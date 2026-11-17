import "server-only";

import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { connection } from "next/server";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

/**
 * The signed-in user's client: every query runs under Row Level Security as that user (or as the public role for
 * visitors). Use this for everything a teacher reads or edits.
 */
export async function userDb(): Promise<SupabaseClient> {
  await connection(); // request-time only: the auth client reads the clock (token expiry), which can't be prerendered
  const store = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a Server Component: cookies can't be written here; proxy.ts refreshes the session instead.
        }
      },
    },
  });
}

let anon: SupabaseClient | undefined;
/**
 * A visitor's client with no session at all (public role, under Row Level Security). Only the public sample class is
 * readable this way. It reads no cookies, so pages built with it can be cached.
 */
export function publicDb(): SupabaseClient {
  anon ??= createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  return anon;
}

let admin: SupabaseClient | undefined;
/**
 * The server's own client (secret key, bypasses RLS). ONLY for work no user may do directly: grading jobs, student
 * uploads after the upload token was checked, signed image URLs, usage limits, clean-up. Every caller must check
 * ownership or the upload token first.
 */
export function adminDb(): SupabaseClient {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!SUPABASE_URL || !secret) throw new Error("Supabase is not configured: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY");
  admin ??= createClient(SUPABASE_URL, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}
