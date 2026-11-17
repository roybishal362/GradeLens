import { ArrowRight, BookOpen, CheckCircle2, Circle, GraduationCap, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { createClass } from "@/app/app/actions";
import { btn, PageHeader } from "@/components/page-header";
import { requireTeacher } from "@/lib/dal";
import { userDb } from "@/lib/supabase/clients";

export const metadata: Metadata = { title: "Your classes" };

const ERRORS: Record<string, string> = {
  name: "Give the class a name.",
  create: "Couldn't create the class. Try again.",
  "guest-classes": "Guest workspaces can have up to 3 classes. Sign in with Google for more.",
};

export default function Dashboard({ searchParams }: PageProps<"/app">) {
  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-8">
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <Classes searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

type ClassCard = {
  id: string; name: string; subject: string | null; created_at: string;
  students: { count: number }[];
  tests: { id: string; title: string; rubric_status: string; created_at: string; submissions: { status: string }[] }[];
};

async function Classes({ searchParams }: { searchParams: PageProps<"/app">["searchParams"] }) {
  const t = await requireTeacher("/app");
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? ERRORS[sp.error] : undefined;
  const db = await userDb();
  const [{ data }, { count: approvedMarks }] = await Promise.all([
    db.from("classes").select("id,name,subject,created_at,students(count),tests(id,title,rubric_status,created_at,submissions(status))").eq("is_sample", false).order("created_at", { ascending: false }).returns<ClassCard[]>(),
    // only the teacher's own classes: the public sample class is readable by everyone and must not count here
    db.from("question_results").select("id,submissions!inner(tests!inner(classes!inner(is_sample)))", { count: "exact", head: true })
      .eq("approved", true).eq("submissions.tests.classes.is_sample", false),
  ]);
  const classes = data ?? [];
  const allTests = classes.flatMap((c) => c.tests);
  const steps = [
    { done: classes.length > 0, title: "Create a class", text: "Name it the way you would on a register.", href: "#new-class" },
    { done: classes.some((c) => (c.students[0]?.count ?? 0) > 0), title: "Add your students", text: "Paste the class list. The AI never sees names.", href: classes[0] ? `/app/classes/${classes[0].id}` : "#new-class" },
    { done: allTests.some((x) => x.rubric_status === "approved"), title: "Set up a test", text: "Paste the question paper and answer key, check the criteria, approve.", href: classes[0] ? `/app/classes/${classes[0].id}#new-test` : "#new-class" },
    { done: allTests.some((x) => x.submissions.length > 0), title: "Collect scripts", text: "Students photograph their pages, or you scan printed sheets.", href: allTests[0] ? `/app/tests/${allTests[0].id}#collect` : "#new-class" },
    { done: (approvedMarks ?? 0) > 0, title: "Review and approve", text: "Check each suggestion against the student's words.", href: allTests[0] ? `/app/tests/${allTests[0].id}/review` : "#new-class" },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <>
      <PageHeader title="Your classes" sub={t.isGuest ? "Guest workspace: deleted after 7 days." : undefined}
        actions={<a href="#new-class" className={btn.primary}><Plus aria-hidden className="size-4" /> New class</a>} />
      {error && <p role="alert" className="mb-6 rounded-md border border-flag/40 bg-flag/5 px-4 py-3">{error}</p>}

      {doneCount < steps.length && (
        <section aria-labelledby="start" className="mb-8 rounded-lg border border-ruling bg-white p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="start" className="text-lg font-semibold">Getting started</h2>
            <span className="text-[0.9rem] text-muted-foreground">{doneCount} of {steps.length} done</span>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-[#e3e9f4]"><div className="h-full rounded-full bg-ok" style={{ width: `${(100 * doneCount) / steps.length}%` }} /></div>
          <ol className="mt-4 grid gap-2 md:grid-cols-5">
            {steps.map((s, i) => {
              const next = !s.done && steps.slice(0, i).every((x) => x.done);
              return (
                <li key={s.title}>
                  <Link href={s.href} className={`flex h-full flex-col rounded-md border p-3 ${next ? "border-redpen/50 bg-redpen/5" : "border-ruling hover:bg-secondary/60"}`}>
                    <span className="flex items-center gap-2 font-semibold">
                      {s.done ? <CheckCircle2 aria-hidden className="size-4 text-ok" /> : <Circle aria-hidden className="size-4 text-muted-foreground" />}
                      {s.title}
                    </span>
                    <span className="mt-1 text-[0.85rem] text-muted-foreground">{s.text}</span>
                    {next && <span className="mt-2 inline-flex items-center gap-1 text-[0.85rem] font-semibold text-redpen">Do this next <ArrowRight aria-hidden className="size-3.5" /></span>}
                  </Link>
                </li>
              );
            })}
          </ol>
          <p className="mt-4 flex items-center gap-2 text-[0.9rem] text-muted-foreground">
            <BookOpen aria-hidden className="size-4" /> Want to see it first? <Link href="/sample" className="font-semibold text-ink underline underline-offset-4">Open the sample class</Link> with real marked scripts.
          </p>
        </section>
      )}

      {classes.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {classes.map((c) => {
            const latest = [...c.tests].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
            const toReview = c.tests.reduce((s, x) => s + x.submissions.filter((y) => y.status === "graded").length, 0);
            return (
              <li key={c.id}>
                <Link href={`/app/classes/${c.id}`} className="flex h-full flex-col rounded-lg border border-ruling bg-white p-5 hover:border-ink/30 hover:shadow-sm">
                  <span className="flex items-center gap-2 text-[0.85rem] text-muted-foreground"><GraduationCap aria-hidden className="size-4" />{c.subject ?? "Class"}</span>
                  <span className="mt-1 text-lg font-semibold">{c.name}</span>
                  <span className="mt-1 text-[0.9rem] text-muted-foreground">{c.students[0]?.count ?? 0} students · {c.tests.length} tests</span>
                  <span className="mt-auto pt-4 text-[0.9rem]">
                    {toReview > 0 ? <span className="font-semibold text-check">{toReview} script{toReview === 1 ? "" : "s"} to review</span>
                      : latest ? <span className="text-muted-foreground">Latest: {latest.title}</span> : <span className="text-muted-foreground">No tests yet</span>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <section id="new-class" className="mt-10 max-w-2xl scroll-mt-6 rounded-lg border border-ruling bg-white p-5">
        <h2 className="text-lg font-semibold">New class</h2>
        <form action={createClass} className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="grid gap-1.5">
            <span className="text-[0.95rem] font-semibold">Class name</span>
            <input name="name" required maxLength={120} placeholder="Year 10 Biology, set 2" className="rounded-md border border-input bg-white px-3 py-2" />
          </label>
          <label className="grid gap-1.5">
            <span className="text-[0.95rem] font-semibold">Subject <span className="font-normal text-muted-foreground">(optional)</span></span>
            <input name="subject" maxLength={80} placeholder="Biology" className="rounded-md border border-input bg-white px-3 py-2" />
          </label>
          <button className={btn.primary}>Create class</button>
        </form>
      </section>
    </>
  );
}
