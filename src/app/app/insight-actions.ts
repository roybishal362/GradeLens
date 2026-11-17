"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireTeacher } from "@/lib/dal";
import type { MisconceptionMap, ReteachPayload } from "@/lib/db/insights";
import { QR_COLS, type QuestionResultRow, type StudentRow } from "@/lib/db/types";
import { draftRubric, mcqRubric } from "@/lib/grading/rubric-agent";
import { checkRubric } from "@/lib/grading/rubric-check";
import type { Rubric } from "@/lib/grading/schemas";
import { clusterMisconceptions, planReteach, type Observation } from "@/lib/insights/agents";
import { adminDb, userDb } from "@/lib/supabase/clients";
import { underLimit } from "@/lib/uploads";

type Result = { ok: true; message?: string } | { ok: false; error: string };

/** Group what the graders noticed into class-level misconceptions (names never leave the server: codes only). */
export async function buildMisconceptionMap(testId: string): Promise<Result> {
  const t = await requireTeacher();
  const db = await userDb();
  const { data: test } = await db.from("tests").select("id,class_id").eq("id", testId).maybeSingle<{ id: string; class_id: string }>();
  if (!test) return { ok: false, error: "Test not found." };
  const [{ data: subs }, { data: students }, { data: results }] = await Promise.all([
    db.from("submissions").select("id,student_id,status").eq("test_id", testId).in("status", ["graded", "approved"]),
    db.from("students").select("id,anon_code").eq("class_id", test.class_id).returns<Pick<StudentRow, "id" | "anon_code">[]>(),
    db.from("question_results").select(`${QR_COLS},submissions!inner(test_id)`).eq("submissions.test_id", testId).limit(5000).returns<QuestionResultRow[]>(),
  ]);
  if (!subs?.length) return { ok: false, error: "No marked scripts yet." };
  const code = new Map((students ?? []).map((s) => [s.id, s.anon_code]));
  const subCode = new Map(subs.map((s: { id: string; student_id: string }) => [s.id, code.get(s.student_id) ?? "S??"]));
  const obs: Observation[] = [];
  for (const r of results ?? []) {
    if (!subCode.has(r.submission_id)) continue;
    // a misconception only counts where the answer actually lost marks
    if (Number(r.teacher_score ?? r.ai_score) >= Number(r.max)) continue;
    const seen = new Set<string>();
    for (const m of [...(r.grade_a?.misconceptions ?? []), ...(r.grade_b?.misconceptions ?? [])]) {
      const k = m.toLowerCase().trim();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      obs.push({ code: subCode.get(r.submission_id)!, q: r.q, misconception: m, quote: r.answer?.text ?? "" });
    }
  }
  if (!obs.length) return { ok: false, error: "The graders didn't record any misconceptions in these scripts." };
  if (!(await underLimit(`ai:text:${t.id}`, t.isGuest ? 15 : 60))) return { ok: false, error: "Today's AI limit for this account is used up. Try again tomorrow." };
  try {
    const { clusters, model } = await clusterMisconceptions(obs);
    const payload: MisconceptionMap = { clusters, scripts: subs.length, approved: subs.filter((s: { status: string }) => s.status === "approved").length, generatedAt: new Date().toISOString() };
    await adminDb().from("insights").insert({ test_id: testId, kind: "misconceptions", payload, model }); // ownership checked above (RLS)
  } catch {
    return { ok: false, error: "The free AI models are busy. Try again in a minute." };
  }
  revalidatePath(`/app/tests/${testId}/insights`);
  return { ok: true };
}

