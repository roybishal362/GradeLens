import type { Metadata } from "next";
import { Suspense } from "react";
import { fmtMark, Mark } from "@/components/marks";
import { toLite } from "@/lib/db/insights";
import { studentResults } from "@/lib/db/student-results";
import { markOf } from "@/lib/db/types";
import { studentFeedback } from "@/lib/insights/analysis";
import { gradeFor } from "@/lib/results";
import { RecheckForm } from "./recheck-form";

export const metadata: Metadata = { title: "Your results", robots: { index: false, follow: false } };

export default function ResultsPage({ params }: PageProps<"/r/[token]">) {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-8">
      <p className="text-lg font-[750] tracking-tight">GradeLens</p>
      <Suspense fallback={<p className="mt-8 text-muted-foreground">Opening your results…</p>}>
        <View params={params} />
      </Suspense>
    </main>
  );
}

async function View({ params }: Pick<PageProps<"/r/[token]">, "params">) {
  const { token } = await params;
  const r = await studentResults(token);
  if (r.state === "invalid") {
    return <Notice title="This link doesn't work" text="Check you copied the whole link, or ask your teacher for it again." />;
  }
  if (r.state !== "ready") {
    return r.state === "hidden"
      ? <Notice title={r.test} sub={r.className} text={`Your teacher${r.teacher ? `, ${r.teacher},` : ""} hasn't released the results yet. Open this link again later.`} />
      : <Notice title={r.test} sub={r.className} text="Your teacher is still checking your marks. Open this link again later." />;
  }
  const pct = r.max ? (100 * r.total) / r.max : 0;
  const grade = gradeFor(pct, r.boundaries);
  const fb = studentFeedback(r.results.map(toLite), r.rubric);
  const qText = (q: number) => r.rubric.questions.find((x) => x.q === q)?.text ?? "";
  return (
    <article className="mt-6">
      <p className="text-muted-foreground">{r.className}{r.teacher && ` · ${r.teacher}`}{r.school && `, ${r.school}`}</p>
      <h1 className="mt-1 text-[1.75rem] font-[750] leading-tight tracking-tight">{r.test}</h1>
      <p className="mt-1">{r.student}</p>

      <div className="mt-5 flex flex-wrap items-end gap-6 border-y border-ruling py-4">
        <Mark value={r.total} max={r.max} approved className="text-5xl" />
        <span className="pb-1 text-xl font-semibold">{Math.round(pct)}%</span>
        {grade && <span className="pb-1 text-xl font-semibold">Grade {grade}</span>}
      </div>

      <section className="mt-6 grid gap-6 sm:grid-cols-2">
        <div>
          <h2 className="font-semibold">What went well</h2>
          {fb.strengths.length ? <ul className="mt-1 list-disc space-y-1 pl-5">{fb.strengths.slice(0, 8).map((s) => <li key={s}>{s}</li>)}</ul> : <p className="mt-1 text-muted-foreground">Keep going. Next time aim for full marks on one question first.</p>}
        </div>
        <div>
          <h2 className="font-semibold">What to work on</h2>
          {fb.nextSteps.length ? <ul className="mt-1 list-disc space-y-1 pl-5">{fb.nextSteps.slice(0, 8).map((s) => <li key={s}>{s}</li>)}</ul> : <p className="mt-1 text-muted-foreground">Full marks on every question.</p>}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="font-semibold">Your marks</h2>
        <ul className="mt-2 divide-y divide-ruling border-y border-ruling">
          {r.results.map((x) => {
            const req = r.requests.filter((q) => q.q === x.q).at(-1);
            return (
              <li key={x.id} className="py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span><span className="font-semibold">Q{x.q}</span> <span className="text-[0.95rem] text-muted-foreground">{qText(x.q).slice(0, 90)}{qText(x.q).length > 90 ? "…" : ""}</span></span>
                  <span className="mark shrink-0 text-2xl" data-approved="true">{fmtMark(Number(markOf(x)))}/{fmtMark(Number(x.max))}</span>
                </div>
                {x.teacher_note && x.teacher_note !== "Mark from the dataset's teacher" && <p className="mt-1 text-[0.95rem]"><span className="font-semibold">Teacher:</span> {x.teacher_note}</p>}
                {req && (
                  <p className="mt-1 text-[0.9rem] text-muted-foreground">
                    You asked: &ldquo;{req.message}&rdquo; · {req.status === "open" ? "waiting for your teacher" : `answered${req.response ? `: “${req.response}”` : ""}`}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {r.pages.length > 0 && (
        <section className="mt-8">
          <h2 className="font-semibold">Your pages</h2>
          <ul className="mt-2 grid grid-cols-3 gap-3">
            {r.pages.map((p) => (
              <li key={p.page_no}>
                <a href={p.url} target="_blank" rel="noreferrer" className="block rounded-md border border-ruling bg-white p-1 hover:border-ink/40">
                  {/* eslint-disable-next-line @next/next/no-img-element -- signed, expiring storage URL */}
                  <img src={p.url} alt={`Page ${p.page_no}`} className="aspect-[3/4] w-full object-cover object-top" />
                  <span className="mt-1 block text-center text-[0.85rem]">Page {p.page_no}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8 rounded-md border border-ruling bg-white p-4">
        <h2 className="font-semibold">Think a mark is wrong?</h2>
        <p className="mt-1 text-[0.95rem] text-muted-foreground">Ask your teacher to look at one question again. Say what you wrote and why it deserves more (or fewer) marks.</p>
        {r.sample ? <p className="mt-2 text-[0.95rem]">This is the public sample class, so requests are switched off.</p>
          : <RecheckForm token={token} questions={r.results.map((x) => x.q)} />}
      </section>
    </article>
  );
}

function Notice({ title, sub, text }: { title: string; sub?: string; text: string }) {
  return (
    <div className="mt-8">
      <h1 className="text-2xl font-[750]">{title}</h1>
      {sub && <p className="text-muted-foreground">{sub}</p>}
      <p className="mt-3">{text}</p>
    </div>
  );
}
