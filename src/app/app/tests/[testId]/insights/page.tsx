import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
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
      <p className="text-[0.95rem] text-muted-foreground"><Link href={`/app/tests/${testId}`} className="underline underline-offset-4">{data.test.title}</Link></p>
      <h1 className="mt-1 mb-2 text-[1.95rem] font-[750] tracking-tight">Class insights</h1>
      <InsightsView data={data} mode="teacher" reviewHref={`/app/tests/${testId}/review`} />
    </>
  );
}
