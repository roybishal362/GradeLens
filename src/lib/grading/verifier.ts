import type { GradeResult, ReadAnswer, RubricQuestion } from "./schemas";

/**
 * The Verifier is deliberately NOT an LLM: it checks the graders' claims with plain code.
 * Rules (each one came out of a spike or a red-team round, see DESIGN.md):
 *  - every awarded point needs an evidence quote that really occurs in the transcription (fragments joined by "..."
 *    are checked one by one)
 *  - the two independent gradings (two different models) should agree: a gap of 1+ mark goes to the teacher,
 *    2+ marks is high risk; the provisional mark is their average
 *  - low reading confidence or illegible parts route the answer to the teacher
 *  - instructions aimed at the grader are flagged as a manipulation attempt
 *  - a diagram question with no drawing can't earn the structure criterion (labels written as text don't count)
 */

export type Risk = "low" | "medium" | "high";
export type Verified = { scoreA: number; scoreB: number; final: number; risk: Risk; flags: string[] };

const INJECTION =
  /ignore (all )?(the )?(previous|prior|above) instructions|full marks|maximum marks|give (me|this( answer)?) (full|max)/i;

export function normalize(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s=+\-/^().]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Similarity ratio in [0,1] based on Levenshtein distance. */
function similarity(a: string, b: string): number {
  if (!a.length && !b.length) return 1;
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return 1 - dp[b.length] / Math.max(a.length, b.length);
}

function fragmentFound(fragment: string, text: string): boolean {
  if (text.includes(fragment)) return true;
  const n = fragment.length;
  for (let i = 0; i + n <= text.length; i += 3) {
    if (similarity(fragment, text.slice(i, i + n)) >= 0.85) return true;
  }
  return false;
}

export function quoteFound(quote: string, text: string): boolean {
  const t = normalize(text);
  const fragments = (quote ?? "").split(/\.\.\.|…/).map(normalize).filter(Boolean);
  return fragments.length > 0 && fragments.every((f) => fragmentFound(f, t));
}

type QuestionGrade = GradeResult["questions"][number];

function scoreOf(grade: QuestionGrade | undefined, rubric: RubricQuestion, answer: ReadAnswer, flags: string[]): number {
  if (!grade) return 0;
  const caps = new Map(rubric.criteria.map((c) => [c.id, c.points]));
  const evidenceText = [answer.text, ...answer.formulas, ...(answer.diagram?.labels ?? [])].join(" ");
  let total = 0;
  for (const c of grade.criteria) {
    const pts = Math.min(Math.max(c.points, 0), caps.get(c.id) ?? 0);
    if (pts > 0 && rubric.type !== "diagram" && !quoteFound(c.evidenceQuote, evidenceText)) {
      flags.push(`unverified evidence for ${c.id}: "${c.evidenceQuote.slice(0, 60)}"`);
    }
    total += pts;
  }
  if (rubric.type === "diagram" && !answer.diagram?.outline) {
    const structure = rubric.criteria[0];
    const awarded = grade.criteria.find((c) => c.id === structure.id)?.points ?? 0;
    if (awarded > 0) {
      total -= Math.min(awarded, structure.points);
      flags.push("no drawing found: labels were only written as text, so structure marks were removed");
    }
  }
  return Math.max(0, total);
}

export function verify(
  answer: ReadAnswer | undefined,
  rubric: RubricQuestion,
  gradeA: QuestionGrade | undefined,
  gradeB: QuestionGrade | undefined,
): Verified {
  const flags: string[] = [];
  if (!answer) return blank();
  const scoreA = scoreOf(gradeA, rubric, answer, flags);
  const scoreB = scoreOf(gradeB, rubric, answer, flags);
  const gap = Math.abs(scoreA - scoreB);
  if (gap >= 1) flags.push(`graders disagree (${scoreA} vs ${scoreB})`);
  if (answer.confidence < 0.8 || answer.illegible.length) {
    flags.push(`low reading confidence (${answer.confidence}${answer.illegible.length ? `; unreadable: ${answer.illegible.join(", ")}` : ""})`);
  }
  if (INJECTION.test(answer.text) || gradeA?.injectionAttempt || gradeB?.injectionAttempt) {
    flags.push("manipulation attempt detected (graded on content only)");
  }
  const unique = [...new Set(flags)];
  const high = gap >= 2 || unique.some((f) => f.startsWith("unverified") || f.startsWith("manipulation"));
  const risk: Risk = high ? "high" : unique.length ? "medium" : "low";
  // Provisional mark = the two graders' average, rounded to the nearest half mark (taking the minimum systematically
  // under-marked students in live tests). Anything flagged waits for the teacher.
  const final = Math.min(rubric.marks, Math.round(((scoreA + scoreB) / 2) * 2) / 2);
  return { scoreA, scoreB, final, risk, flags: unique };
}

