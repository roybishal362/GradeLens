import "server-only";

import { headers } from "next/headers";
import QRCode from "qrcode";
import { adminDb, userDb } from "@/lib/supabase/clients";

export async function siteOrigin(): Promise<string> {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * The student upload link for a test, for its owner only: ownership is proven through Row Level Security first,
 * then the token (a column API roles can't read) is fetched with the server's key.
 */
export async function uploadLinkFor(testId: string): Promise<{ url: string; qrSvg: string } | null> {
  const db = await userDb();
  const { data: owned } = await db.from("tests").select("id").eq("id", testId).maybeSingle();
  if (!owned) return null;
  const { data } = await adminDb().from("tests").select("upload_token").eq("id", testId).single<{ upload_token: string }>();
  if (!data) return null;
  const url = `${await siteOrigin()}/u/${data.upload_token}`;
  const qrSvg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#1c2541", light: "#ffffff" } });
  return { url, qrSvg };
}
