"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { requireTeacher } from "@/lib/dal";
import { runGradingJob } from "@/lib/jobs/grade";
import { checkRubric, draftRubric, mcqRubric, parsePaper, QuestionInputSchema, type QuestionInput } from "@/lib/grading/rubric-agent";
import { RubricSchema, type Rubric } from "@/lib/grading/schemas";
import { adminDb, userDb } from "@/lib/supabase/clients";

/** Longest a teacher waits on an AI answer in the mark-scheme screen before seeing "busy, try again". */
const AI_WAIT_MS = 90_000;
import { underLimit } from "@/lib/uploads";

// Every action re-checks the session itself (never trusts the page that called it), and writes through the teacher's
// own client so Row Level Security enforces ownership. The admin client is used only where noted.

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

// ---------------------------------------------------------------- classes and students
export async function createClass(form: FormData) {
  const t = await requireTeacher();
  const name = String(form.get("name") ?? "").trim().slice(0, 120);
  const subject = String(form.get("subject") ?? "").trim().slice(0, 80) || null;
  if (!name) redirect("/app?error=name");
  const db = await userDb();
  if (t.isGuest) {
    const { count } = await db.from("classes").select("id", { count: "exact", head: true });
    if ((count ?? 0) >= 3) redirect("/app?error=guest-classes");
  }
  const { data, error } = await db.from("classes").insert({ name, subject, owner_id: t.id }).select("id").single<{ id: string }>();
  if (error || !data) redirect("/app?error=create");
  redirect(`/app/classes/${data.id}`);
}

const NamesSchema = z.array(z.string().trim().min(1).max(80)).max(200);

export async function addStudents(classId: string, raw: string): Promise<ActionResult> {
  const t = await requireTeacher();
  const names = NamesSchema.safeParse(
    [...new Set(raw.split(/\r?\n|,|;|\t/).map((n) => n.replace(/^\s*\d+[.)]\s*/, "").trim()).filter(Boolean))],
  );
  if (!names.success || !names.data.length) return { ok: false, error: "Type or paste names, one per line (up to 200)." };
  const db = await userDb();
  const { data: existing, error } = await db.from("students").select("display_name,anon_code").eq("class_id", classId);
  if (error) return { ok: false, error: "That class wasn't found." };
  if (t.isGuest && (existing?.length ?? 0) + names.data.length > 40) return { ok: false, error: "Guest classes can have up to 40 students." };
  const have = new Set((existing ?? []).map((s) => s.display_name.toLowerCase()));
  let next = Math.max(0, ...(existing ?? []).map((s) => Number(String(s.anon_code).replace(/\D/g, "")) || 0)) + 1;
  const rows = names.data.filter((n) => !have.has(n.toLowerCase())).map((n) => ({
    class_id: classId, display_name: n, anon_code: `S${String(next++).padStart(2, "0")}`,
  }));
  if (!rows.length) return { ok: true, message: "Those students are already on the list." };
  const { error: insErr } = await db.from("students").insert(rows);
  if (insErr) return { ok: false, error: "Couldn't add those students. Check the names and try again." };
  revalidatePath(`/app/classes/${classId}`);
  return { ok: true, message: `Added ${rows.length} student${rows.length === 1 ? "" : "s"}.` };
}

export async function removeStudent(classId: string, studentId: string): Promise<ActionResult> {
  await requireTeacher();
  const db = await userDb();
  const { error } = await db.from("students").delete().eq("id", studentId).eq("class_id", classId);
  if (error) return { ok: false, error: "Couldn't remove that student." };
  revalidatePath(`/app/classes/${classId}`);
  return { ok: true };
}

// ---------------------------------------------------------------- tests and mark schemes
export async function createTest(classId: string, form: FormData) {
  await requireTeacher();
  const title = String(form.get("title") ?? "").trim().slice(0, 160);
  if (!title) redirect(`/app/classes/${classId}?error=title`);
  const db = await userDb();
  const { data, error } = await db.from("tests").insert({ class_id: classId, title }).select("id").single<{ id: string }>();
  if (error || !data) redirect(`/app/classes/${classId}?error=test`);
  redirect(`/app/tests/${data.id}/mark-scheme`);
}

async function ownedTest(testId: string) {
  const db = await userDb();
  const { data } = await db.from("tests").select("id,class_id,rubric,rubric_status").eq("id", testId).maybeSingle<{ id: string; class_id: string; rubric: Rubric; rubric_status: string }>();
  return { db, test: data };
}

