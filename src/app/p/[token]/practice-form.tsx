"use client";

import { Camera, CheckCircle2, CircleDashed, PenLine, XCircle } from "lucide-react";
import { useRef, useState } from "react";
import { fmtMark } from "@/components/marks";
import { ReadAloud } from "@/components/read-aloud";
import { preparePage } from "@/lib/images";
import type { PracticeFeedback } from "@/lib/practice";

type Q = { q: number; text: string; marks: number; mcq: boolean };
type Result = { feedback: PracticeFeedback[]; score: number; max: number };

const toBase64 = (b: Blob) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(",")[1] ?? "");
  r.onerror = () => rej(r.error);
  r.readAsDataURL(b);
});

export function PracticeForm({ token, students, questions }: { token: string; students: { id: string; display_name: string }[]; questions: Q[] }) {
  const [mode, setMode] = useState<"typed" | "photo">("typed");
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [studentId, setStudentId] = useState("");
  const [photos, setPhotos] = useState<{ blob: Blob; url: string }[]>([]);
  const [state, setState] = useState<{ kind: "edit" | "marking" | "done" | "error"; text?: string }>({ kind: "edit" });
  const [result, setResult] = useState<Result | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const written = questions.filter((q) => !q.mcq), mcq = questions.filter((q) => q.mcq);
  const answeredCount = Object.values(answers).filter((a) => a.trim()).length;

  async function submit() {
    setState({ kind: "marking" });
    try {
      const body = mode === "typed"
        ? { token, studentId: studentId || null, typed: Object.entries(answers).filter(([, t]) => t.trim()).map(([q, text]) => ({ q: Number(q), text })) }
        : { token, studentId: studentId || null, pages: await Promise.all(photos.map(async (p) => ({ type: "image/jpeg", base64: await toBase64(p.blob) }))) };
      const res = await fetch("/api/practice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) { setState({ kind: "error", text: json.error ?? "Something went wrong. Try again." }); return; }
      setResult(json);
      setState({ kind: "done" });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setState({ kind: "error", text: "Couldn't reach GradeLens. Check your connection and try again." });
    }
  }

  if (state.kind === "done" && result) {
    const spoken = result.feedback.map((f) => `Question ${f.q}: ${fmtMark(f.mark)} out of ${fmtMark(f.max)}. ${f.criteria.filter((c) => c.points < c.max).map((c) => `Missing: ${c.text}.`).join(" ")} ${f.misconceptions.length ? `Watch out: ${f.misconceptions[0]}.` : ""}`).join(" ");
    return (
      <section className="mt-6" aria-live="polite">
        <div className="flex flex-wrap items-end justify-between gap-3 border-y border-ruling py-4">
          <div>
            <p className="text-[0.9rem] text-muted-foreground">Practice feedback</p>
            <p className="mark text-5xl">{fmtMark(result.score)}/{fmtMark(result.max)}</p>
          </div>
          <div className="flex gap-2">
            <ReadAloud text={spoken} label="Read my feedback" />
            <button type="button" onClick={() => setState({ kind: "edit" })} className="rounded-md bg-ink px-4 py-1.5 font-semibold text-white">Edit and try again</button>
          </div>
        </div>
        <ul className="mt-4 space-y-4">
          {result.feedback.map((f) => <FeedbackCard key={f.q} f={f} />)}
        </ul>
        <p className="mt-6 text-[0.85rem] text-muted-foreground">Feedback written by AI from the mark scheme. It can be wrong; ask your teacher if something looks off.</p>
      </section>
    );
  }

  const marking = state.kind === "marking";
  return (
    <div className="mt-6 space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="How to answer" className="inline-flex rounded-md border border-ruling bg-white p-0.5">
          {([["typed", "Type answers", PenLine], ["photo", "Photograph answers", Camera]] as const).map(([m, label, Icon]) => (
            <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
              className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-[0.95rem] font-semibold ${mode === m ? "bg-ink text-white" : "text-ink/80 hover:bg-secondary"}`}>
              <Icon aria-hidden className="size-4" />{label}
            </button>
          ))}
        </div>
        {students.length > 0 && (
          <select value={studentId} onChange={(e) => setStudentId(e.target.value)} aria-label="Your name (optional)" className="rounded-md border border-input bg-white px-3 py-2">
            <option value="">Practise without my name</option>
            {students.map((s) => <option key={s.id} value={s.id}>{s.display_name}</option>)}
          </select>
        )}
      </div>

      {mode === "typed" ? (
        <>
          <ol className="space-y-4">
            {written.map((q) => (
              <li key={q.q} className="rounded-lg border border-ruling bg-white p-4">
                <label className="grid gap-2">
                  <span><span className="font-semibold">Q{q.q}</span> <span className="text-muted-foreground">({fmtMark(q.marks)} mark{q.marks === 1 ? "" : "s"})</span> {q.text}</span>
                  <textarea value={answers[q.q] ?? ""} onChange={(e) => setAnswers((a) => ({ ...a, [q.q]: e.target.value }))} rows={3} maxLength={4000}
                    placeholder="Your answer (leave blank to skip)" className="rounded-md border border-input bg-white px-3 py-2" />
                </label>
              </li>
            ))}
          </ol>
          {mcq.length > 0 && (
            <details className="rounded-lg border border-ruling bg-white p-4">
              <summary className="cursor-pointer font-semibold">Multiple choice ({mcq.length} questions)</summary>
              <ol className="mt-3 space-y-3">
                {mcq.map((q) => (
                  <li key={q.q}>
                    <p className="whitespace-pre-wrap text-[0.95rem]"><span className="font-semibold">Q{q.q}</span> {q.text}</p>
                    <div className="mt-1.5 flex gap-1.5" role="radiogroup" aria-label={`Answer to question ${q.q}`}>
                      {["A", "B", "C", "D"].map((l) => (
                        <button key={l} type="button" role="radio" aria-checked={answers[q.q] === l} onClick={() => setAnswers((a) => ({ ...a, [q.q]: a[q.q] === l ? "" : l }))}
                          className={`size-9 rounded-md border font-semibold ${answers[q.q] === l ? "border-ink bg-ink text-white" : "border-ruling bg-white hover:bg-secondary"}`}>{l}</button>
                      ))}
                    </div>
                  </li>
                ))}
              </ol>
            </details>
          )}
        </>
      ) : (
        <div className="rounded-lg border border-ruling bg-white p-4">
          <p className="text-[0.95rem] text-muted-foreground">Write your answers on paper with the question numbers, then photograph up to 3 pages. Photos are only used to mark this practice and aren&apos;t kept.</p>
          <div className="mt-3 flex flex-wrap gap-3">
            {photos.map((p, i) => (
              <div key={p.url} className="w-24 text-center">
                {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
                <img src={p.url} alt={`Photo ${i + 1}`} className="aspect-[3/4] w-full rounded border border-ruling object-cover" />
                <button type="button" onClick={() => setPhotos((ps) => ps.filter((_, j) => j !== i))} className="mt-1 text-[0.8rem] text-muted-foreground underline">Remove</button>
              </div>
            ))}
            {photos.length < 3 && (
              <button type="button" onClick={() => file.current?.click()} className="grid h-32 w-24 place-items-center rounded border border-dashed border-ink/30 text-[0.85rem] hover:bg-secondary">
                <span><Camera aria-hidden className="mx-auto size-5" />Add a photo</span>
              </button>
            )}
          </div>
          <input ref={file} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden
            onChange={async (e) => {
              const f = e.target.files?.[0]; e.target.value = "";
              if (!f) return;
              const p = await preparePage(f);
              setPhotos((ps) => [...ps, { blob: p.file, url: p.url }].slice(0, 3));
            }} />
        </div>
      )}

      {state.kind === "error" && <p role="alert" className="rounded-md border border-flag/40 bg-flag/5 px-4 py-3">{state.text}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={marking || (mode === "typed" ? answeredCount === 0 : photos.length === 0)} onClick={submit}
          className="rounded-md bg-redpen px-5 py-3 font-semibold text-white hover:bg-[#b81f1f] disabled:opacity-40">
          {marking ? "Marking your answers…" : mode === "typed" ? `Check ${answeredCount || ""} answer${answeredCount === 1 ? "" : "s"}` : "Check my photos"}
        </button>
        {marking && <span role="status" className="text-[0.95rem] text-muted-foreground">Two AI markers are checking each answer. This usually takes under a minute.</span>}
      </div>
    </div>
  );
}

function FeedbackCard({ f }: { f: PracticeFeedback }) {
  const [show, setShow] = useState(false);
  return (
    <li className="rounded-lg border border-ruling bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <p><span className="font-semibold">Q{f.q}</span> <span className="text-[0.95rem] text-muted-foreground">{f.question.length > 160 ? `${f.question.slice(0, 159)}…` : f.question}</span></p>
        <span className="mark shrink-0 text-3xl">{fmtMark(f.mark)}/{fmtMark(f.max)}</span>
      </div>
      {f.answer && <p className="mt-2 whitespace-pre-wrap rounded-md bg-paper px-3 py-2 text-[0.95rem]">{f.answer}</p>}
      <ul className="mt-3 space-y-2">
        {f.criteria.map((c) => {
          const Icon = c.points >= c.max ? CheckCircle2 : c.points > 0 ? CircleDashed : XCircle;
          return (
            <li key={c.text} className="flex gap-2 text-[0.95rem]">
              <Icon aria-hidden className={`mt-0.5 size-4 shrink-0 ${c.points >= c.max ? "text-ok" : c.points > 0 ? "text-check" : "text-flag"}`} />
              <span>
                <span className="font-semibold">{c.text}</span> <span className="tabular-nums text-muted-foreground">{fmtMark(c.points)}/{fmtMark(c.max)}</span>
                {c.reason && <span className="block text-muted-foreground">{c.reason}</span>}
                {c.evidence && c.points > 0 && <span className="block text-[0.9rem]">From your answer: <mark className="highlight bg-transparent">&ldquo;{c.evidence}&rdquo;</mark></span>}
              </span>
            </li>
          );
        })}
      </ul>
      {f.misconceptions.length > 0 && <p className="mt-3 rounded-md border-l-2 border-check bg-check/5 px-3 py-2 text-[0.95rem]"><span className="font-semibold">Watch out:</span> {f.misconceptions.join("; ")}</p>}
      {f.uncertain && <p className="mt-2 text-[0.9rem] text-muted-foreground">The two markers didn&apos;t fully agree on this one. Check it with your teacher.</p>}
      <button type="button" onClick={() => setShow((s) => !s)} className="mt-3 text-[0.9rem] font-semibold underline underline-offset-4">{show ? "Hide the model answer" : "Show the model answer"}</button>
      {show && <p className="mt-1 text-[0.95rem]">{f.modelAnswer}</p>}
    </li>
  );
}