export async function buildReteach(testId: string, clusterId: string): Promise<Result> {
  const t = await requireTeacher();
  const db = await userDb();
  const { data: test } = await db.from("tests").select("id,rubric").eq("id", testId).maybeSingle<{ id: string; rubric: Rubric }>();
  if (!test) return { ok: false, error: "Test not found." };
  const { data: row } = await db.from("insights").select("payload").eq("test_id", testId).eq("kind", "misconceptions").order("created_at", { ascending: false }).limit(1).maybeSingle<{ payload: MisconceptionMap }>();
  const cluster = row?.payload.clusters.find((c) => c.id === clusterId);
  if (!cluster) return { ok: false, error: "That misconception is no longer on the map. Refresh the page." };
  if (!(await underLimit(`ai:text:${t.id}`, t.isGuest ? 15 : 60))) return { ok: false, error: "Today's AI limit for this account is used up. Try again tomorrow." };
  try {
    const { reteach, model } = await planReteach(cluster, test.rubric);
    const payload: ReteachPayload = { ...reteach, clusterId: cluster.id, label: cluster.label };
    await adminDb().from("insights").insert({ test_id: testId, kind: "reteach", payload, model });
  } catch {
    return { ok: false, error: "The free AI models are busy. Try again in a minute." };
  }
  revalidatePath(`/app/tests/${testId}/insights`);
  return { ok: true };
}

/** Turn a re-teach plan's re-test questions into a new test (mark scheme drafted, waiting for the teacher's approval). */
export async function createRetest(testId: string, reteachId: string): Promise<Result> {
  const t = await requireTeacher();
  const db = await userDb();
  const { data: test } = await db.from("tests").select("id,class_id,title").eq("id", testId).maybeSingle<{ id: string; class_id: string; title: string }>();
  if (!test) return { ok: false, error: "Test not found." };
  const { data: row } = await db.from("insights").select("payload").eq("id", reteachId).eq("test_id", testId).maybeSingle<{ payload: ReteachPayload }>();
  if (!row) return { ok: false, error: "Plan not found." };
  const qs = row.payload.retest.map((q, i) => ({ q: i + 1, text: q.text, marks: q.marks, answerKey: q.answerKey, type: q.type }));
  if (!(await underLimit(`ai:text:${t.id}`, t.isGuest ? 15 : 60))) return { ok: false, error: "Today's AI limit for this account is used up. Try again tomorrow." };
  let rubric: Rubric;
  try {
    const open = qs.filter((q) => q.type !== "mcq");
    const drafted = open.length ? (await draftRubric(open)).rubric.questions : [];
    rubric = { questions: [...qs.filter((q) => q.type === "mcq").map(mcqRubric), ...drafted].sort((a, b) => a.q - b.q) };
  } catch {
    return { ok: false, error: "The free AI models are busy. Try again in a minute." };
  }
  const problems = checkRubric(rubric, qs);
  const title = `Re-test: ${row.payload.label}`.slice(0, 160);
  const { data: created, error } = await db.from("tests")
    .insert({ class_id: test.class_id, title, rubric, rubric_status: "draft", parent_test_id: testId })
    .select("id").single<{ id: string }>();
  if (error || !created) return { ok: false, error: "Couldn't create the re-test." };
  revalidatePath(`/app/tests/${testId}/insights`);
  redirect(`/app/tests/${created.id}/mark-scheme${problems.length ? "?check=1" : ""}`);
}

/** Check the question paper before it's given (not stored: the teacher reads it and edits the paper). */
export async function checkQuestionPaper(testId: string): Promise<{ ok: true; check: import("@/lib/insights/agents").PaperCheck } | { ok: false; error: string }> {
  const t = await requireTeacher();
  const db = await userDb();
  const { data: test } = await db.from("tests").select("id,rubric").eq("id", testId).maybeSingle<{ id: string; rubric: Rubric }>();
  if (!test) return { ok: false, error: "Test not found." };
  if (!test.rubric.questions.length) return { ok: false, error: "Add questions first." };
  if (!(await underLimit(`ai:text:${t.id}`, t.isGuest ? 15 : 60))) return { ok: false, error: "Today's AI limit for this account is used up. Try again tomorrow." };
  try {
    const { checkPaper } = await import("@/lib/insights/agents");
    return { ok: true, check: await checkPaper(test.rubric) };
  } catch {
    return { ok: false, error: "The free AI models are busy. Try again in a minute." };
  }
}