/** Read a pasted question paper + answer key into editable questions. */
export async function readQuestionPaper(testId: string, paper: string, key: string): Promise<{ ok: true; questions: QuestionInput[]; missingMarks: number[] } | { ok: false; error: string }> {
  const t = await requireTeacher();
  const { test } = await ownedTest(testId);
  if (!test) return { ok: false, error: "Test not found." };
  if (paper.trim().length < 10) return { ok: false, error: "Paste the question paper first." };
  if (!(await underLimit(`ai:text:${t.id}`, t.isGuest ? 15 : 60))) return { ok: false, error: "Today's limit for AI drafting is used up. You can still type the questions in." };
  try {
    // a teacher waits on this screen: give up after about 90 s with a clear message instead of trying every free model
    const { questions, missingMarks } = await parsePaper(paper, key, { deadline: Date.now() + AI_WAIT_MS });
    if (!questions.length) return { ok: false, error: "No numbered questions were found. Check the paste, or add questions by hand." };
    return { ok: true, questions, missingMarks };
  } catch {
    return { ok: false, error: "The free AI is busy right now. Try again in a few minutes, or add the questions by hand." };
  }
}

const QuestionsSchema = z.array(QuestionInputSchema).min(1).max(80);

/** Draft the mark scheme: multiple choice by code, everything else by the rubric agent; then checked by code. */
export async function draftMarkScheme(testId: string, input: QuestionInput[]): Promise<{ ok: true; rubric: Rubric; problems: string[] } | { ok: false; error: string }> {
  const t = await requireTeacher();
  const parsed = QuestionsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Every question needs a number, text and marks." };
  if (new Set(parsed.data.map((q) => q.q)).size !== parsed.data.length) return { ok: false, error: "Two questions have the same number." };
  const { db, test } = await ownedTest(testId);
  if (!test) return { ok: false, error: "Test not found." };
  const mcq = parsed.data.filter((q) => q.type === "mcq");
  const bad = mcq.filter((q) => !/^[A-Ea-e]/.test(q.answerKey.trim()));
  if (bad.length) return { ok: false, error: `Multiple-choice question${bad.length > 1 ? "s" : ""} ${bad.map((q) => q.q).join(", ")}: the answer key must start with the correct letter (e.g. "B").` };
  const open = parsed.data.filter((q) => q.type !== "mcq");
  let drafted: Rubric = { questions: [] };
  if (open.length) {
    if (!(await underLimit(`ai:text:${t.id}`, t.isGuest ? 15 : 60))) return { ok: false, error: "Today's limit for AI drafting is used up. Try again tomorrow." };
    try {
      drafted = (await draftRubric(open, { deadline: Date.now() + AI_WAIT_MS })).rubric;
    } catch {
      return { ok: false, error: "The free AI is busy right now. Try again in a few minutes. Nothing you entered was lost." };
    }
  }
  const rubric: Rubric = { questions: [...mcq.map(mcqRubric), ...drafted.questions.filter((r) => open.some((q) => q.q === r.q))].sort((a, b) => a.q - b.q) };
  // keep the teacher's exact question text, marks and type (the agent must not change them)
  for (const r of rubric.questions) {
    const src = parsed.data.find((q) => q.q === r.q)!;
    r.text = src.text; r.marks = src.marks; if (src.type) r.type = src.type;
  }
  const problems = checkRubric(rubric, parsed.data);
  await db.from("tests").update({ rubric, rubric_status: "draft" }).eq("id", testId);
  revalidatePath(`/app/tests/${testId}`);
  return { ok: true, rubric, problems };
}

/** The teacher's edits to the mark scheme. Approving it is a separate, explicit step. */
export async function saveMarkScheme(testId: string, rubric: Rubric): Promise<{ ok: true; problems: string[] } | { ok: false; error: string }> {
  await requireTeacher();
  const parsed = RubricSchema.safeParse(rubric);
  if (!parsed.success) return { ok: false, error: "The mark scheme has a missing or invalid field." };
  const { db, test } = await ownedTest(testId);
  if (!test) return { ok: false, error: "Test not found." };
  const problems = checkRubric(parsed.data, parsed.data.questions.map((q) => ({ q: q.q, text: q.text, marks: q.marks, answerKey: q.modelAnswer })));
  const { error } = await db.from("tests").update({ rubric: parsed.data, rubric_status: "draft" }).eq("id", testId);
  if (error) return { ok: false, error: "Couldn't save. Try again." };
  revalidatePath(`/app/tests/${testId}`);
  return { ok: true, problems };
}

