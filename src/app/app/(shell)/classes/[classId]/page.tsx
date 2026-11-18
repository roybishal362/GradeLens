import { ClipboardList, Plus, Table2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { btn, PageHeader } from "@/components/page-header";
import { createTest } from "@/app/app/actions";
import { requireTeacher } from "@/lib/dal";
import { userDb } from "@/lib/supabase/clients";
import { DeleteClass } from "./delete-class";
import { Roster } from "./roster";
import { byName } from "@/lib/utils";

export const metadata: Metadata = { title: "Class" };

export default function ClassPage({ params, searchParams }: PageProps<"/app/classes/[classId]">) {
  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-8">
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <ClassView params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

type TestListRow = {
  id: string; title: string; rubric_status: string; created_at: string; parent_test_id: string | null; results_released: boolean;
  submissions: { status: string }[];
};

function testState(t: TestListRow): { label: string; tone: "ok" | "check" | "muted" | "ink" } {
  const waiting = t.submissions.filter((s) => s.status === "graded").length;
  const working = t.submissions.filter((s) => ["uploaded", "queued", "reading", "grading"].includes(s.status)).length;
  if (t.rubric_status !== "approved") return { label: "Mark scheme to approve", tone: "check" };
  if (working) return { label: `${working} being marked`, tone: "ink" };
  if (waiting) return { label: `${waiting} to review`, tone: "check" };
  if (!t.submissions.length) return { label: "Waiting for scripts", tone: "muted" };
  if (t.results_released) return { label: "Results released", tone: "ok" };
  return { label: "All approved", tone: "ok" };
}
const TONE = { ok: "bg-ok/10 text-ok", check: "bg-check/10 text-check", muted: "bg-secondary text-muted-foreground", ink: "bg-ink/10 text-ink" };

async function ClassView({ params, searchParams }: Pick<PageProps<"/app/classes/[classId]">, "params" | "searchParams">) {
  const { classId } = await params;
  await requireTeacher(`/app/classes/${classId}`);
  const sp = await searchParams;
  const db = await userDb();
  const [{ data: cls }, { data: tests }, { data: students }] = await Promise.all([
    db.from("classes").select("id,name,subject").eq("id", classId).maybeSingle<{ id: string; name: string; subject: string | null }>(),
    db.from("tests").select("id,title,rubric_status,created_at,parent_test_id,results_released,submissions(status)").eq("class_id", classId).order("created_at", { ascending: false }).returns<TestListRow[]>(),
    db.from("students").select("id,display_name,anon_code").eq("class_id", classId).order("display_name"),
  ]);
  if (!cls) notFound();
  const error = sp.error === "title" ? "Give the test a title." : sp.error === "test" ? "Couldn't create the test. Try again." : null;

  return (
    <>
      <PageHeader
        crumbs={[{ href: "/app", label: "Classes" }]}
        title={cls.name}
        sub={[cls.subject, `${students?.length ?? 0} students`, `${tests?.length ?? 0} tests`].filter(Boolean).join(" · ")}
        actions={<>
          <Link href={`/app/classes/${classId}/gradebook`} className={btn.secondary}><Table2 aria-hidden className="size-4" /> Gradebook</Link>
          <a href="#new-test" className={btn.primary}><Plus aria-hidden className="size-4" /> New test</a>
        </>}
      />
      {error && <p role="alert" className="mb-6 rounded-md border border-flag/40 bg-flag/5 px-4 py-3">{error}</p>}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-labelledby="tests-h">
          <h2 id="tests-h" className="text-lg font-semibold">Tests</h2>
          {tests?.length ? (
            <ul className="mt-3 grid gap-3">
              {tests.map((t) => {
                const st = testState(t);
                const n = t.submissions.length;
                return (
                  <li key={t.id}>
                    <Link href={`/app/tests/${t.id}`} className="flex items-start justify-between gap-4 rounded-lg border border-ruling bg-white p-4 hover:border-ink/30 hover:shadow-sm">
                      <span className="flex min-w-0 items-start gap-3">
                        <ClipboardList aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0">
                          <span className="block truncate font-semibold">{t.title}{t.parent_test_id && <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-[0.75rem] font-normal">re-test</span>}</span>
                          <span className="text-[0.9rem] text-muted-foreground">{n} of {students?.length ?? 0} scripts · {new Date(t.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
                        </span>
                      </span>
                      <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[0.85rem] font-semibold ${TONE[st.tone]}`}>{st.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-3 rounded-lg border border-dashed border-ruling bg-white p-6 text-muted-foreground">
              No tests yet. Create one below: you&apos;ll add the questions and your answer key, then share an upload link with the class.
            </p>
          )}
          <form id="new-test" action={createTest.bind(null, classId)} className="mt-5 flex scroll-mt-6 flex-wrap items-end gap-3 rounded-lg border border-ruling bg-white p-4">
            <label className="grid min-w-56 flex-1 gap-1.5">
              <span className="text-[0.95rem] font-semibold">New test</span>
              <input name="title" required maxLength={160} placeholder="e.g. Cell biology quiz, 14 March" className="rounded-md border border-input bg-white px-3 py-2" />
            </label>
            <button className={btn.primary}>Create test</button>
          </form>
        </section>

        <section aria-labelledby="students-h" className="rounded-lg border border-ruling bg-white p-5">
          <h2 id="students-h" className="text-lg font-semibold">Students</h2>
          <p className="mt-1 text-[0.9rem] text-muted-foreground">The AI only ever sees a code (S01, S02…), never a name.</p>
          <Roster classId={classId} students={byName(students as { id: string; display_name: string; anon_code: string }[] | null)} />
        </section>
      </div>
      <div className="mt-12 border-t border-ruling pt-6"><DeleteClass classId={classId} name={cls.name} /></div>
    </>
  );
}
