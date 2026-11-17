import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireTeacher } from "@/lib/dal";
import type { ReteachPayload } from "@/lib/db/insights";
import { userDb } from "@/lib/supabase/clients";
import { InlineMd } from "@/components/inline-md";
import { PrintButton } from "@/components/print-button";

export const metadata: Metadata = { title: "Worksheet" };

export default function WorksheetPage({ params }: PageProps<"/app/tests/[testId]/worksheet/[planId]">) {
  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-10 print:max-w-none print:p-0">
      <style>{`@page { size: A4; margin: 16mm; } @media print { header, .no-print { display: none !important; } body { background: #fff; } }`}</style>
      <Suspense fallback={<p className="text-muted-foreground">Preparing the worksheet…</p>}>
        <View params={params} />
      </Suspense>
    </main>
  );
}

async function View({ params }: Pick<PageProps<"/app/tests/[testId]/worksheet/[planId]">, "params">) {
  const { testId, planId } = await params;
  await requireTeacher(`/app/tests/${testId}/worksheet/${planId}`);
  const db = await userDb();
  const [{ data: test }, { data: row }] = await Promise.all([
    db.from("tests").select("id,title").eq("id", testId).maybeSingle<{ id: string; title: string }>(),
    db.from("insights").select("payload").eq("id", planId).eq("test_id", testId).eq("kind", "reteach").maybeSingle<{ payload: ReteachPayload }>(),
  ]);
  if (!test || !row) notFound();
  const p = row.payload;
  return (
    <>
      <div className="no-print mb-8 flex flex-wrap items-center justify-between gap-3">
        <Link href={`/app/tests/${testId}/insights`} className="text-[0.95rem] underline underline-offset-4">Back to class insights</Link>
        <PrintButton count={2} />
      </div>
      {/* page 1: for students */}
      <section className="break-after-page">
        <p className="text-[0.85rem] text-muted-foreground">{test.title} · follow-up practice</p>
        <h1 className="mt-1 text-2xl font-[750]">Practice: {p.label}</h1>
        <p className="mt-3 border-l-2 border-ruling pl-3"><InlineMd text={p.explanation} /></p>
        <p className="mt-3 whitespace-pre-wrap text-[0.95rem]"><span className="font-semibold">Worked example. </span><InlineMd text={p.workedExample} /></p>
        <ol className="mt-6 list-decimal space-y-8 pl-6">
          {p.practice.map((q, i) => (
            <li key={i}>
              <p className="whitespace-pre-wrap"><InlineMd text={q.question} /></p>
              <div className="mt-2 h-20 border-b border-ruling ruled" style={{ backgroundSize: "100% 1.8em" }} />
            </li>
          ))}
        </ol>
        <p className="mt-6 text-[0.85rem] text-muted-foreground">Name: ______________________</p>
      </section>
      {/* page 2: for the teacher */}
      <section className="mt-12 border-t-2 border-ink pt-6 print:mt-0 print:border-0">
        <h2 className="text-xl font-[750]">Teacher&apos;s copy: answers and the 10-minute plan</h2>
        <ol className="mt-3 list-decimal space-y-1 pl-6">
          {p.practice.map((q, i) => <li key={i}><span className="font-semibold">Answer:</span> <InlineMd text={q.answer} /></li>)}
        </ol>
        <h3 className="mt-6 font-semibold">Plan</h3>
        <ol className="mt-1 space-y-1">
          {p.plan.map((s, i) => <li key={i} className="grid grid-cols-[3.5rem_1fr] gap-2"><span className="tabular-nums font-semibold">{s.minutes} min</span><span><InlineMd text={s.activity} /></span></li>)}
        </ol>
        <p className="mt-6 text-[0.8rem] text-muted-foreground">Drafted by GradeLens from the class&apos;s misconceptions. Check every question and answer before use.</p>
      </section>
    </>
  );
}