/**
 * No answer was found for this question. 0 marks, but never auto-approved: the reader may have missed an answer
 * written somewhere unexpected, so the teacher confirms blanks (the review screen lets them confirm all at once).
 */
export function blank(): Verified {
  return { scoreA: 0, scoreB: 0, final: 0, risk: "medium", flags: [BLANK_FLAG] };
}
export const BLANK_FLAG = "no answer found: confirm the question was left blank";

/**
 * Harsh marks are the AI errors people most often let through: teachers corrected too-harsh grades less often when
 * they were labelled as AI (PNAS Nexus, June 2026), and 34 of the 57 big differences in our evaluation were the AI
 * marking lower than the teacher. So a written answer never gets 0 without the teacher's look.
 * Runs AFTER learned shifts (a shift can move a mark to or from 0). Multiple choice is marked by code and exempt.
 */
export const HARSH_FLAG = "0 marks for a written answer: check it";
export function guardHarsh(q: { final: number; risk: Risk; flags: string[] }, answered: boolean, isMcq: boolean): void {
  q.flags = q.flags.filter((f) => f !== HARSH_FLAG);
  if (!answered || isMcq || q.final > 0) return;
  q.flags.push(HARSH_FLAG);
  if (q.risk === "low") q.risk = "medium";
}

/**
 * The option a student chose in a multiple-choice answer: "B", "b)", "(B)", "Option B", "3. B" -> "B".
 * Returns null when no option is visible, or "AMBIGUOUS:X,Y" when more than one is.
 */
export function mcqChoice(raw: string): string | null {
  const s = (raw ?? "")
    .trim()
    .replace(/^(q(uestion)?\s*)?\d{1,3}\s*[.):\-]\s*/i, "") // the student's question label
    .replace(/^(ans(wer)?|option|choice)\s*[:.\-]?\s*/i, "")
    .trim();
  if (!s) return null;
  const lone = s.match(/^\(?([A-Ea-e])\)?[.)]?$/);
  if (lone) return lone[1].toUpperCase();
  const lead = s.match(/^\(?([A-Ea-e])[).:]\s/) ?? s.match(/^\(([A-Ea-e])\)/);
  if (lead) return lead[1].toUpperCase();
  const caps = [...new Set([...s.matchAll(/\b([A-E])\b/g)].map((m) => m[1]))];
  if (caps.length === 1) return caps[0];
  if (caps.length > 1) return `AMBIGUOUS:${caps.join(",")}`;
  return null;
}

/** Multiple choice is marked by code, not by a model: the chosen letter against the key. */
export function verifyMcq(answer: ReadAnswer | undefined, rubric: RubricQuestion): Verified {
  if (!answer) return blank();
  const key = mcqChoice(rubric.modelAnswer);
  const choice = mcqChoice(answer.text);
  const flags: string[] = [];
  if (!key || key.startsWith("AMBIGUOUS")) flags.push(`the answer key "${rubric.modelAnswer.slice(0, 40)}" has no single option letter`);
  if (!choice) flags.push(`no option letter could be read in "${answer.text.slice(0, 40)}"`);
  else if (choice.startsWith("AMBIGUOUS")) flags.push(`more than one option chosen (${choice.slice(10)})`);
  if (answer.confidence < 0.8 || answer.illegible.length) flags.push(`low reading confidence (${answer.confidence})`);
  const score = choice && key && choice === key && !key.startsWith("AMBIGUOUS") ? rubric.marks : 0;
  return { scoreA: score, scoreB: score, final: score, risk: flags.length ? "medium" : "low", flags };
}
