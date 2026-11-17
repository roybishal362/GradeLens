import { z } from "zod";
import { adminDb, userDb } from "@/lib/supabase/clients";
import { MAX_PAGE_BYTES, MAX_PAGES, PAGE_TYPES, pagePath, removePages, testByToken, TokenSchema, underLimit, visitorKey } from "@/lib/uploads";

const Body = z.object({
  token: TokenSchema,
  studentId: z.uuid(),
  pages: z.array(z.object({ type: z.enum(PAGE_TYPES), size: z.number().int().positive().max(MAX_PAGE_BYTES) })).min(1).max(MAX_PAGES),
  source: z.enum(["upload", "scan"]).optional(), // "scan" = the teacher uploading a sorted pile (session required)
});

const fail = (status: number, message: string) => Response.json({ error: message }, { status });

/**
 * Step 1 of a student upload: check the link, the student and the limits, then hand out one signed upload URL per
 * page. The browser uploads straight to storage (no size limit on our function), then calls /api/upload/finish.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "Something about this upload isn't right. Reload the page and try again.");
  const { token, studentId, pages } = parsed.data;

  const test = await testByToken(token);
  if (!test) return fail(404, "This upload link doesn't work. Ask your teacher for the current link.");
  // A teacher's scan: proven by their session (Row Level Security only shows the test to its owner).
  let source: "upload" | "scan" = "upload";
  if (parsed.data.source === "scan") {
    const { data: owned } = await (await userDb()).from("tests").select("id").eq("id", test.id).maybeSingle();
    if (!owned) return fail(403, "Sign in as this class's teacher to upload scans.");
    source = "scan";
  }
  if (source === "upload" && !test.uploads_open) return fail(403, "Your teacher has closed uploads for this test.");
  if ((source === "upload" && !(await underLimit(`upload:visitor:${visitorKey(req)}`, 40))) || !(await underLimit(`upload:test:${test.id}`, 400))) {
    return fail(429, "Too many uploads today from this device or for this test. Try again tomorrow, or ask your teacher.");
  }

  const db = adminDb();
  const { data: student } = await db.from("students").select("id").eq("id", studentId).eq("class_id", test.class_id).maybeSingle();
  if (!student) return fail(400, "Pick your name from the list.");

  const { data: existing } = await db.from("submissions").select("id,status").eq("test_id", test.id).eq("student_id", studentId).maybeSingle<{ id: string; status: string }>();
  let submissionId = existing?.id;
  if (existing) {
    if (existing.status === "reading" || existing.status === "grading") return fail(409, "Your pages are being marked right now. Wait a minute before sending them again.");
    const { count } = await db.from("question_results").select("id", { count: "exact", head: true }).eq("submission_id", existing.id).eq("approved", true);
    if (count) return fail(409, "Your teacher has already started marking your script. Ask them if you need to send it again.");
    await removePages(existing.id);
    const folder = `${test.class_id}/${test.id}/${existing.id}`;
    const { data: stray } = await db.storage.from("pages").list(folder, { limit: 100 });
    if (stray?.length) await db.storage.from("pages").remove(stray.map((f) => `${folder}/${f.name}`));
    await db.from("question_results").delete().eq("submission_id", existing.id);
    await db.from("submissions").update({ status: "uploaded", attempts: 0, error: null, warnings: [], total: null, risk: null, source }).eq("id", existing.id);
  } else {
    const { data: created, error } = await db.from("submissions").insert({ test_id: test.id, student_id: studentId, status: "uploaded", source }).select("id").single<{ id: string }>();
    if (error || !created) return fail(500, "Couldn't start the upload. Try again.");
    submissionId = created.id;
  }

  const uploads = [];
  for (const [i, p] of pages.entries()) {
    const path = pagePath(test.class_id, test.id, submissionId!, i + 1, p.type);
    const { data, error } = await db.storage.from("pages").createSignedUploadUrl(path);
    if (error || !data) return fail(500, "Couldn't prepare the upload. Try again.");
    uploads.push({ path, token: data.token });
  }
  return Response.json({ submissionId, uploads });
}
