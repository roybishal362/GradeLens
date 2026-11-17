import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { adminDb } from "@/lib/supabase/clients";

export const MAX_PAGES = 12;
export const MAX_PAGE_BYTES = 10 * 1024 * 1024;
export const PAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
const EXT: Record<(typeof PAGE_TYPES)[number], string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

export const TokenSchema = z.string().regex(/^[0-9a-f]{32}$/, "invalid link");

export type UploadTest = {
  id: string; class_id: string; title: string; uploads_open: boolean; rubric_status: string;
  classes: { name: string; is_sample: boolean };
};

/** The test an upload link belongs to (the token is the only credential a student has). */
export async function testByToken(token: string): Promise<UploadTest | null> {
  if (!TokenSchema.safeParse(token).success) return null;
  const { data } = await adminDb()
    .from("tests")
    .select("id,class_id,title,uploads_open,rubric_status,upload_token,classes!inner(name,is_sample)")
    .eq("upload_token", token)
    .maybeSingle<UploadTest & { upload_token: string }>();
  if (!data || !safeEqual(data.upload_token, token) || data.classes.is_sample) return null;
  const { upload_token: _omit, ...test } = data;
  void _omit;
  return test;
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Visitor fingerprint for rate limits: a salted hash, never the raw IP address. */
export function visitorKey(req: Request): string {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
  return createHash("sha256").update(`${process.env.SUPABASE_SECRET_KEY?.slice(-12) ?? "gl"}:${ip}`).digest("hex").slice(0, 24);
}

export async function underLimit(bucket: string, limit: number): Promise<boolean> {
  const { data, error } = await adminDb().rpc("bump_usage", { b: bucket, lim: limit });
  return !error && data === true;
}

export function pagePath(classId: string, testId: string, submissionId: string, pageNo: number, type: (typeof PAGE_TYPES)[number]) {
  const rand = createHash("sha256").update(`${submissionId}:${pageNo}:${Date.now()}:${Math.random()}`).digest("hex").slice(0, 10);
  return `${classId}/${testId}/${submissionId}/${pageNo}-${rand}.${EXT[type]}`;
}

/** Remove a script's page files and rows (re-upload or clean-up). */
export async function removePages(submissionId: string) {
  const db = adminDb();
  const { data } = await db.from("pages").select("storage_path").eq("submission_id", submissionId);
  const paths = (data ?? []).map((p: { storage_path: string }) => p.storage_path).filter((p) => !p.startsWith("/"));
  if (paths.length) await db.storage.from("pages").remove(paths);
  await db.from("pages").delete().eq("submission_id", submissionId);
}
