import { timingSafeEqual } from "node:crypto";
import { adminDb } from "@/lib/supabase/clients";

export const maxDuration = 300;

/** Delete every file under a storage folder (folders are listed level by level). */
async function removeFolder(prefix: string): Promise<number> {
  const storage = adminDb().storage.from("pages");
  let removed = 0;
  const { data: items } = await storage.list(prefix, { limit: 1000 });
  const files: string[] = [];
  for (const it of items ?? []) {
    if (it.id === null) removed += await removeFolder(`${prefix}/${it.name}`); // a sub-folder
    else files.push(`${prefix}/${it.name}`);
  }
  for (let i = 0; i < files.length; i += 100) {
    await storage.remove(files.slice(i, i + 100));
    removed += files.slice(i, i + 100).length;
  }
  return removed;
}

/**
 * Daily clean-up (Vercel Cron): guest workspaces older than 7 days are deleted (their scans first, then the account,
 * which cascades to classes, scripts and marks), and old usage counters are dropped. Called with the CRON_SECRET.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization") ?? "";
  const want = `Bearer ${secret ?? ""}`;
  if (!secret || got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = adminDb();
  const started = Date.now();
  const { data: stale } = await db.rpc("stale_guests");
  let users = 0, files = 0;
  for (const { user_id } of ((stale ?? []) as { user_id: string }[]).slice(0, 200)) {
    if (Date.now() - started > 240_000) break; // leave the rest for tomorrow
    const { data: classes } = await db.from("classes").select("id").eq("owner_id", user_id);
    for (const c of classes ?? []) files += await removeFolder(c.id);
    const { error } = await db.auth.admin.deleteUser(user_id);
    if (!error) users++;
  }
  const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  await db.from("usage_counters").delete().lt("day", cutoff);
  return Response.json({ deletedGuests: users, deletedFiles: files, remaining: Math.max(0, (stale?.length ?? 0) - users) });
}
