import "server-only";

import { QR_COLS, SUB_COLS, TEST_COLS, type PageRow, type QuestionResultRow, type StudentRow, type SubmissionRow, type TestRow } from "@/lib/db/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminDb, userDb } from "@/lib/supabase/clients";
import type { Track } from "@/lib/trust";

export type ReviewScript = SubmissionRow & { student: Pick<StudentRow, "id" | "display_name" | "anon_code"> };
export type ReviewData = {
  test: TestRow;
  className: string;
  isSample: boolean;
  scripts: ReviewScript[];
  current: { script: ReviewScript; results: QuestionResultRow[]; pages: (PageRow & { url: string })[] } | null;
  commentBank: Record<number, string[]>;
  requests: { id: string; q: number; message: string }[];
  track: Track[]; // per question: answers the teacher checked one by one, and how often they kept the suggestion
};

const RANK = { high: 0, medium: 1, low: 2 } as const;

/**
 * Everything the review screen needs, read under Row Level Security: a teacher sees their own tests, anyone sees the
 * sample class. Page images: signed for one hour (private bucket); the sample's images are public files.
 */
export async function loadReview(testId: string, submissionId?: string, client?: SupabaseClient): Promise<ReviewData | null> {
  const db = client ?? (await userDb());
  const { data: test } = await db.from("tests").select(TEST_COLS).eq("id", testId).maybeSingle<TestRow>();
  if (!test) return null;
  const [{ data: cls }, { data: subs }, { data: students }, { data: trackRows }] = await Promise.all([
    db.from("classes").select("name,is_sample").eq("id", test.class_id).single<{ name: string; is_sample: boolean }>(),
    db.from("submissions").select(SUB_COLS).eq("test_id", testId).in("status", ["graded", "approved"]).returns<SubmissionRow[]>(),
    db.from("students").select("id,display_name,anon_code").eq("class_id", test.class_id).returns<StudentRow[]>(),
    db.rpc("question_track", { tid: testId }),
  ]);
  const track = ((trackRows ?? []) as Track[]).map((t) => ({ q: Number(t.q), checked: Number(t.checked), kept: Number(t.kept), close: Number(t.close) }));
  const byId = new Map((students ?? []).map((s) => [s.id, s]));
  const scripts: ReviewScript[] = (subs ?? [])
    .filter((s) => byId.has(s.student_id))
    .map((s) => ({ ...s, student: byId.get(s.student_id)! }))
    // waiting first, riskiest first, then by name
    .sort((a, b) =>
      Number(a.status === "approved") - Number(b.status === "approved") ||
      RANK[a.risk ?? "low"] - RANK[b.risk ?? "low"] ||
      a.student.display_name.localeCompare(b.student.display_name, undefined, { numeric: true }));

  const script = scripts.find((s) => s.id === submissionId) ?? scripts[0];
  if (!script) return { test, className: cls?.name ?? "", isSample: Boolean(cls?.is_sample), scripts, current: null, commentBank: {}, requests: [], track };

  const [{ data: results }, { data: pages }, { data: notes }, { data: requests }] = await Promise.all([
    db.from("question_results").select(QR_COLS).eq("submission_id", script.id).order("q").returns<QuestionResultRow[]>(),
    db.from("pages").select("id,submission_id,page_no,storage_path,media_type,width,height").eq("submission_id", script.id).order("page_no").returns<PageRow[]>(),
    // the teacher's own earlier notes on this test, offered again as one-click comments
    db.from("question_results").select("q,teacher_note,approved_at,submissions!inner(test_id)").eq("submissions.test_id", testId).not("teacher_note", "is", null).order("approved_at", { ascending: false }).limit(500),
    db.from("review_requests").select("id,q,message").eq("submission_id", script.id).eq("status", "open").order("created_at"),
  ]);
  const commentBank: Record<number, string[]> = {};
  for (const n of (notes ?? []) as { q: number; teacher_note: string }[]) {
    const t = n.teacher_note.trim();
    if (!t || t === "Mark from the dataset's teacher") continue;
    const list = (commentBank[n.q] ??= []);
    if (!list.includes(t) && list.length < 6) list.push(t);
  }
  const stored = (pages ?? []).filter((p) => !p.storage_path.startsWith("/"));
  const signed = new Map<string, string>();
  if (stored.length) {
    // the rows above were visible to this user (RLS), so signing exactly those paths is safe
    const { data } = await adminDb().storage.from("pages").createSignedUrls(stored.map((p) => p.storage_path), 3600);
    for (const s of data ?? []) if (s.path && s.signedUrl) signed.set(s.path, s.signedUrl);
  }
  return {
    test, className: cls?.name ?? "", isSample: Boolean(cls?.is_sample), scripts,
    current: {
      script,
      results: (results ?? []).map((r) => ({ ...r, max: Number(r.max), ai_score: Number(r.ai_score), score_a: Number(r.score_a), score_b: Number(r.score_b), teacher_score: r.teacher_score === null ? null : Number(r.teacher_score), reference_score: r.reference_score === null ? null : Number(r.reference_score) })),
      pages: (pages ?? []).map((p) => ({ ...p, url: p.storage_path.startsWith("/") ? p.storage_path : signed.get(p.storage_path) ?? "" })),
    },
    commentBank,
    requests: (requests ?? []) as { id: string; q: number; message: string }[],
    track,
  };
}
