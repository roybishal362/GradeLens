import type { Metadata } from "next";
import { Suspense } from "react";
import { adminDb } from "@/lib/supabase/clients";
import { testByToken } from "@/lib/uploads";
import { Uploader } from "./uploader";
import { byName } from "@/lib/utils";

export const metadata: Metadata = { title: "Hand in your answers", robots: { index: false, follow: false } };

export default function UploadPage({ params }: PageProps<"/u/[token]">) {
  return (
    <main className="mx-auto w-full max-w-lg flex-1 px-5 py-8">
      <p className="text-lg font-[750] tracking-tight">GradeLens</p>
      <Suspense fallback={<p className="mt-8 text-muted-foreground">Opening…</p>}>
        <View params={params} />
      </Suspense>
    </main>
  );
}

async function View({ params }: Pick<PageProps<"/u/[token]">, "params">) {
  const { token } = await params;
  const test = await testByToken(token);
  if (!test) {
    return (
      <div className="mt-8">
        <h1 className="text-2xl font-[750]">This link doesn&apos;t work</h1>
        <p className="mt-2 text-muted-foreground">It may be mistyped or replaced by a new one. Ask your teacher for the current link.</p>
      </div>
    );
  }
  if (!test.uploads_open) {
    return (
      <div className="mt-8">
        <h1 className="text-2xl font-[750]">{test.title}</h1>
        <p className="mt-2 text-muted-foreground">Your teacher has closed uploads for this test.</p>
      </div>
    );
  }
  // Only what the student needs: the names to choose from (ids are random, nothing else is exposed).
  const [{ data: students }, { data: t }] = await Promise.all([
    adminDb().from("students").select("id,display_name").eq("class_id", test.class_id).order("display_name"),
    adminDb().from("tests").select("rubric").eq("id", test.id).single<{ rubric: { questions: { q: number; marks: number; type: string }[] } }>(),
  ]);
  return (
    <>
      <h1 className="mt-6 text-[1.7rem] font-[750] leading-tight tracking-tight">{test.title}</h1>
      <p className="mt-1 text-muted-foreground">{test.classes.name}</p>
      <Uploader token={token} students={byName(students as { id: string; display_name: string }[] | null)}
        questions={(t?.rubric.questions ?? []).map((q) => ({ q: q.q, marks: q.marks, mcq: q.type === "mcq" }))} />
    </>
  );
}
