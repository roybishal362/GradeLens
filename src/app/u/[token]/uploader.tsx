"use client";

import { useEffect, useRef, useState } from "react";
import { preparePage, type PreparedPage } from "@/lib/images";
import { browserDb } from "@/lib/supabase/browser";

type Page = PreparedPage;
type Phase = { kind: "edit" } | { kind: "sending"; done: number; total: number } | { kind: "sent" } | { kind: "error"; message: string };

const MAX_PAGES = 12;

export function Uploader({ token, students }: { token: string; students: { id: string; display_name: string }[] }) {
  const [studentId, setStudentId] = useState("");
  const [pages, setPages] = useState<Page[]>([]);
  const [phase, setPhase] = useState<Phase>({ kind: "edit" });
  const [preparing, setPreparing] = useState(false);
  const camera = useRef<HTMLInputElement>(null);
  const files = useRef<HTMLInputElement>(null);

  useEffect(() => () => pages.forEach((p) => p.url && URL.revokeObjectURL(p.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  async function add(list: FileList | null) {
    if (!list?.length) return;
    setPreparing(true);
    const accepted = [...list].filter((f) => f.type.startsWith("image/") || f.type === "application/pdf");
    const out: Page[] = [];
    for (const f of accepted.slice(0, MAX_PAGES - pages.length)) {
      try { out.push(await preparePage(f)); } catch { /* unreadable image: skipped, the count below shows it */ }
    }
    setPages((p) => [...p, ...out]);
    setPreparing(false);
    if (out.length < accepted.length) setPhase({ kind: "error", message: `Some files couldn't be used (only photos or PDFs, at most ${MAX_PAGES} pages).` });
  }

  const move = (i: number, d: -1 | 1) => setPages((p) => {
    const j = i + d;
    if (j < 0 || j >= p.length) return p;
    const n = [...p]; [n[i], n[j]] = [n[j], n[i]]; return n;
  });

  async function send() {
    if (!studentId || !pages.length) return;
    setPhase({ kind: "sending", done: 0, total: pages.length });
    try {
      const start = await fetch("/api/upload/start", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, studentId, pages: pages.map((p) => ({ type: p.type, size: p.file.size })) }),
      });
      const s = await start.json();
      if (!start.ok) throw new Error(s.error ?? "Couldn't start the upload.");
      const storage = browserDb().storage.from("pages");
      for (const [i, p] of pages.entries()) {
        const { error } = await storage.uploadToSignedUrl(s.uploads[i].path, s.uploads[i].token, p.file, { contentType: p.type });
        if (error) throw new Error(`Page ${i + 1} didn't upload. Check your connection and try again.`);
        setPhase({ kind: "sending", done: i + 1, total: pages.length });
      }
      const finish = await fetch("/api/upload/finish", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, submissionId: s.submissionId, pages: pages.map((p, i) => ({ path: s.uploads[i].path, type: p.type, width: p.width, height: p.height })) }),
      });
      const f = await finish.json();
      if (!finish.ok) throw new Error(f.error ?? "Couldn't finish the upload.");
      setPhase({ kind: "sent" });
    } catch (e) {
      setPhase({ kind: "error", message: e instanceof Error ? e.message : "Something went wrong. Try again." });
    }
  }

  if (phase.kind === "sent") {
    const who = students.find((s) => s.id === studentId)?.display_name;
    return (
      <div className="mt-8 margin-rule pl-4" role="status">
        <p className="text-xl font-semibold text-ok">✓ Sent{who ? `, ${who}` : ""}.</p>
        <p className="mt-2">Your teacher has your {pages.length} page{pages.length === 1 ? "" : "s"}. You can close this page.</p>
        <button type="button" className="mt-4 underline underline-offset-4" onClick={() => { setPages([]); setPhase({ kind: "edit" }); }}>
          Sent the wrong pages? Send them again
        </button>
      </div>
    );
  }

  const sending = phase.kind === "sending";
  return (
    <div className="mt-6 space-y-6">
      <label className="grid gap-1.5">
        <span className="font-semibold">1. Your name</span>
        <select value={studentId} onChange={(e) => setStudentId(e.target.value)} disabled={sending} className="rounded-md border border-input bg-white px-3 py-3 text-lg">
          <option value="">Choose your name…</option>
          {students.map((s) => <option key={s.id} value={s.id}>{s.display_name}</option>)}
        </select>
        {!students.length && <span className="text-[0.95rem] text-flag">Your teacher hasn&apos;t added the class list yet.</span>}
      </label>

      <div>
        <p className="font-semibold">2. Photograph every page, in order</p>
        <p className="mt-1 text-[0.95rem] text-muted-foreground">Flat on a table, in good light, the whole page in the picture.</p>
        <p className="mt-1 text-[0.95rem] text-muted-foreground">
          You don&apos;t need to write your name on the pages: you chose it above. An AI service reads your handwriting to suggest
          marks; your teacher checks every mark. <a href="/transparency#privacy" target="_blank" className="underline underline-offset-2">Where your pages go</a>
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <button type="button" disabled={sending || preparing || pages.length >= MAX_PAGES} onClick={() => camera.current?.click()}
            className="rounded-md bg-redpen px-4 py-4 text-lg font-semibold text-white hover:bg-[#b81f1f] disabled:opacity-50">
            Take a photo
          </button>
          <button type="button" disabled={sending || preparing || pages.length >= MAX_PAGES} onClick={() => files.current?.click()}
            className="rounded-md border border-ink/25 bg-white px-4 py-4 text-lg font-semibold hover:bg-secondary disabled:opacity-50">
            Choose files
          </button>
        </div>
        <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden
          onChange={(e) => { void add(e.target.files); e.target.value = ""; }} />
        <input ref={files} type="file" accept="image/*,application/pdf" multiple className="sr-only" tabIndex={-1} aria-hidden
          onChange={(e) => { void add(e.target.files); e.target.value = ""; }} />
        {preparing && <p className="mt-2 text-[0.95rem] text-muted-foreground" role="status">Preparing photos…</p>}
      </div>

      {pages.length > 0 && (
        <ol className="grid grid-cols-3 gap-3" aria-label="Your pages">
          {pages.map((p, i) => (
            <li key={p.id} className="rounded-md border border-ruling bg-white p-1.5">
              {p.url
                // eslint-disable-next-line @next/next/no-img-element -- local preview of an object URL, not a served image
                ? <img src={p.url} alt={`Page ${i + 1}`} className="aspect-[3/4] w-full rounded-sm object-cover" />
                : <div className="grid aspect-[3/4] place-items-center rounded-sm bg-secondary text-[0.85rem]">PDF<br />{p.name.slice(0, 18)}</div>}
              <div className="mt-1 flex items-center justify-between text-[0.85rem]">
                <span className="font-semibold">p. {i + 1}</span>
                <span className="flex gap-1">
                  <button type="button" aria-label={`Move page ${i + 1} earlier`} disabled={sending || i === 0} onClick={() => move(i, -1)} className="px-1.5 disabled:opacity-30">↑</button>
                  <button type="button" aria-label={`Move page ${i + 1} later`} disabled={sending || i === pages.length - 1} onClick={() => move(i, 1)} className="px-1.5 disabled:opacity-30">↓</button>
                  <button type="button" aria-label={`Remove page ${i + 1}`} disabled={sending} onClick={() => setPages((ps) => ps.filter((x) => x.id !== p.id))} className="px-1.5 text-flag">✕</button>
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}

      {phase.kind === "error" && <p role="alert" className="rounded-md border border-flag/40 bg-flag/5 px-4 py-3">{phase.message}</p>}

      <div>
        <p className="font-semibold">3. Send</p>
        <button type="button" disabled={!studentId || !pages.length || sending || preparing} onClick={send}
          className="mt-2 w-full rounded-md bg-ink px-4 py-4 text-lg font-semibold text-white disabled:opacity-40">
          {sending ? `Sending page ${Math.min(phase.done + 1, phase.total)} of ${phase.total}…` : `Send ${pages.length || ""} page${pages.length === 1 ? "" : "s"} to my teacher`}
        </button>
        {(!studentId || !pages.length) && !sending && (
          <p className="mt-2 text-[0.9rem] text-muted-foreground">{!studentId ? "Choose your name first." : "Add at least one page."}</p>
        )}
      </div>
    </div>
  );
}
