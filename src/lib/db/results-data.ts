import "server-only";

import { TEST_COLS, type TestRow } from "@/lib/db/types";
import { gradeFor, percentOf } from "@/lib/results";
import { userDb } from "@/lib/supabase/clients";

export type MarkCell = {
  q: number; max: number; mark: number; ai: number; approved: boolean; note: string | null; flags: string[];
  criteria: { id: string; points: number }[]; misconceptions: string[]; answered: boolean;
};
export type StudentLine = {
  studentId: string; name: string; code: string; submissionId: string | null; status: string | null;
  total: number | null; max: number | null; percent: number | null; grade: string | null; approved: boolean; resultToken: string | null;
  marks: MarkCell[];
};

/** Everything needed for exports, stats and the gradebook for one test, read under Row Level Security. */
export async function testMarks(testId: string): Promise<{ test: TestRow; className: string; lines: StudentLine[] } | null> {
  const db = await userDb();
  const { data: test } = await db.from("tests").select(TEST_COLS).eq("id", testId).maybeSingle<TestRow>();
  if (!test) return null;
  const [{ data: cls }, { data: students }, { data: subs }, { data: qrs }] = await Promise.all([
    db.from("classes").select("name").eq("id", test.class_id).single<{ name: string }>(),
    db.from("students").select("id,display_name,anon_code").eq("class_id", test.class_id).order("display_name"),
    db.from("submissions").select("id,student_id,status,total,max_total,result_token").eq("test_id", testId),
    // only the small parts of the JSON columns: criterion points, misconceptions, and whether anything was written
    db.from("question_results").select("submission_id,q,max,ai_score,teacher_score,approved,teacher_note,flags,criteria:grade_a->criteria,misconceptions:grade_a->misconceptions,answer_text:answer->>text,submissions!inner(test_id)").eq("submissions.test_id", testId).order("q").limit(20000),
  ]);
  type Sub = { id: string; student_id: string; status: string; total: number | null; max_total: number | null; result_token: string };
  type QR = {
    submission_id: string; q: number; max: number; ai_score: number; teacher_score: number | null; approved: boolean; teacher_note: string | null; flags: string[];
    criteria: { id: string; points: number }[] | null; misconceptions: string[] | null; answer_text: string | null;
  };
  const bySub = new Map<string, MarkCell[]>();
  for (const r of (qrs ?? []) as QR[]) {
    bySub.set(r.submission_id, [...(bySub.get(r.submission_id) ?? []), {
      q: r.q, max: Number(r.max), mark: Number(r.teacher_score ?? r.ai_score), ai: Number(r.ai_score), approved: r.approved, note: r.teacher_note, flags: r.flags,
      criteria: (r.criteria ?? []).map((c) => ({ id: c.id, points: Number(c.points) })), misconceptions: r.misconceptions ?? [], answered: Boolean(r.answer_text?.trim()),
    }]);
  }
  const subByStudent = new Map(((subs ?? []) as Sub[]).map((s) => [s.student_id, s]));
  const lines: StudentLine[] = (students ?? []).map((st: { id: string; display_name: string; anon_code: string }) => {
    const s = subByStudent.get(st.id);
    const marked = s && ["graded", "approved"].includes(s.status);
    const pct = marked ? percentOf(s.total, s.max_total) : null;
    return {
      studentId: st.id, name: st.display_name, code: st.anon_code, submissionId: s?.id ?? null, status: s?.status ?? null,
      total: marked ? Number(s.total) : null, max: marked ? Number(s.max_total) : null, percent: pct,
      grade: pct === null ? null : gradeFor(pct, test.grade_boundaries), approved: s?.status === "approved",
      resultToken: s?.result_token ?? null, marks: s ? bySub.get(s.id) ?? [] : [],
    };
  });
  return { test, className: cls?.name ?? "", lines };
}

export const safeFileName = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 60) || "export";
