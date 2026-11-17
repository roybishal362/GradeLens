import "server-only";

import { pickExemplars, questionShifts, shifted, type Exemplar } from "@/lib/grading/calibration";
import { gradeRead, readStudent, type ReadStep } from "@/lib/grading/pipeline";
import type { Rubric } from "@/lib/grading/schemas";
import { adminDb } from "@/lib/supabase/clients";

/**
 * Free-tier protection. The free model pool allows roughly 100+ page-reads a day in total, so a single visitor must not
 * be able to use it all. Grading pauses (never fails) when a limit is hit and resumes the next day.
 */
export const LIMITS = { guestScriptsPerDay: 12, teacherScriptsPerDay: 60, allScriptsPerDay: 150 };

/** A job must finish inside the function's limit (300 s on Vercel's free plan) with room to save the results. */
const JOB_BUDGET_MS = 270_000;

export type JobResult = { status: "graded" | "waiting" | "busy" | "limited" | "failed"; message?: string };

type SubCtx = {
  id: string; status: string; student_id: string; attempts: number;
  tests: { id: string; rubric: Rubric; rubric_status: string; classes: { owner_id: string; is_sample: boolean } };
  students: { display_name: string };
};

/**
 * Read + grade one student's script and store everything. Safe to call twice: the database claim lets exactly one
 * caller run it. `regrade` re-uses the stored transcription (no new vision call), e.g. after the teacher's first
 * decisions, so the remaining scripts follow their standard.
 */
