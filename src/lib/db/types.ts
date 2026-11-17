import type { GradeResult, ReadAnswer, Rubric } from "@/lib/grading/schemas";

export type Risk = "low" | "medium" | "high";
export type SubmissionStatus = "uploaded" | "queued" | "reading" | "grading" | "graded" | "failed" | "approved";

export type ClassRow = { id: string; owner_id: string; name: string; subject: string | null; is_sample: boolean; created_at: string };
export type TestRow = {
  id: string; class_id: string; title: string; rubric: Rubric; rubric_status: "draft" | "approved";
  uploads_open: boolean; created_at: string; parent_test_id: string | null;
};
export type StudentRow = { id: string; class_id: string; display_name: string; anon_code: string; created_at: string };
export type SubmissionRow = {
  id: string; test_id: string; student_id: string; status: SubmissionStatus; total: number | null; max_total: number | null;
  risk: Risk | null; created_at: string; updated_at: string; source: "upload" | "scan" | "sample"; attempts: number;
  error: string | null; warnings: string[];
};
export type PageRow = {
  id: string; submission_id: string; page_no: number; storage_path: string; media_type: string; width: number | null; height: number | null;
};
export type QuestionResultRow = {
  id: string; submission_id: string; q: number; max: number; score_a: number; score_b: number; ai_score: number; risk: Risk;
  flags: string[]; answer: ReadAnswer | null; grade_a: GradeResult["questions"][number] | null; grade_b: GradeResult["questions"][number] | null;
  teacher_score: number | null; teacher_note: string | null; approved: boolean; approved_at: string | null;
  reference_score: number | null;
};
export type ReviewEventRow = {
  id: string; question_result_id: string; actor_id: string | null; action: "approve" | "adjust" | "bulk_approve" | "unapprove";
  from_score: number | null; to_score: number | null; note: string | null; created_at: string;
};
export type InsightRow = { id: string; test_id: string; kind: "misconceptions" | "reteach" | "retest"; payload: unknown; model: string | null; created_at: string };

// Explicit column lists: never `select *` on tests (the upload token is not readable by API roles; see migration 0002).
export const TEST_COLS = "id,class_id,title,rubric,rubric_status,uploads_open,created_at,parent_test_id";
export const SUB_COLS = "id,test_id,student_id,status,total,max_total,risk,created_at,updated_at,source,attempts,error,warnings";
export const QR_COLS =
  "id,submission_id,q,max,score_a,score_b,ai_score,risk,flags,answer,grade_a,grade_b,teacher_score,teacher_note,approved,approved_at,reference_score";

/** The mark that counts: the teacher's when they set one, otherwise the AI suggestion. */
export const markOf = (r: Pick<QuestionResultRow, "teacher_score" | "ai_score">) => Number(r.teacher_score ?? r.ai_score);
