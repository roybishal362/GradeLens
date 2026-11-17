import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { Suspense } from "react";
import { requireTeacher } from "@/lib/dal";
import type { StudentRow } from "@/lib/db/types";
import { sheetPayload } from "@/lib/sheets";
import { userDb } from "@/lib/supabase/clients";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Answer sheets" };

export default function SheetsPage({ params, searchParams }: PageProps<"/app/tests/[testId]/sheets">) {
  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-8 print:max-w-none print:p-0">
      <style>{`@page { size: A4; margin: 10mm; } @media print { header, .no-print { display: none !important; } body { background: #fff; } }`}</style>
      <Suspense fallback={<p className="text-muted-foreground">Preparing the sheets…</p>}>
        <View params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function View({ params, searchParams }: Pick<PageProps<"/app/tests/[testId]/sheets">, "params" | "searchParams">) {
  const { testId } = await params;
  const sp = await searchParams;
  await requireTeacher(`/app/tests/${testId}/sheets`);
  const perStudent = Math.min(8, Math.max(1, Number(sp.pages) || 2));
  const db = await userDb();
  const { data: test } = await db.from("tests").select("id,class_id,title").eq("id", testId).maybeSingle<{ id: string; class_id: string; title: string }>();
  if (!test) notFound();
  const { data: students } = await db.from("students").select("id,display_name,anon_code").eq("class_id", test.class_id).order("display_name").returns<StudentRow[]>();
  const sheets = await Promise.all((students ?? []).flatMap((s) => Array.from({ length: perStudent }, async (_, i) => ({
    key: `${s.id}-${i}`, name: s.display_name, code: s.anon_code, page: i + 1,
    qr: await QRCode.toString(sheetPayload(test.id, s.anon_code, i + 1), { type: "svg", margin: 0, errorCorrectionLevel: "Q" }),
  }))));

  return (
    <>
      <div className="no-print mb-8 space-y-3">
        <p className="text-[0.95rem] text-muted-foreground"><Link href={`/app/tests/${testId}`} className="underline underline-offset-4">{test.title}</Link></p>
        <h1 className="text-[1.95rem] font-[750] tracking-tight">Answer sheets</h1>
        <p className="max-w-2xl text-muted-foreground">
          Each page has the student&apos;s name and a QR code (it holds their code, {students?.[0]?.anon_code ?? "S01"}, never their name).
          After the test, photograph the whole pile in any order on the <Link href={`/app/tests/${testId}/scan`} className="font-semibold text-ink underline underline-offset-4">scan page</Link>:
          GradeLens sorts the pages to the right students.
        </p>
        <form className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1">
            <span className="text-[0.9rem] font-semibold">Pages per student</span>
            <select name="pages" defaultValue={perStudent} className="rounded-md border border-input bg-white px-3 py-2">
              {[1, 2, 3, 4, 6, 8].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <button className="rounded-md border border-ink/25 bg-white px-4 py-2 font-semibold hover:bg-secondary">Update</button>
          <PrintButton count={sheets.length} />
        </form>
        {!students?.length && <p className="text-flag">Add students to the class first.</p>}
      </div>

      <div className="space-y-8 print:space-y-0">
        {sheets.map((s) => (
          <section key={s.key} className="flex aspect-[210/297] w-full flex-col border border-ruling bg-white p-[6%] shadow-sm break-after-page print:border-0 print:shadow-none">
            <div className="flex items-start justify-between gap-6">
              <div>
                <p className="text-[0.8rem] text-muted-foreground">GradeLens · {test.title}</p>
                <p className="mt-2 text-xl font-[750]">{s.name}</p>
                <p className="text-[0.95rem]">Page {s.page} of {perStudent}</p>
              </div>
              <div className="w-[22%] shrink-0" aria-label={`QR code: ${s.code}, page ${s.page}`} dangerouslySetInnerHTML={{ __html: s.qr }} />
            </div>
            <p className="mt-3 text-[0.8rem] text-muted-foreground">Write the question number in the margin before each answer. Keep writing inside the box.</p>
            <div className="mt-2 flex-1 border border-ink/30 ruled margin-rule" style={{ backgroundSize: "100% 2.2em" }} />
          </section>
        ))}
      </div>
    </>
  );
}
