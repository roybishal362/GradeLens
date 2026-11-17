import type { ReadAnswer } from "./schemas";
import { normalize, quoteFound } from "./verifier";

const words = (s: string) => normalize(s).split(" ").filter((w) => w.length > 1 || /\d/.test(w));

/**
 * Which handwritten lines of an answer a grader's evidence quote came from, so the review screen can put the
 * highlighter on the student's page. A line counts when the quote contains (most of) it, or the line contains the
 * quote. Fragments joined with "..." are matched separately.
 */
export function evidenceLines(quote: string, lines: ReadAnswer["lines"]): number[] {
  const fragments = (quote ?? "").split(/\.\.\.|…/).map((f) => f.trim()).filter(Boolean);
  if (!fragments.length) return [];
  const hits = new Set<number>();
  for (const frag of fragments) {
    const fw = new Set(words(frag));
    if (!fw.size) continue;
    lines.forEach((line, i) => {
      const lw = words(line.text);
      if (!lw.length) return;
      const inside = lw.filter((w) => fw.has(w)).length / lw.length; // share of the line that is quoted
      if ((inside >= 0.6 && (lw.length >= 2 || fw.size <= 2)) || quoteFound(frag, line.text)) hits.add(i);
    });
  }
  return [...hits].sort((a, b) => a - b);
}

/** The page (1-based) a line is on: its own page when the reader gave one, else the page the answer starts on. */
export const pageOfLine = (answer: Pick<ReadAnswer, "page">, line: ReadAnswer["lines"][number]) => line.page ?? answer.page;
