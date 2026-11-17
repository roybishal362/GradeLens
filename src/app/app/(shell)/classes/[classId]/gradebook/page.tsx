import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { btn, PageHeader } from "@/components/page-header";
import { requireTeacher } from "@/lib/dal";
import { classGradebook } from "@/lib/db/gradebook";

export const metadata: Metadata = { title: "Gradebook" };

export default function GradebookPage({ params }: PageProps<"/app/classes/[classId]/gradebook">) {
  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-8">
      <Suspense fallback={<p className="text-muted-foreground">Loading the gradebook…</p>}>
        <View params={params} />
      </Suspense>
    </main>
  );
}

async function View({ params }: Pick<PageProps<"/app/classes/[classId]/gradebook">, "params">) {
  const { classId } = await params;
  await requireTeacher(`/app/classes/${classId}/gradebook`);
  const gb = await classGradebook(classId);
  if (!gb) notFound();
  const anySuggested = gb.rows.some((r) => r.cells.some((c) => c && !c.approved));
  return (
    <>
      <PageHeader
        crumbs={[{ href: "/app", label: "Classes" }, { href: `/app/classes/${classId}`, label: gb.className }]}
        title="Gradebook"
        sub={`${gb.rows.length} students · ${gb.tests.length} tests`}
        actions={<a href={`/app/classes/${classId}/gradebook/export`} className={btn.secondary}><Download aria-hidden className="size-4" /> Download CSV</a>}
      />
      {gb.tests.length === 0 || gb.rows.length === 0 ? (
        <p className="text-muted-foreground">Marks appear here once a test has marked scripts.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-ruling bg-white">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-ruling text-[0.85rem]">
                <th className="sticky left-0 bg-white px-4 py-2.5 font-semibold">Student</th>
                {gb.tests.map((t) => (
                  <th key={t.id} className="min-w-28 px-3 py-2.5 text-right font-semibold">
                    <Link href={`/app/tests/${t.id}`} className="hover:underline underline-offset-4">{t.title.length > 28 ? `${t.title.slice(0, 27)}…` : t.title}</Link>
                  </th>
                ))}
                <th className="px-4 py-2.5 text-right font-semibold">Average</th>
              </tr>
            </thead>
            <tbody>
              {gb.rows.map((r) => (
                <tr key={r.studentId} className="border-b border-ruling last:border-0 hover:bg-secondary/40">
                  <td className="sticky left-0 bg-white px-4 py-2"><Link href={`/app/students/${r.studentId}`} className="font-semibold hover:underline underline-offset-4">{r.name}</Link></td>
                  {r.cells.map((c, i) => (
                    <td key={gb.tests[i].id} className="px-3 py-2 text-right tabular-nums">
                      {c ? <span className={c.approved ? "" : "text-muted-foreground"}>{Math.round(c.percent)}%{c.grade && <span className="ml-1.5 font-semibold">{c.grade}</span>}{!c.approved && "*"}</span> : <span className="text-muted-foreground">–</span>}
                    </td>
                  ))}
                  <td className="px-4 py-2 text-right font-semibold tabular-nums">{r.average === null ? "–" : `${Math.round(r.average)}%`}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-ink/20 bg-secondary/40 text-[0.95rem]">
                <td className="sticky left-0 bg-secondary/40 px-4 py-2 font-semibold">Class average</td>
                {gb.tests.map((t) => <td key={t.id} className="px-3 py-2 text-right font-semibold tabular-nums">{t.average === null ? "–" : `${Math.round(t.average)}%`}</td>)}
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {anySuggested && <p className="mt-3 text-[0.9rem] text-muted-foreground">* includes marks you haven&apos;t approved yet.</p>}
    </>
  );
}
