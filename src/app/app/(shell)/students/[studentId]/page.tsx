import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { markOf, QR_COLS, type QuestionResultRow } from "@/lib/db/types";
import { requireTeacher } from "@/lib/dal";
import { misconceptionKey } from "@/lib/insights/analysis";
import { userDb } from "@/lib/supabase/clients";

export const metadata: Metadata = { title: "Student progress" };

export default function StudentPage({ params }: PageProps<"/app/students/[studentId]">) {
  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-10">
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <View params={params} />
      </Suspense>
    </main>
  );
}

type TestLite = { id: string; title: string; created_at: string; parent_test_id: string | null };

async function View({ params }: Pick<PageProps<"/app/students/[studentId]">, "params">) {
  const { studentId } = await params;
  await requireTeacher(`/app/students/${studentId}`);
  const db = await userDb();
  const { data: st } = await db.from("students").select("id,display_name,anon_code,class_id").eq("id", studentId).maybeSingle<{ id: string; display_name: string; anon_code: string; class_id: string }>();
  if (!st) notFound();
  const [{ data: cls }, { data: tests }] = await Promise.all([
    db.from("classes").select("name").eq("id", st.class_id).single<{ name: string }>(),
    db.from("tests").select("id,title,created_at,parent_test_id").eq("class_id", st.class_id).order("created_at").returns<TestLite[]>(),
  ]);
  const testIds = (tests ?? []).map((t) => t.id);
  const { data: allSubs } = testIds.length
    ? await db.from("submissions").select("id,test_id,student_id,status,total,max_total").in("test_id", testIds).in("status", ["graded", "approved"])
    : { data: [] };
  const mine = (allSubs ?? []).filter((s: { student_id: string }) => s.student_id === studentId) as { id: string; test_id: string; status: string; total: number; max_total: number }[];
  const { data: results } = mine.length
    ? await db.from("question_results").select(QR_COLS).in("submission_id", mine.map((s) => s.id)).returns<QuestionResultRow[]>()
    : { data: [] as QuestionResultRow[] };

  const points = (tests ?? []).flatMap((t) => {
    const s = mine.find((x) => x.test_id === t.id);
    const cohort = (allSubs ?? []).filter((x: { test_id: string; total: number | null }) => x.test_id === t.id && x.total !== null) as { total: number; max_total: number }[];
    if (!s || s.total === null) return [];
    return [{
      test: t, approved: s.status === "approved",
      pct: Number(s.total) / Math.max(1, Number(s.max_total)),
      avg: cohort.length >= 3 ? cohort.reduce((a, x) => a + Number(x.total) / Math.max(1, Number(x.max_total)), 0) / cohort.length : null,
      submissionId: s.id,
    }];
  });

  // misconceptions per test, where marks were lost
  const byTest = new Map<string, Map<string, string>>(); // test -> key -> wording
  for (const r of results ?? []) {
    if (Number(markOf(r)) >= Number(r.max)) continue;
    const testId = mine.find((s) => s.id === r.submission_id)!.test_id;
    for (const m of [...(r.grade_a?.misconceptions ?? []), ...(r.grade_b?.misconceptions ?? [])]) {
      const k = misconceptionKey(m);
      if (!k) continue;
      byTest.set(testId, (byTest.get(testId) ?? new Map()).set(k, m));
    }
  }
  const everSeen = new Map<string, string>();
  for (const m of byTest.values()) for (const [k, w] of m) if (!everSeen.has(k)) everSeen.set(k, w);

  return (
    <>
      <PageHeader crumbs={[{ href: "/app", label: "Classes" }, { href: `/app/classes/${st.class_id}`, label: cls?.name ?? "Class" }]} title={st.display_name}
        sub={`${st.anon_code} · progress across this class's tests`} />

      <section className="mt-8" aria-labelledby="prog">
        <h2 id="prog" className="text-xl font-semibold">Marks over time</h2>
        {points.length === 0 ? <p className="mt-2 text-muted-foreground">No marked scripts yet.</p> : (
          <>
            {points.length >= 2 && <Trend points={points.map((p) => ({ label: p.test.title, pct: p.pct, avg: p.avg }))} />}
            <table className="mt-4 w-full border-collapse text-left">
              <thead><tr className="border-b border-ruling text-[0.85rem] text-muted-foreground"><th className="py-1.5 pr-3 font-semibold">Test</th><th className="py-1.5 pr-3 text-right font-semibold">{st.display_name.split(" ")[0]}</th><th className="py-1.5 pr-3 text-right font-semibold">Class average</th><th className="py-1.5 font-semibold"><span className="sr-only">Report</span></th></tr></thead>
              <tbody>
                {points.map((p) => (
                  <tr key={p.test.id} className="border-b border-ruling">
                    <td className="py-2 pr-3">{p.test.title}{p.test.parent_test_id && <span className="ml-2 text-[0.85rem] text-muted-foreground">re-test</span>}{!p.approved && <span className="ml-2 text-[0.85rem] text-check">not fully approved</span>}</td>
                    <td className="py-2 pr-3 text-right tabular-nums font-semibold">{Math.round(p.pct * 100)}%</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{p.avg === null ? "–" : `${Math.round(p.avg * 100)}%`}</td>
                    <td className="py-2 text-right"><Link href={`/app/report/${p.submissionId}`} className="text-[0.9rem] underline underline-offset-4">Report</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      <section className="mt-10" aria-labelledby="mis">
        <h2 id="mis" className="text-xl font-semibold">Misconceptions: still there, or fixed?</h2>
        {everSeen.size === 0 ? <p className="mt-2 text-muted-foreground">None recorded.</p> : (
          <ul className="mt-3 divide-y divide-ruling border-y border-ruling">
            {[...everSeen].map(([k, wording]) => {
              const seenIn = points.filter((p) => byTest.get(p.test.id)?.has(k));
              const last = points.at(-1);
              const fixed = last && seenIn.length && !byTest.get(last.test.id)?.has(k) && seenIn.at(-1)!.test.id !== last.test.id;
              return (
                <li key={k} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
                  <span>{wording}</span>
                  <span className={`text-[0.9rem] font-semibold ${fixed ? "text-ok" : "text-check"}`}>
                    {fixed ? `✓ not seen since ${seenIn.at(-1)!.test.title}` : `◐ seen in ${seenIn.map((p) => p.test.title).join(", ")}`}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}

/** Trend over tests: the student in the accent, the class average in grey for context; direct labels + legend. */
function Trend({ points }: { points: { label: string; pct: number; avg: number | null }[] }) {
  const W = 640, H = 200, pad = { l: 36, r: 16, t: 14, b: 26 };
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / Math.max(1, points.length - 1);
  const y = (v: number) => pad.t + (1 - v) * (H - pad.t - pad.b);
  const line = (vals: (number | null)[]) => vals.map((v, i) => (v === null ? null : `${x(i)},${y(v)}`)).filter(Boolean).join(" ");
  return (
    <figure className="mt-3">
      <ul className="mb-1 flex gap-4 text-[0.85rem] text-muted-foreground" aria-label="Legend">
        <li className="inline-flex items-center gap-1.5"><span aria-hidden className="h-0.5 w-4 bg-[#2f4b8f]" />This student</li>
        <li className="inline-flex items-center gap-1.5"><span aria-hidden className="h-0.5 w-4 bg-[#9aa3b2]" />Class average</li>
      </ul>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Marks over ${points.length} tests: ${points.map((p) => `${p.label} ${Math.round(p.pct * 100)}%`).join(", ")}`}>
        {[0, 0.5, 1].map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="#e3e9f4" strokeWidth={1} />
            <text x={pad.l - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill="#4a5672">{v * 100}%</text>
          </g>
        ))}
        <polyline points={line(points.map((p) => p.avg))} fill="none" stroke="#9aa3b2" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={line(points.map((p) => p.pct))} fill="none" stroke="#2f4b8f" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(p.pct)} r={4.5} fill="#2f4b8f" stroke="#fff" strokeWidth={2}><title>{`${p.label}: ${Math.round(p.pct * 100)}%${p.avg !== null ? ` (class ${Math.round(p.avg * 100)}%)` : ""}`}</title></circle>
            <text x={x(i)} y={H - 8} textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"} fontSize={11} fill="#4a5672">{p.label.length > 22 ? `${p.label.slice(0, 21)}…` : p.label}</text>
          </g>
        ))}
        <text x={x(points.length - 1) - 8} y={y(points.at(-1)!.pct) - 9} textAnchor="end" fontSize={12} fontWeight={600} fill="#1c2541">{Math.round(points.at(-1)!.pct * 100)}%</text>
      </svg>
    </figure>
  );
}
