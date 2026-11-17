import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import { loadInsights } from "@/lib/db/insights";
import { loadReview } from "@/lib/db/review";
import { adminDb, publicDb } from "@/lib/supabase/clients";

// The sample class is public and changes only when it is re-seeded, so its pages are cached (no cookies are read).

export async function sampleTestId(): Promise<string | null> {
  "use cache";
  cacheLife("hours");
  cacheTag("sample");
  const { data } = await publicDb().from("classes").select("id,tests(id)").eq("is_sample", true).limit(1).maybeSingle<{ id: string; tests: { id: string }[] }>();
  return data?.tests?.[0]?.id ?? null;
}

export async function sampleReview(submissionId?: string) {
  "use cache";
  cacheLife("hours");
  cacheTag("sample");
  const id = await sampleTestId();
  return id ? loadReview(id, submissionId, publicDb()) : null;
}

export async function sampleInsights() {
  "use cache";
  cacheLife("hours");
  cacheTag("sample");
  const id = await sampleTestId();
  return id ? loadInsights(id, publicDb()) : null;
}

/** The public practice link of the sample class (anyone can practise its questions; no sign-up). */
export async function samplePracticePath(): Promise<string | null> {
  "use cache";
  cacheLife("hours");
  cacheTag("sample");
  const id = await sampleTestId();
  if (!id) return null;
  const { data } = await adminDb().from("tests").select("practice_token,practice_open").eq("id", id).single<{ practice_token: string; practice_open: boolean }>();
  return data?.practice_open ? `/p/${data.practice_token}` : null;
}
