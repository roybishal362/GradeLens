"use client";

import { Copy } from "lucide-react";
import { useState, useTransition } from "react";
import { copySampleClass } from "@/app/app/actions";

/** "Mark real scripts in your own workspace": copies the sample class (no uploads, no AI calls). */
export function CopySampleButton({ variant = "secondary", label = "Copy the sample class into my workspace" }: { variant?: "primary" | "secondary"; label?: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const cls = variant === "primary"
    ? "inline-flex items-center gap-2 rounded-md bg-redpen px-4 py-2 font-semibold text-white hover:bg-[#b81f1f] disabled:opacity-50"
    : "inline-flex items-center gap-2 rounded-md border border-ink/20 bg-white px-3.5 py-2 font-semibold hover:bg-secondary disabled:opacity-50";
  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" disabled={pending} className={cls}
        onClick={() => start(async () => { const r = await copySampleClass(); if (r && !r.ok) setError(r.error); })}>
        <Copy aria-hidden className="size-4" /> {pending ? "Copying 20 scripts…" : label}
      </button>
      {error && <span role="status" className="text-[0.9rem] text-flag">{error}</span>}
    </span>
  );
}