/** Approve the mark scheme: grading can start, and scripts that were waiting for it start now. */
export async function approveMarkScheme(testId: string): Promise<ActionResult> {
  await requireTeacher();
  const { db, test } = await ownedTest(testId);
  if (!test) return { ok: false, error: "Test not found." };
  if (!test.rubric.questions.length) return { ok: false, error: "Add questions first." };
  const problems = checkRubric(test.rubric, test.rubric.questions.map((q) => ({ q: q.q, text: q.text, marks: q.marks, answerKey: q.modelAnswer })));
  if (problems.length) return { ok: false, error: `Fix these first: ${problems.join("; ")}` };
  const { error } = await db.from("tests").update({ rubric_status: "approved" }).eq("id", testId);
  if (error) return { ok: false, error: "Couldn't approve. Try again." };
  const { data: waiting } = await db.from("submissions").select("id").eq("test_id", testId).in("status", ["queued", "uploaded"]);
  if (waiting?.length) after(async () => { for (const s of waiting) await runGradingJob(s.id).catch(() => undefined); });
  revalidatePath(`/app/tests/${testId}`);
  return { ok: true, message: waiting?.length ? `Approved. Marking ${waiting.length} waiting script${waiting.length === 1 ? "" : "s"} now.` : "Approved." };
}

export async function reopenMarkScheme(testId: string): Promise<ActionResult> {
  await requireTeacher();
  const { db, test } = await ownedTest(testId);
  if (!test) return { ok: false, error: "Test not found." };
  await db.from("tests").update({ rubric_status: "draft" }).eq("id", testId);
  revalidatePath(`/app/tests/${testId}`);
  return { ok: true };
}

export async function setUploadsOpen(testId: string, open: boolean): Promise<ActionResult> {
  await requireTeacher();
  const { db, test } = await ownedTest(testId);
  if (!test) return { ok: false, error: "Test not found." };
  await db.from("tests").update({ uploads_open: open }).eq("id", testId);
  revalidatePath(`/app/tests/${testId}`);
  return { ok: true };
}

/** A fresh upload link (the old one stops working), e.g. if it was shared outside the class. */
export async function rotateUploadLink(testId: string): Promise<ActionResult> {
  await requireTeacher();
  const { test } = await ownedTest(testId); // ownership via RLS
  if (!test) return { ok: false, error: "Test not found." };
  const token = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  await adminDb().from("tests").update({ upload_token: token }).eq("id", testId); // the token column is server-only
  revalidatePath(`/app/tests/${testId}`);
  return { ok: true, message: "New link created. The old link no longer works." };
}

export async function deleteSubmission(testId: string, submissionId: string): Promise<ActionResult> {
  await requireTeacher();
  const db = await userDb();
  const { data } = await db.from("submissions").select("id").eq("id", submissionId).eq("test_id", testId).maybeSingle();
  if (!data) return { ok: false, error: "Not found." };
  const { removePages } = await import("@/lib/uploads");
  await removePages(submissionId);
  await db.from("submissions").delete().eq("id", submissionId);
  revalidatePath(`/app/tests/${testId}`);
  return { ok: true };
}

/** Delete a class with everything in it: students, tests, scripts, marks, audit history and the scanned pages. */
export async function deleteClass(classId: string, confirmName: string): Promise<ActionResult> {
  await requireTeacher();
  const db = await userDb();
  const { data: cls } = await db.from("classes").select("id,name").eq("id", classId).maybeSingle<{ id: string; name: string }>();
  if (!cls) return { ok: false, error: "Class not found." };
  if (confirmName.trim() !== cls.name) return { ok: false, error: "Type the class name exactly to confirm." };
  // files first (server key, after the ownership check above), then the rows (cascade)
  const storage = adminDb().storage.from("pages");
  const walk = async (prefix: string): Promise<void> => {
    const { data } = await storage.list(prefix, { limit: 1000 });
    const files: string[] = [];
    for (const it of data ?? []) {
      if (it.id === null) await walk(`${prefix}/${it.name}`);
      else files.push(`${prefix}/${it.name}`);
    }
    for (let i = 0; i < files.length; i += 100) await storage.remove(files.slice(i, i + 100));
  };
  await walk(classId);
  const { error } = await db.from("classes").delete().eq("id", classId);
  if (error) return { ok: false, error: "Couldn't delete the class. Try again." };
  redirect("/app");
}

