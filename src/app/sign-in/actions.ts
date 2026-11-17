"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { userDb } from "@/lib/supabase/clients";

/** Only same-site paths: never redirect to another site after sign-in. */
function safeNext(next: FormDataEntryValue | null): string {
  const n = typeof next === "string" ? next : "";
  return n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/\\") ? n : "/app";
}

async function origin(): Promise<string> {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function signInWithGoogle(form: FormData) {
  const next = safeNext(form.get("next"));
  const db = await userDb();
  const { data, error } = await db.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${await origin()}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error || !data.url) redirect(`/sign-in?error=google&next=${encodeURIComponent(next)}`);
  redirect(data.url);
}

export async function signInAsGuest(form: FormData) {
  const next = safeNext(form.get("next"));
  const db = await userDb();
  const { error } = await db.auth.signInAnonymously();
  if (error) redirect(`/sign-in?error=guest&next=${encodeURIComponent(next)}`);
  redirect(next);
}

export async function signOut() {
  const db = await userDb();
  await db.auth.signOut();
  redirect("/");
}
