import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ReviewWorkspace } from "@/components/review/workspace";
import { requireTeacher } from "@/lib/dal";
import { loadReview } from "@/lib/db/review";

export const metadata: Metadata = { title: "Review marks" };

export default function ReviewPage({ params, searchParams }: PageProps<"/app/tests/[testId]/review">) {
  return (
    <main className="flex flex-col lg:h-[calc(100dvh-3.6rem)]">
      <Suspense fallback={<p className="p-6 text-muted-foreground">Loading the scripts…</p>}>
        <View params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function View({ params, searchParams }: Pick<PageProps<"/app/tests/[testId]/review">, "params" | "searchParams">) {
  const { testId } = await params;
  const sp = await searchParams;
  await requireTeacher(`/app/tests/${testId}/review`);
  const data = await loadReview(testId, typeof sp.s === "string" ? sp.s : undefined);
  if (!data) notFound();
  return (
    <ReviewWorkspace
      mode={data.isSample ? "sample" : "teacher"}
      testId={testId}
      title={data.test.title}
      rubric={data.test.rubric}
      basePath={`/app/tests/${testId}/review`}
      scripts={data.scripts.map((s) => ({ id: s.id, status: s.status, total: s.total, max_total: s.max_total, risk: s.risk, warnings: s.warnings, name: s.student.display_name, code: s.student.anon_code }))}
      commentBank={data.commentBank}
      requests={data.requests}
      initialQ={typeof sp.q === "string" ? Number(sp.q) || undefined : undefined}
      current={data.current && {
        id: data.current.script.id, name: data.current.script.student.display_name, code: data.current.script.student.anon_code,
        warnings: data.current.script.warnings, results: data.current.results, pages: data.current.pages,
      }}
    />
  );
}
