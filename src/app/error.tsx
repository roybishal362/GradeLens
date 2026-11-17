"use client";

import Link from "next/link";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-5 py-16">
      <p className="text-lg font-[750] tracking-tight">GradeLens</p>
      <h1 className="mt-6 text-[1.95rem] font-[750] tracking-tight">Something went wrong</h1>
      <p className="mt-2 text-muted-foreground">
        Nothing you approved has been lost: every decision is saved the moment you make it. Try again, and if it keeps happening,
        reload the page.
      </p>
      {error.digest && <p className="mt-2 text-[0.85rem] text-muted-foreground">Reference: {error.digest}</p>}
      <div className="mt-6 flex items-center gap-5">
        <button type="button" onClick={reset} className="rounded-md bg-redpen px-4 py-2 font-semibold text-white hover:bg-[#b81f1f]">Try again</button>
        <Link href="/app" className="font-semibold underline underline-offset-4">Your classes</Link>
      </div>
    </main>
  );
}
