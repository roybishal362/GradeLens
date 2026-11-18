import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase/clients";
import { signInAsGuest, signInWithGoogle } from "./actions";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  google: "Google sign-in isn't available right now. Try again, or continue as a guest.",
  guest: "Guest sign-in isn't available right now. Please try again in a minute.",
  callback: "That sign-in link didn't work (it may have expired). Please try again.",
};

/** Offer Google only when it is really switched on, so nobody meets a button that fails. */
async function googleEnabled() {
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_PUBLISHABLE_KEY }, cache: "no-store" });
    return r.ok && Boolean(((await r.json()) as { external?: { google?: boolean } }).external?.google);
  } catch {
    return false;
  }
}

export default function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 py-16">
      <Link href="/" className="text-xl font-[750] tracking-tight">GradeLens</Link>
      <h1 className="mt-8 text-[1.95rem] font-[750] leading-tight tracking-tight">Sign in to mark your class</h1>
      <p className="mt-3 text-muted-foreground">
        Your classes, scans and marks are private to your account.
      </p>
      <Suspense fallback={<div className="mt-8 h-48" />}>
        <SignInForms searchParams={searchParams} />
      </Suspense>
      <p className="mt-10 text-[0.95rem] text-muted-foreground">
        Just looking? <Link href="/sample" className="font-semibold text-ink underline underline-offset-4">Open the sample class</Link>{" "}
        to see real marked scripts without signing in.
      </p>
    </main>
  );
}

async function SignInForms({ searchParams }: { searchParams: PageProps<"/sign-in">["searchParams"] }) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/app";
  const error = typeof sp.error === "string" ? ERRORS[sp.error] : undefined;
  const google = await googleEnabled();
  return (
    <div className="mt-8 space-y-6">
      {error && (
        <p role="alert" className="rounded-md border border-flag/40 bg-flag/5 px-4 py-3 text-[0.95rem]">{error}</p>
      )}
      {google && (
        <form action={signInWithGoogle}>
          <input type="hidden" name="next" value={next} />
          <button className="w-full rounded-md bg-redpen px-5 py-3 font-semibold text-white shadow-sm hover:bg-[#b81f1f]">
            Continue with Google
          </button>
        </form>
      )}
      <div className={google ? "margin-rule pl-4" : ""}>
        <form action={signInAsGuest}>
          <input type="hidden" name="next" value={next} />
          <button className={google ? "w-full rounded-md border border-ink/25 bg-white px-5 py-3 font-semibold hover:bg-secondary" : "w-full rounded-md bg-redpen px-5 py-3 font-semibold text-white shadow-sm hover:bg-[#b81f1f]"}>
            Try it as a guest
          </button>
        </form>
        <p className="mt-2 text-[0.9rem] text-muted-foreground">
          No sign-up. A guest workspace is deleted after 7 days.
        </p>
      </div>
    </div>
  );
}
