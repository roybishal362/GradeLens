import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { InsightsView } from "@/components/insights/insights-view";
import { requireTeacher } from "@/lib/dal";
import { loadInsights } from "@/lib/db/insights";

export const metadata: Metadata = { title: "Class insights" };

export default function InsightsPage({ params }: PageProps<"/app/tests/[testId]/insights">) {
  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-10">
      <Suspense fallback={<p className="text-muted-foreground">Loading the class insights…</p>}>
        <View params={params} />
      </Suspense>
    </main>
  );
}

async function View({ params }: Pick<PageProps<"/app/tests/[testId]/insights">, "params">) {
  const { testId } = await params;
  await requireTeacher(`/app/tests/${testId}/insights`);
  const data = await loadInsights(testId);
  if (!data) notFound();
  return (
    <>
      <PageHeader crumbs={[{ href: "/app", label: "Classes" }, { href: `/app/tests/${testId}`, label: data.test.title }]} title="Class insights" />
      <InsightsView data={data} mode="teacher" reviewHref={`/app/tests/${testId}/review`} />
    </>
  );
}
