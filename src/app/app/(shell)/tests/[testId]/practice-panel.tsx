"use client";

import { Check, Copy } from "lucide-react";
import { useState, useTransition } from "react";
import { setPracticeOpen } from "@/app/app/actions";
import { btn } from "@/components/page-header";

export function PracticePanel({ testId, open, url, qrSvg, schemeApproved, stats }: {
  testId: string; open: boolean; url: string; qrSvg: string; schemeApproved: boolean;
  stats: { attempts: number; average: number | null; topMisconceptions: { text: string; n: number }[]; recent: { who: string; score: string; when: string }[] };
}) {
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-3">
      <p className="text-[0.95rem] text-muted-foreground">
        Students answer the questions and get instant feedback that doesn&apos;t count as a grade. Good for homework, revision and re-tests.
      </p>
      {!schemeApproved && <p className="text-[0.95rem] text-check">Approve the mark scheme first.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={pending || !schemeApproved} className={open ? btn.secondary : btn.primary}
          onClick={() => start(async () => { await setPracticeOpen(testId, !open); })}>
          {open ? "Close practice" : "Open practice"}
        </button>
        {open && (
          <button type="button" className={btn.secondary} onClick={async () => { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
            {copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />} {copied ? "Copied" : "Copy link"}
          </button>
        )}
      </div>
      {open && (
        <div className="flex items-start gap-3">
          <div className="w-28 shrink-0 rounded-md border border-ruling bg-white p-1" aria-label="QR code of the practice link" dangerouslySetInnerHTML={{ __html: qrSvg }} />
          <code className="break-all rounded bg-secondary px-2 py-1 text-[0.8rem]">{url}</code>
        </div>
      )}
      {stats.attempts > 0 && (
        <div className="border-t border-ruling pt-3 text-[0.95rem]">
          <p><span className="font-semibold">{stats.attempts}</span> practice attempt{stats.attempts === 1 ? "" : "s"}{stats.average !== null && <>, average <span className="font-semibold">{Math.round(stats.average)}%</span></>}</p>
          {stats.topMisconceptions.length > 0 && (
            <>
              <p className="mt-2 text-[0.85rem] font-semibold text-muted-foreground">Most common in practice</p>
              <ul className="mt-1 space-y-0.5">{stats.topMisconceptions.map((m) => <li key={m.text}>{m.text} <span className="text-muted-foreground">({m.n})</span></li>)}</ul>
            </>
          )}
          <p className="mt-2 text-[0.85rem] font-semibold text-muted-foreground">Recent</p>
          <ul className="mt-1 space-y-0.5">{stats.recent.map((r, i) => <li key={i} className="flex justify-between gap-2"><span>{r.who}</span><span className="tabular-nums text-muted-foreground">{r.score} · {r.when}</span></li>)}</ul>
        </div>
      )}
    </div>
  );
}
