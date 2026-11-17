import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { gradeRead, readStudent, type ReadStep, type StudentOutcome } from "./pipeline";
import { SAMPLE_RUBRIC } from "./sample-rubric";

const SPIKE = new URL("../../../../spike/synthetic/", import.meta.url);
const FIXTURES = new URL("./__fixtures__/", import.meta.url);
const page = (name: string) => ({ data: new Uint8Array(readFileSync(new URL(name, SPIKE))), mediaType: "image/jpeg" });

/** Reading costs scarce free vision quota, so each student is read once and cached; grading is re-run freely. */
async function cachedRead(student: string, files: string[]): Promise<ReadStep> {
  const file = new URL(`read-${student}.json`, FIXTURES);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf-8"));
  const read = await readStudent(files.map(page), SAMPLE_RUBRIC);
  mkdirSync(FIXTURES, { recursive: true });
  writeFileSync(file, JSON.stringify(read, null, 2));
  return read;
}

/** Correct marks for the practice students, from the mistakes they were written to make (spike/questions.md). */
const GOLD: Record<string, Record<number, number>> = {
  liam: { 1: 1, 2: 1, 3: 2, 4: 2, 5: 0.5, 6: 1 }, // 7.5
  noah: { 1: 2, 2: 1.5, 3: 3, 4: 2, 5: 2, 6: 0 }, // 10.5
};

function report(student: string, r: StudentOutcome) {
  const gold = GOLD[student];
  const out = [
    `\n=== ${student}: name ${JSON.stringify(r.studentName)} (hidden from graders) · AI ${r.total}/${r.max} vs correct ${Object.values(gold).reduce((a, b) => a + b, 0)} · risk ${r.risk}`,
    `models: reader ${r.models.reader} · grader A ${r.models.graderA} · grader B ${r.models.graderB} · grade ms ${r.ms.gradeA}/${r.ms.gradeB}`,
    ...r.questions.map((q) => `Q${q.q}: A ${q.scoreA} / B ${q.scoreB} -> ${q.final}/${q.max} (correct ${gold[q.q]}) [${q.risk}] ${q.flags.join(" | ")}`),
  ];
  appendFileSync("live-report.txt", out.join("\n") + "\n");
}

const absError = (student: string, r: StudentOutcome) =>
  r.questions.reduce((s, q) => s + Math.abs(q.final - GOLD[student][q.q]), 0);

describe("live pipeline on practice pages", () => {
  it("Liam (confused student): misconceptions, sign error carried forward, animal-cell diagram", async () => {
    const r = await gradeRead(await cachedRead("liam", ["B_1.jpg", "B_2.jpg"]), SAMPLE_RUBRIC);
    report("liam", r);
    expect(r.studentName).toMatch(/liam/i);
    expect(r.models.graderA).not.toBe(r.models.graderB);
    expect(r.questions.find((q) => q.q === 6)?.final).toBe(1);
    expect(r.questions.every((q) => (q.answer?.lines.length ?? 0) > 0)).toBe(true);
    // Regression: the reader once silently "fixed" Liam's sign error because it saw the question text.
    expect(r.questions.find((q) => q.q === 3)!.answer!.formulas.join(" ")).toContain("(2x + 1)");
    // Q3 must either be graded right (2/3) or be flagged for the teacher; never silently wrong.
    const q3 = r.questions.find((q) => q.q === 3)!;
    expect(q3.final === 2 || q3.risk !== "low").toBe(true);
    expect(absError("liam", r)).toBeLessThanOrEqual(1);
  });

  it("Noah (messy + cheeky): manipulation flagged, no-drawing diagram capped", async () => {
    const r = await gradeRead(await cachedRead("noah", ["C_1.jpg"]), SAMPLE_RUBRIC);
    report("noah", r);
    const q2 = r.questions.find((q) => q.q === 2)!;
    expect(q2.flags.some((f) => f.startsWith("manipulation"))).toBe(true);
    expect(r.questions.find((q) => q.q === 4)!.final).toBeLessThanOrEqual(2);
    expect(r.questions.find((q) => q.q === 6)!.final).toBe(0);
    expect(absError("noah", r)).toBeLessThanOrEqual(1);
  });
});
