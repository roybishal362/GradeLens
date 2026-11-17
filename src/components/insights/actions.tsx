"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { buildMisconceptionMap, buildReteach, createRetest } from "@/app/app/insight-actions";

type Kind = "map" | "reteach" | "retest";

/** The AI steps on the insights page. In the sample class they are shown but explain they need an account. */
export function InsightButton({ kind, testId, clusterId, reteachId, sample, label, primary }: {
  kind: Kind; testId: string; clusterId?: string; reteachId?: string; sample?: boolean; label: string; primary?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const cls = primary
    ? "rounded-md bg-redpen px-4 py-2 font-semibold text-white hover:bg-[#b81f1f] disabled:opacity-50"
    : "rounded-md border border-ink/25 bg-white px-3 py-1.5 text-[0.95rem] font-semibold hover:bg-secondary disabled:opacity-50";
  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        className={cls}
        onClick={() => {
          if (sample) { setMsg("This is the sample class. Sign in to run this on your own class."); return; }
          setMsg(null);
          start(async () => {
            const r = kind === "map" ? await buildMisconceptionMap(testId)
              : kind === "reteach" ? await buildReteach(testId, clusterId!)
              : await createRetest(testId, reteachId!);
            if (r && !r.ok) setMsg(r.error);
            else router.refresh();
          });
        }}
      >
        {pending ? (kind === "map" ? "Reading the class's mistakes…" : kind === "reteach" ? "Planning…" : "Creating the re-test…") : label}
      </button>
      {msg && <span role="status" className="text-[0.9rem] text-muted-foreground">{msg}</span>}
    </span>
  );
}
