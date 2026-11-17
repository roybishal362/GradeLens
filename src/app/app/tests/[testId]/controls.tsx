"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { deleteSubmission, rotateUploadLink, setUploadsOpen } from "../../actions";

async function startGrading(submissionId: string, opts: { regrade?: boolean; retry?: boolean } = {}) {
  await fetch("/api/grade", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ submissionId, ...opts }) }).catch(() => undefined);
}

/**
 * Follows marking while this page is open: refreshes every few seconds and nudges scripts that are waiting (e.g. if a
 * background job was lost). Each script is nudged at most once per visit; the database claim prevents double work.
 */
export function LiveStatus({ active, canGrade }: { active: { id: string; status: string; error: string | null }[]; canGrade: boolean }) {
  const router = useRouter();
  const nudged = useRef(new Set<string>());
  const n = active.length;

  useEffect(() => {
    if (!n) return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [n, router]);

  useEffect(() => {
    if (!canGrade) return;
    const waiting = active.filter((s) => s.status === "queued" && !/limit|capacity/i.test(s.error ?? "") && !nudged.current.has(s.id));
    let cancelled = false;
    (async () => {
      for (const s of waiting) {
        if (cancelled) return;
        nudged.current.add(s.id);
        await startGrading(s.id);
        await new Promise((r) => setTimeout(r, 4000)); // be gentle with the free models' per-minute limits
      }
    })();
    return () => { cancelled = true; };
  }, [active, canGrade]);

  if (!n) return null;
  return (
    <p role="status" aria-live="polite" className="mt-3 inline-flex items-center gap-2 text-[0.95rem] text-muted-foreground">
      <span aria-hidden className="size-2 animate-pulse rounded-full bg-check" />
      {n} script{n === 1 ? " is" : "s are"} being read and marked. This page updates by itself.
    </p>
  );
}

export function UploadControls({ testId, url, qrSvg, open }: { testId: string; url: string; qrSvg: string; open: boolean }) {
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="mt-4 space-y-4">
      <p className="text-[0.95rem] text-muted-foreground">
        Students open this link on their phone, pick their name and photograph their pages. Show the QR code on the board.
      </p>
      <div className="flex items-start gap-4">
        <div className="w-36 shrink-0 rounded-md border border-ruling bg-white p-1.5" aria-label="QR code of the upload link" dangerouslySetInnerHTML={{ __html: qrSvg }} />
        <div className="min-w-0 space-y-2">
          <code className="block break-all rounded bg-secondary px-2 py-1 text-[0.85rem]">{url}</code>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={async () => { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
              className="rounded-md border border-ink/25 bg-white px-3 py-1.5 text-[0.95rem] font-semibold hover:bg-secondary"
            >
              {copied ? "Copied" : "Copy link"}
            </button>
            <a href={url} target="_blank" rel="noreferrer" className="rounded-md px-1 py-1.5 text-[0.95rem] underline underline-offset-4">Open it</a>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[0.95rem]">
        <span className={open ? "font-semibold text-ok" : "font-semibold text-check"}>{open ? "✓ Uploads open" : "Uploads closed"}</span>
        <button type="button" disabled={pending} className="underline underline-offset-4" onClick={() => start(async () => { await setUploadsOpen(testId, !open); })}>
          {open ? "Close uploads" : "Re-open uploads"}
        </button>
        <button
          type="button"
          disabled={pending}
          className="underline underline-offset-4"
          onClick={() => {
            if (!confirm("Make a new link? The current link and QR code will stop working.")) return;
            start(async () => { const r = await rotateUploadLink(testId); setMsg(r.ok ? r.message ?? null : r.error); });
          }}
        >
          New link
        </button>
      </div>
      {msg && <p role="status" className="text-[0.95rem]">{msg}</p>}
    </div>
  );
}

export function ScriptActions(props: { testId: string; submissionId?: string; status?: string; regradeAll?: string[]; decisions?: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  if (props.regradeAll) {
    const ids = props.regradeAll;
    return (
      <div className="mt-6 margin-rule pl-4">
        <p className="font-semibold">Mark the rest your way</p>
        <p className="text-[0.95rem] text-muted-foreground">
          You&apos;ve made {props.decisions} decisions. GradeLens can re-mark the {ids.length} script{ids.length === 1 ? "" : "s"} you haven&apos;t
          reviewed yet, using your decisions as examples of your standard. It re-uses the handwriting it already read.
        </p>
        <button
          type="button"
          disabled={pending}
          className="mt-2 rounded-md border border-ink/25 bg-white px-4 py-2 font-semibold hover:bg-secondary disabled:opacity-50"
          onClick={() => start(async () => {
            for (const id of ids) { await startGrading(id, { regrade: true }); await new Promise((r) => setTimeout(r, 3000)); }
            setNote("Re-marking started. Marks update as each script finishes.");
            router.refresh();
          })}
        >
          {pending ? "Starting…" : `Re-mark ${ids.length} unreviewed script${ids.length === 1 ? "" : "s"}`}
        </button>
        {note && <p role="status" className="mt-2 text-[0.95rem]">{note}</p>}
      </div>
    );
  }

  const { testId, submissionId, status } = props;
  if (!submissionId) return null;
  return (
    <span className="inline-flex gap-3 text-[0.9rem]">
      {(status === "failed" || status === "queued") && (
        <button type="button" disabled={pending} className="font-semibold underline underline-offset-4"
          onClick={() => start(async () => { await startGrading(submissionId, { retry: true }); router.refresh(); })}>
          {status === "failed" ? "Try again" : "Mark now"}
        </button>
      )}
      <button type="button" disabled={pending} className="text-muted-foreground underline underline-offset-4 hover:text-flag"
        onClick={() => {
          if (!confirm("Delete this script? Its pages and marks are removed; the student can upload again.")) return;
          start(async () => { await deleteSubmission(testId, submissionId); router.refresh(); });
        }}>
        Delete
      </button>
    </span>
  );
}
