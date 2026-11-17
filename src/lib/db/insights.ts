import "server-only";

import { markOf, QR_COLS, TEST_COLS, type InsightRow, type QuestionResultRow, type StudentRow, type TestRow } from "@/lib/db/types";
import { itemAnalysis, learningGain, studentFeedback, type ItemStats, type ResultLite, type StudentFeedback } from "@/lib/insights/analysis";
import type { Cluster, Reteach } from "@/lib/insights/agents";
import type { SupabaseClient } from "@supabase/supabase-js";
import { userDb } from "@/lib/supabase/clients";

export type MisconceptionMap = { clusters: Cluster[]; scripts: number; approved: number; generatedAt: string };
export type ReteachPayload = Reteach & { clusterId: string; label: string };
export type RetestGain = {
  test: { id: string; title: string; status: string };
  clusterLabel: string | null;
  scripts: number;
  gain: ReturnType<typeof learningGain>;
};

export type InsightsData = {
  test: TestRow;
  className: string;
  isSample: boolean;
  students: Map<string, Pick<StudentRow, "id" | "display_name" | "anon_code">>; // by anon code
  scripts: number;
  approvedScripts: number;
  items: ItemStats[];
  feedback: { code: string; name: string; submissionId: string; fb: StudentFeedback; approved: boolean }[];
  map: (MisconceptionMap & { model: string | null }) | null;
  reteach: (ReteachPayload & { id: string; model: string | null })[];
  retests: RetestGain[];
};

export function toLite(r: QuestionResultRow): ResultLite {
  return {
    submissionId: r.submission_id, q: r.q, max: Number(r.max), mark: Number(markOf(r)), approved: r.approved,
    criteria: (r.grade_a?.criteria ?? []).map((c) => ({ id: c.id, points: c.points })),
    misconceptions: [...new Set([...(r.grade_a?.misconceptions ?? []), ...(r.grade_b?.misconceptions ?? [])])],
    answerText: r.answer?.text ?? "",
  };
}

/** Read under Row Level Security: a teacher's own test, or the public sample class. */
export async function loadInsights(testId: string, client?: SupabaseClient): Promise<InsightsData | null> {
  const db = client ?? (await userDb());
  const { data: test } = await db.from("tests").select(TEST_COLS).eq("id", testId).maybeSingle<TestRow>();
  if (!test) return null;
  const [{ data: cls }, { data: students }, { data: subs }, { data: results }, { data: insights }, { data: children }] = await Promise.all([
    db.from("classes").select("name,is_sample").eq("id", test.class_id).single<{ name: string; is_sample: boolean }>(),
    db.from("students").select("id,display_name,anon_code").eq("class_id", test.class_id).returns<StudentRow[]>(),
    db.from("submissions").select("id,student_id,status").eq("test_id", testId).in("status", ["graded", "approved"]).returns<{ id: string; student_id: string; status: string }[]>(),
    db.from("question_results").select(`${QR_COLS},submissions!inner(test_id)`).eq("submissions.test_id", testId).limit(5000).returns<QuestionResultRow[]>(),
    db.from("insights").select("id,test_id,kind,payload,model,created_at").eq("test_id", testId).order("created_at", { ascending: false }).returns<InsightRow[]>(),
    db.from("tests").select("id,title,rubric_status").eq("parent_test_id", testId).returns<{ id: string; title: string; rubric_status: string }[]>(),
  ]);
  const byStudentId = new Map((students ?? []).map((s) => [s.id, s]));
  const subStudent = new Map((subs ?? []).map((s) => [s.id, byStudentId.get(s.student_id)]));
  const graded = (results ?? []).filter((r) => subStudent.has(r.submission_id));
  const lite = graded.map(toLite);

  const feedback = (subs ?? []).flatMap((s) => {
    const st = byStudentId.get(s.student_id);
    if (!st) return [];
    return [{ code: st.anon_code, name: st.display_name, submissionId: s.id, approved: s.status === "approved", fb: studentFeedback(lite.filter((r) => r.submissionId === s.id), test.rubric) }];
  }).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  const mapRow = (insights ?? []).find((i) => i.kind === "misconceptions");
  const reteach = (insights ?? []).filter((i) => i.kind === "reteach").map((i) => ({ ...(i.payload as ReteachPayload), id: i.id, model: i.model }));
  const map = mapRow ? { ...(mapRow.payload as MisconceptionMap), model: mapRow.model } : null;

  // learning gain for each re-test: the original questions behind the misconception vs the re-test
  const retests: RetestGain[] = [];
  for (const child of children ?? []) {
    const label = reteach.find((r) => child.title.includes(r.label.slice(0, 40)))?.label ?? null;
    const cluster = map?.clusters.find((c) => c.label === label);
    const { data: childSubs } = await db.from("submissions").select("id,student_id").eq("test_id", child.id).in("status", ["graded", "approved"]);
    const { data: childResults } = await db.from("question_results").select(`${QR_COLS},submissions!inner(test_id)`).eq("submissions.test_id", child.id).returns<QuestionResultRow[]>();
    const childStudent = new Map((childSubs ?? []).map((s: { id: string; student_id: string }) => [s.id, s.student_id]));
    const preQs = new Set(cluster?.questions ?? test.rubric.questions.map((q) => q.q));
    const pre = graded.filter((r) => preQs.has(r.q)).map((r) => ({ student: subStudent.get(r.submission_id)!.id, mark: Number(markOf(r)), max: Number(r.max) }));
    const post = (childResults ?? []).filter((r) => childStudent.has(r.submission_id)).map((r) => ({ student: childStudent.get(r.submission_id)!, mark: Number(markOf(r)), max: Number(r.max) }));
    retests.push({ test: { id: child.id, title: child.title, status: child.rubric_status }, clusterLabel: label, scripts: childStudent.size, gain: learningGain(pre, post) });
  }

  return {
    test, className: cls?.name ?? "", isSample: Boolean(cls?.is_sample),
    students: new Map((students ?? []).map((s) => [s.anon_code, s])),
    scripts: subs?.length ?? 0,
    approvedScripts: (subs ?? []).filter((s) => s.status === "approved").length,
    items: itemAnalysis(lite, test.rubric),
    feedback, map, reteach, retests,
  };
}
