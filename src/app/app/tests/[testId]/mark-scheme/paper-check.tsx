"use client";

import { useState, useTransition } from "react";
import { Meter } from "@/components/insights/charts";
import { fmtMark } from "@/components/marks";
import { checkQuestionPaper } from "../../../insight-actions";
import type { PaperCheck as Check } from "@/lib/insights/agents";

const LABEL: Record<string, string> = {
  remember: "Remember (recall facts)", understand: "Understand (explain)", apply: "Apply (use in a new case)",
  analyse: "Analyse (break down, compare)", evaluate: "Evaluate (judge, justify)", create: "Create (design, produce)",
};

/** "Check the paper before you give it": the thinking each question asks for, and concrete problems to fix. */
export function PaperCheck({ testId }: { testId: string }) {
  const [check, setCheck] = useState<Check | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const issues = check?.questions.filter((q) => q.issues.length) ?? [];
  const recall = check ? (check.marksBySkill.remember ?? 0) / Math.max(1, check.total) : 0;
  return (
    <section aria-labelledby="pc" className="rounded-md border border-ruling bg-white p-4">
      <h2 id="pc" className="text-lg font-semibold">Check the paper before you give it</h2>
      <p className="mt-1 text-[0.95rem] text-muted-foreground">
        What kind of thinking each question asks for, and wording or answer-key problems that would make marking unfair.
      </p>
      {!check && (
        <button type="button" disabled={pending} onClick={() => start(async () => { setError(null); const r = await checkQuestionPaper(testId); if (r.ok) setCheck(r.check); else setError(r.error); })}
          className="mt-3 rounded-md border border-ink/25 bg-white px-4 py-2 font-semibold hover:bg-secondary disabled:opacity-50">
          {pending ? "Checking the paper…" : "Check the paper"}
        </button>
      )}
      {error && <p role="status" className="mt-2 text-flag">{error}</p>}
      {check && (
        <div className="mt-4 grid gap-6 md:grid-cols-2">
          <div>
            <p className="text-[0.9rem] font-semibold">Marks by kind of thinking</p>
            <ul className="mt-2 space-y-2">
              {Object.entries(check.marksBySkill).filter(([, m]) => m > 0).map(([skill, m]) => (
                <li key={skill} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 text-[0.9rem]">
                  <span>{LABEL[skill]}</span>
                  <span className="tabular-nums text-muted-foreground">{fmtMark(m)} of {fmtMark(check.total)}</span>
                  <span className="col-span-2"><Meter value={m} max={check.total} label={`${LABEL[skill]}: ${m} of ${check.total} marks`} /></span>
                </li>
              ))}
            </ul>
            {recall > 0.6 && <p className="mt-3 text-[0.9rem] font-semibold text-check">Most of the marks are for recall. Consider a question that asks students to apply or explain.</p>}
          </div>
          <div>
            <p className="text-[0.9rem] font-semibold">{issues.length ? `${issues.length} question${issues.length === 1 ? "" : "s"} to look at` : "No problems found"}</p>
            <ul className="mt-2 space-y-2 text-[0.95rem]">
              {issues.map((q) => <li key={q.q}><strong>Q{q.q}:</strong> {q.issues.join(" ")}</li>)}
            </ul>
          </div>
          <p className="text-[0.8rem] text-muted-foreground md:col-span-2">Levels and issues suggested by {check.model}; mark totals computed from your paper. You decide what to change.</p>
        </div>
      )}
    </section>
  );
}
