import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";
import { cacheLife, cacheTag } from "next/cache";
import { sampleTestId } from "@/lib/db/sample";
import { QR_COLS, type QuestionResultRow } from "@/lib/db/types";
import { evidenceLines, pageOfLine } from "@/lib/grading/evidence";
import type { Rubric } from "@/lib/grading/schemas";
import { publicDb } from "@/lib/supabase/clients";

export type HeroData = {
  image: { src: string; w: number; h: number };
  crop: { x0: number; y0: number; x1: number; y1: number }; // 0-1000 on the page
  lines: { box: [number, number, number, number]; criteria: string[] }[];
  criteria: { id: string; label: string; max: number; score: number; reason: string }[];
  question: { q: number; text: string; max: number };
  suggested: number;
  teacherMark: number;
  student: string;
};

/** Width and height of a baseline/progressive JPEG, read from its frame header. */
export function jpegSize(buf: Buffer): { w: number; h: number } | null {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

/**
 * The landing page's hero: one REAL answer from the sample class, exactly as GradeLens marked it, chosen by rule
 * (a short answer where the suggestion equals the dataset teacher's mark, with one criterion earned and one missed,
 * so both the evidence and the reasoning show). Nothing is typed in by hand.
 */
export async function heroAnswer(): Promise<HeroData | null> {
  "use cache";
  cacheLife("hours");
  cacheTag("sample");
  const testId = await sampleTestId();
  if (!testId) return null;
  const db = publicDb();
  const { data: test } = await db.from("tests").select("rubric").eq("id", testId).single<{ rubric: Rubric }>();
  const { data: rows } = await db
    .from("question_results")
    .select(`${QR_COLS},submissions!inner(test_id,student_id,students(display_name))`)
    .eq("submissions.test_id", testId).eq("approved", false).gt("q", 20).limit(600)
    .returns<(QuestionResultRow & { submissions: { students: { display_name: string } } })[]>();
  if (!test || !rows) return null;
  const pick = rows
    // the mark must be explained by its criteria alone (no learned shift), and match the dataset teacher's mark
    .filter((r) => r.answer?.lines?.length && r.grade_a && r.reference_score !== null && Number(r.reference_score) === Number(r.ai_score)
      && Number(r.score_a) === Number(r.score_b) && Number(r.score_a) === Number(r.ai_score) && !r.flags.some((f) => f.startsWith("adjusted")))
    .map((r) => {
      const rq = test.rubric.questions.find((x) => x.q === r.q)!;
      const earned = r.grade_a!.criteria.filter((c) => c.points > 0 && evidenceLines(c.evidenceQuote, r.answer!.lines).length);
      const missed = rq.criteria.filter((c) => (r.grade_a!.criteria.find((x) => x.id === c.id)?.points ?? 0) === 0);
      const pages = new Set(r.answer!.lines.map((l) => pageOfLine(r.answer!, l)));
      const ys = r.answer!.lines.flatMap((l) => [l.box[0], l.box[2]]);
      return { r, rq, ok: rq.criteria.length === 2 && earned.length === 1 && missed.length === 1 && pages.size === 1 && Math.max(...ys) - Math.min(...ys) < 220 && r.answer!.lines.length <= 5 };
    })
    .filter((x) => x.ok)
    .sort((a, b) => a.r.submission_id.localeCompare(b.r.submission_id) || a.r.q - b.r.q)[0];
  if (!pick) return null;
  const { r, rq } = pick;
  const a = r.answer!;
  const { data: page } = await db.from("pages").select("storage_path").eq("submission_id", r.submission_id).eq("page_no", a.page).single<{ storage_path: string }>();
  if (!page?.storage_path.startsWith("/sample/")) return null;
  const size = jpegSize(readFileSync(path.join(process.cwd(), "public", page.storage_path)));
  if (!size) return null;
  // tight crop: just this answer's lines (neighbouring answers are often only a few units away on the page)
  const padX = 14, padY = 6;
  const crop = {
    x0: Math.max(0, Math.min(...a.lines.map((l) => l.box[1])) - padX), y0: Math.max(0, Math.min(...a.lines.map((l) => l.box[0])) - padY),
    x1: Math.min(1000, Math.max(...a.lines.map((l) => l.box[3])) + padX), y1: Math.min(1000, Math.max(...a.lines.map((l) => l.box[2])) + padY),
  };
  const criteria = rq.criteria.map((c) => {
    const g = r.grade_a!.criteria.find((x) => x.id === c.id);
    return { id: c.id, label: c.mustMention, max: c.points, score: g?.points ?? 0, reason: g?.reason ?? "", quote: g?.evidenceQuote ?? "" };
  });
  return {
    image: { src: page.storage_path, ...size },
    crop,
    lines: a.lines.map((l, i) => ({ box: l.box as [number, number, number, number], criteria: criteria.filter((c) => c.score > 0 && evidenceLines(c.quote, a.lines).includes(i)).map((c) => c.id) })),
    criteria: criteria.map(({ quote: _q, ...c }) => { void _q; return c; }),
    question: { q: r.q, text: rq.text, max: Number(r.max) },
    suggested: Number(r.ai_score),
    teacherMark: Number(r.reference_score),
    student: r.submissions.students.display_name,
  };
}
