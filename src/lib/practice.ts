import "server-only";

import { gradeRead, readStudent, type ReadStep } from "@/lib/grading/pipeline";
import type { Rubric } from "@/lib/grading/schemas";
import { applyShifts, teacherStandard } from "@/lib/jobs/grade";
import { adminDb } from "@/lib/supabase/clients";

export type PracticeTest = {
  id: string; title: string; rubric: Rubric; className: string; classId: string; isSample: boolean; open: boolean;
};

/** The test behind a practice link (the token is the only credential; it's server-only like the upload token). */
export async function practiceTest(token: string): Promise<PracticeTest | null> {
  if (!/^[0-9a-f]{32}$/.test(token)) return null;
  const { data } = await adminDb().from("tests")
    .select("id,title,rubric,rubric_status,practice_open,class_id,classes!inner(name,is_sample)")
    .eq("practice_token", token).maybeSingle<{ id: string; title: string; rubric: Rubric; rubric_status: string; practice_open: boolean; class_id: string; classes: { name: string; is_sample: boolean } }>();
  if (!data || data.rubric_status !== "approved") return null;
  return { id: data.id, title: data.title, rubric: data.rubric, className: data.classes.name, classId: data.class_id, isSample: data.classes.is_sample, open: data.practice_open };
}

/** Typed answers become a "reading" directly: no vision call, nothing to misread. */
export function typedRead(answers: { q: number; text: string }[]): ReadStep {
  return {
    model: "typed",
    ms: 0,
    attempts: [],
    output: {
      studentName: null,
      imageQuality: "good",
      answers: answers.filter((a) => a.text.trim()).map((a) => ({
        q: a.q, text: a.text.trim(), formulas: [], diagram: null, lines: [], page: 1, illegible: [], confidence: 1,
      })),
    },
  };
}

export type PracticeFeedback = {
  q: number; question: string; max: number; mark: number; answer: string; uncertain: boolean;
  criteria: { text: string; max: number; points: number; reason: string; evidence: string }[];
  misconceptions: string[]; modelAnswer: string;
};

/**
 * Mark a practice attempt with the same pipeline as real scripts (two markers, verified evidence, the teacher's
 * standard), and keep a record for the teacher. Practice photos are read and then discarded, never stored.
 */
export async function gradePractice(opts: {
  test: PracticeTest; studentId: string | null; typed?: { q: number; text: string }[]; pages?: { data: Uint8Array; mediaType: string }[];
}): Promise<{ feedback: PracticeFeedback[]; score: number; max: number }> {
  const deadline = Date.now() + 240_000;
  const read = opts.typed ? typedRead(opts.typed) : await readStudent(opts.pages!, opts.test.rubric, { deadline });
  const answered = new Set(read.output.answers.filter((a) => a.text.trim()).map((a) => a.q));
  const rubric: Rubric = { questions: opts.test.rubric.questions.filter((q) => answered.has(q.q)) };
  if (!rubric.questions.length) return { feedback: [], score: 0, max: 0 };
  const standard = await teacherStandard(opts.test.id, null);
  const outcome = await gradeRead(read, rubric, { exemplars: standard.exemplars, deadline });
  applyShifts(outcome, rubric, standard.shifts);

  const feedback: PracticeFeedback[] = outcome.questions.map((q) => {
    const rq = rubric.questions.find((x) => x.q === q.q)!;
    const isMcq = rq.type === "mcq";
    return {
      q: q.q, question: rq.text, max: q.max, mark: q.final, answer: q.answer?.text ?? "",
      uncertain: q.risk !== "low",
      criteria: isMcq
        ? [{ text: `The correct option is ${rq.modelAnswer.trim().slice(0, 1).toUpperCase()}`, max: q.max, points: q.final, reason: q.final ? "Correct." : "Not the correct option.", evidence: "" }]
        : rq.criteria.map((c) => {
          const g = q.gradeA?.criteria.find((x) => x.id === c.id);
          return { text: c.mustMention, max: c.points, points: g?.points ?? 0, reason: g?.reason ?? "", evidence: g?.evidenceQuote ?? "" };
        }),
      misconceptions: [...new Set([...(q.gradeA?.misconceptions ?? []), ...(q.gradeB?.misconceptions ?? [])])],
      modelAnswer: isMcq ? `Option ${rq.modelAnswer.trim().slice(0, 1).toUpperCase()}` : rq.modelAnswer,
    };
  });
  const score = feedback.reduce((s, f) => s + f.mark, 0), max = feedback.reduce((s, f) => s + f.max, 0);
  await adminDb().from("practice_attempts").insert({
    test_id: opts.test.id, student_id: opts.studentId, mode: opts.typed ? "typed" : "photo",
    questions: feedback.map((f) => f.q), score, max,
    result: feedback.map(({ q, mark, max, criteria, misconceptions, answer }) => ({ q, mark, max, criteria: criteria.map((c) => ({ text: c.text, points: c.points, max: c.max })), misconceptions, answer: answer.slice(0, 600) })),
    models: outcome.models,
  });
  return { feedback, score, max };
}
