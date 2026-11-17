import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireTeacher } from "@/lib/dal";
import { TEST_COLS, type TestRow } from "@/lib/db/types";
import { userDb } from "@/lib/supabase/clients";
import { MarkSchemeEditor } from "./editor";
import { PaperCheck } from "./paper-check";

export const metadata: Metadata = { title: "Mark scheme" };

export default function MarkSchemePage({ params }: PageProps<"/app/tests/[testId]/mark-scheme">) {
  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-10">
      <Suspense fallback={<p className="text-muted-foreground">Loading the mark scheme…</p>}>
        <View params={params} />
      </Suspense>
    </main>
  );
}

async function View({ params }: Pick<PageProps<"/app/tests/[testId]/mark-scheme">, "params">) {
  const { testId } = await params;
  await requireTeacher(`/app/tests/${testId}/mark-scheme`);
  const db = await userDb();
  const { data: test } = await db.from("tests").select(TEST_COLS).eq("id", testId).maybeSingle<TestRow>();
  if (!test) notFound();
  const { count: marked } = await db.from("submissions").select("id", { count: "exact", head: true }).eq("test_id", testId).in("status", ["graded", "approved"]);
  return (
    <>
      <p className="text-[0.95rem] text-muted-foreground">
        <Link href={`/app/tests/${testId}`} className="underline underline-offset-4">{test.title}</Link>
      </p>
      <h1 className="mt-1 text-[1.95rem] font-[750] tracking-tight">Mark scheme</h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">
        Add the questions and your answer key. GradeLens drafts the marking criteria; you check and approve them.
        Nothing is marked until you approve the mark scheme.
      </p>
      <MarkSchemeEditor testId={testId} initial={test.rubric} status={test.rubric_status} markedScripts={marked ?? 0} />
      {test.rubric.questions.length > 0 && <div className="mt-12"><PaperCheck testId={testId} /></div>}
    </>
  );
}
