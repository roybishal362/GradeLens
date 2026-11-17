import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireTeacher } from "@/lib/dal";
import { userDb } from "@/lib/supabase/clients";
import { createClass } from "./actions";

export const metadata: Metadata = { title: "Your classes" };

const ERRORS: Record<string, string> = {
  name: "Give the class a name.",
  create: "Couldn't create the class. Try again.",
  "guest-classes": "Guest workspaces can have up to 3 classes. Sign in with Google for more.",
};

export default function Dashboard({ searchParams }: PageProps<"/app">) {
  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-10">
      <h1 className="text-[1.95rem] font-[750] tracking-tight">Your classes</h1>
      <Suspense fallback={<p className="mt-8 text-muted-foreground">Loading your classes…</p>}>
        <Classes searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

type ClassListRow = { id: string; name: string; subject: string | null; students: { count: number }[]; tests: { count: number }[] };

async function Classes({ searchParams }: { searchParams: PageProps<"/app">["searchParams"] }) {
  await requireTeacher("/app");
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? ERRORS[sp.error] : undefined;
  const db = await userDb();
  const { data } = await db
    .from("classes")
    .select("id,name,subject,students(count),tests(count)")
    .eq("is_sample", false)
    .order("created_at", { ascending: false })
    .returns<ClassListRow[]>();
  const classes = data ?? [];
  return (
    <>
      {error && <p role="alert" className="mt-6 rounded-md border border-flag/40 bg-flag/5 px-4 py-3">{error}</p>}
      {classes.length ? (
        <ul className="mt-8 divide-y divide-ruling border-y border-ruling">
          {classes.map((c) => (
            <li key={c.id}>
              <Link href={`/app/classes/${c.id}`} className="flex flex-wrap items-baseline justify-between gap-2 px-1 py-4 hover:bg-secondary/60">
                <span>
                  <span className="text-lg font-semibold">{c.name}</span>
                  {c.subject && <span className="ml-2 text-muted-foreground">{c.subject}</span>}
                </span>
                <span className="text-[0.95rem] text-muted-foreground">
                  {c.students[0]?.count ?? 0} students · {c.tests[0]?.count ?? 0} tests
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-8 margin-rule pl-5">
          <p className="text-lg">No classes yet.</p>
          <p className="mt-1 text-muted-foreground">
            Create one below, or look around the <Link href="/sample" className="font-semibold text-ink underline underline-offset-4">sample class</Link> first:
            it has real marked scripts from a public dataset.
          </p>
        </div>
      )}

      <section className="mt-12 max-w-xl">
        <h2 className="text-xl font-semibold">New class</h2>
        <form action={createClass} className="mt-4 grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="grid gap-1.5">
            <span className="text-[0.95rem] font-semibold">Class name</span>
            <input name="name" required maxLength={120} placeholder="e.g. Year 10 Biology, set 2" className="rounded-md border border-input bg-white px-3 py-2" />
          </label>
          <label className="grid gap-1.5">
            <span className="text-[0.95rem] font-semibold">Subject <span className="font-normal text-muted-foreground">(optional)</span></span>
            <input name="subject" maxLength={80} placeholder="Biology" className="rounded-md border border-input bg-white px-3 py-2" />
          </label>
          <button className="rounded-md bg-redpen px-4 py-2 font-semibold text-white hover:bg-[#b81f1f]">Create class</button>
        </form>
      </section>
    </>
  );
}
