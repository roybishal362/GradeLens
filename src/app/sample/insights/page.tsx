import type { Metadata } from "next";
import Link from "next/link";
import { DatasetAttribution } from "@/components/attribution";
import { InsightsView } from "@/components/insights/insights-view";
import { sampleInsights } from "@/lib/db/sample";

export const metadata: Metadata = { title: "Sample class insights" };

export default async function SampleInsightsPage() {
  const data = await sampleInsights();
  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-10">
      <p className="text-[0.95rem] text-muted-foreground"><Link href="/sample" className="underline underline-offset-4">Sample class</Link></p>
      <h1 className="mt-1 mb-2 text-[1.95rem] font-[750] tracking-tight">Class insights</h1>
      {data ? <InsightsView data={data} mode="sample" reviewHref="/sample/review" /> : <p className="text-muted-foreground">The sample class is being prepared.</p>}
      <DatasetAttribution className="mt-12 max-w-3xl" />
    </main>
  );
}
