/**
 * The Mendeley dataset (CC BY 4.0, DOI 10.17632/sf3kvjwknt.1, author Dinesh K P): loaders and the content-hash caches
 * shared by the evaluation (mendeley.eval.ts) and the sample-class seed (seed-sample.eval.ts), so the sample class shows
 * exactly the outputs that were evaluated.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pickExemplars, type Exemplar } from "@/lib/grading/calibration";
import { gradeRead, readStudent, type ReadStep, type StudentOutcome } from "@/lib/grading/pipeline";
import { graderSystem, readerSystem } from "@/lib/grading/prompts";
import type { QuestionInput } from "@/lib/grading/rubric-agent";
import type { Rubric } from "@/lib/grading/schemas";

export const ROOT = new URL("../../../datasets/mendeley-sf3kvjwknt/", import.meta.url);
export const DATA = new URL("extracted/data/", ROOT);
export const PAGES = new URL("pages/", ROOT);
export const OUT = new URL("eval/", ROOT);
export const RUBRIC_FILE = new URL("rubric.json", ROOT);

export const text = (u: URL) => readFileSync(u, "utf-8");
export const sha = (x: unknown) => createHash("sha256").update(typeof x === "string" ? x : JSON.stringify(x)).digest("hex").slice(0, 12);

export function csvRows(src: string): string[][] {
  // small CSV parser (quoted fields with commas)
  return src.trim().split(/\r?\n/).map((line) => {
    const out: string[] = []; let cur = ""; let q = false;
    for (const ch of line) {
      if (ch === '"') q = !q; else if (ch === "," && !q) { out.push(cur); cur = ""; } else cur += ch;
    }
    out.push(cur);
    return out;
  });
}

export function loadQuestions(): QuestionInput[] {
  const key = new Map(csvRows(text(new URL("answerkey.txt", DATA))).slice(1).map((r) => [Number(r[0]), r[2]]));
  const qText = new Map<number, string>();
  for (const m of text(new URL("Question.txt", DATA)).matchAll(/^\s*(\d{1,2})\.\s+(.+)$/gm)) qText.set(Number(m[1]), m[2].trim());
  const qs: QuestionInput[] = [];
  for (let q = 1; q <= 35; q++) {
    qs.push(q <= 20
      ? { q, text: qText.get(q) ?? `MCQ ${q}`, marks: 1, answerKey: key.get(q) ?? "", type: "mcq" }
      : { q, text: qText.get(q) ?? "", marks: 2, answerKey: key.get(q) ?? "" });
  }
  return qs;
}

export type Teacher = { mcq: Record<number, string>; mcqMark: number; marks: Record<number, number | null> };
export function loadTeacher(): Record<string, Teacher> {
  const rows = csvRows(text(new URL("Teacher_manual_marks_Anonymized.csv", DATA)));
  const head = rows[0];
  const col = (name: string) => head.indexOf(name);
  const out: Record<string, Teacher> = {};
  for (const r of rows.slice(1)) {
    const mcq: Record<number, string> = {}, marks: Record<number, number | null> = {};
    for (let q = 1; q <= 20; q++) mcq[q] = (r[col(String(q))] ?? "").trim().toUpperCase();
    for (let q = 21; q <= 35; q++) {
      const v = (r[col(String(q))] ?? "").trim();
      const n = Number(v);
      marks[q] = v === "" || Number.isNaN(n) ? null : n; // blank / NC / NM = not answered or not marked
    }
    out[r[0]] = { mcq, mcqMark: Number(r[col("MCQ mark")]), marks };
  }
  return out;
}

export function range(spec: string | undefined, fallback: string): number[] {
  return (spec ?? fallback).split(",").filter(Boolean).flatMap((part) => {
    const [a, b] = part.split("-").map(Number);
    return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a];
  });
}

export const loadRubric = () => (JSON.parse(text(RUBRIC_FILE)) as { rubric: Rubric }).rubric;
export const pageIndex = () => JSON.parse(text(new URL("index.json", PAGES))) as Record<string, string[]>;

/** cacheOnly: throw instead of calling a model (the seed must show evaluated outputs, never fresh ones). */
export async function cachedRead(student: string, rubric: Rubric, cacheOnly = false): Promise<ReadStep> {
  const dir = new URL(`reads/${sha(readerSystem(rubric))}/`, ROOT); // a new reader prompt = a fresh cache
  const file = new URL(`${student}.json`, dir);
  if (existsSync(file)) return JSON.parse(text(file));
  if (cacheOnly) throw new Error(`${student}: no cached reading for the current reader prompt`);
  const pages = pageIndex()[student].map((f) => ({ data: new Uint8Array(readFileSync(new URL(f, PAGES))), mediaType: "image/jpeg" }));
  const read = await readStudent(pages, rubric);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(read, null, 1));
  return read;
}

export async function cachedGrade(student: string, read: ReadStep, rubric: Rubric, exemplars: Exemplar[], cacheOnly = false): Promise<StudentOutcome> {
  const dir = new URL("grades/", ROOT);
  const file = new URL(`${student}-${sha({ s: graderSystem(rubric, exemplars), a: read.output.answers })}.json`, dir);
  if (existsSync(file)) return JSON.parse(text(file));
  if (cacheOnly) throw new Error(`${student}: no cached grading for these prompts and examples`);
  const out = await gradeRead(read, rubric, { exemplars });
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(out, null, 1));
  return out;
}

/** Calibration exactly as a teacher would get it: GradeLens marks these students, the teacher's marks become examples. */
export async function calibrate(calib: string[], rubric: Rubric, teacher: Record<string, Teacher>, cacheOnly = false, note: (s: string) => void = () => {}) {
  const candidates: Exemplar[] = [];
  const outcomes = new Map<string, StudentOutcome>();
  for (const student of calib) {
    try {
      const read = await cachedRead(student, rubric, cacheOnly);
      const plain = await cachedGrade(student, read, rubric, [], cacheOnly);
      outcomes.set(student, plain);
      for (const q of plain.questions) {
        const t = teacher[student].marks[q.q];
        if (q.q > 20 && t !== null && t !== undefined && q.answer) candidates.push({ q: q.q, answer: q.answer.text, score: t, aiScore: q.final });
      }
      note(`calibration ${student}: ${plain.total}/${plain.max}`);
    } catch (e) { note(`calibration ${student}: FAILED ${String(e).slice(0, 200)}`); }
  }
  return { exemplars: pickExemplars(candidates, 4), candidates, outcomes };
}
