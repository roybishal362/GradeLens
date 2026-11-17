/**
 * Real-world evaluation on the Mendeley dataset (CC BY 4.0, DOI 10.17632/sf3kvjwknt.1): 50 university students'
 * handwritten Data Science exams + the teacher's item-level marks. Compares GradeLens to the teacher, question by question.
 *
 *   npm run eval -- -t rubric               draft + check the rubric from the official answer key (review it before grading)
 *   EVAL_CALIBRATE=1-5 EVAL_STUDENTS=6-20 npm run eval -- -t grade
 *
 * Calibration is simulated the way a teacher would use it: GradeLens marks the calibration students, the teacher's real
 * marks for them become examples of the teacher's standard, and the test students (never used as examples) are graded
 * twice: without examples ("rubric only") and with them ("calibrated"). Both are reported on the same test students.
 *
 * Everything is cached by content hash (reads per reader prompt, gradings per prompt + answers), so an interrupted
 * run resumes without spending free-tier quota twice, and a prompt change automatically invalidates the cache.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { StudentOutcome } from "@/lib/grading/pipeline";
import type { ReadStep } from "@/lib/grading/pipeline";
import { draftRubric } from "@/lib/grading/rubric-agent";
import type { Rubric } from "@/lib/grading/schemas";
import { questionShifts, shifted } from "@/lib/grading/calibration";
import { mcqChoice } from "@/lib/grading/verifier";
import { cachedGrade, cachedRead, calibrate, loadQuestions, loadRubric, loadTeacher, OUT, range, RUBRIC_FILE, type Teacher } from "./mendeley-data";

// ---------------------------------------------------------------- metrics
function quadraticKappa(pairs: [number, number][], cats = [0, 0.5, 1, 1.5, 2]): number {
  const k = cats.length, idx = (v: number) => cats.indexOf(Math.round(v * 2) / 2);
  const O = Array.from({ length: k }, () => Array(k).fill(0));
  for (const [a, b] of pairs) O[idx(a)][idx(b)]++;
  const n = pairs.length, rowT = O.map((r) => r.reduce((s, x) => s + x, 0)), colT = O[0].map((_, j) => O.reduce((s, r) => s + r[j], 0));
  let num = 0, den = 0;
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
    const w = ((i - j) ** 2) / ((k - 1) ** 2);
    num += w * O[i][j];
    den += w * (rowT[i] * colT[j]) / n;
  }
  return den === 0 ? 1 : 1 - num / den;
}

type Row = {
  student: string; q: number; ai: number; teacher: number | null; risk: string; flags: string[]; aiText: string;
  scoreA: number; scoreB: number; confA: number | null; confB: number | null; readConf: number | null;
};

function rowsOf(student: string, r: StudentOutcome, t: Teacher): Row[] {
  return r.questions.filter((q) => q.q > 20).map((q) => ({
    student, q: q.q, ai: q.final, teacher: t.marks[q.q], risk: q.risk, flags: q.flags,
    aiText: (q.answer?.text ?? "").replace(/\s+/g, " ").slice(0, 160),
    scoreA: q.scoreA, scoreB: q.scoreB, confA: q.gradeA?.confidence ?? null, confB: q.gradeB?.confidence ?? null,
    readConf: q.answer?.confidence ?? null,
  }));
}

function metrics(rows: Row[]) {
  const marked = rows.filter((x) => x.teacher !== null) as (Row & { teacher: number })[];
  const n = marked.length;
  const within = (x: Row & { teacher: number }) => Math.abs(x.ai - x.teacher) <= 0.5;
  const low = marked.filter((x) => x.risk === "low"), flagged = marked.filter((x) => x.risk !== "low");
  const wrong = marked.filter((x) => !within(x));
  const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : "n/a");
  const share = (a: number, b: number) => (b ? Math.round((1000 * a) / b) / 1000 : null);
  const caughtN = wrong.filter((x) => x.risk !== "low").length;
  return {
    n, wrong,
    numbers: {
      n,
      exact: share(marked.filter((x) => x.ai === x.teacher).length, n),
      withinHalf: share(marked.filter(within).length, n),
      mae: Math.round((marked.reduce((s, x) => s + Math.abs(x.ai - x.teacher), 0) / Math.max(1, n)) * 1000) / 1000,
      bias: Math.round((marked.reduce((s, x) => s + (x.ai - x.teacher), 0) / Math.max(1, n)) * 1000) / 1000,
      qwk: Math.round(quadraticKappa(marked.map((x) => [x.ai, x.teacher])) * 1000) / 1000,
      autoApprovable: share(low.length, n),
      withinHalfAmongLow: share(low.filter(within).length, low.length),
      withinHalfAmongFlagged: share(flagged.filter(within).length, flagged.length),
      errorsCaught: share(caughtN, wrong.length), errors: wrong.length, caught: caughtN,
      unmarked: rows.filter((x) => x.teacher === null).length,
      unmarkedGivenMarks: rows.filter((x) => x.teacher === null && x.ai > 0).length,
    },
    table: {
      "Exact agreement with the teacher": pct(marked.filter((x) => x.ai === x.teacher).length, n),
      "Within ±0.5 mark": pct(marked.filter(within).length, n),
      "Mean absolute error (marks, out of 2)": (marked.reduce((s, x) => s + Math.abs(x.ai - x.teacher), 0) / Math.max(1, n)).toFixed(3),
      "Bias (AI − teacher; + = AI more lenient)": (() => { const b = marked.reduce((s, x) => s + (x.ai - x.teacher), 0) / Math.max(1, n); return `${b >= 0 ? "+" : ""}${b.toFixed(3)}`; })(),
      "Quadratic weighted kappa": quadraticKappa(marked.map((x) => [x.ai, x.teacher])).toFixed(3),
      "Answers auto-approvable (low risk)": pct(low.length, n),
      "Within ±0.5 among low-risk answers": pct(low.filter(within).length, low.length),
      "Within ±0.5 among flagged answers": pct(flagged.filter(within).length, flagged.length),
      "Errors > 0.5 caught by a flag": `${pct(wrong.filter((x) => x.risk !== "low").length, wrong.length)} (${wrong.filter((x) => x.risk !== "low").length}/${wrong.length})`,
      "Items the teacher left unmarked (NC): AI gave > 0": `${rows.filter((x) => x.teacher === null && x.ai > 0).length} of ${rows.filter((x) => x.teacher === null).length}`,
    } as Record<string, string>,
  };
}

describe("Mendeley real-data evaluation", () => {
  it("rubric", async () => {
    if (existsSync(RUBRIC_FILE)) { console.log("rubric.json exists; delete it to redraft"); return; }
    const questions = loadQuestions();
    const shortQs = questions.filter((q) => q.type !== "mcq");
    const { rubric, model, problems } = await draftRubric(shortQs);
    // MCQs are graded by code: the correct option is the model answer.
    const mcq = questions.filter((q) => q.type === "mcq").map((q) => ({
      q: q.q, type: "mcq" as const, marks: 1, text: q.text, modelAnswer: q.answerKey,
      criteria: [{ id: `${q.q}a`, points: 1, mustMention: `option ${q.answerKey}` }], commonMisconceptions: [],
    }));
    const full: Rubric = { questions: [...mcq, ...rubric.questions].sort((a, b) => a.q - b.q) };
    writeFileSync(RUBRIC_FILE, JSON.stringify({ model, problems, rubric: full }, null, 1));
    console.log(`drafted by ${model}; problems: ${problems.length ? problems.join(" | ") : "none"}`);
    expect(problems).toEqual([]);
  });

  it("grade", async () => {
    const rubric = loadRubric();
    const teacher = loadTeacher();
    const calib = range(process.env.EVAL_CALIBRATE, "").map((n) => `Student_${n}`);
    const test = range(process.env.EVAL_STUDENTS, "1-5").map((n) => `Student_${n}`).filter((s) => !calib.includes(s));
    const log: string[] = [];
    const note = (s: string) => { log.push(s); console.log(s); };
    mkdirSync(OUT, { recursive: true });

    // 1. calibration: GradeLens marks these students, the teacher's real marks become the examples
    const cacheOnly = process.env.EVAL_CACHE_ONLY === "1"; // report from what's cached, never call a model
    const { exemplars, candidates, outcomes: calibOutcomes } = await calibrate(calib, rubric, teacher, cacheOnly, note);
    // per-question shifts learned ONLY from the calibration students (the rule was fixed before seeing test results)
    const decisions = [...calibOutcomes].flatMap(([st, o]) => o.questions.filter((q) => q.q > 20 && teacher[st].marks[q.q] !== null).map((q) => ({ q: q.q, ai: q.final, teacher: teacher[st].marks[q.q]! })));
    const shifts = questionShifts(decisions);
    note(`examples: ${exemplars.length} from ${candidates.length} teacher-marked answers of ${calib.length} students`);

    // 2. test students, graded both ways
    // "calibrated + learned shifts" = exactly what the product does when it re-marks the remaining scripts after the
    // teacher reviewed the first ones: the teacher's examples in the prompt, then each question's learned shift.
    const modes = exemplars.length ? (["rubric only", "calibrated", "rubric + learned shifts", "calibrated + learned shifts"] as const) : (["rubric only"] as const);
    const rows: Record<string, Row[]> = Object.fromEntries(modes.map((m) => [m, []]));
    const mcqRows: { student: string; q: number; read: string; truth: string }[] = [];
    const mcqTotals: { student: string; ai: number; teacher: number }[] = [];
    const timing: string[] = [];
    for (const student of test) {
      let read: ReadStep;
      try { read = await cachedRead(student, rubric, cacheOnly); } catch (e) { note(`${student}: READ FAILED ${String(e).slice(0, 200)}`); continue; }
      for (const mode of modes) {
        if (mode === "rubric + learned shifts" || mode === "calibrated + learned shifts") continue; // derived from the gradings above
        let r: StudentOutcome;
        try { r = await cachedGrade(student, read, rubric, mode === "calibrated" ? exemplars : [], cacheOnly); } catch (e) {
          note(`${student} [${mode}]: GRADE FAILED ${String(e).slice(0, 200)}`);
          continue;
        }
        rows[mode].push(...rowsOf(student, r, teacher[student]));
        if (mode === "calibrated" && modes.length > 3) {
          rows["calibrated + learned shifts"].push(...rowsOf(student, r, teacher[student]).map((x) => ({ ...x, ai: shifted(x.ai, 2, shifts.get(x.q)?.shift, x.aiText.trim().length > 0) })));
        }
        if (mode === "rubric only" && modes.length > 2) {
          // same gradings, each suggestion moved by its question's learned shift (no extra model call)
          rows["rubric + learned shifts"].push(...rowsOf(student, r, teacher[student]).map((x) => ({ ...x, ai: shifted(x.ai, 2, shifts.get(x.q)?.shift, x.aiText.trim().length > 0) })));
        }
        if (mode === "rubric only") {
          for (const q of r.questions.filter((x) => x.q <= 20)) {
            mcqRows.push({ student, q: q.q, read: mcqChoice(q.answer?.text ?? "") ?? "", truth: teacher[student].mcq[q.q] });
          }
          mcqTotals.push({ student, ai: r.questions.filter((x) => x.q <= 20).reduce((s, x) => s + x.final, 0), teacher: teacher[student].mcqMark });
          timing.push(`${student}: read ${r.ms.read} ms (${r.models.reader})${r.studentName ? ` ⚠ name found: ${r.studentName}` : ""}${r.warnings.length ? ` ⚠ ${r.warnings.join("; ")}` : ""}`);
        }
        timing.push(`${student} [${mode}]: grade ${r.ms.gradeA}/${r.ms.gradeB} ms (${r.models.graderA} / ${r.models.graderB})`);
        note(`${student} [${mode}]: ${r.total}/${r.max}`);
      }
    }

    // 3. report — every column on exactly the same answers: only students graded in every mode
    const complete = new Set([...new Set(rows[modes[0]].map((x) => x.student))].filter((st) => modes.every((mode) => rows[mode].some((x) => x.student === st))));
    const dropped = [...new Set(rows[modes[0]].map((x) => x.student))].filter((st) => !complete.has(st));
    if (dropped.length) note(`left out of the comparison (not graded in every mode, e.g. a free-model failure): ${dropped.join(", ")}`);
    for (const mode of modes) rows[mode] = rows[mode].filter((x) => complete.has(x.student));
    const m = Object.fromEntries(modes.map((mode) => [mode, metrics(rows[mode])]));
    const keys = Object.keys(m[modes[0]].table);
    const mcqWithTruth = mcqRows.filter((x) => x.truth);
    const mcqOk = mcqWithTruth.filter((x) => x.read === x.truth).length;
    const perQ = (mode: string) => {
      const out: string[] = [];
      for (let q = 21; q <= 35; q++) {
        const xs = rows[mode].filter((x) => x.q === q && x.teacher !== null) as (Row & { teacher: number })[];
        if (!xs.length) continue;
        const bias = xs.reduce((s, x) => s + (x.ai - x.teacher), 0) / xs.length;
        out.push(`| Q${q} | ${xs.length} | ${(xs.reduce((s, x) => s + x.teacher, 0) / xs.length).toFixed(2)} | ${(xs.reduce((s, x) => s + x.ai, 0) / xs.length).toFixed(2)} | ${bias >= 0 ? "+" : ""}${bias.toFixed(2)} |`);
      }
      return out;
    };
    const last = modes[modes.length - 1];
    const report = [
      `# GradeLens vs the teacher: Mendeley real-data evaluation`,
      `Test students compared: ${[...complete].join(", ")} (short-answer items the teacher marked: ${m[modes[0]].n})`,
      calib.length ? `Calibration students (their marks are the examples; never tested): ${calib.join(", ")}; ${exemplars.length} examples used` : `No calibration.`,
      ``,
      `| Metric | ${modes.join(" | ")} |`, `|---|${modes.map(() => "---").join("|")}|`,
      ...keys.map((k) => `| ${k} | ${modes.map((mode) => m[mode].table[k]).join(" | ")} |`),
      ``,
      `Multiple choice (marked by code): letters read correctly ${mcqWithTruth.length ? ((100 * mcqOk) / mcqWithTruth.length).toFixed(1) : "n/a"}% (${mcqOk}/${mcqWithTruth.length}); MCQ total equal to the teacher's for ${mcqTotals.filter((x) => x.ai === x.teacher).length}/${mcqTotals.length} students.`,
      ``,
      `## Per question (${last})`, `| Q | n | teacher mean | AI mean | bias |`, `|---|---|---|---|---|`, ...perQ(last),
      ``,
      `## Disagreements > 0.5 mark (${last})`,
      ...m[last].wrong.map((x) => `- ${x.student} Q${x.q}: AI ${x.ai} (A ${x.scoreA}, B ${x.scoreB}) vs teacher ${x.teacher} [${x.risk}] ${x.flags.join("; ")} — read: "${x.aiText}"`),
      ``, `## MCQ misreads`,
      ...mcqWithTruth.filter((x) => x.read !== x.truth).map((x) => `- ${x.student} Q${x.q}: read "${x.read}" vs teacher's record "${x.truth}"`),
      ...mcqTotals.filter((x) => x.ai !== x.teacher).map((x) => `- ${x.student}: MCQ total ${x.ai} vs teacher ${x.teacher}`),
      ``, `## Log`, ...log.map((t) => `- ${t}`), ``, `## Timing and models`, ...timing.map((t) => `- ${t}`),
    ].join("\n");
    // the dataset's own consistency: do the teacher's MCQ totals match their recorded letters + the published key?
    const key = Object.fromEntries(rubric.questions.filter((q) => q.type === "mcq").map((q) => [q.q, q.modelAnswer.trim().slice(0, 1).toUpperCase()]));
    const studentsAll = Object.entries(teacher);
    const mcqTotalMatches = (k: Record<number, string>) => studentsAll.filter(([, t]) => Object.keys(k).reduce((s, q) => s + (t.mcq[Number(q)] === k[Number(q)] ? 1 : 0), 0) === t.mcqMark).length;
    let bestAlt: { q: number; letter: string; matches: number } | null = null;
    for (const q of Object.keys(key).map(Number)) for (const letter of ["A", "B", "C", "D"]) {
      const m = mcqTotalMatches({ ...key, [q]: letter });
      if (!bestAlt || m > bestAlt.matches) bestAlt = { q, letter, matches: m };
    }
    const summary = {
      generatedAt: new Date().toISOString(),
      dataset: { name: "A Dataset of Digitized Student Examination Papers, Answer Keys, and Manual Evaluations for Automated Grading Research", doi: "10.17632/sf3kvjwknt.1", license: "CC BY 4.0", students: studentsAll.length },
      calibrationStudents: calib.length, testStudents: complete.size,
      examplesUsed: exemplars.length,
      modes: Object.fromEntries(modes.map((mode) => [mode, m[mode].numbers])),
      mcq: { lettersRead: mcqWithTruth.length, lettersCorrect: mcqOk },
      teacherConsistency: {
        mcqTotalsMatchPublishedKey: mcqTotalMatches(key),
        bestAlternativeKey: bestAlt && bestAlt.matches > mcqTotalMatches(key) ? { question: bestAlt.q, published: key[bestAlt.q], alternative: bestAlt.letter, matches: bestAlt.matches } : null,
      },
      models: [...new Set(timing.flatMap((t) => [...t.matchAll(/\(([^)]+)\)/g)].flatMap((x) => x[1].split(" / "))))].filter((x) => x.includes("/")),
    };
    writeFileSync(new URL("../data/eval-summary.json", import.meta.url), JSON.stringify(summary, null, 1));
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    writeFileSync(new URL(`report-${stamp}.md`, OUT), report);
    writeFileSync(new URL(`rows-${stamp}.json`, OUT), JSON.stringify({ rows, mcqRows, mcqTotals, exemplars }, null, 1));
    console.log(report.split("\n").slice(0, 20).join("\n"));
  });
});
