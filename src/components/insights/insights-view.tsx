import Link from "next/link";
import { fmtMark } from "@/components/marks";
import type { InsightsData } from "@/lib/db/insights";
import { itemNote } from "@/lib/insights/analysis";
import { InlineMd } from "@/components/inline-md";
import { InsightButton } from "./actions";
import { Dumbbell, MarkSplit, MarkSplitLegend, Meter } from "./charts";

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Class insights: shared by a teacher's test and the read-only sample class. */
export function InsightsView({ data, mode, reviewHref }: { data: InsightsData; mode: "teacher" | "sample"; reviewHref: string }) {
  const sample = mode === "sample";
  const nameOf = (code: string) => data.students.get(code)?.display_name ?? code;
  const qText = (q: number) => data.test.rubric.questions.find((x) => x.q === q)?.text ?? "";
  const classSize = data.scripts;

  return (
    <div className="space-y-14">
      <p className="text-muted-foreground">
        Based on {data.scripts} marked script{data.scripts === 1 ? "" : "s"}
        {data.approvedScripts < data.scripts ? ` (${data.approvedScripts} fully approved; the rest still include suggested marks)` : ", all approved"}.
      </p>

      {/* ------------------------------------------------ misconceptions */}
      <section aria-labelledby="mis">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="mis" className="text-xl font-semibold">What the class misunderstood</h2>
          {data.map && !sample && <InsightButton kind="map" testId={data.test.id} label="Refresh" />}
        </div>
        {!data.map ? (
          <div className="mt-4 margin-rule pl-4">
            <p>GradeLens groups the wrong ideas the graders noted in each answer into misconceptions, and counts the students who have each one.</p>
            {data.scripts > 0
              ? <div className="mt-3"><InsightButton kind="map" testId={data.test.id} sample={sample} label="Find what the class misunderstood" primary /></div>
              : <p className="mt-2 text-muted-foreground">Nothing to analyse until scripts are marked.</p>}
          </div>
        ) : !data.map.clusters.length ? (
          <p className="mt-4 text-muted-foreground">No misconceptions were noted in these scripts.</p>
        ) : (
          <ol className="mt-5 divide-y divide-ruling border-y border-ruling">
            {data.map.clusters.slice(0, 12).map((c) => {
              const plan = data.reteach.find((r) => r.clusterId === c.id);
              return (
                <li key={c.id} className="grid gap-3 py-4 md:grid-cols-[minmax(0,1fr)_14rem]">
                  <div className="min-w-0">
                    <h3 className="font-semibold">{c.label}</h3>
                    {c.explanation && <p className="mt-1 text-[0.95rem] text-muted-foreground"><InlineMd text={c.explanation} /></p>}
                    <p className="mt-1 text-[0.9rem] text-muted-foreground">
                      Seen in {c.questions.map((q) => `Q${q}`).join(", ")} · {c.students.map(nameOf).slice(0, 8).join(", ")}{c.students.length > 8 ? ` and ${c.students.length - 8} more` : ""}
                    </p>
                    {c.examples.length > 0 && (
                      <ul className="mt-2 space-y-1.5">
                        {c.examples.slice(0, 2).map((e) => (
                          <li key={`${e.code}-${e.q}`} className="border-l-2 border-ruling pl-3 text-[0.95rem]">
                            <q className="italic">{e.quote.length > 180 ? `${e.quote.slice(0, 180)}…` : e.quote}</q>
                            <span className="text-[0.85rem] text-muted-foreground"> {nameOf(e.code)}, Q{e.q}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {plan ? <ReteachPlan plan={plan} testId={data.test.id} sample={sample} /> : (
                      <div className="mt-3"><InsightButton kind="reteach" testId={data.test.id} clusterId={c.id} sample={sample} label="Plan a 10-minute re-teach" /></div>
                    )}
                  </div>
                  <div className="md:pt-1">
                    <p className="text-[0.95rem]"><strong>{c.students.length}</strong> of {classSize} student{classSize === 1 ? "" : "s"}</p>
                    <div className="mt-1.5"><Meter value={c.students.length} max={classSize} label={`${c.students.length} of ${classSize} students (${pct(c.students.length / Math.max(1, classSize))})`} /></div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {data.map && <p className="mt-2 text-[0.85rem] text-muted-foreground">Grouped by {data.map.model ?? "AI"}; who has each misconception is checked against the graders&apos; notes by code.</p>}
      </section>

      {/* ------------------------------------------------ learning gain */}
      {data.retests.length > 0 && (
        <section aria-labelledby="gain">
          <h2 id="gain" className="text-xl font-semibold">Did the re-teach work?</h2>
          {data.retests.map((r) => (
            <div key={r.test.id} className="mt-4 rounded-md border border-ruling bg-white p-4">
              <p className="font-semibold"><Link href={sample ? "#" : `/app/tests/${r.test.id}`} className="underline-offset-4 hover:underline">{r.test.title}</Link></p>
              {r.gain.rows.length === 0 ? (
                <p className="mt-1 text-[0.95rem] text-muted-foreground">
                  {r.scripts ? "No student has both the original test and the re-test marked yet." : r.test.status === "approved" ? "Waiting for re-test scripts." : "Approve the re-test's mark scheme, then share its upload link."}
                </p>
              ) : (
                <>
                  <dl className="mt-3 flex flex-wrap gap-8">
                    <div><dt className="text-[0.85rem] text-muted-foreground">Before (original questions)</dt><dd className="text-2xl font-[750]">{pct(r.gain.meanPre)}</dd></div>
                    <div><dt className="text-[0.85rem] text-muted-foreground">After (re-test)</dt><dd className="text-2xl font-[750]">{pct(r.gain.meanPost)}</dd></div>
                    <div><dt className="text-[0.85rem] text-muted-foreground">Normalised gain</dt><dd className="text-2xl font-[750]">{r.gain.meanGain === null ? "–" : r.gain.meanGain.toFixed(2)}</dd></div>
                  </dl>
                  <p className="mt-1 text-[0.85rem] text-muted-foreground">Normalised gain = (after − before) ÷ (1 − before): the share of the possible improvement achieved (Hake, 1998).</p>
                  <table className="mt-3 w-full text-left text-[0.95rem]">
                    <thead><tr className="text-[0.85rem] text-muted-foreground"><th className="py-1 font-semibold">Student</th><th className="w-1/2 py-1 font-semibold">Before ○ → after ●</th><th className="py-1 text-right font-semibold">Gain</th></tr></thead>
                    <tbody>
                      {r.gain.rows.map((g) => {
                        const st = [...data.students.values()].find((s) => s.id === g.student);
                        return (
                          <tr key={g.student} className="border-t border-ruling">
                            <td className="py-1.5 pr-3">{st?.display_name ?? "Student"}</td>
                            <td className="py-1.5 pr-3"><Dumbbell pre={g.pre} post={g.post} label={`${pct(g.pre)} before, ${pct(g.post)} after`} /></td>
                            <td className="py-1.5 text-right tabular-nums">{g.gain === null ? "already full" : g.gain.toFixed(2)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          ))}
        </section>
      )}

      {/* ------------------------------------------------ item analysis */}
      <section aria-labelledby="items">
        <h2 id="items" className="text-xl font-semibold">Question by question</h2>
        <p className="mt-1 max-w-3xl text-[0.95rem] text-muted-foreground">
          Facility is the class&apos;s average share of the marks. Discrimination compares the top and bottom 27% of scripts: near 0 or
          negative means the question doesn&apos;t separate stronger from weaker students (check its wording or mark scheme).
        </p>
        <div className="mt-3"><MarkSplitLegend /></div>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[42rem] border-collapse text-left">
            <thead>
              <tr className="border-b border-ruling text-[0.85rem] text-muted-foreground">
                <th className="py-2 pr-3 font-semibold">Question</th>
                <th className="w-40 py-2 pr-3 font-semibold">Facility</th>
                <th className="w-44 py-2 pr-3 font-semibold">Marks</th>
                <th className="py-2 pr-3 text-right font-semibold">Discrim.</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((s) => {
                const note = itemNote(s);
                return (
                  <tr key={s.q} className="border-b border-ruling align-top">
                    <td className="py-2 pr-3 text-[0.95rem]">
                      <span className="font-semibold">Q{s.q}</span> <span className="text-muted-foreground">({fmtMark(s.max)})</span>{" "}
                      <span className="line-clamp-1">{qText(s.q)}</span>
                      {note && <span className="block text-[0.85rem] font-semibold text-check">{note}</span>}
                    </td>
                    <td className="py-2 pr-3">
                      <span className="block text-[0.9rem] tabular-nums">{pct(s.facility)}</span>
                      <Meter value={s.facility} max={1} label={`Facility ${pct(s.facility)} over ${s.n} scripts`} />
                    </td>
                    <td className="py-2 pr-3">
                      <span className="block text-[0.85rem] tabular-nums text-muted-foreground">{s.full} · {s.partial} · {s.zero} · {s.blank}</span>
                      <MarkSplit full={s.full} partial={s.partial} zero={s.zero} blank={s.blank}
                        label={`${s.full} full marks, ${s.partial} some marks, ${s.zero} no marks, ${s.blank} not answered`} />
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{s.discrimination === null ? "–" : s.discrimination.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ------------------------------------------------ feedback */}
      <section aria-labelledby="fb">
        <h2 id="fb" className="text-xl font-semibold">Feedback for each student</h2>
        <p className="mt-1 max-w-3xl text-[0.95rem] text-muted-foreground">
          Written from the mark scheme and the marks (no invented praise): what earned marks, and what was missing, in the mark
          scheme&apos;s own words.
        </p>
        <ul className="mt-3 divide-y divide-ruling border-y border-ruling">
          {data.feedback.map((f) => (
            <li key={f.submissionId}>
              <details>
                <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-2 px-1 py-2.5 hover:bg-secondary/60">
                  <span className="font-semibold">{f.name}</span>
                  <span className="text-[0.95rem] text-muted-foreground">
                    {fmtMark(f.fb.score)}/{fmtMark(f.fb.max)}{f.approved ? "" : " (includes suggested marks)"}
                  </span>
                </summary>
                <div className="grid gap-4 px-1 pb-4 md:grid-cols-2">
                  <div>
                    <p className="text-[0.9rem] font-semibold">Did well</p>
                    {f.fb.strengths.length ? <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[0.95rem]">{f.fb.strengths.slice(0, 8).map((s) => <li key={s}>{s}</li>)}</ul> : <p className="text-[0.95rem] text-muted-foreground">No full-mark answers yet.</p>}
                  </div>
                  <div>
                    <p className="text-[0.9rem] font-semibold">Next steps</p>
                    {f.fb.nextSteps.length ? <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[0.95rem]">{f.fb.nextSteps.slice(0, 8).map((s) => <li key={s}>{s}</li>)}</ul> : <p className="text-[0.95rem] text-muted-foreground">Full marks.</p>}
                  </div>
                  <p className="text-[0.9rem] md:col-span-2">
                    <Link href={`${reviewHref}?s=${f.submissionId}`} className="underline underline-offset-4">Open the script</Link>
                    {!sample && <> · <Link href={`/app/report/${f.submissionId}`} className="underline underline-offset-4">Report for the student and parents</Link></>}
                  </p>
                </div>
              </details>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function ReteachPlan({ plan, testId, sample }: { plan: InsightsData["reteach"][number]; testId: string; sample: boolean }) {
  return (
    <details className="mt-3 rounded-md border border-ruling bg-white" open>
      <summary className="cursor-pointer px-3 py-2 font-semibold">10-minute re-teach plan</summary>
      <div className="space-y-4 px-3 pb-4">
        <ol className="space-y-1">
          {plan.plan.map((s, i) => <li key={i} className="grid grid-cols-[3.5rem_1fr] gap-2 text-[0.95rem]"><span className="font-semibold tabular-nums">{s.minutes} min</span><span><InlineMd text={s.activity} /></span></li>)}
        </ol>
        <div>
          <p className="text-[0.9rem] font-semibold">For the board</p>
          <p className="text-[0.95rem]"><InlineMd text={plan.explanation} /></p>
          <p className="mt-1 whitespace-pre-wrap text-[0.95rem] text-muted-foreground"><InlineMd text={plan.workedExample} /></p>
        </div>
        <div>
          <p className="text-[0.9rem] font-semibold">Worksheet{!sample && <> · <Link href={`/app/tests/${testId}/worksheet/${plan.id}`} className="font-normal underline underline-offset-4">print it</Link></>}</p>
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-[0.95rem]">
            {plan.practice.map((p, i) => <li key={i}><InlineMd text={p.question} /> <span className="text-muted-foreground">(Answer: <InlineMd text={p.answer} />)</span></li>)}
          </ol>
        </div>
        <div>
          <p className="text-[0.9rem] font-semibold">Re-test ({plan.retest.reduce((s, q) => s + q.marks, 0)} marks)</p>
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-[0.95rem]">
            {plan.retest.map((q, i) => <li key={i} className="whitespace-pre-wrap"><InlineMd text={q.text} /> <span className="text-muted-foreground">[{q.marks}]</span></li>)}
          </ol>
          <div className="mt-3"><InsightButton kind="retest" testId={testId} reteachId={plan.id} sample={sample} label="Create this re-test" primary /></div>
          <p className="mt-1 text-[0.85rem] text-muted-foreground">Creates a new test with a drafted mark scheme for you to check. When students take it, this page shows each student&apos;s before and after.</p>
        </div>
        <p className="text-[0.8rem] text-muted-foreground">Drafted by {plan.model ?? "AI"}. Check every question and answer before using it in class.</p>
      </div>
    </details>
  );
}