// ---------------------------------------------------------------- returning results to students
/** Release (or withdraw) results: students then see their approved marks and feedback on their private page. */
export async function setResultsReleased(testId: string, released: boolean): Promise<ActionResult> {
  await requireTeacher();
  const db = await userDb();
  const { error } = await db.from("tests").update({ results_released: released, released_at: released ? new Date().toISOString() : null }).eq("id", testId);
  if (error) return { ok: false, error: "Couldn't change that. Try again." };
  revalidatePath(`/app/tests/${testId}`);
  return { ok: true, message: released ? "Results released. Students can open their links." : "Results hidden from students again." };
}

/** Optional letter grades for this test (percent thresholds). Empty list = no letter grades. */
export async function saveGradeBoundaries(testId: string, raw: { label: string; min: number }[]): Promise<ActionResult> {
  await requireTeacher();
  const { BoundariesSchema } = await import("@/lib/results");
  const parsed = BoundariesSchema.safeParse(raw.filter((b) => b.label.trim()));
  if (!parsed.success) return { ok: false, error: "Each grade needs a short name and a minimum between 0 and 100, and names must differ." };
  const db = await userDb();
  const { error } = await db.from("tests").update({ grade_boundaries: parsed.data.length ? parsed.data : null }).eq("id", testId);
  if (error) return { ok: false, error: "Couldn't save the grades. Try again." };
  revalidatePath(`/app/tests/${testId}`);
  return { ok: true, message: parsed.data.length ? "Letter grades saved." : "Letter grades removed." };
}

/** Answer a student's re-check request (the mark itself is changed in the review screen, which is audited). */
export async function resolveRequest(requestId: string, response: string): Promise<ActionResult> {
  await requireTeacher();
  const db = await userDb();
  const { data, error } = await db.from("review_requests")
    .update({ status: "resolved", response: response.trim().slice(0, 1000) || null, resolved_at: new Date().toISOString() })
    .eq("id", requestId).select("submission_id").maybeSingle();
  if (error || !data) return { ok: false, error: "Couldn't update that request." };
  revalidatePath("/app");
  return { ok: true };
}

// ---------------------------------------------------------------- settings
export async function saveProfile(input: { displayName: string; school: string }): Promise<ActionResult> {
  const t = await requireTeacher();
  const display_name = String(input?.displayName ?? "").trim().slice(0, 80) || null;
  const school = String(input?.school ?? "").trim().slice(0, 120) || null;
  const db = await userDb();
  const { error } = await db.from("teacher_profiles").upsert({ user_id: t.id, display_name, school, updated_at: new Date().toISOString() });
  if (error) return { ok: false, error: "Couldn't save. Try again." };
  revalidatePath("/app", "layout");
  return { ok: true, message: "Saved." };
}

/** Delete the account and everything in it: every class's scanned pages first, then the account (rows cascade). */
export async function deleteAccount(confirm: string): Promise<ActionResult> {
  const t = await requireTeacher();
  if (confirm.trim().toLowerCase() !== "delete") return { ok: false, error: 'Type "delete" to confirm.' };
  const db = await userDb();
  const { data: classes } = await db.from("classes").select("id").eq("owner_id", t.id);
  const storage = adminDb().storage.from("pages");
  const walk = async (prefix: string): Promise<void> => {
    const { data } = await storage.list(prefix, { limit: 1000 });
    const files: string[] = [];
    for (const it of data ?? []) {
      if (it.id === null) await walk(`${prefix}/${it.name}`);
      else files.push(`${prefix}/${it.name}`);
    }
    for (let i = 0; i < files.length; i += 100) await storage.remove(files.slice(i, i + 100));
  };
  for (const c of classes ?? []) await walk(c.id);
  const { error } = await adminDb().auth.admin.deleteUser(t.id); // after the session check above: only your own account
  if (error) return { ok: false, error: "Couldn't delete the account. Try again." };
  await db.auth.signOut();
  redirect("/?deleted=1");
}

/** Open or close practice for a test (students get instant feedback that doesn't count as a grade). */
export async function setPracticeOpen(testId: string, open: boolean): Promise<ActionResult> {
  await requireTeacher();
  const db = await userDb();
  const { error } = await db.from("tests").update({ practice_open: open }).eq("id", testId);
  if (error) return { ok: false, error: "Couldn't change that. Try again." };
  revalidatePath(`/app/tests/${testId}`);
  return { ok: true };
}

