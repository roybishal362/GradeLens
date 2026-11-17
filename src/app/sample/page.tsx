import type { Metadata } from "next";
import Link from "next/link";
import { DatasetAttribution } from "@/components/attribution";
import { Mark, RiskLabel } from "@/components/marks";
import { sampleReview } from "@/lib/db/sample";

export const metadata: Metadata = {
  title: "Sample class",
  description: "Real handwritten exam scripts from a public dataset, read and marked by GradeLens. Try the review yourself.",
};

export default async function SamplePage() {
  const data = await sampleReview();
  if (!data) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-12">
        <h1 className="text-[1.95rem] font-[750] tracking-tight">Sample class</h1>
        <p className="mt-3 text-muted-foreground">The sample class is being prepared. Please check back shortly.</p>
      </main>
    );
  }
  const { test, scripts } = data;
  const approved = scripts.filter((s) => s.status === "approved");
  const waiting = scripts.filter((s) => s.status !== "approved");
  const qs = test.rubric.questions;
  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-10">
      <p className="text-[0.95rem] text-muted-foreground">Sample class · no sign-in needed · nothing you do here is saved</p>
      <h1 className="mt-1 text-[1.95rem] font-[750] leading-tight tracking-tight">{data.className}</h1>
      <p className="mt-1 text-lg">{test.title}</p>

      <div className="mt-6 grid gap-6 md:grid-cols-[3fr_2fr]">
        <div className="space-y-3 text-[1.02rem]">
          <p>
            These are <strong>real handwritten answer sheets</strong> from university students, published with the teacher&apos;s own
            marks as an open dataset. GradeLens read each photographed script and suggested every mark from the mark scheme,
            with the student&apos;s words as evidence.
          </p>
          <p className="margin-rule pl-4">
            <span className="mark text-2xl" data-approved="true">Red pen</span> = decided by a teacher.{" "}
            <span className="mark text-2xl">Pencil</span> = suggested by GradeLens, waiting for review.
            The first {approved.length} scripts carry the dataset teacher&apos;s real marks: GradeLens used them as examples of this
            teacher&apos;s standard for the other {waiting.length}. On every answer you can compare the suggestion with the mark the real
            teacher gave.
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            <Link href="/sample/review" className="rounded-md bg-redpen px-5 py-2.5 font-semibold text-white hover:bg-[#b81f1f]">Review the scripts</Link>
            <Link href="/sample/insights" className="rounded-md border border-ink/25 bg-white px-5 py-2.5 font-semibold hover:bg-secondary">What the class misunderstood</Link>
            <Link href="/transparency" className="px-1 py-2.5 font-semibold underline underline-offset-4">How accurate is it?</Link>
          </div>
        </div>
        <dl className="grid grid-cols-2 content-start gap-px overflow-hidden rounded-md border border-ruling bg-ruling text-center">
          {[
            ["Scripts", scripts.length],
            ["Questions", qs.length],
            ["Multiple choice", qs.filter((q) => q.type === "mcq").length],
            ["Short answers", qs.filter((q) => q.type !== "mcq").length],
          ].map(([k, v]) => (
            <div key={k} className="bg-white px-3 py-4">
              <dt className="text-[0.85rem] text-muted-foreground">{k}</dt>
              <dd className="text-2xl font-[750]">{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      <h2 className="mt-12 text-xl font-semibold">Scripts</h2>
      <ul className="mt-3 grid gap-px overflow-hidden rounded-md border border-ruling bg-ruling sm:grid-cols-2 lg:grid-cols-3">
        {scripts.map((s) => (
          <li key={s.id} className="bg-white">
            <Link href={`/sample/review?s=${s.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-secondary/60">
              <span>
                <span className="block font-semibold">{s.student.display_name}</span>
                {s.status === "approved" ? <span className="text-[0.85rem] font-semibold text-redpen">Marked by the dataset&apos;s teacher</span> : <RiskLabel risk={s.risk} className="text-[0.85rem]" />}
              </span>
              {s.total !== null && <Mark value={Number(s.total)} max={Number(s.max_total)} approved={s.status === "approved"} className="text-2xl" />}
            </Link>
          </li>
        ))}
      </ul>
      <DatasetAttribution className="mt-10 max-w-3xl" />
    </main>
  );
}
