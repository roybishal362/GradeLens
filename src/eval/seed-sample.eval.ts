/**
 * Builds the public sample class from REAL outputs: the Mendeley dataset's handwritten scripts as read and graded by
 * the GradeLens pipeline in the evaluation (loaded from its cache, never re-generated or edited).
 *
 *   SEED_CALIBRATE=1-5 SEED_STUDENTS=6-25 npm run eval -- -t seed
 *
 * - Calibration students: GradeLens' marks, then the dataset teacher's real marks applied as the teacher's decisions
 *   (red pen), with an audit event each. They are the examples the other scripts were calibrated with.
 * - Other students: GradeLens' calibrated suggestions (pencil), waiting for review, with the dataset teacher's mark
 *   stored as `reference_score` so visitors can compare.
 * - Page images are copied to public/sample/mendeley (CC BY 4.0, attributed on the sample pages).
 * - The misconception map and one re-teach plan are produced by the real agents from these results.
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { questionShifts, shifted } from "@/lib/grading/calibration";
import type { StudentOutcome } from "@/lib/grading/pipeline";
import { clusterMisconceptions, planReteach, type Observation } from "@/lib/insights/agents";
import { cachedGrade, cachedRead, calibrate, loadRubric, loadTeacher, PAGES, pageIndex, range } from "./mendeley-data";

const PUBLIC_DIR = new URL("../../public/sample/mendeley/", import.meta.url);
const OWNER_EMAIL = "sample-class@gradelens.invalid"; // a system account that owns the read-only sample class

describe("sample class", () => {
  it("seed", async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!, secret = process.env.SUPABASE_SECRET_KEY!;
    const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
    const rubric = loadRubric();
    const teacher = loadTeacher();
    const calibN = range(process.env.SEED_CALIBRATE, "1-5");
    const testN = range(process.env.SEED_STUDENTS, "6-25").filter((n) => !calibN.includes(n));
    const calib = calibN.map((n) => `Student_${n}`);

    // 1. outcomes from the evaluation cache only
    const { exemplars, outcomes: calibOutcomes } = await calibrate(calib, rubric, teacher, true, console.log);
    expect(calibOutcomes.size).toBe(calib.length);
    const testOutcomes = new Map<string, StudentOutcome>();
    for (const n of testN) {
      const s = `Student_${n}`;
      try {
        testOutcomes.set(s, await cachedGrade(s, await cachedRead(s, rubric, true), rubric, exemplars, true));
      } catch (e) { console.log(`skip ${s}: ${String(e).slice(0, 120)}`); }
    }
    // exactly what the product does after the teacher reviewed the calibration scripts: each question's learned shift
    const decisions = [...calibOutcomes].flatMap(([st, o]) => o.questions.filter((q) => q.q > 20 && teacher[st].marks[q.q] !== null).map((q) => ({ q: q.q, ai: q.final, teacher: teacher[st].marks[q.q]! })));
    const shifts = questionShifts(decisions);
    for (const o of testOutcomes.values()) {
      for (const q of o.questions) {
        const sh = shifts.get(q.q);
        if (!sh || q.q <= 20 || !q.answer?.text?.trim()) continue;
        const moved = shifted(q.final, q.max, sh.shift, true);
        if (moved === q.final) continue;
        q.flags = [...q.flags, `adjusted ${moved > q.final ? "+" : "−"}${Math.abs(moved - q.final)} to match your marking on this question (learned from ${sh.n} answers you reviewed)`];
        q.final = moved;
      }
      o.total = o.questions.reduce((sum, q) => sum + q.final, 0);
    }
    console.log(`outcomes: ${calibOutcomes.size} calibration + ${testOutcomes.size} calibrated students; ${shifts.size} questions with a learned shift`);
    expect(testOutcomes.size).toBeGreaterThan(0);

    // 2. the owner account (no password anyone knows; it never signs in)
    const { data: list } = await db.auth.admin.listUsers({ perPage: 200 });
    let owner = list.users.find((u) => u.email === OWNER_EMAIL);
    if (!owner) {
      const { data, error } = await db.auth.admin.createUser({ email: OWNER_EMAIL, password: crypto.randomUUID() + crypto.randomUUID(), email_confirm: true });
      if (error || !data.user) throw new Error(`owner: ${error?.message}`);
      owner = data.user;
    }

    // 3. replace the previous sample class
    await db.from("classes").delete().eq("owner_id", owner.id);
    const { data: cls, error: e1 } = await db.from("classes")
      .insert({ owner_id: owner.id, name: "Data Science, university (sample class)", subject: "Data Science", is_sample: true })
      .select("id").single<{ id: string }>();
    if (e1 || !cls) throw new Error(`class: ${e1?.message}`);
    const { data: test, error: e2 } = await db.from("tests")
      .insert({ class_id: cls.id, title: "Data Science examination (20 multiple choice + 15 short answers)", rubric, rubric_status: "approved", uploads_open: false, practice_open: true })
      .select("id").single<{ id: string }>();
    if (e2 || !test) throw new Error(`test: ${e2?.message}`);

    // 4. students, scripts, pages, marks
    mkdirSync(PUBLIC_DIR, { recursive: true });
    const index = pageIndex();
    const all = [...calib.map((s) => [s, calibOutcomes.get(s)!, true] as const), ...[...testOutcomes].map(([s, o]) => [s, o, false] as const)];
    const observations: Observation[] = [];
    for (const [student, outcome, isCalib] of all) {
      const n = Number(student.split("_")[1]);
      const { data: st, error: e3 } = await db.from("students")
        .insert({ class_id: cls.id, display_name: `Student ${n}`, anon_code: `S${String(n).padStart(2, "0")}` })
        .select("id").single<{ id: string }>();
      if (e3 || !st) throw new Error(`student: ${e3?.message}`);
      const { data: sub, error: e4 } = await db.from("submissions")
        .insert({ test_id: test.id, student_id: st.id, status: "graded", source: "sample", risk: outcome.risk, warnings: outcome.warnings ?? [] })
        .select("id").single<{ id: string }>();
      if (e4 || !sub) throw new Error(`submission: ${e4?.message}`);

      const files = index[student];
      for (const f of files) if (!existsSync(new URL(f, PUBLIC_DIR))) copyFileSync(new URL(f, PAGES), new URL(f, PUBLIC_DIR));
      await db.from("pages").insert(files.map((f, i) => ({ submission_id: sub.id, page_no: i + 1, storage_path: `/sample/mendeley/${f}`, media_type: "image/jpeg" })));

      const rows = outcome.questions.map((q) => {
        const ref = q.q > 20 ? teacher[student].marks[q.q] : null;
        const teacherScore = isCalib && ref !== null && ref !== undefined ? ref : null;
        return {
          submission_id: sub.id, q: q.q, max: q.max, score_a: q.scoreA, score_b: q.scoreB, ai_score: q.final, risk: q.risk, flags: q.flags,
          answer: q.answer ?? null, grade_a: q.gradeA ?? null, grade_b: q.gradeB ?? null, reference_score: ref ?? null,
          approved: isCalib, approved_at: isCalib ? new Date().toISOString() : null,
          teacher_score: teacherScore !== null && teacherScore !== q.final ? teacherScore : null,
          teacher_note: teacherScore !== null && teacherScore !== q.final ? "Mark from the dataset's teacher" : null,
        };
      });
      const { data: inserted, error: e5 } = await db.from("question_results").insert(rows).select("id,ai_score,teacher_score");
      if (e5 || !inserted) throw new Error(`marks: ${e5?.message}`);
      if (isCalib) {
        await db.from("review_events").insert(inserted.map((r: { id: string; ai_score: number; teacher_score: number | null }) => ({
          question_result_id: r.id, actor_id: null, action: r.teacher_score === null ? "approve" : "adjust",
          from_score: r.ai_score, to_score: r.teacher_score ?? r.ai_score,
          note: r.teacher_score === null ? null : "Mark from the dataset's teacher",
        })));
      }
      await db.rpc("refresh_submission", { sid: sub.id });
      if (isCalib) {
        await db.from("submissions").update({ status: "approved" }).eq("id", sub.id);
        await db.rpc("refresh_submission", { sid: sub.id });
      }

      // misconceptions only where marks were actually lost (same rule as the product)
      for (const q of outcome.questions) {
        const mark = isCalib && q.q > 20 && teacher[student].marks[q.q] !== null ? teacher[student].marks[q.q]! : q.final;
        if (mark >= q.max) continue;
        const seen = new Set<string>();
        for (const m of [...(q.gradeA?.misconceptions ?? []), ...(q.gradeB?.misconceptions ?? [])]) {
          const k = m.toLowerCase().trim();
          if (k && !seen.has(k)) { seen.add(k); observations.push({ code: `S${String(n).padStart(2, "0")}`, q: q.q, misconception: m, quote: q.answer?.text ?? "" }); }
        }
      }
      console.log(`${student}: ${outcome.total}/${outcome.max}${isCalib ? " (approved with the dataset teacher's marks)" : ""}`);
    }

    // 5. insights from the real agents
    if (process.env.SEED_INSIGHTS !== "0") {
      try {
        const { clusters, model } = await clusterMisconceptions(observations);
        await db.from("insights").insert({
          test_id: test.id, kind: "misconceptions", model,
          payload: { clusters, scripts: all.length, approved: calib.length, generatedAt: new Date().toISOString() },
        });
        console.log(`misconception map: ${clusters.length} groups from ${observations.length} observations (${model})`);
        const top = clusters.find((c) => c.students.length >= 2 && c.explanation);
        if (top) {
          const { reteach, model: m2 } = await planReteach(top, rubric);
          await db.from("insights").insert({ test_id: test.id, kind: "reteach", model: m2, payload: { ...reteach, clusterId: top.id, label: top.label } });
          console.log(`re-teach plan for "${top.label}" (${m2})`);
        }
      } catch (e) { console.log(`insights skipped: ${String(e).slice(0, 200)}`); }
    }
    console.log(`sample class ready: test ${test.id}`);
  });
});
