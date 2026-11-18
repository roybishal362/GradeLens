import { describe, expect, it } from "vitest";
import { byName } from "./utils";

describe("roster order", () => {
  it("puts numbers in natural order and ignores case", () => {
    const names = ["Student 10", "student 2", "Student 1", "Ada"].map((display_name) => ({ display_name }));
    expect(byName(names).map((s) => s.display_name)).toEqual(["Ada", "Student 1", "student 2", "Student 10"]);
    expect(byName(null)).toEqual([]);
  });
});
