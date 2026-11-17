"use client";

import { Check, Copy, Eye, EyeOff, Printer } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { btn } from "@/components/page-header";
import { saveGradeBoundaries, setResultsReleased } from "@/app/app/actions";

/** Releasing results: students open a private link (or scan the QR on a printed slip) to see marks and feedback. */
export function ResultsPanel({ testId, released, notReady, links }: {
  testId: string; released: boolean; notReady: number; links: { name: string; url: string }[];
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-3">
      <p className="flex items-center gap-2 font-semibold">
        {released ? <><Eye aria-hidden className="size-4 text-ok" /> Released to students</> : <><EyeOff aria-hidden className="size-4 text-muted-foreground" /> Not released yet</>}
      </p>
      <p className="text-[0.95rem] text-muted-foreground">
        {released
          ? "Each student sees their approved marks, your notes and their feedback, and can ask you to look at a question again."
          : "Students see nothing until you release. Only fully approved scripts are shown."}
        {notReady > 0 && ` ${notReady} script${notReady === 1 ? " is" : "s are"} not fully approved yet; ${notReady === 1 ? "that student sees" : "those students see"} "not ready".`}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending} className={released ? btn.secondary : btn.primary}
          onClick={() => start(async () => { const r = await setResultsReleased(testId, !released); setMsg(r.ok ? r.message ?? null : r.error); })}>
          {released ? "Hide results" : "Release results"}
        </button>
        {released && links.length > 0 && (
          <>
            <Link href={`/app/tests/${testId}/slips`} className={btn.secondary}><Printer aria-hidden className="size-4" /> Print result slips</Link>
            <button type="button" className={btn.secondary} onClick={async () => {
              await navigator.clipboard.writeText(links.map((l) => `${l.name}\t${l.url}`).join("\n"));
              setCopied(true); setTimeout(() => setCopied(false), 2000);
            }}>
              {copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />} {copied ? "Copied" : "Copy all links"}
            </button>
          </>
        )}
      </div>
      {msg && <p role="status" className="text-[0.95rem]">{msg}</p>}
    </div>
  );
}

const PRESETS: Record<string, { label: string; min: number }[]> = {
  "A–F": [{ label: "A", min: 90 }, { label: "B", min: 80 }, { label: "C", min: 70 }, { label: "D", min: 60 }, { label: "F", min: 0 }],
  "Pass / fail": [{ label: "Pass", min: 50 }, { label: "Fail", min: 0 }],
};

export function GradeBoundaries({ testId, initial }: { testId: string; initial: { label: string; min: number }[] | null }) {
  const [rows, setRows] = useState(initial ?? []);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3">
      <p className="text-[0.95rem] text-muted-foreground">Optional. Shown in exports, reports and to students.</p>
      <div className="flex flex-wrap gap-2 text-[0.9rem]">
        {Object.entries(PRESETS).map(([name, p]) => (
          <button key={name} type="button" onClick={() => setRows(p)} className="rounded-full border border-ruling bg-white px-3 py-1 hover:bg-secondary">Use {name}</button>
        ))}
      </div>
      {rows.length > 0 && (
        <ul className="space-y-1.5">
          {rows.map((r, i) => (
            <li key={i} className="flex items-center gap-2">
              <input aria-label="Grade" value={r.label} maxLength={12} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} className="w-20 rounded-md border border-input bg-white px-2 py-1.5" />
              <span className="text-[0.9rem] text-muted-foreground">from</span>
              <input aria-label="Minimum percent" type="number" min={0} max={100} value={r.min} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, min: Number(e.target.value) } : x)))} className="w-20 rounded-md border border-input bg-white px-2 py-1.5" />
              <span className="text-[0.9rem] text-muted-foreground">%</span>
              <button type="button" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="ml-auto text-[0.9rem] text-muted-foreground underline underline-offset-4 hover:text-flag">Remove</button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setRows((rs) => [...rs, { label: "", min: 0 }])} className={btn.secondary}>Add a grade</button>
        <button type="button" disabled={pending} onClick={() => start(async () => { const r = await saveGradeBoundaries(testId, rows); setMsg(r.ok ? { ok: true, text: r.message ?? "Saved." } : { ok: false, text: r.error }); })} className={btn.primary}>Save</button>
      </div>
      {msg && <p role="status" className={msg.ok ? "text-ok" : "text-flag"}>{msg.text}</p>}
    </div>
  );
}
