import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { practiceTest } from "@/lib/practice";
import { adminDb } from "@/lib/supabase/clients";
import { PracticeForm } from "./practice-form";
import { byName } from "@/lib/utils";

export const metadata: Metadata = { title: "Practice", robots: { index: false, follow: false } };

export default function PracticePage({ params }: PageProps<"/p/[token]">) {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-8">
      <Link href="/" className="text-lg font-[750] tracking-tight">GradeLens</Link>
      <Suspense fallback={<p className="mt-8 text-muted-foreground">Opening…</p>}>
        <View params={params} />
      </Suspense>
    </main>
  );
}

async function View({ params }: Pick<PageProps<"/p/[token]">, "params">) {
  const { token } = await params;
  const test = await practiceTest(token);
  if (!test) {
    return <div className="mt-8"><h1 className="text-2xl font-[750]">This practice link doesn&apos;t work</h1><p className="mt-2 text-muted-foreground">Ask your teacher for the current link.</p></div>;
  }
  if (!test.open && !test.isSample) {
    return <div className="mt-8"><h1 className="text-2xl font-[750]">{test.title}</h1><p className="mt-2 text-muted-foreground">Your teacher has closed practice for this test.</p></div>;
  }
  const { data: students } = test.isSample ? { data: [] } : await adminDb().from("students").select("id,display_name").eq("class_id", test.classId).order("display_name");
  return (
    <>
      <p className="mt-6 text-[0.95rem] text-muted-foreground">{test.className}{test.isSample && " · public sample"}</p>
      <h1 className="mt-1 text-[1.8rem] font-[750] leading-tight tracking-tight">Practise: {test.title}</h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">
        Answer any questions and get instant feedback: what earned marks, what was missing and what to watch out for.
        This is practice, so it doesn&apos;t count towards a grade, and the AI can be wrong.
      </p>
      <PracticeForm
        token={token}
        students={byName(students as { id: string; display_name: string }[] | null)}
        questions={test.rubric.questions.map((q) => ({ q: q.q, text: q.text, marks: q.marks, mcq: q.type === "mcq" }))}
      />
    </>
  );
}
