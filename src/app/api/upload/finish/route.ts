import { after } from "next/server";
import { z } from "zod";
import { runGradingJob } from "@/lib/jobs/grade";
import { adminDb } from "@/lib/supabase/clients";
import { MAX_PAGES, PAGE_TYPES, testByToken, TokenSchema } from "@/lib/uploads";

export const maxDuration = 300; // grading starts right after the upload, in the background (after())

const Body = z.object({
  token: TokenSchema,
  submissionId: z.uuid(),
  pages: z.array(z.object({
    path: z.string().max(300),
    type: z.enum(PAGE_TYPES),
    width: z.number().int().positive().max(20000).nullable(),
    height: z.number().int().positive().max(20000).nullable(),
  })).min(1).max(MAX_PAGES),
});

const fail = (status: number, message: string) => Response.json({ error: message }, { status });

/** Step 2 of a student upload: confirm every page really arrived, record it, and start marking in the background. */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "Something about this upload isn't right. Reload the page and try again.");
  const { token, submissionId, pages } = parsed.data;
  const test = await testByToken(token);
  if (!test) return fail(404, "This upload link doesn't work. Ask your teacher for the current link.");

  const db = adminDb();
  const { data: sub } = await db.from("submissions").select("id,status").eq("id", submissionId).eq("test_id", test.id).maybeSingle<{ id: string; status: string }>();
  if (!sub) return fail(404, "This upload has expired. Start again.");
  if (sub.status !== "uploaded") return fail(409, "These pages were already sent.");

  const folder = `${test.class_id}/${test.id}/${submissionId}`;
  const { data: files } = await db.storage.from("pages").list(folder, { limit: 100 });
  const present = new Set((files ?? []).map((f) => `${folder}/${f.name}`));
  for (const p of pages) {
    if (!p.path.startsWith(`${folder}/`) || p.path.includes("..")) return fail(400, "Something about this upload isn't right. Start again.");
    if (!present.has(p.path)) return fail(400, "Some pages didn't finish uploading. Check your connection and send them again.");
  }

  const { error } = await db.from("pages").insert(pages.map((p, i) => ({
    submission_id: submissionId, page_no: i + 1, storage_path: p.path, media_type: p.type, width: p.width, height: p.height,
  })));
  if (error) return fail(500, "Couldn't save your pages. Try again.");
  await db.from("submissions").update({ status: "queued" }).eq("id", submissionId);

  after(() => runGradingJob(submissionId).then(() => undefined, () => undefined));
  return Response.json({ ok: true });
}
