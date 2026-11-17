import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { fmtMark, Mark } from "@/components/marks";
import { requireTeacher } from "@/lib/dal";
import { toLite } from "@/lib/db/insights";
import { markOf, QR_COLS, TEST_COLS, type QuestionResultRow, type TestRow } from "@/lib/db/types";
import { studentFeedback } from "@/lib/insights/analysis";
import { userDb } from "@/lib/supabase/clients";
import { PrintButton } from "../../tests/[testId]/sheets/print-button";

export const metadata: Metadata = { title: "Report" };

export default function ReportPage({ params }: PageProps<"/app/report/[submissionId]">) {
  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-10 print:max-w-none print:p-0">
      <style>{`@page { size: A4; margin: 14mm; } @media print { header, .no-print { display: none !important; } body { background: #fff; } }`}</style>
      <Suspense fallback={<p className="text-muted-foreground">Preparing the report…</p>}>
        <View params={params} />
      </Suspense>
    </main>
  );
}

async function View({ params }: Pick<PageProps<"/app/report/[submissionId]">, "params">) {
  const { submissionId } = await params;
  await requireTeacher(`/app/report/${submissionId}`);
  const db = await userDb();
  const { data: sub } = await db.from("submissions").select("id,test_id,student_id,status,updated_at").eq("id", submissionId).maybeSingle<{ id: string; test_id: string; student_id: string; status: string; updated_at: string }>();
  if (!sub) notFound();
  const [{ data: test }, { data: student }, { data: results }, { data: classSubs }] = await Promise.all([
    db.from("tests").select(TEST_COLS).eq("id", sub.test_id).single<TestRow>(),
    db.from("students").select("display_name").eq("id", sub.student_id).single<{ display_name: string }>(),
    db.from("question_results").select(QR_COLS).eq("submission_id", submissionId).order("q").returns<QuestionResultRow[]>(),
    db.from("submissions").select("total,max_total,status").eq("test_id", sub.test_id).in("status", ["graded", "approved"]),
  ]);
  if (!test || !student) notFound();
  const rows = results ?? [];
  const fb = studentFeedback(rows.map(toLite), test.rubric);
  const allApproved = rows.length > 0 && rows.every((r) => r.approved);
  const others = (classSubs ?? []).filter((s: { total: number | null }) => s.total !== null) as { total: number; max_total: number }[];
  const classAvg = others.length >= 5 ? others.reduce((s, x) => s + Number(x.total) / Number(x.max_total), 0) / others.length : null;

  return (
    <article>
      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link href={`/app/tests/${test.id}/review?s=${submissionId}`} className="text-[0.95rem] underline underline-offset-4">Back to the script</Link>
        <PrintButton count={1} />
      </div>
      {!allApproved && (
        <p role="alert" className="mb-6 rounded-md border border-check/40 bg-check/5 px-4 py-3">
          Draft: some marks are still GradeLens suggestions. Approve every mark before sharing this report.
        </p>
      )}
      <header className="border-b-2 border-ink pb-4">
        <p className="text-[0.9rem] text-muted-foreground">{test.title}</p>
        <h1 className="text-[1.95rem] font-[750] tracking-tight">{student.display_name}</h1>
        <div className="mt-2 flex flex-wrap items-end gap-6">
          <Mark value={fb.score} max={fb.max} approved={allApproved} className="text-5xl" />
          <span className="pb-1 text-lg">{Math.round((fb.score / Math.max(1, fb.max)) * 100)}%</span>
          {classAvg !== null && <span className="pb-1 text-muted-foreground">Class average {Math.round(classAvg * 100)}%</span>}
        </div>
      </header>

      <section className="mt-6 grid gap-6 sm:grid-cols-2">
        <div>
          <h2 className="font-semibold">What went well</h2>
          {fb.strengths.length ? <ul className="mt-1 list-disc space-y-1 pl-5">{fb.strengths.slice(0, 10).map((s) => <li key={s}>{s}</li>)}</ul> : <p className="mt-1 text-muted-foreground">Keep going: no full-mark answers on this test yet.</p>}
        </div>
        <div>
          <h2 className="font-semibold">What to work on next</h2>
          {fb.nextSteps.length ? <ul className="mt-1 list-disc space-y-1 pl-5">{fb.nextSteps.slice(0, 10).map((s) => <li key={s}>{s}</li>)}</ul> : <p className="mt-1 text-muted-foreground">Full marks on every question.</p>}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="font-semibold">Marks by question</h2>
        <table className="mt-2 w-full border-collapse text-left text-[0.95rem]">
          <thead><tr className="border-b border-ruling text-[0.85rem] text-muted-foreground"><th className="py-1.5 pr-3 font-semibold">Question</th><th className="py-1.5 pr-3 font-semibold">Mark</th><th className="py-1.5 font-semibold">Teacher&apos;s note</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-ruling align-top">
                <td className="py-1.5 pr-3">Q{r.q}</td>
                <td className="py-1.5 pr-3 tabular-nums">{fmtMark(Number(markOf(r)))} / {fmtMark(Number(r.max))}</td>
                <td className="py-1.5">{r.teacher_note && r.teacher_note !== "Mark from the dataset's teacher" ? r.teacher_note : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="mt-8 text-[0.8rem] text-muted-foreground">
        Marked with GradeLens: an AI suggested each mark from the mark scheme with the student&apos;s own words as evidence, and the
        teacher checked and approved every mark{allApproved ? "" : " (not yet complete)"}.
      </p>
    </article>
  );
}
