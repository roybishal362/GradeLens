import { describe, expect, it } from "vitest";
import { evidenceLines, pageOfLine } from "./evidence";

const lines = [
  { text: "22. based on mind the M1 model is not yet the best", box: [100, 50, 130, 900] },
  { text: "solution yet since it has only 30% accuracy the data set", box: [135, 50, 165, 900] },
  { text: "should use another model then do classification matrix", box: [170, 50, 200, 900] },
  { text: "to find the best one.", box: [205, 50, 235, 400] },
];

describe("evidenceLines", () => {
  it("finds the line a short quote comes from", () => {
    expect(evidenceLines("only 30% accuracy", lines)).toEqual([1]);
  });
  it("finds every line a long quote spans", () => {
    expect(evidenceLines("the M1 model is not yet the best solution yet since it has only 30% accuracy the data set", lines)).toEqual([0, 1]);
  });
  it("matches '...' fragments separately and tolerates small misreadings", () => {
    expect(evidenceLines("M1 model is not yet the best ... shuld use another model then do classification matrix", lines)).toEqual([0, 2]);
  });
  it("returns nothing for empty or invented quotes", () => {
    expect(evidenceLines("", lines)).toEqual([]);
    expect(evidenceLines("the model is overfitting because of high variance", lines)).toEqual([]);
  });
  it("uses a line's own page when an answer continues on the next page", () => {
    expect(pageOfLine({ page: 2 }, { text: "x", box: [0, 0, 1, 1], page: 3 })).toBe(3);
    expect(pageOfLine({ page: 2 }, { text: "x", box: [0, 0, 1, 1] })).toBe(2);
  });
});
