import "server-only";

import { markOf, type QuestionResultRow, type ReviewRequestRow } from "@/lib/db/types";
import type { Rubric } from "@/lib/grading/schemas";
import { adminDb } from "@/lib/supabase/clients";

export type StudentResults =
  | { state: "invalid" }
  | { state: "hidden" | "not-ready"; test: string; className: string; teacher: string | null }
  | {
      state: "ready"; sample: boolean;
      test: string; className: string; teacher: string | null; school: string | null; student: string;
      submissionId: string; rubric: Rubric; results: QuestionResultRow[]; total: number; max: number;
      boundaries: { label: string; min: number }[] | null;
      pages: { page_no: number; url: string }[];
      requests: ReviewRequestRow[];
    };

type SubRow = {
  id: string; status: string;
  tests: { title: string; rubric: Rubric; results_released: boolean; grade_boundaries: { label: string; min: number }[] | null; classes: { name: string; owner_id: string; is_sample: boolean } };
  students: { display_name: string };
};

/**
 * A student's results, opened with the private token from their link. Read with the server's key because students
 * have no account; the token is the credential (128-bit, unique per script), and nothing is shown until the teacher
 * released the test and approved every mark on the script.
 */
export async function studentResults(token: string): Promise<StudentResults> {
  if (!/^[0-9a-f]{32}$/.test(token)) return { state: "invalid" };
  const db = adminDb();
  const { data: sub } = await db.from("submissions")
    .select("id,status,tests!inner(title,rubric,results_released,grade_boundaries,classes!inner(name,owner_id,is_sample)),students!inner(display_name)")
    .eq("result_token", token).maybeSingle<SubRow>();
  if (!sub) return { state: "invalid" };
  const { data: profile } = await db.from("teacher_profiles").select("display_name,school").eq("user_id", sub.tests.classes.owner_id).maybeSingle<{ display_name: string | null; school: string | null }>();
  const base = { test: sub.tests.title, className: sub.tests.classes.name, teacher: profile?.display_name ?? null };
  if (!sub.tests.results_released && !sub.tests.classes.is_sample) return { state: "hidden", ...base };
  if (sub.status !== "approved") return { state: "not-ready", ...base };
  const [{ data: results }, { data: pages }, { data: requests }] = await Promise.all([
    db.from("question_results").select("id,submission_id,q,max,score_a,score_b,ai_score,risk,flags,answer,grade_a,grade_b,teacher_score,teacher_note,approved,approved_at,reference_score").eq("submission_id", sub.id).order("q"),
    db.from("pages").select("page_no,storage_path").eq("submission_id", sub.id).order("page_no"),
    db.from("review_requests").select("id,submission_id,q,message,status,response,created_at,resolved_at").eq("submission_id", sub.id).order("created_at"),
  ]);
  const rows = (results ?? []) as QuestionResultRow[];
  const stored = (pages ?? []).filter((p: { storage_path: string }) => !p.storage_path.startsWith("/"));
  const signed = new Map<string, string>();
  if (stored.length) {
    const { data } = await db.storage.from("pages").createSignedUrls(stored.map((p: { storage_path: string }) => p.storage_path), 3600);
    for (const s of data ?? []) if (s.path && s.signedUrl) signed.set(s.path, s.signedUrl);
  }
  return {
    state: "ready", sample: sub.tests.classes.is_sample, ...base, school: profile?.school ?? null, student: sub.students.display_name, submissionId: sub.id,
    rubric: sub.tests.rubric, results: rows, boundaries: sub.tests.grade_boundaries,
    total: rows.reduce((s, r) => s + Number(markOf(r)), 0), max: rows.reduce((s, r) => s + Number(r.max), 0),
    pages: (pages ?? []).map((p: { page_no: number; storage_path: string }) => ({ page_no: p.page_no, url: p.storage_path.startsWith("/") ? p.storage_path : signed.get(p.storage_path) ?? "" })),
    requests: (requests ?? []) as ReviewRequestRow[],
  };
}
