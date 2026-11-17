import { after } from "next/server";
import { z } from "zod";
import { runGradingJob } from "@/lib/jobs/grade";
import { adminDb, userDb } from "@/lib/supabase/clients";

export const maxDuration = 300; // one script = 1 reading + 2 gradings; the job keeps a 270 s budget

const Body = z.object({ submissionId: z.uuid(), regrade: z.boolean().optional(), retry: z.boolean().optional() });

/**
 * Start (or retry, or re-grade) marking one script, for its teacher. Returns at once; the job runs in the background
 * and the teacher's page follows its status. The database claim makes duplicate calls harmless.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad request" }, { status: 400 });
  const db = await userDb();
  const { data: claims } = await db.auth.getClaims();
  if (!claims?.claims?.sub) return Response.json({ error: "Sign in first." }, { status: 401 });
  // Row Level Security: this only finds the script if the signed-in teacher owns its class.
  const { data: sub } = await db.from("submissions").select("id,status").eq("id", parsed.data.submissionId).maybeSingle<{ id: string; status: string }>();
  if (!sub) return Response.json({ error: "Not found." }, { status: 404 });
  // The teacher asked explicitly: re-open a finished or failed script and reset its automatic-retry counter.
  // Ownership was proven above; status changes are server-only (see migration 0003), hence the admin client.
  if ((parsed.data.regrade || parsed.data.retry) && ["graded", "failed", "queued"].includes(sub.status)) {
    await adminDb().from("submissions").update({ status: "queued", attempts: 0 }).eq("id", sub.id).in("status", ["graded", "failed", "queued"]);
  }
  after(() => runGradingJob(parsed.data.submissionId, { regrade: parsed.data.regrade }).then(() => undefined, () => undefined));
  return Response.json({ accepted: true }, { status: 202 });
}
