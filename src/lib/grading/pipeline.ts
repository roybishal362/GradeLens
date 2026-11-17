import "server-only";

import { runStructured, type PoolResult } from "@/lib/ai/pool";
import { answersForGrading, graderSystem, readerSystem } from "./prompts";
import type { Exemplar } from "./calibration";
import { GradeSchema, ReadResultSchema, type GradeResult, type ReadAnswer, type ReadResult, type Rubric } from "./schemas";
import { guardHarsh, verify, verifyMcq, type Verified } from "./verifier";

export type PageInput = { data: Uint8Array; mediaType: string };

export type QuestionOutcome = Verified & {
  q: number;
  max: number;
  answer: ReadAnswer | undefined;
  gradeA: GradeResult["questions"][number] | undefined;
  gradeB: GradeResult["questions"][number] | undefined;
};

export type StudentOutcome = {
  studentName: string | null; // kept apart from grading; graders never see it
  imageQuality: string;
  questions: QuestionOutcome[];
  total: number;
  max: number;
  risk: "low" | "medium" | "high";
  models: { reader: string; graderA: string; graderB: string };
  ms: { read: number; gradeA: number; gradeB: number };
  attempts: string[]; // models that failed or were skipped before one answered (diagnostics)
  warnings: string[]; // reading problems that don't belong to one question (e.g. an answer labelled with a number not on the test)
};

export type ReadStep = { output: ReadResult; model: string; ms: number; attempts: string[] };

/** Step 1 (1 vision call): read all pages of one student. Stored, so grading can be re-run without re-reading. */
export async function readStudent(pages: PageInput[], rubric: Rubric, opts: { deadline?: number } = {}): Promise<ReadStep> {
  return runStructured({
    task: "read",
    deadline: opts.deadline,
    schema: ReadResultSchema,
    system: readerSystem(rubric),
    messages: [{
      role: "user",
      content: [
        { type: "text", text: `Transcribe these ${pages.length} page(s) of one student's answers.` },
        ...pages.map((p) => ({ type: "file" as const, mediaType: p.mediaType, data: p.data })),
      ],
    }],
  });
}

/**
 * One student = one job: read all pages (1 vision call) -> remove the name -> two independent gradings on two
 * DIFFERENT models -> verify every claim in code. About 3 model calls, well under the 300 s function limit.
 */
export async function gradeStudent(pages: PageInput[], rubric: Rubric, opts: GradeOptions = {}): Promise<StudentOutcome> {
  return gradeRead(await readStudent(pages, rubric, opts), rubric, opts);
}

/**
 * The reader's answers keyed by question number. Duplicates (the reader filed two answers under one number, e.g. a
 * crossed-out first attempt) are joined and flagged; numbers that aren't on the test are reported.
 */
export function collectAnswers(answers: ReadAnswer[], rubric: Rubric): { byQ: Map<number, ReadAnswer>; flags: Map<number, string[]>; warnings: string[] } {
  const byQ = new Map<number, ReadAnswer>(), flags = new Map<number, string[]>(), warnings: string[] = [];
  const onTest = new Set(rubric.questions.map((q) => q.q));
  const stray: number[] = [];
  for (const a of answers) {
    if (!onTest.has(a.q)) { if (a.text.trim()) stray.push(a.q); continue; }
    if (!a.text.trim() && !a.formulas.length && !a.diagram) continue; // an empty item is a blank answer
    const prev = byQ.get(a.q);
    if (!prev) { byQ.set(a.q, a); continue; }
    byQ.set(a.q, {
      ...prev,
      text: `${prev.text}\n${a.text}`,
      formulas: [...prev.formulas, ...a.formulas],
      diagram: prev.diagram ?? a.diagram,
      lines: [...prev.lines, ...a.lines],
      illegible: [...prev.illegible, ...a.illegible],
      confidence: Math.min(prev.confidence, a.confidence),
    });
    flags.set(a.q, ["two answers were found for this question and were joined: check which one counts"]);
  }
  if (stray.length) {
    const qs = [...new Set(stray)].sort((x, y) => x - y);
    warnings.push(`Answers labelled ${qs.length > 8 ? `${qs.slice(0, 8).map((q) => `Q${q}`).join(", ")} and ${qs.length - 8} more` : qs.map((q) => `Q${q}`).join(", ")} are not on this test, so they weren't marked. Check the question numbers.`);
  }
  return { byQ, flags, warnings };
}