export async function runGradingJob(submissionId: string, opts: { regrade?: boolean } = {}): Promise<JobResult> {
  const db = adminDb();
  const deadline = Date.now() + JOB_BUDGET_MS;
  const { data: sub, error } = await db
    .from("submissions")
    .select("id,status,student_id,attempts,tests!inner(id,rubric,rubric_status,classes!inner(owner_id,is_sample)),students!inner(display_name)")
    .eq("id", submissionId)
    .single<SubCtx>();
  if (error || !sub) return { status: "failed", message: "This script no longer exists." };
  const test = sub.tests;
  if (test.classes.is_sample) return { status: "failed", message: "The sample class is read-only." };
  if (test.rubric_status !== "approved") {
    await db.from("submissions").update({ status: "queued", error: "Waiting for the mark scheme to be approved." }).eq("id", submissionId);
    return { status: "waiting", message: "Waiting for the mark scheme to be approved." };
  }

  const { data: claimed } = await db.rpc("claim_submission", { sid: submissionId });
  if (!claimed) return { status: "busy" };

  // ---- limits (checked after the claim so two callers can't both spend quota)
  const owner = await db.auth.admin.getUserById(test.classes.owner_id);
  const isGuest = Boolean(owner.data.user?.is_anonymous);
  const ownerOk = (await db.rpc("bump_usage", { b: `grade:owner:${test.classes.owner_id}`, lim: isGuest ? LIMITS.guestScriptsPerDay : LIMITS.teacherScriptsPerDay })).data;
  const allOk = ownerOk && (await db.rpc("bump_usage", { b: "grade:all", lim: LIMITS.allScriptsPerDay })).data;
  if (!ownerOk || !allOk) {
    const message = !ownerOk
      ? `Today's free grading limit for this account is used up (${isGuest ? LIMITS.guestScriptsPerDay : LIMITS.teacherScriptsPerDay} scripts). Grading continues tomorrow.`
      : "GradeLens has used today's free AI capacity. Grading continues tomorrow.";
    await db.from("submissions").update({ status: "queued", error: message, attempts: sub.attempts }).eq("id", submissionId);
    return { status: "limited", message };
  }

  const { data: run } = await db
    .from("grading_runs")
    .insert({ submission_id: submissionId, status: "running", started_at: new Date().toISOString() })
    .select("id")
    .single<{ id: string }>();
  const runId = run?.id;

  try {
    // ---- 1. read (or re-use the stored transcription)
    let read: ReadStep | null = null;
    if (opts.regrade) {
      const { data: prev } = await db
        .from("grading_runs")
        .select("read_result,models,timings_ms")
        .eq("submission_id", submissionId)
        .eq("status", "done")
        .not("read_result", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<{ read_result: ReadStep["output"]; models: { reader?: string } | null; timings_ms: { read?: number } | null }>();
      if (prev?.read_result) read = { output: prev.read_result, model: prev.models?.reader ?? "stored", ms: 0, attempts: ["re-used the stored transcription"] };
    }
    if (!read) {
      const pages = await loadPages(submissionId);
      if (!pages.length) throw new UserFacing("No pages were uploaded for this script.");
      read = await readStudent(pages, test.rubric, { deadline });
    }
    await db.from("grading_runs").update({ read_result: read.output }).eq("id", runId);
    await db.from("submissions").update({ status: "grading" }).eq("id", submissionId);

    // ---- 2. grade twice + verify, following this teacher's standard so far (examples in the prompt, then each
    // question's learned shift: measured on held-out real scripts, see src/eval/mendeley.eval.ts)
    const standard = await teacherStandard(test.id, submissionId);
    const outcome = await gradeRead(read, test.rubric, { exemplars: standard.exemplars, deadline });
    for (const q of outcome.questions) {
      const s = standard.shifts.get(q.q);
      const rq = test.rubric.questions.find((x) => x.q === q.q);
      if (!s || !q.answer?.text?.trim() || rq?.type === "mcq") continue;
      const moved = shifted(q.final, q.max, s.shift, true);
      if (moved === q.final) continue;
      q.flags = [...q.flags, `adjusted ${moved > q.final ? "+" : "−"}${Math.abs(moved - q.final)} to match your marking on this question (learned from ${s.n} answers you reviewed)`];
      q.final = moved;
    }
    outcome.total = outcome.questions.reduce((sum, q) => sum + q.final, 0);

    // ---- 3. store: teacher decisions are never overwritten; everything else is replaced
    const { data: kept } = await db.from("question_results").select("q").eq("submission_id", submissionId).eq("approved", true);
    const approvedQs = new Set((kept ?? []).map((r: { q: number }) => r.q));
    await db.from("question_results").delete().eq("submission_id", submissionId).eq("approved", false);
    const rows = outcome.questions.filter((q) => !approvedQs.has(q.q)).map((q) => ({
      submission_id: submissionId, q: q.q, max: q.max, score_a: q.scoreA, score_b: q.scoreB, ai_score: q.final, risk: q.risk,
      flags: q.flags, answer: q.answer ?? null, grade_a: q.gradeA ?? null, grade_b: q.gradeB ?? null,
    }));
    if (rows.length) {
      const { error: insErr } = await db.from("question_results").insert(rows);
      if (insErr) throw new Error(`saving marks failed: ${insErr.message}`);
    }
    const warnings = [...outcome.warnings];
    const nameWarning = nameMismatch(outcome.studentName, sub.students.display_name);
    if (nameWarning) warnings.unshift(nameWarning);
    if (outcome.imageQuality !== "good") warnings.push(`Photo quality: ${outcome.imageQuality.replace("_", " ")}. Check the reading carefully.`);
    await db.from("submissions").update({ status: "graded", risk: outcome.risk, error: null, warnings }).eq("id", submissionId);
    await db.rpc("refresh_submission", { sid: submissionId });
    await db.from("grading_runs").update({
      status: "done", models: outcome.models, timings_ms: outcome.ms, attempts: outcome.attempts, finished_at: new Date().toISOString(),
    }).eq("id", runId);
    return { status: "graded" };
  } catch (e) {
    const raw = String(e instanceof Error ? e.message : e);
    const message = e instanceof UserFacing
      ? e.message
      : /All free models failed|Out of time/.test(raw)
        ? "The free AI models are busy right now. GradeLens will try again shortly."
        : "Something went wrong while marking this script. Try again.";
    await db.from("grading_runs").update({ status: "failed", error: raw.slice(0, 4000), finished_at: new Date().toISOString() }).eq("id", runId);
    await db.from("submissions").update({ status: "failed", error: message }).eq("id", submissionId);
    return { status: "failed", message };
  }
}

class UserFacing extends Error {}

async function loadPages(submissionId: string) {
  const db = adminDb();
  const { data: pages } = await db.from("pages").select("storage_path,media_type,page_no").eq("submission_id", submissionId).order("page_no");
  const out: { data: Uint8Array; mediaType: string }[] = [];
  for (const p of pages ?? []) {
    const { data, error } = await db.storage.from("pages").download(p.storage_path);
    if (error || !data) throw new UserFacing(`Page ${p.page_no} could not be loaded. Ask the student to upload again.`);
    out.push({ data: new Uint8Array(await data.arrayBuffer()), mediaType: p.media_type });
  }
  return out;
}

/**
 * This teacher's standard so far, from the answers they already decided on in this test (other students): examples for
 * the graders' prompt, and per-question shifts. Shifts compare the teacher's mark with GradeLens' RAW suggestion (the
 * two graders' average), never with an already-shifted one, so adjustments can't compound.
 */
async function teacherStandard(testId: string, exceptSubmission: string): Promise<{ exemplars: Exemplar[]; shifts: ReturnType<typeof questionShifts> }> {
  const { data } = await adminDb()
    .from("question_results")
    .select("q,max,answer,score_a,score_b,ai_score,teacher_score,submissions!inner(test_id)")
    .eq("submissions.test_id", testId)
    .eq("approved", true)
    .neq("submission_id", exceptSubmission)
    .limit(2000);
  type Row = { q: number; max: number; answer: { text?: string } | null; score_a: number; score_b: number; ai_score: number; teacher_score: number | null };
  const rows = (data ?? []) as Row[];
  const raw = (r: Row) => Math.min(Number(r.max), Math.round(((Number(r.score_a) + Number(r.score_b)) / 2) * 2) / 2);
  const answered = rows.filter((r) => r.answer?.text?.trim());
  return {
    exemplars: pickExemplars(answered.map((r) => ({ q: r.q, answer: r.answer!.text!, score: Number(r.teacher_score ?? r.ai_score), aiScore: raw(r) })), 4),
    shifts: questionShifts(answered.map((r) => ({ q: r.q, ai: raw(r), teacher: Number(r.teacher_score ?? r.ai_score) }))),
  };
}

/** "The name on the script doesn't match": catches a mixed-up upload before marks reach the wrong student. */
export function nameMismatch(written: string | null, rosterName: string): string | null {
  if (!written?.trim()) return null;
  const tokens = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\s]/gu, " ").split(/\s+/).filter((t) => t.length > 1);
  const a = tokens(written), b = tokens(rosterName);
  if (!a.length || !b.length) return null;
  const close = (x: string, y: string) => x === y || (x.length >= 3 && y.length >= 3 && (x.startsWith(y) || y.startsWith(x))) || editDistance(x, y) <= (Math.max(x.length, y.length) >= 6 ? 2 : 1);
  if (a.some((x) => b.some((y) => close(x, y)))) return null;
  return `The name written on the script ("${written.trim().slice(0, 60)}") doesn't look like ${rosterName}. Check it's the right student's work.`;
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}
