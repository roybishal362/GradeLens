import { describe, expect, it } from "vitest";
import { typedRead } from "./practice";

describe("typed answers", () => {
  it("become a transcription with full confidence, skipping blanks", () => {
    const r = typedRead([{ q: 21, text: "  Learning from labelled data. " }, { q: 22, text: "   " }, { q: 3, text: "B" }]);
    expect(r.model).toBe("typed");
    expect(r.output.answers.map((a) => [a.q, a.text, a.confidence])).toEqual([[21, "Learning from labelled data.", 1], [3, "B", 1]]);
    expect(r.output.studentName).toBeNull();
  });
});
