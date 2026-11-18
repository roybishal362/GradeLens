import "server-only";

import { gradeFor, percentOf } from "@/lib/results";
import { userDb } from "@/lib/supabase/clients";
import { byName } from "@/lib/utils";

export type Gradebook = {
  className: string;
  tests: { id: string; title: string; boundaries: { label: string; min: number }[] | null; average: number | null }[];
  rows: { studentId: string; name: string; code: string; cells: ({ percent: number; grade: string | null; approved: boolean } | null)[]; average: number | null }[];
};

/** Every student × every test of a class (percent, grade, whether all marks are approved). RLS: owner only. */
export async function classGradebook(classId: string): Promise<Gradebook | null> {
  const db = await userDb();
  const { data: cls } = await db.from("classes").select("name").eq("id", classId).maybeSingle<{ name: string }>();
  if (!cls) return null;
  const [{ data: tests }, { data: students }] = await Promise.all([
    db.from("tests").select("id,title,grade_boundaries,created_at").eq("class_id", classId).order("created_at"),
    db.from("students").select("id,display_name,anon_code").eq("class_id", classId).order("display_name"),
  ]);
  const testIds = (tests ?? []).map((t: { id: string }) => t.id);
  const { data: subs } = testIds.length
    ? await db.from("submissions").select("test_id,student_id,status,total,max_total").in("test_id", testIds).in("status", ["graded", "approved"])
    : { data: [] };
  type Sub = { test_id: string; student_id: string; status: string; total: number | null; max_total: number | null };
  const key = (t: string, s: string) => `${t}:${s}`;
  const subMap = new Map(((subs ?? []) as Sub[]).map((s) => [key(s.test_id, s.student_id), s]));
  const ts = (tests ?? []) as { id: string; title: string; grade_boundaries: { label: string; min: number }[] | null }[];
  const rows = byName(students as { id: string; display_name: string; anon_code: string }[] | null).map((st) => {
    const cells = ts.map((t) => {
      const s = subMap.get(key(t.id, st.id));
      const p = s ? percentOf(s.total, s.max_total) : null;
      return p === null ? null : { percent: p, grade: gradeFor(p, t.grade_boundaries), approved: s!.status === "approved" };
    });
    const got = cells.filter((c): c is NonNullable<typeof c> => c !== null);
    return { studentId: st.id, name: st.display_name, code: st.anon_code, cells, average: got.length ? got.reduce((a, c) => a + c.percent, 0) / got.length : null };
  });
  return {
    className: cls.name,
    tests: ts.map((t, i) => {
      const got = rows.map((r) => r.cells[i]).filter((c): c is NonNullable<typeof c> => c !== null);
      return { id: t.id, title: t.title, boundaries: t.grade_boundaries, average: got.length ? got.reduce((a, c) => a + c.percent, 0) / got.length : null };
    }),
    rows,
  };
}
