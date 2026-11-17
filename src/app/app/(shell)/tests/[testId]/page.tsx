import { BarChart3, Download, FileCheck2, MessageSquareWarning, ScanLine, Smartphone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ScoreChart } from "@/components/insights/score-chart";
import { fmtMark, Mark, RiskLabel, STATUS_LABEL } from "@/components/marks";
import { btn, PageHeader } from "@/components/page-header";
import { requireTeacher } from "@/lib/dal";
import { testMarks } from "@/lib/db/results-data";
import { practiceLinkFor, siteOrigin, uploadLinkFor } from "@/lib/db/teacher";
import { SUB_COLS, type SubmissionRow } from "@/lib/db/types";
import { reviewTime, summaryStats } from "@/lib/results";
import { userDb } from "@/lib/supabase/clients";
import { LiveStatus, ScriptActions, UploadControls } from "./controls";
import { PracticePanel } from "./practice-panel";
import { GradeBoundaries, ResultsPanel } from "./results-panel";

export const metadata: Metadata = { title: "Test" };

export default function TestPage({ params }: PageProps<"/app/tests/[testId]">) {
  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-8">
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <View params={params} />
      </Suspense>
    </main>
  );
}

const panel = "rounded-lg border border-ruling bg-white p-5";

async function View({ params }: Pick<PageProps<"/app/tests/[testId]">, "params">) {
  const { testId } = await params;
  await requireTeacher(`/app/tests/${testId}`);
  const data = await testMarks(testId);
  if (!data) notFound();
  const { test, lines } = data;
  const db = await userDb();
  const [{ data: subs }, link, origin, { data: requests }, practiceLink, { data: attempts }, { data: events }] = await Promise.all([
    db.from("submissions").select(SUB_COLS).eq("test_id", testId).returns<SubmissionRow[]>(),
    uploadLinkFor(testId),
    siteOrigin(),
    db.from("review_requests").select("id,q,message,created_at,submission_id,submissions!inner(test_id,student_id)").eq("submissions.test_id", testId).eq("status", "open").order("created_at"),
    practiceLinkFor(testId),
    db.from("practice_attempts").select("student_id,score,max,result,created_at").eq("test_id", testId).order("created_at", { ascending: false }).limit(300),
    db.from("review_events").select("created_at,action,question_results!inner(submissions!inner(test_id))").eq("question_results.submissions.test_id", testId).order("created_at").limit(10000),
  ]);
  const timing = reviewTime(((events ?? []) as { created_at: string; action: string }[]).map((e) => ({ at: e.created_at, bulk: e.action === "bulk_approve" })));
  type Attempt = { student_id: string | null; score: number; max: number; result: { misconceptions: string[] }[]; created_at: string };
  const att = (attempts ?? []) as Attempt[];
  const misCount = new Map<string, number>();
  for (const a of att) for (const r of a.result) for (const m of r.misconceptions ?? []) misCount.set(m, (misCount.get(m) ?? 0) + 1);
  const nameById = new Map(lines.map((l) => [l.studentId, l.name]));
  const practiceStats = {
    attempts: att.length,
    average: att.length ? att.reduce((s, a) => s + (100 * Number(a.score)) / Math.max(1, Number(a.max)), 0) / att.length : null,
    topMisconceptions: [...misCount].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([text, n]) => ({ text, n })),
    recent: att.slice(0, 5).map((a) => ({
      who: (a.student_id && nameById.get(a.student_id)) || "Anonymous",
      score: `${Number(a.score)}/${Number(a.max)}`,
      when: new Date(a.created_at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
    })),
  };
  const byStudent = new Map((subs ?? []).map((s) => [s.student_id, s]));
  const nameOfSub = new Map(lines.filter((l) => l.submissionId).map((l) => [l.submissionId!, l.name]));
  const marked = lines.filter((l) => l.percent !== null);
  const stats = summaryStats(marked.map((l) => l.percent!));
  const allMarks = lines.flatMap((l) => l.marks);
  const approvedMarks = allMarks.filter((m) => m.approved);
  const changed = approvedMarks.filter((m) => m.mark !== m.ai).length;
  const counts = {
    total: subs?.length ?? 0,
    working: (subs ?? []).filter((s) => ["uploaded", "queued", "reading", "grading"].includes(s.status)).length,
    waiting: (subs ?? []).filter((s) => s.status === "graded").length,
    approved: (subs ?? []).filter((s) => s.status === "approved").length,
  };
  const schemeOk = test.rubric_status === "approved";
  const maxMarks = test.rubric.questions.reduce((s, q) => s + q.marks, 0);
  const active = (subs ?? []).filter((s) => ["uploaded", "queued", "reading", "grading"].includes(s.status)).map((s) => ({ id: s.id, status: s.status, error: s.error }));
  const gradeCounts = test.grade_boundaries?.length
    ? [...test.grade_boundaries].sort((a, b) => b.min - a.min).map((b) => ({ label: b.label, n: marked.filter((l) => l.grade === b.label).length }))
    : [];

  return (
    <>
      <PageHeader
        crumbs={[{ href: "/app", label: "Classes" }, { href: `/app/classes/${test.class_id}`, label: data.className }]}
        title={test.title}
        sub={<>{test.rubric.questions.length} questions · {fmtMark(maxMarks)} marks · {counts.total} of {lines.length} scripts in</>}
        actions={<>
          {counts.waiting > 0 && <Link href={`/app/tests/${testId}/review`} className={btn.primary}><FileCheck2 aria-hidden className="size-4" /> Review {counts.waiting} script{counts.waiting === 1 ? "" : "s"}</Link>}
          <Link href={`/app/tests/${testId}/insights`} className={btn.secondary}><BarChart3 aria-hidden className="size-4" /> Insights</Link>
          <details className="relative">
            <summary className={`${btn.secondary} cursor-pointer list-none`}><Download aria-hidden className="size-4" /> Export</summary>
            <div className="absolute right-0 z-20 mt-1 w-64 rounded-md border border-ruling bg-white p-1 shadow-lg">
              <a href={`/app/tests/${testId}/export?kind=marks`} className="block rounded px-3 py-2 hover:bg-secondary"><span className="font-semibold">Marks</span><span className="block text-[0.85rem] text-muted-foreground">One row per student, CSV for Excel or Sheets</span></a>
              <a href={`/app/tests/${testId}/export?kind=answers`} className="block rounded px-3 py-2 hover:bg-secondary"><span className="font-semibold">Every answer</span><span className="block text-[0.85rem] text-muted-foreground">One row per answer, with your notes</span></a>
              <Link href={`/app/tests/${testId}/slips`} className="block rounded px-3 py-2 hover:bg-secondary"><span className="font-semibold">All reports</span><span className="block text-[0.85rem] text-muted-foreground">Printable, one page per student</span></Link>
            </div>
          </details>
        </>}
      />
      <LiveStatus active={active} canGrade={schemeOk} />

      <ol className="mt-2 grid gap-px overflow-hidden rounded-lg border border-ruling bg-ruling sm:grid-cols-4">
        <Step n={1} title="Mark scheme" done={schemeOk} href={`/app/tests/${testId}/mark-scheme`} text={schemeOk ? "Approved" : test.rubric.questions.length ? "Check and approve" : "Add questions"} />
        <Step n={2} title="Collect scripts" done={counts.total > 0} href="#collect" text={`${counts.total} of ${lines.length} in${counts.working ? ` · ${counts.working} being marked` : ""}`} />
        <Step n={3} title="Review" done={counts.total > 0 && counts.approved === counts.total} href={`/app/tests/${testId}/review`} text={counts.waiting ? `${counts.waiting} waiting` : counts.approved ? `${counts.approved} approved` : "Nothing yet"} />
        <Step n={4} title="Return results" done={test.results_released} href="#results" text={test.results_released ? "Released" : "Not released"} />
      </ol>
      {!schemeOk && (
        <p className="mt-4 rounded-md border border-check/40 bg-check/5 px-4 py-2.5 text-[0.95rem]">
          Students can upload now. Marking starts when you <Link href={`/app/tests/${testId}/mark-scheme`} className="font-semibold underline underline-offset-4">approve the mark scheme</Link>.
        </p>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {(requests?.length ?? 0) > 0 && (
            <section className={`${panel} border-check/50`} aria-labelledby="req">
              <h2 id="req" className="flex items-center gap-2 font-semibold"><MessageSquareWarning aria-hidden className="size-4 text-check" /> {requests!.length} re-check request{requests!.length === 1 ? "" : "s"} from students</h2>
              <ul className="mt-3 divide-y divide-ruling">
                {requests!.map((r: { id: string; q: number; message: string; submission_id: string }) => (
                  <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                    <span><span className="font-semibold">{nameOfSub.get(r.submission_id) ?? "Student"}, Q{r.q}:</span> <span className="text-[0.95rem]">&ldquo;{r.message}&rdquo;</span></span>
                    <Link href={`/app/tests/${testId}/review?s=${r.submission_id}&q=${r.q}`} className="text-[0.95rem] font-semibold underline underline-offset-4">Open</Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {stats && stats.n >= 2 && (
            <section className={panel} aria-labelledby="stats">
              <h2 id="stats" className="font-semibold">Results so far</h2>
              <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
                {[["Average", stats.mean], ["Median", stats.median], ["Highest", stats.max], ["Lowest", stats.min]].map(([k, v]) => (
                  <div key={k as string}><dt className="text-[0.85rem] text-muted-foreground">{k}</dt><dd className="text-2xl font-[750] tabular-nums">{Math.round(v as number)}%</dd></div>
                ))}
              </dl>
              <div className="mt-4"><ScoreChart percentages={marked.map((l) => l.percent!)} /></div>
              <p className="mt-3 text-[0.9rem] text-muted-foreground">
                {stats.n} scripts marked{counts.waiting ? `, ${counts.waiting} still with suggested marks` : ""}.
                {approvedMarks.length > 0 && ` You've approved ${approvedMarks.length} of ${allMarks.length} marks and changed ${changed}.`}
              </p>
              {timing.individual + timing.bulk > 1 && (
                <p className="mt-2 text-[0.9rem]">
                  <span className="font-semibold">Your marking time:</span> about {Math.max(1, Math.round(timing.seconds / 60))} minute{Math.round(timing.seconds / 60) === 1 ? "" : "s"} for {timing.individual + timing.bulk} decisions
                  {timing.bulk > 0 && ` (${timing.bulk} approved in bulk)`}{timing.secondsPerMark !== null && `, about ${timing.secondsPerMark} s per mark you checked one by one`}.
                  <span className="text-muted-foreground"> Measured from your decisions; pauses over 2 minutes don&apos;t count.</span>
                </p>
              )}
              {gradeCounts.length > 0 && (
                <p className="mt-2 flex flex-wrap gap-2 text-[0.9rem]">
                  {gradeCounts.map((g) => <span key={g.label} className="rounded-full bg-secondary px-2.5 py-0.5"><span className="font-semibold">{g.label}</span> {g.n}</span>)}
                </p>
              )}
            </section>
          )}

          <section className={panel} aria-labelledby="scripts">
            <h2 id="scripts" className="font-semibold">Scripts</h2>
            {lines.length ? (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[34rem] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-ruling text-[0.85rem] text-muted-foreground">
                      <th className="py-2 pr-3 font-semibold">Student</th>
                      <th className="py-2 pr-3 font-semibold">Status</th>
                      <th className="py-2 pr-3 font-semibold">Mark</th>
                      <th className="py-2 pr-3 font-semibold">{test.grade_boundaries?.length ? "Grade" : ""}</th>
                      <th className="py-2 font-semibold"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => {
                      const s = byStudent.get(l.studentId);
                      return (
                        <tr key={l.studentId} className="border-b border-ruling align-top last:border-0">
                          <td className="py-2.5 pr-3">
                            {s && ["graded", "approved"].includes(s.status)
                              ? <Link href={`/app/tests/${testId}/review?s=${s.id}`} className="font-semibold hover:underline underline-offset-4">{l.name}</Link>
                              : <span className={s ? "font-semibold" : "text-muted-foreground"}>{l.name}</span>}
                          </td>
                          <td className="py-2.5 pr-3 text-[0.95rem]">
                            {s ? (
                              <>
                                <span className={s.status === "failed" ? "font-semibold text-flag" : ""}>{STATUS_LABEL[s.status]}</span>
                                {s.status === "graded" && <> · <RiskLabel risk={s.risk} /></>}
                                {s.error && <span className="block text-[0.9rem] text-muted-foreground">{s.error}</span>}
                                {s.warnings?.map((w) => <span key={w} className="block text-[0.9rem] font-semibold text-check">⚠ {w}</span>)}
                              </>
                            ) : <span className="text-muted-foreground">Not handed in</span>}
                          </td>
                          <td className="py-2.5 pr-3">{l.total !== null && <Mark value={l.total} max={l.max ?? undefined} approved={l.approved} className="text-2xl" />}</td>
                          <td className="py-2.5 pr-3 font-semibold">{l.grade ?? ""}</td>
                          <td className="py-2.5 text-right">{s && <ScriptActions testId={testId} submissionId={s.id} status={s.status} />}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-2 text-muted-foreground">No students yet. <Link href={`/app/classes/${test.class_id}`} className="font-semibold text-ink underline underline-offset-4">Add your class list</Link> so each script is matched to a student.</p>
            )}
            {schemeOk && approvedMarks.length >= 5 && counts.waiting > 0 && (
              <ScriptActions testId={testId} regradeAll={(subs ?? []).filter((s) => s.status === "graded").map((s) => s.id)} decisions={approvedMarks.length} />
            )}
          </section>
        </div>

        <div className="space-y-6">
          <section id="collect" className={`${panel} scroll-mt-6`} aria-labelledby="collect-h">
            <h2 id="collect-h" className="flex items-center gap-2 font-semibold"><Smartphone aria-hidden className="size-4" /> Students upload from a phone</h2>
            {link && <UploadControls testId={testId} url={link.url} qrSvg={link.qrSvg} open={test.uploads_open} />}
          </section>
          <section className={panel} aria-labelledby="paper-h">
            <h2 id="paper-h" className="flex items-center gap-2 font-semibold"><ScanLine aria-hidden className="size-4" /> Or mark paper sheets</h2>
            <p className="mt-2 text-[0.95rem] text-muted-foreground">Print answer sheets with a QR code for each student. After the test, photograph the pile in any order and GradeLens sorts it.</p>
            <p className="mt-3 flex flex-wrap gap-2">
              <Link href={`/app/tests/${testId}/sheets`} className={btn.secondary}>Print answer sheets</Link>
              <Link href={`/app/tests/${testId}/scan`} className={btn.secondary}>Scan a pile</Link>
            </p>
          </section>
          <section id="results" className={`${panel} scroll-mt-6`} aria-labelledby="results-h">
            <h2 id="results-h" className="font-semibold">Results for students</h2>
            <div className="mt-2">
              <ResultsPanel testId={testId} released={test.results_released}
                notReady={(subs ?? []).filter((s) => s.status !== "approved").length}
                links={lines.filter((l) => l.resultToken && l.approved).map((l) => ({ name: l.name, url: `${origin}/r/${l.resultToken}` }))} />
            </div>
          </section>
          <section className={panel} aria-labelledby="practice-h">
            <h2 id="practice-h" className="font-semibold">Practice with instant feedback</h2>
            <div className="mt-2">
              {practiceLink && <PracticePanel testId={testId} open={test.practice_open} url={practiceLink.url} qrSvg={practiceLink.qrSvg} schemeApproved={schemeOk} stats={practiceStats} />}
            </div>
          </section>
          <section className={panel} aria-labelledby="grades-h">
            <h2 id="grades-h" className="font-semibold">Letter grades</h2>
            <div className="mt-2"><GradeBoundaries testId={testId} initial={test.grade_boundaries} /></div>
          </section>
        </div>
      </div>
    </>
  );
}

function Step({ n, title, text, done, href }: { n: number; title: string; text: string; done: boolean; href: string }) {
  return (
    <li className="bg-white">
      <Link href={href} className="block h-full px-4 py-3 hover:bg-secondary/60">
        <span className="flex items-center gap-2 font-semibold">
          <span aria-hidden className={`grid size-6 place-items-center rounded-full text-[0.8rem] ${done ? "bg-ok text-white" : "border border-ink/30"}`}>{done ? "✓" : n}</span>
          {title}
        </span>
        <span className="mt-1 block text-[0.9rem] text-muted-foreground">{text}</span>
      </Link>
    </li>
  );
}
