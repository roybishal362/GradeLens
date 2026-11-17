import "server-only";

import { redirect } from "next/navigation";
import { userDb } from "@/lib/supabase/clients";

export type Teacher = { id: string; email: string | null; name: string | null; isGuest: boolean };

/** The signed-in teacher, verified from the session's signed JWT, or null for visitors. */
export async function currentTeacher(): Promise<Teacher | null> {
  const db = await userDb();
  const { data } = await db.auth.getClaims();
  const c = data?.claims;
  if (!c?.sub) return null;
  const meta = (c.user_metadata ?? {}) as Record<string, unknown>;
  return {
    id: c.sub,
    email: typeof c.email === "string" && c.email ? c.email : null,
    name: typeof meta.full_name === "string" ? meta.full_name : typeof meta.name === "string" ? meta.name : null,
    isGuest: Boolean(c.is_anonymous),
  };
}

/** For teacher pages and actions: the teacher, or a redirect to sign-in. Every server action calls this itself. */
export async function requireTeacher(next = "/app"): Promise<Teacher> {
  const t = await currentTeacher();
  if (!t) redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  return t;
}
