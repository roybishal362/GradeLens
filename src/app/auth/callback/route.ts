import { NextResponse, type NextRequest } from "next/server";
import { userDb } from "@/lib/supabase/clients";

/** Google sends the teacher back here with a one-time code; swap it for a session cookie. */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const rawNext = url.searchParams.get("next") ?? "/app";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") && !rawNext.startsWith("/\\") ? rawNext : "/app";
  if (code) {
    const db = await userDb();
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }
  return NextResponse.redirect(new URL(`/sign-in?error=callback&next=${encodeURIComponent(next)}`, url.origin));
}
