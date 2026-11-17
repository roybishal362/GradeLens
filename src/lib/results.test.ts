import { describe, expect, it } from "vitest";
import { BoundariesSchema, gradeFor, histogram, summaryStats, toCsv } from "./results";

describe("grade boundaries", () => {
  const b = [{ label: "B", min: 65 }, { label: "A", min: 80 }, { label: "C", min: 50 }];
  it("gives the highest grade whose minimum is reached, whatever the order", () => {
    expect(gradeFor(80, b)).toBe("A");
    expect(gradeFor(79.9, b)).toBe("B");
    expect(gradeFor(49, b)).toBeNull();
    expect(gradeFor(90, null)).toBeNull();
  });
  it("rejects duplicate grade names and out-of-range thresholds", () => {
    expect(BoundariesSchema.safeParse([{ label: "A", min: 80 }, { label: "a", min: 70 }]).success).toBe(false);
    expect(BoundariesSchema.safeParse([{ label: "A", min: 120 }]).success).toBe(false);
  });
});

describe("statistics", () => {
  it("summarises totals", () => {
    expect(summaryStats([10, 20, 30, 40])).toMatchObject({ n: 4, mean: 25, median: 25, min: 10, max: 40 });
    expect(summaryStats([5, 1, 3])?.median).toBe(3);
    expect(summaryStats([])).toBeNull();
  });
  it("puts percentages into 10-point bands, with 100 in the top band", () => {
    const h = histogram([0, 9.9, 10, 55, 100]);
    expect(h).toHaveLength(10);
    expect(h[0].count).toBe(2);
    expect(h[1].count).toBe(1);
    expect(h[5].count).toBe(1);
    expect(h[9].count).toBe(1);
  });
});

describe("CSV export", () => {
  it("quotes, escapes and blocks spreadsheet formulas", () => {
    const csv = toCsv([["Name", "Note"], ["O'Neil, Ana", 'said "hi"'], ["=HYPERLINK(1)", 1.234]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('"O\'Neil, Ana","said ""hi"""');
    expect(csv).toContain("'=HYPERLINK(1),1.23");
  });
});

describe("review time from the audit log", () => {
  it("adds up the gaps between decisions, treats long gaps as breaks, and counts bulk approvals apart", async () => {
    const { reviewTime } = await import("./results");
    const at = (s: number) => new Date(Date.UTC(2026, 10, 17, 10, 0, s)).toISOString();
    const r = reviewTime([
      { at: at(0), bulk: false }, { at: at(10), bulk: false }, { at: at(30), bulk: false },
      { at: at(30 + 3600), bulk: false }, // after an hour's break: counts as 2 minutes at most
      { at: at(30 + 3600), bulk: true }, { at: at(30 + 3600), bulk: true },
    ]);
    expect(r).toEqual({ seconds: 10 + 20 + 120, individual: 4, bulk: 2, secondsPerMark: Math.round(150 / 4) });
    expect(reviewTime([]).seconds).toBe(0);
  });
});
