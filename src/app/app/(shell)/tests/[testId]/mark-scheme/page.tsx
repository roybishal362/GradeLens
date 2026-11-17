import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
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
      <PageHeader
        crumbs={[{ href: "/app", label: "Classes" }, { href: `/app/tests/${testId}`, label: test.title }]}
        title="Mark scheme"
        sub="Add the questions and your answer key, check the criteria GradeLens drafts, then approve. Nothing is marked before that."
      />
      <MarkSchemeEditor testId={testId} initial={test.rubric} status={test.rubric_status} markedScripts={marked ?? 0} />
      {test.rubric.questions.length > 0 && <div className="mt-12"><PaperCheck testId={testId} /></div>}
    </>
  );
}
