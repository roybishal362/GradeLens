"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { preparePage, readQr, redactHeader, type PreparedPage } from "@/lib/images";
import { groupScans, parseSheet, type ScanResult } from "@/lib/sheets";
import { browserDb } from "@/lib/supabase/browser";

type Student = { id: string; name: string; code: string };
type Photo = PreparedPage & { qr: string | null; redacted: boolean };

export function Scanner({ testId, token, students }: { testId: string; token: string; students: Student[] }) {
  const input = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [assign, setAssign] = useState<Record<number, string>>({}); // photo index -> student code (teacher overrides)
  const [sent, setSent] = useState<{ ok: string[]; failed: string[] } | null>(null);
  const byCode = new Map(students.map((s) => [s.code, s]));

  async function read(list: FileList | null) {
    if (!list?.length) return;
    const files = [...list].filter((f) => f.type.startsWith("image/")).slice(0, 400);
    const out: Photo[] = [];
    for (const [i, f] of files.entries()) {
      setProgress(`Reading QR codes: photo ${i + 1} of ${files.length}…`);
      try {
        const page = await preparePage(f);
        const hit = await readQr(page.file);
        // a GradeLens sheet: blank out the printed name before anything is uploaded
        const ours = hit && parseSheet(hit.data) ? await redactHeader(page, hit) : page;
        out.push({ ...ours, qr: hit?.data ?? null, redacted: Boolean(hit && parseSheet(hit.data)) });
      } catch { /* unreadable image: skipped */ }
    }
    setProgress(null);
    setPhotos(out);
    setAssign({});
    setSent(null);
    setResult(groupScans(out.map((p, index) => ({ index, qr: parseSheet(p.qr) })), testId));
  }

  // the final grouping: QR result + teacher overrides
  const groups = (() => {
    if (!result) return [];
    const m = new Map<string, number[]>();
    for (const g of result.groups) for (const p of g.pages) if (!(p.index in assign)) m.set(g.code, [...(m.get(g.code) ?? []), p.index]);
    for (const [idx, code] of Object.entries(assign)) if (code) m.set(code, [...(m.get(code) ?? []), Number(idx)]);
    return [...m].filter(([code]) => byCode.has(code)).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
  })();
  const unknownCodes = result?.groups.filter((g) => !byCode.has(g.code)).map((g) => g.code) ?? [];
  const leftover = photos.map((_, i) => i).filter((i) => !groups.some(([, idx]) => idx.includes(i)));

  async function send() {
    const ok: string[] = [], failed: string[] = [];
    const storage = browserDb().storage.from("pages");
    for (const [n, [code, idx]] of groups.entries()) {
      const st = byCode.get(code)!;
      setProgress(`Uploading ${st.name} (${n + 1} of ${groups.length})…`);
      try {
        const pages = idx.map((i) => photos[i]);
        const s = await fetch("/api/upload/start", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, studentId: st.id, source: "scan", pages: pages.map((p) => ({ type: p.type, size: p.file.size })) }) });
        const sj = await s.json();
        if (!s.ok) throw new Error(sj.error);
        for (const [i, p] of pages.entries()) {
          const { error } = await storage.uploadToSignedUrl(sj.uploads[i].path, sj.uploads[i].token, p.file, { contentType: p.type });
          if (error) throw new Error("upload failed");
        }
        const f = await fetch("/api/upload/finish", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, submissionId: sj.submissionId, pages: pages.map((p, i) => ({ path: sj.uploads[i].path, type: p.type, width: p.width, height: p.height })) }) });
        if (!f.ok) throw new Error((await f.json()).error);
        ok.push(st.name);
      } catch (e) {
        failed.push(`${st.name}: ${e instanceof Error ? e.message : "failed"}`);
      }
    }
    setProgress(null);
    setSent({ ok, failed });
  }

  if (sent) {
    return (
      <div className="mt-8 margin-rule pl-4" role="status">
        <p className="text-lg font-semibold text-ok">✓ {sent.ok.length} script{sent.ok.length === 1 ? "" : "s"} uploaded. Marking has started.</p>
        {sent.failed.length > 0 && <ul className="mt-2 list-disc pl-5 text-flag">{sent.failed.map((f) => <li key={f}>{f}</li>)}</ul>}
        <Link href={`/app/tests/${testId}`} className="mt-3 inline-block font-semibold underline underline-offset-4">Follow the marking</Link>
      </div>
    );
  }

  return (
    <div className="mt-8 space-y-6">
      <div>
        <button type="button" disabled={!!progress} onClick={() => input.current?.click()} className="rounded-md bg-redpen px-5 py-3 font-semibold text-white hover:bg-[#b81f1f] disabled:opacity-50">
          {photos.length ? "Choose different photos" : "Choose the photos"}
        </button>
        <input ref={input} type="file" accept="image/*" multiple className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { void read(e.target.files); e.target.value = ""; }} />
        {progress && <p role="status" aria-live="polite" className="mt-2 text-muted-foreground">{progress}</p>}
      </div>

      {result && !progress && (
        <>
          <p className="font-semibold">
            {photos.length} photo{photos.length === 1 ? "" : "s"} → {groups.length} student{groups.length === 1 ? "" : "s"}
            {leftover.length ? `, ${leftover.length} not assigned` : ""}
          </p>
          <p className="text-[0.95rem] text-muted-foreground">
            The printed names on {photos.filter((p) => p.redacted).length} sheet{photos.filter((p) => p.redacted).length === 1 ? "" : "s"} were blanked out on this
            device: the AI that reads the answers never sees them.
          </p>
          {(result.problems.length > 0 || unknownCodes.length > 0) && (
            <ul className="list-disc space-y-0.5 rounded-md border border-check/40 bg-check/5 py-3 pl-8 pr-4 text-[0.95rem]">
              {result.problems.map((p) => <li key={p}>{p}</li>)}
              {unknownCodes.map((c) => <li key={c}>Sheets for {c} were found, but no student in this class has that code.</li>)}
            </ul>
          )}

          <ul className="space-y-4">
            {groups.map(([code, idx]) => (
              <li key={code} className="rounded-md border border-ruling bg-white p-3">
                <p className="font-semibold">{byCode.get(code)!.name} <span className="text-[0.9rem] font-normal text-muted-foreground">{code} · {idx.length} page{idx.length === 1 ? "" : "s"}</span></p>
                <ol className="mt-2 flex flex-wrap gap-2">
                  {idx.map((i) => <Thumb key={i} photo={photos[i]} index={i} students={students} value={assign[i] ?? code} onChange={(c) => setAssign((a) => ({ ...a, [i]: c }))} />)}
                </ol>
              </li>
            ))}
          </ul>

          {leftover.length > 0 && (
            <div className="rounded-md border border-ruling bg-white p-3">
              <p className="font-semibold">Not assigned</p>
              <ol className="mt-2 flex flex-wrap gap-2">
                {leftover.map((i) => <Thumb key={i} photo={photos[i]} index={i} students={students} value={assign[i] ?? ""} onChange={(c) => setAssign((a) => ({ ...a, [i]: c }))} />)}
              </ol>
            </div>
          )}

          <button type="button" disabled={!groups.length} onClick={send} className="rounded-md bg-ink px-5 py-3 font-semibold text-white disabled:opacity-40">
            Upload {groups.length} script{groups.length === 1 ? "" : "s"} and start marking
          </button>
          <p className="text-[0.9rem] text-muted-foreground">A student who already has a script for this test gets it replaced, unless you&apos;ve started reviewing it.</p>
        </>
      )}
    </div>
  );
}

function Thumb({ photo, index, students, value, onChange }: { photo: Photo; index: number; students: Student[]; value: string; onChange: (code: string) => void }) {
  return (
    <li className="w-28">
      {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
      <img src={photo.url} alt={`Photo ${index + 1}`} className="aspect-[3/4] w-full rounded-sm border border-ruling object-cover" />
      <span className="mt-0.5 block text-[0.75rem] text-muted-foreground">Photo {index + 1}{photo.qr ? "" : " · no QR"}</span>
      <select aria-label={`Student for photo ${index + 1}`} value={value} onChange={(e) => onChange(e.target.value)} className="mt-0.5 w-full rounded border border-input bg-white px-1 py-0.5 text-[0.8rem]">
        <option value="">Not assigned</option>
        {students.map((s) => <option key={s.id} value={s.code}>{s.name}</option>)}
      </select>
    </li>
  );
}
