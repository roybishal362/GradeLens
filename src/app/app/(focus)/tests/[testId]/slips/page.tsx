import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { Suspense } from "react";
import { fmtMark } from "@/components/marks";
import { PrintButton } from "@/components/print-button";
import { requireTeacher } from "@/lib/dal";
import { testMarks } from "@/lib/db/results-data";
import { siteOrigin } from "@/lib/db/teacher";
import { studentFeedback } from "@/lib/insights/analysis";
import { userDb } from "@/lib/supabase/clients";

export const metadata: Metadata = { title: "Reports for all students" };

export default function SlipsPage({ params }: PageProps<"/app/tests/[testId]/slips">) {
  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-8 print:max-w-none print:p-0">
      <style>{`@page { size: A4; margin: 12mm; } @media print { header, .no-print { display: none !important; } body { background: #fff; } }`}</style>
      <Suspense fallback={<p className="text-muted-foreground">Preparing the reports…</p>}>
        <View params={params} />
      </Suspense>
    </main>
  );
}

async function View({ params }: Pick<PageProps<"/app/tests/[testId]/slips">, "params">) {
  const { testId } = await params;
  const t = await requireTeacher(`/app/tests/${testId}/slips`);
  const data = await testMarks(testId);
  if (!data) notFound();
  const db = await userDb();
  const { data: profile } = await db.from("teacher_profiles").select("display_name,school").eq("user_id", t.id).maybeSingle<{ display_name: string | null; school: string | null }>();
  const origin = await siteOrigin();
  const ready = data.lines.filter((l) => l.approved);
  const slips = await Promise.all(ready.map(async (l) => ({
    l,
    fb: studentFeedback(l.marks.map((m) => ({ submissionId: l.submissionId!, q: m.q, max: m.max, mark: m.mark, approved: m.approved, criteria: m.criteria, misconceptions: m.misconceptions, answerText: m.answered ? "answered" : "" })), data.test.rubric),
    qr: data.test.results_released && l.resultToken ? await QRCode.toString(`${origin}/r/${l.resultToken}`, { type: "svg", margin: 0, errorCorrectionLevel: "M" }) : null,
  })));
  const pending = data.lines.filter((l) => l.submissionId && !l.approved).length;
  return (
    <>
      <div className="no-print mb-8 space-y-2">
        <Link href={`/app/tests/${testId}`} className="text-[0.95rem] underline underline-offset-4">Back to {data.test.title}</Link>
        <h1 className="text-[1.85rem] font-[750] tracking-tight">Reports for all students</h1>
        <p className="text-muted-foreground">
          One page per student with approved marks.{pending > 0 && ` ${pending} script${pending === 1 ? " isn't" : "s aren't"} fully approved yet and ${pending === 1 ? "is" : "are"} left out.`}
          {data.test.results_released ? " The QR code opens the student's results online." : " Release results on the test page to add a QR code to each report."}
        </p>
        <PrintButton count={slips.length} />
      </div>
      <div className="space-y-8 print:space-y-0">
        {slips.map(({ l, fb, qr }) => (
          <section key={l.studentId} className="break-after-page rounded-md border border-ruling bg-white p-8 print:border-0 print:p-0">
            <div className="flex items-start justify-between gap-6 border-b-2 border-ink pb-3">
              <div>
                <p className="text-[0.85rem] text-muted-foreground">{data.className}{profile?.display_name && ` · ${profile.display_name}`}{profile?.school && `, ${profile.school}`}</p>
                <h2 className="text-xl font-[750]">{l.name}</h2>
                <p>{data.test.title}</p>
              </div>
              <div className="text-right">
                <p className="mark text-4xl" data-approved="true">{fmtMark(l.total)}/{fmtMark(l.max)}</p>
                <p className="font-semibold">{Math.round(l.percent ?? 0)}%{l.grade && ` · Grade ${l.grade}`}</p>
              </div>
            </div>
            <div className="mt-4 grid gap-6 sm:grid-cols-[1fr_auto]">
              <div className="space-y-3 text-[0.95rem]">
                <div><p className="font-semibold">What went well</p><ul className="list-disc pl-5">{(fb.strengths.length ? fb.strengths : ["Keep going."]).slice(0, 5).map((s) => <li key={s}>{s}</li>)}</ul></div>
                <div><p className="font-semibold">What to work on</p><ul className="list-disc pl-5">{(fb.nextSteps.length ? fb.nextSteps : ["Full marks on every question."]).slice(0, 5).map((s) => <li key={s}>{s}</li>)}</ul></div>
              </div>
              {qr && <div className="w-28 text-center"><div dangerouslySetInnerHTML={{ __html: qr }} /><p className="mt-1 text-[0.75rem] text-muted-foreground">Scan for your full results</p></div>}
            </div>
            <div className="mt-4 grid grid-cols-6 gap-x-3 gap-y-1 text-[0.85rem] tabular-nums sm:grid-cols-10">
              {l.marks.map((m) => <span key={m.q}><span className="text-muted-foreground">Q{m.q}</span> {fmtMark(m.mark)}/{fmtMark(m.max)}</span>)}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
