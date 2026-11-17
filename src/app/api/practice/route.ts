import { z } from "zod";
import { gradePractice, practiceTest } from "@/lib/practice";
import { adminDb } from "@/lib/supabase/clients";
import { underLimit, visitorKey } from "@/lib/uploads";

export const maxDuration = 300;

const Body = z.object({
  token: z.string().regex(/^[0-9a-f]{32}$/),
  studentId: z.uuid().nullable().optional(),
  typed: z.array(z.object({ q: z.number().int().min(1), text: z.string().max(4000) })).max(80).optional(),
  pages: z.array(z.object({ type: z.enum(["image/jpeg", "image/png", "image/webp"]), base64: z.string().max(1_400_000) })).max(3).optional(), // stays under the 4.5 MB request limit
}).refine((b) => Boolean(b.typed?.length) !== Boolean(b.pages?.length), "send typed answers or photos");

const fail = (status: number, error: string) => Response.json({ error }, { status });

/** Instant practice feedback (doesn't count as a grade). Limited per device, per test and overall to protect the free quota. */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "Answer at least one question (or add a photo), then try again.");
  const { token, typed, pages } = parsed.data;
  const test = await practiceTest(token);
  if (!test) return fail(404, "This practice link doesn't work. Ask your teacher for the current one.");
  if (!test.open && !test.isSample) return fail(403, "Your teacher has closed practice for this test.");
  if (typed && !typed.some((a) => a.text.trim())) return fail(400, "Answer at least one question first.");

  let studentId = parsed.data.studentId ?? null;
  if (studentId) {
    const { data } = await adminDb().from("students").select("id").eq("id", studentId).eq("class_id", test.classId).maybeSingle();
    if (!data) studentId = null;
  }
  const visitor = visitorKey(req);
  const perDevice = test.isSample ? 6 : 15;
  if (!(await underLimit(`practice:visitor:${visitor}`, perDevice)) || !(await underLimit(`practice:test:${test.id}`, test.isSample ? 150 : 300)) || !(await underLimit("practice:all", 400))) {
    return fail(429, "That's the most practice the free AI service allows for today. Try again tomorrow.");
  }
  try {
    const result = await gradePractice({
      test, studentId,
      typed: typed?.map((a) => ({ q: a.q, text: a.text })),
      pages: pages?.map((p) => ({ data: new Uint8Array(Buffer.from(p.base64, "base64")), mediaType: p.type })),
    });
    if (!result.feedback.length) return fail(400, pages ? "No answers could be read in those photos. Try a clearer photo, or type your answers." : "Answer at least one question first.");
    return Response.json(result);
  } catch (e) {
    console.error("practice marking failed:", e instanceof Error ? e.message.slice(0, 500) : e);
    const busy = /All free models failed|Out of time/.test(String(e));
    return fail(503, busy ? "The free AI service is busy right now. Wait a minute and try again." : "Something went wrong while marking. Try again.");
  }
}
