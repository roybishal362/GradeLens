/**
 * Class insights computed by plain code from the marks (no AI, so these numbers are exactly reproducible):
 * item analysis per question, per-student feedback from the mark scheme, and learning gain after a re-test.
 */
import type { Rubric } from "@/lib/grading/schemas";

export type ResultLite = {
  submissionId: string;
  q: number;
  max: number;
  mark: number; // the mark that counts (teacher's if set, else the suggestion)
  approved: boolean;
  criteria: { id: string; points: number }[]; // points the first grader gave per criterion
  misconceptions: string[];
  answerText: string;
};

export type ItemStats = {
  q: number;
  max: number;
  n: number;
  facility: number; // mean mark / max (0..1): how easy the question was for this class
  discrimination: number | null; // upper-group facility − lower-group facility (27% groups); null if too few scripts
  full: number; partial: number; zero: number;
  blank: number;
};

const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

/** Classical item analysis. Discrimination uses the top and bottom 27% of scripts by total (Kelley's groups). */
export function itemAnalysis(results: ResultLite[], rubric: Rubric): ItemStats[] {
  const totals = new Map<string, number>();
  for (const r of results) totals.set(r.submissionId, (totals.get(r.submissionId) ?? 0) + r.mark);
  const ranked = [...totals].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const g = ranked.length >= 6 ? Math.max(1, Math.round(ranked.length * 0.27)) : 0;
  const upper = new Set(ranked.slice(0, g)), lower = new Set(ranked.slice(-g));
  return rubric.questions.map((rq) => {
    const xs = results.filter((r) => r.q === rq.q);
    const fac = (set: (r: ResultLite) => boolean) => {
      const ys = xs.filter(set);
      return ys.length ? ys.reduce((s, r) => s + r.mark / r.max, 0) / ys.length : 0;
    };
    return {
      q: rq.q,
      max: rq.marks,
      n: xs.length,
      facility: round(fac(() => true)),
      discrimination: g ? round(fac((r) => upper.has(r.submissionId)) - fac((r) => lower.has(r.submissionId))) : null,
      full: xs.filter((r) => r.mark >= r.max).length,
      partial: xs.filter((r) => r.mark > 0 && r.mark < r.max).length,
      zero: xs.filter((r) => r.mark === 0 && r.answerText.trim()).length,
      blank: xs.filter((r) => !r.answerText.trim()).length,
    };
  });
}

/** What a teacher would say about an item, in their words. */
export function itemNote(s: ItemStats): string | null {
  if (s.n < 3) return null;
  if (s.facility < 0.3) return "Most of the class struggled with this one.";
  if (s.discrimination !== null && s.discrimination < 0) return "Weaker students did better than stronger ones here: check the question's wording or the mark scheme.";
  if (s.discrimination !== null && s.discrimination < 0.1 && s.facility < 0.9) return "This question barely separates stronger and weaker students: it may be ambiguous.";
  if (s.facility > 0.9) return "Almost everyone got this right.";
  return null;
}

export type StudentFeedback = { strengths: string[]; nextSteps: string[]; score: number; max: number };

/**
 * Feedback from the mark scheme itself: what earned marks, and the criteria that were missed (in the mark scheme's own
 * words). Deterministic: no invented praise, only what the marks show.
 */
export function studentFeedback(results: ResultLite[], rubric: Rubric): StudentFeedback {
  const strengths: string[] = [], nextSteps: string[] = [];
  for (const rq of rubric.questions) {
    const r = results.find((x) => x.q === rq.q);
    if (!r) continue;
    if (r.mark >= r.max) { strengths.push(`Q${rq.q}: full marks`); continue; }
    if (!r.answerText.trim()) {
      const idea = (rq.criteria[0]?.mustMention ?? "the key idea").replace(/\.$/, "");
      nextSteps.push(`Q${rq.q}: no answer. Even one idea earns marks here, for example: ${idea.charAt(0).toLowerCase()}${idea.slice(1)}.`);
      continue;
    }
    if (rq.type === "mcq") { nextSteps.push(`Q${rq.q}: the correct option was ${rq.modelAnswer.trim().slice(0, 1).toUpperCase()}.`); continue; }
    const missed = rq.criteria.filter((c) => (r.criteria.find((x) => x.id === c.id)?.points ?? 0) < c.points);
    const got = rq.criteria.filter((c) => (r.criteria.find((x) => x.id === c.id)?.points ?? 0) >= c.points);
    if (got.length) strengths.push(`Q${rq.q}: ${got.map((c) => c.mustMention.replace(/\.$/, "")).join("; ")}`);
    const mis = r.misconceptions[0];
    nextSteps.push(`Q${rq.q}: ${missed.map((c) => c.mustMention.replace(/\.$/, "")).join("; ")}${mis ? `. Watch out: ${mis.replace(/\.$/, "")}` : ""}.`);
  }
  return {
    strengths, nextSteps,
    score: results.reduce((s, r) => s + r.mark, 0),
    max: results.reduce((s, r) => s + r.max, 0),
  };
}

export type Gain = { student: string; pre: number; post: number; gain: number | null };

/**
 * Learning gain after a re-test: pre = the share of marks a student had on the original questions behind the
 * misconception; post = their share on the re-test. Normalized gain (Hake): (post − pre) / (1 − pre).
 */
export function learningGain(
  pre: { student: string; mark: number; max: number }[],
  post: { student: string; mark: number; max: number }[],
): { rows: Gain[]; meanPre: number; meanPost: number; meanGain: number | null } {
  const sum = (xs: { student: string; mark: number; max: number }[]) => {
    const m = new Map<string, { mark: number; max: number }>();
    for (const x of xs) { const c = m.get(x.student) ?? { mark: 0, max: 0 }; m.set(x.student, { mark: c.mark + x.mark, max: c.max + x.max }); }
    return m;
  };
  const a = sum(pre), b = sum(post);
  const rows: Gain[] = [];
  for (const [student, p] of a) {
    const q = b.get(student);
    if (!q || !p.max || !q.max) continue;
    const pr = p.mark / p.max, po = q.mark / q.max;
    rows.push({ student, pre: round(pr), post: round(po), gain: pr >= 1 ? null : round((po - pr) / (1 - pr)) });
  }
  const mean = (xs: number[]) => (xs.length ? round(xs.reduce((s, x) => s + x, 0) / xs.length) : 0);
  const gains = rows.map((r) => r.gain).filter((g): g is number => g !== null);
  return { rows, meanPre: mean(rows.map((r) => r.pre)), meanPost: mean(rows.map((r) => r.post)), meanGain: gains.length ? mean(gains) : null };
}

/** Normalize a misconception for exact grouping before any AI is involved. */
export const misconceptionKey = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
