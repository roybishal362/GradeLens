import { describe, expect, it } from "vitest";
import type { Rubric } from "@/lib/grading/schemas";
import { itemAnalysis, itemNote, learningGain, studentFeedback, type ResultLite } from "./analysis";

const rubric: Rubric = {
  questions: [
    { q: 1, type: "mcq", marks: 1, text: "", modelAnswer: "B", criteria: [{ id: "1a", points: 1, mustMention: "option B" }], commonMisconceptions: [] },
    { q: 2, type: "short", marks: 2, text: "", modelAnswer: "", commonMisconceptions: [],
      criteria: [{ id: "2a", points: 1, mustMention: "Identifies overfitting." }, { id: "2b", points: 1, mustMention: "Explains it fails to generalize." }] },
  ],
};
const r = (s: string, q: number, mark: number, over: Partial<ResultLite> = {}): ResultLite => ({
  submissionId: s, q, max: q === 1 ? 1 : 2, mark, approved: true, criteria: [], misconceptions: [], answerText: "x", ...over,
});

describe("itemAnalysis", () => {
  it("computes facility, mark bands and discrimination from the top and bottom 27%", () => {
    // 6 scripts: strong students get Q2 right, weak ones don't
    const rows = ["a", "b", "c", "d", "e", "f"].flatMap((s, i) => [r(s, 1, i < 3 ? 1 : 0), r(s, 2, i < 3 ? 2 : 0)]);
    const [q1, q2] = itemAnalysis(rows, rubric);
    expect(q1.facility).toBe(0.5);
    expect(q2).toMatchObject({ n: 6, full: 3, zero: 3, partial: 0, discrimination: 1 });
  });
  it("leaves discrimination out with too few scripts, and counts blanks apart from wrong answers", () => {
    const [, q2] = itemAnalysis([r("a", 2, 0, { answerText: "" }), r("b", 2, 1)], rubric);
    expect(q2).toMatchObject({ discrimination: null, blank: 1, zero: 0, partial: 1 });
  });
  it("explains items in teachers' words", () => {
    expect(itemNote({ q: 1, max: 1, n: 10, facility: 0.2, discrimination: 0.3, full: 2, partial: 0, zero: 8, blank: 0 })).toMatch(/struggled/);
    expect(itemNote({ q: 1, max: 1, n: 10, facility: 0.6, discrimination: -0.2, full: 6, partial: 0, zero: 4, blank: 0 })).toMatch(/Weaker students/);
  });
});

describe("studentFeedback", () => {
  it("states strengths and next steps in the mark scheme's own words", () => {
    const fb = studentFeedback([
      r("a", 1, 0),
      r("a", 2, 1, { criteria: [{ id: "2a", points: 1 }, { id: "2b", points: 0 }], misconceptions: ["more accuracy on training data is always better"] }),
    ], rubric);
    expect(fb.strengths).toEqual(["Q2: Identifies overfitting"]);
    expect(fb.nextSteps).toEqual([
      "Q1: the correct option was B.",
      "Q2: Explains it fails to generalize. Watch out: more accuracy on training data is always better.",
    ]);
    expect(fb).toMatchObject({ score: 1, max: 3 });
  });
});

describe("feedback for a blank answer", () => {
  it("reads as a sentence", () => {
    const fb = studentFeedback([r("a", 2, 0, { answerText: "" })], { questions: [rubric.questions[1]] });
    expect(fb.nextSteps).toEqual(["Q2: no answer. Even one idea earns marks here, for example: identifies overfitting."]);
  });
});

describe("learningGain", () => {
  it("compares the original questions with the re-test, with Hake's normalized gain", () => {
    const g = learningGain(
      [{ student: "a", mark: 1, max: 4 }, { student: "b", mark: 4, max: 4 }, { student: "c", mark: 0, max: 2 }],
      [{ student: "a", mark: 3, max: 4 }, { student: "b", mark: 4, max: 4 }],
    );
    expect(g.rows).toEqual([
      { student: "a", pre: 0.25, post: 0.75, gain: 0.67 },
      { student: "b", pre: 1, post: 1, gain: null },
    ]);
    expect(g.meanGain).toBe(0.67);
  });
});