/**
 * Copy the public sample class (20 real exam scripts, already read and marked by GradeLens) into this teacher's own
 * workspace, so they can try everything for real (review, approve, release, gradebook, exports) with no uploads and
 * no AI calls. Page images are the public CC BY files, so nothing is duplicated in storage.
 */
export async function copySampleClass(): Promise<ActionResult> {
  const t = await requireTeacher();
  const db = await userDb();
  if (t.isGuest) {
    const { count } = await db.from("classes").select("id", { count: "exact", head: true });
    if ((count ?? 0) >= 3) return { ok: false, error: "Guest workspaces can have up to 3 classes. Delete one first." };
  }
  if (!(await underLimit(`copy-sample:${t.id}`, 3))) return { ok: false, error: "You've copied the sample class 3 times today. Try again tomorrow." };
  const admin = adminDb();
  const { data: src } = await admin.from("classes").select("id,name,subject").eq("is_sample", true).limit(1).maybeSingle<{ id: string; name: string; subject: string | null }>();
  if (!src) return { ok: false, error: "The sample class isn't available right now." };
  const [{ data: tests }, { data: students }] = await Promise.all([
    admin.from("tests").select("id,title,rubric").eq("class_id", src.id),
    admin.from("students").select("id,display_name,anon_code").eq("class_id", src.id),
  ]);
  const { data: cls, error: e1 } = await admin.from("classes")
    .insert({ owner_id: t.id, name: "Data Science (copy of the sample class)", subject: src.subject }).select("id").single<{ id: string }>();
  if (e1 || !cls) return { ok: false, error: "Couldn't copy the sample class. Try again." };
  try {
    const { data: newStudents } = await admin.from("students")
      .insert((students ?? []).map((s: { display_name: string; anon_code: string }) => ({ class_id: cls.id, display_name: s.display_name, anon_code: s.anon_code })))
      .select("id,anon_code");
    const studentMap = new Map((students ?? []).map((s: { id: string; anon_code: string }) => [s.id, (newStudents ?? []).find((n: { anon_code: string }) => n.anon_code === s.anon_code)?.id]));
    let firstTest = "";
    for (const test of (tests ?? []) as { id: string; title: string; rubric: Rubric }[]) {
      const { data: nt } = await admin.from("tests").insert({ class_id: cls.id, title: test.title, rubric: test.rubric, rubric_status: "approved", uploads_open: false }).select("id").single<{ id: string }>();
      if (!nt) throw new Error("test");
      firstTest ||= nt.id;
      const { data: subs } = await admin.from("submissions").select("id,student_id,status,total,max_total,risk,warnings").eq("test_id", test.id);
      for (const s of (subs ?? []) as { id: string; student_id: string; status: string; total: number; max_total: number; risk: string; warnings: string[] }[]) {
        const studentId = studentMap.get(s.student_id);
        if (!studentId) continue;
        const { data: ns } = await admin.from("submissions")
          .insert({ test_id: nt.id, student_id: studentId, status: s.status, total: s.total, max_total: s.max_total, risk: s.risk, warnings: s.warnings, source: "sample" })
          .select("id").single<{ id: string }>();
        if (!ns) throw new Error("submission");
        const [{ data: pages }, { data: qrs }] = await Promise.all([
          admin.from("pages").select("page_no,storage_path,media_type,width,height").eq("submission_id", s.id),
          admin.from("question_results").select("q,max,score_a,score_b,ai_score,risk,flags,answer,grade_a,grade_b,teacher_score,teacher_note,approved,approved_at,reference_score,learned").eq("submission_id", s.id),
        ]);
        if (pages?.length) await admin.from("pages").insert(pages.map((p) => ({ ...p, submission_id: ns.id })));
        if (qrs?.length) await admin.from("question_results").insert(qrs.map((r) => ({ ...r, submission_id: ns.id })));
      }
      const { data: ins } = await admin.from("insights").select("kind,payload,model").eq("test_id", test.id);
      if (ins?.length) await admin.from("insights").insert(ins.map((i) => ({ ...i, test_id: nt.id })));
    }
    revalidatePath("/app", "layout");
    redirect(`/app/tests/${firstTest}`);
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e) throw e; // let the redirect through
    await admin.from("classes").delete().eq("id", cls.id); // no half-copied class left behind
    return { ok: false, error: "Couldn't copy the sample class. Try again." };
  }
}
