import { describe, expect, it } from "vitest";
import { groupScans, parseSheet, sheetPayload } from "./sheets";

const T = "2248f6cf-9b1e-4d98-a172-470ef9ee0987", OTHER = "11111111-2222-3333-4444-555555555555";
const qr = (code: string, page: number, testId = T) => parseSheet(sheetPayload(testId, code, page));

describe("sheet QR codes", () => {
  it("round-trips and rejects anything else", () => {
    expect(qr("S07", 2)).toEqual({ testId: T, code: "S07", page: 2 });
    expect(parseSheet("https://example.com")).toBeNull();
    expect(parseSheet(`GL1.${T}.Ada.1`)).toBeNull(); // names never appear in a QR
  });
});

describe("groupScans", () => {
  it("sorts a shuffled pile to students, pages in order", () => {
    const r = groupScans([
      { index: 0, qr: qr("S02", 2) }, { index: 1, qr: qr("S01", 1) }, { index: 2, qr: qr("S02", 1) }, { index: 3, qr: qr("S01", 2) },
    ], T);
    expect(r.groups.map((g) => [g.code, g.pages.map((p) => p.index)])).toEqual([["S01", [1, 3]], ["S02", [2, 0]]]);
    expect(r.problems).toEqual([]);
  });
  it("attaches a page without a QR to the page before it, right after that page, and flags it", () => {
    const r = groupScans([{ index: 0, qr: qr("S01", 1) }, { index: 1, qr: null }, { index: 2, qr: qr("S01", 2) }], T);
    expect(r.groups[0].pages.map((p) => p.index)).toEqual([0, 1, 2]);
    expect(r.problems[0]).toMatch(/Photo 2 has no readable QR/);
  });
  it("sets aside other tests' sheets and a leading page with no QR", () => {
    const r = groupScans([{ index: 0, qr: null }, { index: 1, qr: qr("S01", 1, OTHER) }, { index: 2, qr: qr("S03", 1) }], T);
    expect(r.unassigned).toEqual([0, 1]);
    expect(r.groups.map((g) => g.code)).toEqual(["S03"]);
    expect(r.problems).toHaveLength(2);
  });
  it("flags a page photographed twice", () => {
    expect(groupScans([{ index: 0, qr: qr("S01", 1) }, { index: 1, qr: qr("S01", 1) }], T).problems[0]).toMatch(/appears twice/);
  });
});
