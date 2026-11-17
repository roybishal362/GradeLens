import { z } from "zod";

/** Optional letter grades: percent thresholds, e.g. A ≥ 80, B ≥ 65 … (order doesn't matter). */
export const BoundariesSchema = z.array(z.object({
  label: z.string().trim().min(1).max(12),
  min: z.number().min(0).max(100),
})).max(12).refine((b) => new Set(b.map((x) => x.label.toLowerCase())).size === b.length, "each grade needs a different name");
export type Boundaries = z.infer<typeof BoundariesSchema>;

export function gradeFor(percent: number, boundaries: Boundaries | null | undefined): string | null {
  if (!boundaries?.length) return null;
  const hit = [...boundaries].sort((a, b) => b.min - a.min).find((b) => percent >= b.min - 1e-9);
  return hit?.label ?? null;
}

export type Stats = { n: number; mean: number; median: number; sd: number; min: number; max: number };

export function summaryStats(values: number[]): Stats | null {
  if (!values.length) return null;
  const xs = [...values].sort((a, b) => a - b);
  const n = xs.length, mean = xs.reduce((s, x) => s + x, 0) / n;
  const median = n % 2 ? xs[(n - 1) / 2] : (xs[n / 2 - 1] + xs[n / 2]) / 2;
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / n);
  return { n, mean, median, sd, min: xs[0], max: xs[n - 1] };
}

/** Score bands of `size` percent: 0–9, 10–19 … 90–100 (100 belongs to the top band). */
export function histogram(percentages: number[], size = 10): { from: number; to: number; count: number }[] {
  const bands = Array.from({ length: Math.ceil(100 / size) }, (_, i) => ({ from: i * size, to: Math.min(100, (i + 1) * size), count: 0 }));
  for (const p of percentages) bands[Math.min(bands.length - 1, Math.max(0, Math.floor(p / size)))].count++;
  return bands;
}

/**
 * CSV that opens cleanly in Excel and Google Sheets: quoted where needed, UTF-8 with a BOM (so names with accents
 * survive), and cells starting with = + - @ are prefixed with ' so student text can't run as a spreadsheet formula.
 */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return "";
    let s = typeof v === "number" ? String(Math.round(v * 100) / 100) : v;
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export const percentOf = (total: number | null, max: number | null) => (total === null || !max ? null : (100 * Number(total)) / Number(max));
