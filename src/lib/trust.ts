/**
 * Earned trust: GradeLens may only approve marks in bulk on a question where it has already matched this teacher.
 *
 * Why: in our evaluation, a quarter of the marks the old rules called "ready" (49 of 198) were more than half a mark off,
 * and those rules flagged only 14% of the big differences. People also fix harsh AI marks less often than the same marks from a colleague
 * (PNAS Nexus, June 2026). So "approve every ready mark" was a promise the data didn't support.
 *
 * The rule (mirrored in supabase/migrations/0010_earned_trust.sql, bulk_approve): on a written question, the teacher
 * must have checked at least MIN_CHECKED answers one by one, and kept GradeLens' mark on at least MIN_KEPT_RATE of them.
 * Multiple choice is exempt: it's marked by code from the letter read (97.8% of letters read correctly), and an
 * unclear letter is flagged, never "ready".
 */
export const MIN_CHECKED = 5;
export const MIN_KEPT_RATE = 0.9;

/** A question's track record: answers the teacher checked one by one (blanks and bulk approvals don't count). */
export type Track = { q: number; checked: number; kept: number; close: number };

export type Trust =
  | { kind: "mcq" }
  | { kind: "trusted"; checked: number; kept: number }
  | { kind: "learning"; checked: number; kept: number; more: number }
  | { kind: "check"; checked: number; kept: number };

export function trustFor(track: Track | undefined, isMcq: boolean): Trust {
  if (isMcq) return { kind: "mcq" };
  const checked = track?.checked ?? 0, kept = track?.kept ?? 0;
  if (checked < MIN_CHECKED) return { kind: "learning", checked, kept, more: MIN_CHECKED - checked };
  return kept >= MIN_KEPT_RATE * checked - 1e-9 ? { kind: "trusted", checked, kept } : { kind: "check", checked, kept };
}

export const bulkAllowed = (t: Trust) => t.kind === "mcq" || t.kind === "trusted";

/** One line for the teacher, in their terms. */
export function trustLine(t: Trust): string {
  switch (t.kind) {
    case "mcq": return "Multiple choice: marked from the letter the student chose.";
    case "trusted": return `You kept GradeLens' mark on ${t.kept} of the ${t.checked} answers you checked here, so its ready marks can be approved together.`;
    case "learning": return t.checked
      ? `You've checked ${t.checked} answer${t.checked === 1 ? "" : "s"} here. Check ${t.more} more one by one before approving its marks together.`
      : `Check ${t.more} answers here one by one first. If you keep GradeLens' mark on at least 9 in 10, its ready marks can be approved together.`;
    case "check": return `You kept GradeLens' mark on only ${t.kept} of ${t.checked} answers here, so check each one on this question.`;
  }
}

/** The same counts as the database's question_track(), for rows already on the screen (e.g. the public sample). */
export function trackFrom(rows: { q: number; approved: boolean; teacher_score: number | null; ai_score: number; answer: { text?: string } | null; bulk?: boolean }[]): Map<number, Track> {
  const out = new Map<number, Track>();
  for (const r of rows) {
    if (!r.approved || r.bulk || !r.answer?.text?.trim()) continue;
    const t = out.get(r.q) ?? { q: r.q, checked: 0, kept: 0, close: 0 };
    const mark = r.teacher_score ?? r.ai_score;
    t.checked++;
    if (mark === r.ai_score) t.kept++;
    if (Math.abs(mark - r.ai_score) <= 0.5) t.close++;
    out.set(r.q, t);
  }
  return out;
}

/** Whole-test summary for "how closely GradeLens marks like you". */
export function agreement(tracks: Iterable<Track>) {
  let checked = 0, kept = 0, close = 0;
  for (const t of tracks) { checked += t.checked; kept += t.kept; close += t.close; }
  return { checked, kept, close };
}