export type GradeOptions = { exemplars?: Exemplar[]; deadline?: number };

/**
 * Steps 2-4: anonymize, grade twice on different models, verify. Multiple choice is marked by code (no model call).
 * `exemplars` = answers this teacher already marked, so the graders follow their standard (see calibration.ts).
 */
export async function gradeRead(read: ReadStep, rubric: Rubric, opts: GradeOptions = {}): Promise<StudentOutcome> {
  const { byQ: ans, flags: dupFlags, warnings } = collectAnswers(read.output.answers, rubric);
  const open: Rubric = { questions: rubric.questions.filter((q) => q.type !== "mcq") };
  const openAnswers = open.questions.flatMap((q) => (ans.has(q.q) ? [ans.get(q.q)!] : []));
  const openQs = new Set(open.questions.map((q) => q.q));
  const exemplars = (opts.exemplars ?? []).filter((e) => openQs.has(e.q));

  let gradeA: PoolResult<GradeResult> | undefined;
  let gradeB: PoolResult<GradeResult> | undefined;
  if (openAnswers.length) {
    const system = graderSystem(open, exemplars);
    const payload = answersForGrading(openAnswers);
    gradeA = await runStructured({
      task: "grade", schema: GradeSchema, system, temperature: 0.2, messages: [{ role: "user", content: payload }], deadline: opts.deadline,
    });
    gradeB = await runStructured({
      task: "grade", schema: GradeSchema, system, temperature: 0.2, messages: [{ role: "user", content: payload }], deadline: opts.deadline,
      exclude: [gradeA.model], // independent second opinion from a different model
    });
  }

  const byQ = <T extends { q: number }>(xs: T[] = []) => new Map(xs.map((x) => [x.q, x]));
  const ga = byQ(gradeA?.output.questions), gb = byQ(gradeB?.output.questions);
  const questions: QuestionOutcome[] = rubric.questions.map((rq) => {
    const v = rq.type === "mcq" ? verifyMcq(ans.get(rq.q), rq) : verify(ans.get(rq.q), rq, ga.get(rq.q), gb.get(rq.q));
    const extra = dupFlags.get(rq.q);
    if (extra) { v.flags = [...v.flags, ...extra]; if (v.risk === "low") v.risk = "medium"; }
    return { q: rq.q, max: rq.marks, answer: ans.get(rq.q), gradeA: ga.get(rq.q), gradeB: gb.get(rq.q), ...v };
  });
  const rank = { low: 0, medium: 1, high: 2 } as const;
  return {
    studentName: read.output.studentName,
    imageQuality: read.output.imageQuality,
    questions,
    total: questions.reduce((s, x) => s + x.final, 0),
    max: questions.reduce((s, x) => s + x.max, 0),
    risk: questions.reduce<"low" | "medium" | "high">((r, x) => (rank[x.risk] > rank[r] ? x.risk : r), "low"),
    models: { reader: read.model, graderA: gradeA?.model ?? "none needed", graderB: gradeB?.model ?? "none needed" },
    ms: { read: read.ms, gradeA: gradeA?.ms ?? 0, gradeB: gradeB?.ms ?? 0 },
    attempts: [...read.attempts, ...(gradeA?.attempts ?? []), ...(gradeB?.attempts ?? [])],
    warnings,
  };
}

/**
 * Last step before a suggestion is stored (after any learned shifts): written answers marked 0 go to the teacher
 * (see guardHarsh), then the script's risk is the highest of its questions.
 */
export function finalizeOutcome(outcome: StudentOutcome, rubric: Rubric): StudentOutcome {
  const rank = { low: 0, medium: 1, high: 2 } as const;
  for (const q of outcome.questions) {
    const rq = rubric.questions.find((x) => x.q === q.q);
    guardHarsh(q, Boolean(q.answer?.text?.trim()), rq?.type === "mcq");
  }
  outcome.total = outcome.questions.reduce((s, x) => s + x.final, 0);
  outcome.risk = outcome.questions.reduce<"low" | "medium" | "high">((r, x) => (rank[x.risk] > rank[r] ? x.risk : r), "low");
  return outcome;
}
