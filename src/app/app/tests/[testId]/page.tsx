import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Mark, RiskLabel, STATUS_LABEL } from "@/components/marks";
import { requireTeacher } from "@/lib/dal";
import { uploadLinkFor } from "@/lib/db/teacher";
import { SUB_COLS, TEST_COLS, type StudentRow, type SubmissionRow, type TestRow } from "@/lib/db/types";
import { userDb } from "@/lib/supabase/clients";
import { LiveStatus, ScriptActions, UploadControls } from "./controls";

export const metadata: Metadata = { title: "Test" };

export default function TestPage({ params }: PageProps<"/app/tests/[testId]">) {
  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-10">
      <Suspense fallback={<p className="text-muted-foreground">Loading the test…</p>}>
        <View params={params} />
      </Suspense>
    </main>
  );
}

async function View({ params }: Pick<PageProps<"/app/tests/[testId]">, "params">) {
  const { testId } = await params;
  await requireTeacher(`/app/tests/${testId}`);
  const db = await userDb();
  const { data: test } = await db.from("tests").select(TEST_COLS).eq("id", testId).maybeSingle<TestRow>();
  if (!test) notFound();
  const [{ data: cls }, { data: students }, { data: subs }, { count: decisions }, link] = await Promise.all([
    db.from("classes").select("id,name").eq("id", test.class_id).single<{ id: string; name: string }>(),
    db.from("students").select("id,display_name,anon_code").eq("class_id", test.class_id).order("display_name").returns<StudentRow[]>(),
    db.from("submissions").select(SUB_COLS).eq("test_id", testId).returns<SubmissionRow[]>(),
    db.from("question_results").select("id,submissions!inner(test_id)", { count: "exact", head: true }).eq("submissions.test_id", testId).eq("approved", true),
    uploadLinkFor(testId),
  ]);
  const byStudent = new Map((subs ?? []).map((s) => [s.student_id, s]));
  const counts = {
    total: subs?.length ?? 0,
    working: (subs ?? []).filter((s) => ["uploaded", "queued", "reading", "grading"].includes(s.status)).length,
    waiting: (subs ?? []).filter((s) => s.status === "graded").length,
    approved: (subs ?? []).filter((s) => s.status === "approved").length,
    failed: (subs ?? []).filter((s) => s.status === "failed").length,
  };
  const approvedScheme = test.rubric_status === "approved";
  const maxMarks = test.rubric.questions.reduce((s, q) => s + q.marks, 0);
  const active = (subs ?? []).filter((s) => ["uploaded", "queued", "reading", "grading"].includes(s.status)).map((s) => ({ id: s.id, status: s.status, error: s.error }));

  return (
    <>
      <p className="text-[0.95rem] text-muted-foreground"><Link href={`/app/classes/${test.class_id}`} className="underline underline-offset-4">{cls?.name}</Link></p>
      <h1 className="mt-1 text-[1.95rem] font-[750] tracking-tight">{test.title}</h1>
      <LiveStatus active={active} canGrade={approvedScheme} />

      {/* the four steps, as a teacher would do them */}
      <ol className="mt-8 grid gap-px overflow-hidden rounded-md border border-ruling bg-ruling sm:grid-cols-4">
        <Step n={1} title="Mark scheme" done={approvedScheme} href={`/app/tests/${testId}/mark-scheme`}
          text={approvedScheme ? `Approved · ${test.rubric.questions.length} questions · ${maxMarks} marks` : test.rubric.questions.length ? "Draft: check and approve it" : "Add questions and the answer key"} />
        <Step n={2} title="Collect scripts" done={counts.total > 0} href="#collect"
          text={`${counts.total} of ${students?.length ?? 0} students${counts.working ? ` · ${counts.working} being marked` : ""}`} />
        <Step n={3} title="Review marks" done={counts.total > 0 && counts.approved === counts.total} href={`/app/tests/${testId}/review`}
          text={counts.waiting ? `${counts.waiting} script${counts.waiting === 1 ? "" : "s"} waiting for you` : counts.approved ? `${counts.approved} approved` : "Nothing to review yet"} />
        <Step n={4} title="Class insights" done={false} href={`/app/tests/${testId}/insights`}
          text="What the class misunderstood, and a re-teach plan" />
      </ol>

      {!approvedScheme && (
        <p className="mt-6 margin-rule pl-4">
          Students can already upload. Marking starts as soon as you{" "}
          <Link href={`/app/tests/${testId}/mark-scheme`} className="font-semibold underline underline-offset-4">approve the mark scheme</Link>.
        </p>
      )}

      <div className="mt-12 grid gap-12 lg:grid-cols-[2fr_1fr]">
        <section aria-labelledby="scripts">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="scripts" className="text-xl font-semibold">Scripts</h2>
            {counts.waiting > 0 && (
              <Link href={`/app/tests/${testId}/review`} className="rounded-md bg-redpen px-4 py-2 font-semibold text-white hover:bg-[#b81f1f]">
                Review {counts.waiting} script{counts.waiting === 1 ? "" : "s"}
              </Link>
            )}
          </div>
          {students?.length ? (
            <table className="mt-4 w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-ruling text-[0.9rem] text-muted-foreground">
                  <th className="py-2 pr-3 font-semibold">Student</th>
                  <th className="py-2 pr-3 font-semibold">Status</th>
                  <th className="py-2 pr-3 font-semibold">Mark</th>
                  <th className="py-2 font-semibold"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {students.map((st) => {
                  const s = byStudent.get(st.id);
                  return (
                    <tr key={st.id} className="border-b border-ruling align-top">
                      <td className="py-2.5 pr-3">
                        {s && ["graded", "approved"].includes(s.status)
                          ? <Link href={`/app/tests/${testId}/review?s=${s.id}`} className="font-semibold underline-offset-4 hover:underline">{st.display_name}</Link>
                          : <span className={s ? "font-semibold" : "text-muted-foreground"}>{st.display_name}</span>}
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
                      <td className="py-2.5 pr-3">
                        {s && s.total !== null && ["graded", "approved"].includes(s.status) && (
                          <Mark value={Number(s.total)} max={Number(s.max_total)} approved={s.status === "approved"} className="text-2xl" />
                        )}
                      </td>
                      <td className="py-2.5 text-right">{s && <ScriptActions testId={testId} submissionId={s.id} status={s.status} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="mt-4 text-muted-foreground">
              Add students to <Link href={`/app/classes/${test.class_id}`} className="underline underline-offset-4">the class</Link> first, so each script is matched to a student.
            </p>
          )}
          {approvedScheme && (decisions ?? 0) >= 5 && counts.waiting > 0 && (
            <ScriptActions testId={testId} regradeAll={(subs ?? []).filter((s) => s.status === "graded").map((s) => s.id)} decisions={decisions ?? 0} />
          )}
        </section>

        <section id="collect" aria-labelledby="collect-h" className="scroll-mt-6">
          <h2 id="collect-h" className="text-xl font-semibold">Collect scripts</h2>
          {link ? <UploadControls testId={testId} url={link.url} qrSvg={link.qrSvg} open={test.uploads_open} /> : null}
          <div className="mt-6 space-y-2 border-t border-ruling pt-4 text-[0.95rem]">
            <p className="font-semibold">Marking paper sheets in class?</p>
            <p className="text-muted-foreground">Print answer sheets with each student&apos;s QR code, then photograph the whole pile: GradeLens sorts the pages to the right students.</p>
            <p className="flex flex-wrap gap-x-4 gap-y-1">
              <Link href={`/app/tests/${testId}/sheets`} className="font-semibold underline underline-offset-4">Print answer sheets</Link>
              <Link href={`/app/tests/${testId}/scan`} className="font-semibold underline underline-offset-4">Scan a pile of sheets</Link>
            </p>
          </div>
        </section>
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
