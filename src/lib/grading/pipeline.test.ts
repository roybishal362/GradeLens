import { describe, expect, it } from "vitest";
import { collectAnswers } from "./pipeline";
import type { ReadAnswer, Rubric } from "./schemas";

const a = (q: number, text: string, over: Partial<ReadAnswer> = {}): ReadAnswer => ({
  q, text, formulas: [], diagram: null, lines: [], page: 1, illegible: [], confidence: 0.9, ...over,
});
const rubric = {
  questions: [21, 22].map((q) => ({ q, type: "short" as const, marks: 2, text: "", modelAnswer: "", criteria: [], commonMisconceptions: [] })),
} satisfies Rubric;

describe("collectAnswers", () => {
  it("joins two answers filed under one number and flags them for the teacher", () => {
    const { byQ, flags } = collectAnswers([a(22, "first try", { confidence: 0.95 }), a(22, "second try", { confidence: 0.7 })], rubric);
    expect(byQ.get(22)?.text).toBe("first try\nsecond try");
    expect(byQ.get(22)?.confidence).toBe(0.7);
    expect(flags.get(22)?.[0]).toMatch(/two answers/);
  });
  it("reports answers labelled with a number that is not on the test", () => {
    const { byQ, warnings } = collectAnswers([a(36, "stray"), a(37, "also stray"), a(36, "again")], rubric);
    expect(byQ.size).toBe(0);
    expect(warnings).toEqual(["Answers labelled Q36, Q37 are not on this test, so they weren't marked. Check the question numbers."]);
  });
  it("treats an empty item as a blank answer", () => {
    expect(collectAnswers([a(21, "  ")], rubric).byQ.has(21)).toBe(false);
  });
});
