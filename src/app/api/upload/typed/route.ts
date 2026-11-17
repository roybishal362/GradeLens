import { after } from "next/server";
import { z } from "zod";
import { runGradingJob } from "@/lib/jobs/grade";
import { typedRead } from "@/lib/practice";
import { adminDb } from "@/lib/supabase/clients";
import { removePages, testByToken, TokenSchema, underLimit, visitorKey } from "@/lib/uploads";

export const maxDuration = 300;

const Body = z.object({
  token: TokenSchema,
  studentId: z.uuid(),
  answers: z.array(z.object({ q: z.number().int().min(1), text: z.string().max(4000) })).min(1).max(80),
});
const fail = (status: number, error: string) => Response.json({ error }, { status });

/**
 * A student hands in typed answers instead of photos (no camera, poor light, or an accessibility need). The answers
 * are stored as the script's transcription, so marking skips the reading step; everything else is the same.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "Type at least one answer, then send.");
  const { token, studentId, answers } = parsed.data;
  if (!answers.some((a) => a.text.trim())) return fail(400, "Type at least one answer, then send.");
  const test = await testByToken(token);
  if (!test) return fail(404, "This upload link doesn't work. Ask your teacher for the current link.");
  if (!test.uploads_open) return fail(403, "Your teacher has closed uploads for this test.");
  if (!(await underLimit(`upload:visitor:${visitorKey(req)}`, 40)) || !(await underLimit(`upload:test:${test.id}`, 400))) {
    return fail(429, "Too many uploads today from this device or for this test. Try again tomorrow, or ask your teacher.");
  }
  const db = adminDb();
  const { data: student } = await db.from("students").select("id").eq("id", studentId).eq("class_id", test.class_id).maybeSingle();
  if (!student) return fail(400, "Pick your name from the list.");
  const { data: rubricRow } = await db.from("tests").select("rubric").eq("id", test.id).single<{ rubric: { questions: { q: number }[] } }>();
  const onTest = new Set((rubricRow?.rubric.questions ?? []).map((q) => q.q));
  const clean = answers.filter((a) => onTest.has(a.q) && a.text.trim());

  const { data: existing } = await db.from("submissions").select("id,status").eq("test_id", test.id).eq("student_id", studentId).maybeSingle<{ id: string; status: string }>();
  let submissionId = existing?.id;
  if (existing) {
    if (existing.status === "reading" || existing.status === "grading") return fail(409, "Your answers are being marked right now. Wait a minute before sending them again.");
    const { count } = await db.from("question_results").select("id", { count: "exact", head: true }).eq("submission_id", existing.id).eq("approved", true);
    if (count) return fail(409, "Your teacher has already started marking your script. Ask them if you need to send it again.");
    await removePages(existing.id);
    await db.from("question_results").delete().eq("submission_id", existing.id);
    await db.from("grading_runs").delete().eq("submission_id", existing.id);
    await db.from("submissions").update({ status: "queued", attempts: 0, error: null, warnings: ["Typed answers (no photos)."], total: null, risk: null, source: "upload" }).eq("id", existing.id);
  } else {
    const { data: created, error } = await db.from("submissions")
      .insert({ test_id: test.id, student_id: studentId, status: "queued", source: "upload", warnings: ["Typed answers (no photos)."] })
      .select("id").single<{ id: string }>();
    if (error || !created) return fail(500, "Couldn't save your answers. Try again.");
    submissionId = created.id;
  }
  const read = typedRead(clean);
  const { error } = await db.from("grading_runs").insert({
    submission_id: submissionId, status: "done", read_result: read.output, models: { reader: "typed" },
    started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
  });
  if (error) return fail(500, "Couldn't save your answers. Try again.");
  after(() => runGradingJob(submissionId!).then(() => undefined, () => undefined));
  return Response.json({ ok: true, answered: clean.length });
}
