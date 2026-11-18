import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { requireTeacher } from "@/lib/dal";
import { uploadLinkFor } from "@/lib/db/teacher";
import type { StudentRow } from "@/lib/db/types";
import { userDb } from "@/lib/supabase/clients";
import { Scanner } from "./scanner";
import { byName } from "@/lib/utils";

export const metadata: Metadata = { title: "Scan a pile of answer sheets" };

export default function ScanPage({ params }: PageProps<"/app/tests/[testId]/scan">) {
  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-10">
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <View params={params} />
      </Suspense>
    </main>
  );
}

async function View({ params }: Pick<PageProps<"/app/tests/[testId]/scan">, "params">) {
  const { testId } = await params;
  await requireTeacher(`/app/tests/${testId}/scan`);
  const db = await userDb();
  const { data: test } = await db.from("tests").select("id,class_id,title").eq("id", testId).maybeSingle<{ id: string; class_id: string; title: string }>();
  if (!test) notFound();
  const [{ data: students }, link] = await Promise.all([
    db.from("students").select("id,display_name,anon_code").eq("class_id", test.class_id).order("display_name").returns<StudentRow[]>(),
    uploadLinkFor(testId),
  ]);
  if (!link) notFound();
  return (
    <>
      <PageHeader crumbs={[{ href: "/app", label: "Classes" }, { href: `/app/tests/${testId}`, label: test.title }]} title="Scan a pile of answer sheets" />
      <p className="mt-2 max-w-2xl text-muted-foreground">
        Photograph or scan every page of the <Link href={`/app/tests/${testId}/sheets`} className="font-semibold text-ink underline underline-offset-4">printed answer sheets</Link>,
        in any order, and choose all the photos at once. The QR codes are read on this device; you check the grouping before anything is uploaded.
      </p>
      <Scanner testId={testId} token={link.url.split("/u/")[1]} students={byName(students).map((s) => ({ id: s.id, name: s.display_name, code: s.anon_code }))} />
    </>
  );
}
