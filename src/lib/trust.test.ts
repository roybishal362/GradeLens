import { describe, expect, it } from "vitest";
import { agreement, bulkAllowed, trackFrom, trustFor } from "./trust";

describe("earned trust per question", () => {
  it("needs five answers checked one by one, then 90% kept", () => {
    expect(trustFor(undefined, false)).toEqual({ kind: "learning", checked: 0, kept: 0, more: 5 });
    expect(trustFor({ q: 1, checked: 4, kept: 4, close: 4 }, false).kind).toBe("learning");
    expect(trustFor({ q: 1, checked: 5, kept: 5, close: 5 }, false).kind).toBe("trusted");
    expect(trustFor({ q: 1, checked: 5, kept: 4, close: 5 }, false).kind).toBe("check");
    expect(trustFor({ q: 1, checked: 10, kept: 9, close: 10 }, false).kind).toBe("trusted");
    expect(bulkAllowed(trustFor({ q: 1, checked: 10, kept: 8, close: 10 }, false))).toBe(false);
  });
  it("lets multiple choice through (marked by code), never a question still being learned", () => {
    expect(bulkAllowed(trustFor(undefined, true))).toBe(true);
    expect(bulkAllowed(trustFor(undefined, false))).toBe(false);
  });
  it("counts only individual decisions on written answers", () => {
    const row = (q: number, ai: number, teacher: number | null, extra: object = {}) =>
      ({ q, approved: true, ai_score: ai, teacher_score: teacher, answer: { text: "an answer" }, ...extra });
    const t = trackFrom([
      row(1, 2, null), row(1, 2, 2), row(1, 2, 1.5), row(1, 2, 0),
      row(1, 2, null, { bulk: true }), // approved in bulk: says nothing about the teacher's judgement
      row(1, 0, null, { answer: { text: " " } }), // blank
      row(1, 2, null, { approved: false }), // still pending
    ]).get(1)!;
    expect(t).toEqual({ q: 1, checked: 4, kept: 2, close: 3 });
    expect(agreement([t, { q: 2, checked: 1, kept: 1, close: 1 }])).toEqual({ checked: 5, kept: 3, close: 4 });
  });
});
