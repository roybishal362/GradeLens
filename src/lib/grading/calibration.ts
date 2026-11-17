/**
 * Calibration: every teacher marks differently. Answers the teacher has already marked (approved or adjusted in review)
 * become examples of THEIR standard, which the graders follow for the rest of the class.
 *
 * Measured, not assumed: src/eval/mendeley.eval.ts compares grading with and without calibration on students the
 * examples never came from.
 */
export type Exemplar = {
  q: number;
  answer: string; // the reader's transcription of another student's answer
  score: number; // the teacher's mark
  aiScore?: number; // what GradeLens suggested before the teacher's decision, when known
};

const MAX_CHARS = 280;

/**
 * Pick at most `perQuestion` examples per question. Preference: answers where the teacher changed the AI's mark (they
 * carry the most information about the teacher's standard), then a spread over different mark levels, so the graders
 * see what a 0, a partial and a full answer look like to this teacher.
 */
export function pickExemplars(candidates: Exemplar[], perQuestion = 4): Exemplar[] {
  const byQ = new Map<number, Exemplar[]>();
  for (const c of candidates) {
    if (!c.answer.trim()) continue;
    byQ.set(c.q, [...(byQ.get(c.q) ?? []), c]);
  }
  const out: Exemplar[] = [];
  for (const [, list] of [...byQ].sort((a, b) => a[0] - b[0])) {
    const adjusted = (e: Exemplar) => (e.aiScore !== undefined && e.aiScore !== e.score ? 1 : 0);
    // group by mark level, most informative first inside each level
    const levels = new Map<number, Exemplar[]>();
    for (const e of [...list].sort((a, b) => adjusted(b) - adjusted(a))) levels.set(e.score, [...(levels.get(e.score) ?? []), e]);
    // levels with an adjusted example first, then from high to low marks
    const order = [...levels.keys()].sort((a, b) => adjusted(levels.get(b)![0]) - adjusted(levels.get(a)![0]) || b - a);
    const picked: Exemplar[] = [];
    for (let round = 0; picked.length < perQuestion; round++) {
      let added = false;
      for (const level of order) {
        const e = levels.get(level)![round];
        if (e && picked.length < perQuestion) { picked.push(e); added = true; }
      }
      if (!added) break;
    }
    out.push(...picked.sort((a, b) => b.score - a.score));
  }
  return out;
}

/** The examples as a data block for the grader's prompt (they are student writing: data, never instructions). */
export function exemplarBlock(exemplars: Exemplar[], marksOf: (q: number) => number | undefined): string {
  if (!exemplars.length) return "";
  const lines: string[] = [];
  let lastQ = -1;
  for (const e of exemplars) {
    const max = marksOf(e.q);
    if (max === undefined) continue;
    if (e.q !== lastQ) { lines.push(`Q${e.q}:`); lastQ = e.q; }
    const text = e.answer.replace(/\s+/g, " ").trim();
    lines.push(`  - ${JSON.stringify(text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}…` : text)} -> the teacher gave ${e.score}/${max}`);
  }
  return lines.join("\n");
}

/**
 * Per-question shift learned from the teacher's decisions: on each question the teacher has reviewed at least `minN`
 * answers for, the average of (teacher's mark − GradeLens' suggestion), pulled towards 0 when there are few decisions
 * (× n / (n + 2)), so two or three decisions can't swing the rest of the class. Shown to the teacher as
 * "adjusted +½ to match your marking on Q29 (from 5 scripts you reviewed)".
 */
export function questionShifts(decisions: { q: number; ai: number; teacher: number }[], minN = 3): Map<number, { shift: number; n: number }> {
  const byQ = new Map<number, number[]>();
  for (const d of decisions) byQ.set(d.q, [...(byQ.get(d.q) ?? []), d.teacher - d.ai]);
  const out = new Map<number, { shift: number; n: number }>();
  for (const [q, diffs] of byQ) {
    if (diffs.length < minN) continue;
    const mean = diffs.reduce((s, x) => s + x, 0) / diffs.length;
    out.set(q, { shift: mean * (diffs.length / (diffs.length + 2)), n: diffs.length });
  }
  return out;
}

/** A suggestion after the question's shift, in half marks within [0, max]. A blank answer is never shifted: it stays 0. */
export const shifted = (ai: number, max: number, shift = 0, answered = true) =>
  answered ? Math.min(max, Math.max(0, Math.round((ai + shift) * 2) / 2)) : ai;
