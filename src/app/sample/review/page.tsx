import type { Metadata } from "next";
import { Suspense } from "react";
import { ReviewWorkspace } from "@/components/review/workspace";
import { sampleReview } from "@/lib/db/sample";

export const metadata: Metadata = { title: "Review the sample class" };

export default function SampleReviewPage({ searchParams }: PageProps<"/sample/review">) {
  return (
    <main className="flex flex-col lg:h-[calc(100dvh-3.6rem)]">
      <Suspense fallback={<p className="p-6 text-muted-foreground">Loading the scripts…</p>}>
        <View searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function View({ searchParams }: Pick<PageProps<"/sample/review">, "searchParams">) {
  const sp = await searchParams;
  const data = await sampleReview(typeof sp.s === "string" ? sp.s : undefined);
  if (!data) return <p className="p-6 text-muted-foreground">The sample class is being prepared. Please check back shortly.</p>;
  return (
    <ReviewWorkspace
      mode="sample"
      testId={data.test.id}
      title={data.test.title}
      rubric={data.test.rubric}
      track={data.track}
      basePath="/sample/review"
      scripts={data.scripts.map((s) => ({ id: s.id, status: s.status, total: s.total, max_total: s.max_total, risk: s.risk, warnings: s.warnings, name: s.student.display_name, code: s.student.anon_code }))}
      current={data.current && {
        id: data.current.script.id, name: data.current.script.student.display_name, code: data.current.script.student.anon_code,
        warnings: data.current.script.warnings, results: data.current.results, pages: data.current.pages,
      }}
    />
  );
}
