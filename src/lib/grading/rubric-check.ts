import type { Rubric } from "./schemas";

export type QuestionInput = {
  q: number;
  text: string;
  marks: number;
  answerKey: string; // the teacher's model answer or key points
  type?: "short" | "long" | "math" | "diagram" | "one_word" | "mcq";
};

/** Code checks on the drafted rubric (the agent's output is never trusted blindly). */
export function checkRubric(rubric: Rubric, questions: QuestionInput[]): string[] {
  const problems: string[] = [];
  const byQ = new Map(rubric.questions.map((r) => [r.q, r]));
  for (const qi of questions) {
    const r = byQ.get(qi.q);
    if (!r) { problems.push(`Q${qi.q}: missing from the rubric`); continue; }
    const sum = r.criteria.reduce((s, c) => s + c.points, 0);
    if (Math.abs(sum - qi.marks) > 1e-9) problems.push(`Q${qi.q}: criteria add up to ${sum}, but the question is worth ${qi.marks}`);
    if (Math.abs(r.marks - qi.marks) > 1e-9) problems.push(`Q${qi.q}: marks changed from ${qi.marks} to ${r.marks}`);
    if (new Set(r.criteria.map((c) => c.id)).size !== r.criteria.length) problems.push(`Q${qi.q}: duplicate criterion ids`);
    if (r.criteria.some((c) => (c.points * 2) % 1 !== 0)) problems.push(`Q${qi.q}: points must be whole or half marks`);
  }
  for (const r of rubric.questions) if (!questions.some((q) => q.q === r.q)) problems.push(`Q${r.q}: not in the question paper`);
  return problems;
}


/** Live checks while the teacher edits (no question paper to compare with: the rubric is its own reference). */
export function checkOwnRubric(rubric: Rubric): string[] {
  const problems = checkRubric(rubric, rubric.questions.map((q) => ({ q: q.q, text: q.text, marks: q.marks, answerKey: q.modelAnswer })));
  for (const q of rubric.questions) {
    if (!q.criteria.length) problems.push(`Q${q.q}: add at least one criterion`);
    if (q.criteria.some((c) => !c.mustMention.trim())) problems.push(`Q${q.q}: every criterion needs a description`);
    if (q.type === "mcq" && !/^[A-Ea-e]/.test(q.modelAnswer.trim())) problems.push(`Q${q.q}: the answer must start with the correct option letter`);
  }
  if (new Set(rubric.questions.map((q) => q.q)).size !== rubric.questions.length) problems.push("two questions have the same number");
  return problems;
}
