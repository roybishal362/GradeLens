import { z } from "zod";
import { studentResults } from "@/lib/db/student-results";
import { adminDb } from "@/lib/supabase/clients";
import { underLimit, visitorKey } from "@/lib/uploads";

const Body = z.object({ token: z.string().regex(/^[0-9a-f]{32}$/), q: z.number().int().min(1), message: z.string().trim().min(3).max(1000) });
const fail = (status: number, error: string) => Response.json({ error }, { status });

/** A student asks the teacher to look at one question again (after results were released). */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "Write a short reason (at least a few words).");
  const { token, q, message } = parsed.data;
  const r = await studentResults(token);
  if (r.state !== "ready") return fail(403, "Requests open once your teacher has released your results.");
  if (r.sample) return fail(403, "This is the sample class, so requests are switched off.");
  if (!r.results.some((x) => x.q === q)) return fail(400, "That question isn't on this test.");
  if (r.requests.some((x) => x.q === q && x.status === "open")) return fail(409, "You already asked about this question. Your teacher will reply here.");
  if (!(await underLimit(`request:sub:${r.submissionId}`, 5)) || !(await underLimit(`request:visitor:${visitorKey(req)}`, 20))) {
    return fail(429, "You've sent the most requests allowed today. Talk to your teacher in class.");
  }
  const { error } = await adminDb().from("review_requests").insert({ submission_id: r.submissionId, q, message });
  if (error) return fail(500, "Couldn't send your request. Try again.");
  return Response.json({ ok: true });
}
