import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireTeacher } from "@/lib/dal";
import { userDb } from "@/lib/supabase/clients";
import { createTest } from "../../actions";
import { DeleteClass } from "./delete-class";
import { Roster } from "./roster";

export const metadata: Metadata = { title: "Class" };

export default function ClassPage({ params, searchParams }: PageProps<"/app/classes/[classId]">) {
  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-10">
      <Suspense fallback={<p className="text-muted-foreground">Loading the class…</p>}>
        <ClassView params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

type TestListRow = {
  id: string; title: string; rubric_status: string; created_at: string; parent_test_id: string | null;
  submissions: { status: string }[];
};

async function ClassView({ params, searchParams }: Pick<PageProps<"/app/classes/[classId]">, "params" | "searchParams">) {
  const { classId } = await params;
  await requireTeacher(`/app/classes/${classId}`);
  const sp = await searchParams;
  const db = await userDb();
  const [{ data: cls }, { data: tests }, { data: students }] = await Promise.all([
    db.from("classes").select("id,name,subject").eq("id", classId).maybeSingle<{ id: string; name: string; subject: string | null }>(),
    db.from("tests").select("id,title,rubric_status,created_at,parent_test_id,submissions(status)").eq("class_id", classId).order("created_at", { ascending: false }).returns<TestListRow[]>(),
    db.from("students").select("id,display_name,anon_code").eq("class_id", classId).order("display_name"),
  ]);
  if (!cls) notFound();
  const error = sp.error === "title" ? "Give the test a title." : sp.error === "test" ? "Couldn't create the test. Try again." : null;

  return (
    <>
      <p className="text-[0.95rem] text-muted-foreground"><Link href="/app" className="underline underline-offset-4">Your classes</Link></p>
      <h1 className="mt-1 text-[1.95rem] font-[750] tracking-tight">{cls.name}</h1>
      {cls.subject && <p className="text-muted-foreground">{cls.subject}</p>}
      {error && <p role="alert" className="mt-6 rounded-md border border-flag/40 bg-flag/5 px-4 py-3">{error}</p>}

      <div className="mt-10 grid gap-12 lg:grid-cols-[3fr_2fr]">
        <section>
          <h2 className="text-xl font-semibold">Tests</h2>
          {tests?.length ? (
            <ul className="mt-4 divide-y divide-ruling border-y border-ruling">
              {tests.map((t) => {
                const total = t.submissions.length;
                const approved = t.submissions.filter((s) => s.status === "approved").length;
                const waiting = t.submissions.filter((s) => s.status === "graded").length;
                return (
                  <li key={t.id}>
                    <Link href={`/app/tests/${t.id}`} className="block px-1 py-3.5 hover:bg-secondary/60">
                      <span className="font-semibold">{t.title}</span>
                      {t.parent_test_id && <span className="ml-2 text-[0.9rem] text-muted-foreground">re-test</span>}
                      <span className="mt-0.5 block text-[0.95rem] text-muted-foreground">
                        {t.rubric_status === "approved" ? "Mark scheme approved" : "Mark scheme not approved yet"}
                        {" · "}{total} script{total === 1 ? "" : "s"}
                        {waiting ? ` · ${waiting} waiting for you` : ""}
                        {total ? ` · ${approved} approved` : ""}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-4 text-muted-foreground">No tests yet. Create one, add its questions and mark scheme, then share the upload link with students.</p>
          )}
          <form action={createTest.bind(null, classId)} className="mt-6 flex flex-wrap items-end gap-3">
            <label className="grid flex-1 gap-1.5">
              <span className="text-[0.95rem] font-semibold">New test</span>
              <input name="title" required maxLength={160} placeholder="e.g. Cell biology quiz, 14 March" className="min-w-56 rounded-md border border-input bg-white px-3 py-2" />
            </label>
            <button className="rounded-md bg-redpen px-4 py-2 font-semibold text-white hover:bg-[#b81f1f]">Create test</button>
          </form>
        </section>

        <section>
          <h2 className="text-xl font-semibold">Students <span className="font-normal text-muted-foreground">({students?.length ?? 0})</span></h2>
          <p className="mt-1 text-[0.95rem] text-muted-foreground">
            The AI never sees names: answers are graded under a code (S01, S02…) and names are removed from scans first.
          </p>
          <Roster classId={classId} students={(students ?? []) as { id: string; display_name: string; anon_code: string }[]} />
        </section>
      </div>
      <div className="mt-16 border-t border-ruling pt-6"><DeleteClass classId={classId} name={cls.name} /></div>
    </>
  );
}
