"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Keyboard, MessageSquareWarning } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { resolveRequest } from "@/app/app/actions";
import { fmtMark, Mark, RiskLabel } from "@/components/marks";
import type { PageRow, QuestionResultRow } from "@/lib/db/types";
import { evidenceLines, pageOfLine } from "@/lib/grading/evidence";
import type { Rubric } from "@/lib/grading/schemas";
import { browserDb } from "@/lib/supabase/browser";

export type ScriptSummary = {
  id: string; status: string; total: number | null; max_total: number | null; risk: "low" | "medium" | "high" | null;
  warnings: string[]; name: string; code: string;
};

type Props = {
  mode: "teacher" | "sample";
  testId: string;
  title: string;
  rubric: Rubric;
  basePath: string; // e.g. /app/tests/<id>/review or /sample/review
  scripts: ScriptSummary[];
  current: { id: string; name: string; code: string; warnings: string[]; results: QuestionResultRow[]; pages: (PageRow & { url: string })[] } | null;
  commentBank?: Record<number, string[]>; // notes this teacher already wrote for each question in this test
  requests?: { id: string; q: number; message: string }[]; // students' open re-check requests on this script
  initialQ?: number;
};

/** A boolean remembered on this device (e.g. "hide names"), safe to render on the server. */
function useLocalFlag(key: string): [boolean, (v: boolean) => void] {
  const value = useSyncExternalStore(
    (cb) => { window.addEventListener("storage", cb); window.addEventListener("gl-flag", cb); return () => { window.removeEventListener("storage", cb); window.removeEventListener("gl-flag", cb); }; },
    () => localStorage.getItem(key) === "1",
    () => false,
  );
  return [value, (v) => { localStorage.setItem(key, v ? "1" : "0"); window.dispatchEvent(new Event("gl-flag")); }];
}

const SHORTCUTS: [string, string][] = [
  ["A", "Approve this mark"], ["0-9", "Set the mark"], ["H", "Add or remove a half mark"],
  ["J / K", "Next / previous question"], ["N / P", "Next / previous script"], ["?", "Show or hide this list"],
];

const markOf = (r: QuestionResultRow) => (r.teacher_score ?? r.ai_score);

/** Plain-language explanations of the verifier's flags (the teacher sees why an answer waits for them). */
function explain(flag: string): string {
  if (flag.startsWith("graders disagree")) return `The two markers disagree ${flag.slice(16)}.`;
  if (flag.startsWith("unverified evidence")) return "One marker quoted words the student didn't write, so check its points.";
  if (flag.startsWith("low reading confidence")) return `The handwriting was hard to read ${flag.slice(22)}. Check the transcription against the page.`;
  if (flag.startsWith("manipulation attempt")) return "The answer contains instructions aimed at the grader (e.g. \"give full marks\"). It was marked on content only.";
  if (flag.startsWith("no answer found")) return "No answer was found for this question. Confirm it was left blank (check the page in case it was written somewhere else).";
  if (flag.startsWith("no drawing found")) return "There is no drawing, only labels written as text, so the structure marks were removed.";
  if (flag.startsWith("two answers")) return "Two answers were found for this question and joined. Check which one counts.";
  if (flag.startsWith("more than one option")) return `More than one option was chosen ${flag.slice(21)}.`;
  if (flag.startsWith("adjusted ")) return `${flag.charAt(0).toUpperCase()}${flag.slice(1)}.`;
  if (flag.startsWith("no option letter")) return "No option letter could be read. Check the page.";
  return flag;
}

export function ReviewWorkspace(props: Props) {
  const { mode, rubric, current } = props;
  const router = useRouter();
  const [results, setResults] = useState<QuestionResultRow[]>(current?.results ?? []);
  // Open where the teacher's attention is most useful: a flagged answer that has writing, then any flagged one.
  const [sel, setSel] = useState(() => {
    const rs = current?.results ?? [];
    const asked = props.initialQ ? rs.findIndex((r) => r.q === props.initialQ) : -1;
    if (asked >= 0) return asked;
    const answered = rs.findIndex((r) => !r.approved && r.risk !== "low" && r.answer?.text?.trim());
    const flagged = rs.findIndex((r) => !r.approved && r.risk !== "low");
    return answered >= 0 ? answered : flagged >= 0 ? flagged : 0;
  });
  const [crit, setCrit] = useState<string | null>(null);
  const [tab, setTab] = useState<"queue" | "page" | "marks">("marks");
  const [note, setNote] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [anon, setAnon] = useLocalFlag("gl-hide-names");
  const [showKeys, setShowKeys] = useState(false);
  const [openRequests, setOpenRequests] = useState(props.requests ?? []);
  const [reply, setReply] = useState("");
  // Decisions save in the background and never lock the buttons: a fast reviewer can keep going while the server
  // confirms. Only the bulk actions wait for their own result.
  const [saving, setSaving] = useState(0);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [, startRefresh] = useTransition();

  const [zoom, setZoom] = useState(false);
  // New server data (after a save, or another script): adopt it during render, not in an effect.
  const [seen, setSeen] = useState(current);
  if (current !== seen) { setSeen(current); setResults(current?.results ?? []); }
  const r = results[sel];
  const rq = useMemo(() => rubric.questions.find((q) => q.q === r?.q), [rubric, r]);
  // Moving to another question clears the selected criterion and loads that question's note.
  const [shownId, setShownId] = useState(r?.id);
  if (r?.id !== shownId) { setShownId(r?.id); setCrit(null); setNote(r?.teacher_note ?? ""); }

  const flash = (t: string) => { setToast(t); setTimeout(() => setToast(null), 2500); };

  const decide = useCallback((act: "approve" | "adjust" | "unapprove", score?: number) => {
    if (!r) return;
    const next = results.map((x) => (x.id === r.id
      ? { ...x, approved: act !== "unapprove", teacher_score: act === "adjust" ? score! : x.teacher_score, teacher_note: act !== "unapprove" && note.trim() ? note.trim() : x.teacher_note }
      : x));
    setResults(next);
    if (act !== "unapprove") {
      const i = next.findIndex((x, k) => k > sel && !x.approved);
      if (i >= 0) setSel(i);
    }
    if (mode === "sample") { flash(act === "unapprove" ? "Back to pencil (sample: not saved)." : "Approved in red pen (sample: not saved)."); return; }
    const before = r;
    void (async () => {
      setSaving((n) => n + 1);
      const { error } = await browserDb().rpc("review_mark", { qid: before.id, act, score: act === "adjust" ? score : null, note: act !== "unapprove" && note.trim() ? note.trim() : null });
      setSaving((n) => n - 1);
      if (error) {
        setResults((rs) => rs.map((x) => (x.id === before.id ? before : x))); // undo only this decision
        flash(`Question ${before.q} didn't save. Check your connection and try again.`);
        return;
      }
      startRefresh(() => router.refresh());
    })();
  }, [r, results, sel, note, mode, router]);

  const approveReady = (scope: "script" | "test") => {
    if (mode === "sample") {
      setResults((rs) => rs.map((x) => (x.risk === "low" ? { ...x, approved: true } : x)));
      flash("Ready marks approved (sample: not saved).");
      return;
    }
    void (async () => {
      setBulkBusy(true);
      const { data, error } = await browserDb().rpc("bulk_approve", { tid: props.testId, sid: scope === "script" ? current?.id : null });
      setBulkBusy(false);
      if (error) { flash("That didn't save. Try again."); return; }
      if (scope === "script") setResults((rs) => rs.map((x) => (x.risk === "low" ? { ...x, approved: true } : x)));
      flash(`Approved ${data} mark${data === 1 ? "" : "s"}.`);
      startRefresh(() => router.refresh());
    })();
  };

  // keyboard: J/K question, A approve, digits set a mark, H adds or removes a half, N/P next/previous script
  const idx = props.scripts.findIndex((s) => s.id === current?.id);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey || !r) return;
      const k = e.key.toLowerCase();
      if (e.key === "?") { setShowKeys((v) => !v); e.preventDefault(); return; }
      if (k === "escape") { setShowKeys(false); return; }
      if (k === "j") setSel((s) => Math.min(results.length - 1, s + 1));
      else if (k === "k") setSel((s) => Math.max(0, s - 1));
      else if (k === "a") decide("approve");
      else if (/^\d$/.test(k) && Number(k) <= r.max) decide("adjust", Number(k));
      else if (k === "h") { const m = markOf(r); const v = m % 1 ? Math.floor(m) : Math.min(r.max, m + 0.5); decide("adjust", v); }
      else if (k === "n" && idx < props.scripts.length - 1) router.push(`${props.basePath}?s=${props.scripts[idx + 1].id}`);
      else if (k === "p" && idx > 0) router.push(`${props.basePath}?s=${props.scripts[idx - 1].id}`);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [r, results.length, decide, idx, props.scripts, props.basePath, router]);

  const pendingCount = results.filter((x) => !x.approved).length;
  const readyCount = results.filter((x) => !x.approved && x.risk === "low").length;
  const total = results.reduce((s, x) => s + markOf(x), 0);
  const max = results.reduce((s, x) => s + x.max, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {mode === "sample" && (
        <p className="border-b border-ruling bg-highlighter/40 px-5 py-2 text-center text-[0.95rem]">
          Sample class: real exam scripts from a public dataset. Try marking them; changes here aren&apos;t saved.
        </p>
      )}
      {/* mobile: the three panes become tabs */}
      <div role="tablist" aria-label="Review panes" className="flex border-b border-ruling bg-white lg:hidden">
        {(["queue", "page", "marks"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`flex-1 px-3 py-2.5 font-semibold ${tab === t ? "border-b-2 border-redpen" : "text-muted-foreground"}`}>
            {t === "queue" ? "Scripts" : t === "page" ? "Page" : "Marks"}
          </button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[15rem_minmax(0,1fr)_minmax(22rem,28rem)]">
        {/* ------------------------------------------------ queue */}
        <aside aria-label="Scripts" className={`${tab === "queue" ? "block" : "hidden"} border-r border-ruling bg-white lg:block lg:overflow-y-auto`}>
          <div className="border-b border-ruling p-3">
            <p className="text-[0.9rem] text-muted-foreground">{props.title}</p>
            <div className="mt-2 flex gap-1.5">
              <button type="button" onClick={() => setAnon(!anon)} aria-pressed={anon} title="Anonymous marking: show codes instead of names"
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-ruling px-2 py-1 text-[0.85rem] hover:bg-secondary aria-pressed:bg-secondary">
                {anon ? <EyeOff aria-hidden className="size-3.5" /> : <Eye aria-hidden className="size-3.5" />} {anon ? "Names hidden" : "Hide names"}
              </button>
              <button type="button" onClick={() => setShowKeys(true)} title="Keyboard shortcuts (?)" className="inline-flex items-center gap-1.5 rounded-md border border-ruling px-2 py-1 text-[0.85rem] hover:bg-secondary">
                <Keyboard aria-hidden className="size-3.5" /> Keys
              </button>
            </div>
            <button type="button" disabled={bulkBusy} onClick={() => approveReady("test")}
              className="mt-2 w-full rounded-md border border-redpen px-3 py-1.5 text-[0.95rem] font-semibold text-redpen hover:bg-redpen hover:text-white disabled:opacity-50">
              Approve every ready mark
            </button>
          </div>
          <ol>
            {props.scripts.map((s) => (
              <li key={s.id}>
                <Link href={`${props.basePath}?s=${s.id}`} aria-current={s.id === current?.id ? "page" : undefined}
                  className="flex items-center justify-between gap-2 border-b border-ruling px-3 py-2 hover:bg-secondary/60 aria-[current=page]:bg-secondary">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{anon ? s.code : s.name}</span>
                    {s.status === "approved" ? <span className="text-[0.85rem] font-semibold text-ok">✓ Approved</span> : <RiskLabel risk={s.risk} className="text-[0.85rem]" />}
                  </span>
                  {s.total !== null && <Mark value={Number(s.total)} approved={s.status === "approved"} className="text-xl" />}
                </Link>
              </li>
            ))}
          </ol>
        </aside>

        {/* ------------------------------------------------ page */}
        <section aria-label="Student's page" className={`${tab === "page" ? "block" : "hidden"} min-h-0 bg-[#eef1f6] lg:block lg:overflow-y-auto`}>
          {current && r ? <PageView key={r.id} pages={current.pages} result={r} criterion={crit} zoom={zoom} onZoom={setZoom} /> : <p className="p-6 text-muted-foreground">Nothing to review yet.</p>}
        </section>

        {/* ------------------------------------------------ marking sheet */}
        <section aria-label="Marking sheet" className={`${tab === "marks" ? "block" : "hidden"} border-l border-ruling bg-white lg:block lg:overflow-y-auto`}>
          {current ? (
            <>
              <header className="border-b border-ruling px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <h1 className="text-xl font-semibold">{anon ? current.code : <>{current.name} <span className="text-[0.9rem] font-normal text-muted-foreground">{current.code}</span></>}</h1>
                  <Mark value={total} max={max} approved={pendingCount === 0} className="text-3xl" />
                </div>
                {current.warnings.map((w) => <p key={w} className="mt-1 text-[0.9rem] font-semibold text-check">⚠ {w}</p>)}
                <p className="mt-1 text-[0.9rem] text-muted-foreground">
                  {pendingCount ? `${pendingCount} mark${pendingCount === 1 ? "" : "s"} still in pencil` : "Every mark approved"}
                  {saving > 0 && <span aria-live="polite"> · saving…</span>}
                  {readyCount > 0 && (
                    <> · <button type="button" disabled={bulkBusy} onClick={() => approveReady("script")} className="font-semibold text-redpen underline underline-offset-4">approve the {readyCount} ready</button></>
                  )}
                </p>
              </header>

              {/* question strip */}
              <nav aria-label="Questions" className="flex flex-wrap gap-1 border-b border-ruling px-3 py-2">
                {results.map((x, i) => (
                  <button key={x.id} type="button" onClick={() => setSel(i)} aria-current={i === sel ? "true" : undefined}
                    title={`Q${x.q}: ${fmtMark(markOf(x))}/${fmtMark(x.max)}${x.approved ? ", approved" : x.risk === "low" ? ", ready" : ", needs a look"}`}
                    className={`min-w-10 rounded px-1.5 py-1 text-[0.85rem] font-semibold ring-1 ${i === sel ? "bg-ink text-white ring-ink" : x.approved ? "text-redpen ring-redpen/40" : x.risk === "low" ? "text-ok ring-ok/40" : x.risk === "medium" ? "text-check ring-check/50" : "text-flag ring-flag/50"}`}>
                    {x.q}{!x.approved && x.risk !== "low" ? (x.risk === "high" ? "⚑" : "◐") : ""}
                  </button>
                ))}
              </nav>

              {r && rq && (
                <article className="px-4 py-4">
                  <header className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="font-semibold">Question {r.q}</h2>
                      <p className="text-[0.95rem] text-muted-foreground">{rq.text}</p>
                    </div>
                    <Mark value={markOf(r)} max={r.max} approved={r.approved} className="text-4xl" />
                  </header>

                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                    {r.approved ? <span className="text-[0.9rem] font-semibold text-redpen">Approved{r.teacher_score !== null && r.teacher_score !== r.ai_score ? ` (changed from ${fmtMark(r.ai_score)})` : ""}</span> : <RiskLabel risk={r.risk} />}
                    {mode === "sample" && r.reference_score === null && rq.type !== "mcq" && (
                      <span className="text-[0.9rem] text-muted-foreground">The dataset&apos;s teacher left this answer unmarked.</span>
                    )}
                    {r.reference_score !== null && (
                      <span className="text-[0.9rem]">
                        The dataset&apos;s teacher gave <strong>{fmtMark(r.reference_score)}</strong>
                        {Math.abs(r.reference_score - r.ai_score) <= 0.5 ? " (within half a mark)" : ` (GradeLens suggested ${fmtMark(r.ai_score)})`}
                      </span>
                    )}
                  </div>
                  {openRequests.filter((x) => x.q === r.q).map((req) => (
                    <div key={req.id} className="mt-3 rounded-md border border-check/50 bg-check/5 p-3">
                      <p className="flex items-center gap-1.5 text-[0.9rem] font-semibold"><MessageSquareWarning aria-hidden className="size-4 text-check" /> The student asked you to look again</p>
                      <p className="mt-1 text-[0.95rem]">&ldquo;{req.message}&rdquo;</p>
                      <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={2} maxLength={1000} placeholder="Reply (optional). The student sees it on their results page."
                        className="mt-2 w-full rounded-md border border-input bg-white px-3 py-1.5 text-[0.95rem]" />
                      <button type="button" className="mt-1.5 rounded-md border border-ink/25 bg-white px-3 py-1 text-[0.9rem] font-semibold hover:bg-secondary"
                        onClick={async () => {
                          const res = await resolveRequest(req.id, reply);
                          if (!res.ok) { flash(res.error); return; }
                          setOpenRequests((rs) => rs.filter((x) => x.id !== req.id)); setReply(""); flash("Request answered.");
                        }}>
                        Mark as answered
                      </button>
                    </div>
                  ))}
                  {r.flags.length > 0 && (
                    <ul className="mt-3 space-y-1 border-l-2 border-check pl-3 text-[0.95rem]">
                      {r.flags.map((f) => <li key={f}>{explain(f)}</li>)}
                    </ul>
                  )}

                  {/* what the student wrote */}
                  <h3 className="mt-5 text-[0.9rem] font-semibold text-muted-foreground">Student&apos;s answer, as read from the page</h3>
                  {r.answer ? (
                    <Transcript text={rq.type === "mcq" ? r.answer.text : r.answer.text} quote={crit ? (r.grade_a?.criteria.find((c) => c.id === crit)?.evidenceQuote || r.grade_b?.criteria.find((c) => c.id === crit)?.evidenceQuote || "") : ""} />
                  ) : <p className="mt-1 italic text-muted-foreground">No answer found.</p>}
                  {r.answer?.formulas?.length ? <p className="mt-1 font-mono text-[0.85rem] text-muted-foreground">{r.answer.formulas.join("  ⟶  ")}</p> : null}
                  {r.answer?.diagram && <p className="mt-1 text-[0.9rem] text-muted-foreground">Drawing: {r.answer.diagram.outline}{r.answer.diagram.labels.length ? `; labels: ${r.answer.diagram.labels.join(", ")}` : ""}</p>}

                  {/* criteria */}
                  {rq.type !== "mcq" ? (
                    <>
                      <h3 className="mt-5 text-[0.9rem] font-semibold text-muted-foreground">Mark scheme · click a line to show its evidence</h3>
                      <ol className="mt-1 divide-y divide-ruling border-y border-ruling">
                        {rq.criteria.map((c) => {
                          const a = r.grade_a?.criteria.find((x) => x.id === c.id), b = r.grade_b?.criteria.find((x) => x.id === c.id);
                          return (
                            <li key={c.id}>
                              <button type="button" aria-pressed={crit === c.id} onClick={() => { setCrit(crit === c.id ? null : c.id); setTab((t) => t); }}
                                className="grid w-full grid-cols-[1fr_auto] gap-x-3 gap-y-1 px-1 py-2.5 text-left hover:bg-secondary/60 aria-pressed:bg-highlighter/30">
                                <span className="text-[0.95rem]">{c.mustMention}</span>
                                <span className="whitespace-nowrap text-right">
                                  <span className="mark text-xl" data-approved={r.approved}>{fmtMark(a?.points ?? 0)}</span>
                                  {b && b.points !== a?.points && <span className="mark text-xl text-check"> / {fmtMark(b.points)}</span>}
                                  <span className="text-[0.85rem] text-muted-foreground"> of {fmtMark(c.points)}</span>
                                </span>
                                <span className="col-span-2 text-[0.9rem] text-muted-foreground">
                                  {a?.reason}{b && b.reason && b.points !== a?.points ? ` · Second marker: ${b.reason}` : ""}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ol>
                      <p className="mt-2 text-[0.85rem] text-muted-foreground">
                        Two markers gave {fmtMark(r.score_a)} and {fmtMark(r.score_b)}.
                      </p>
                      {(r.grade_a?.misconceptions.length || r.grade_b?.misconceptions.length) ? (
                        <p className="mt-2 text-[0.9rem]"><span className="font-semibold">Misconception: </span>{[...new Set([...(r.grade_a?.misconceptions ?? []), ...(r.grade_b?.misconceptions ?? [])])].join("; ")}</p>
                      ) : null}
                    </>
                  ) : (
                    <p className="mt-4 text-[0.95rem]">Multiple choice. Correct option: <strong>{rq.modelAnswer.trim().slice(0, 1).toUpperCase()}</strong>.</p>
                  )}

                  {/* decide */}
                  <div className="mt-5 border-t border-ruling pt-4">
                    <p className="text-[0.9rem] font-semibold">Your mark</p>
                    <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Set the mark">
                      {Array.from({ length: r.max * 2 + 1 }, (_, i) => i / 2).map((v) => (
                        <button key={v} type="button" onClick={() => decide("adjust", v)} aria-pressed={markOf(r) === v}
                          className={`mark min-w-11 rounded-md border px-2 py-1 text-2xl ${markOf(r) === v ? (r.approved ? "border-redpen bg-redpen/5" : "border-ink/40 bg-secondary") : "border-ruling bg-white hover:bg-secondary"}`}
                          data-approved={r.approved && markOf(r) === v}>
                          {fmtMark(v)}
                        </button>
                      ))}
                    </div>
                    <label className="mt-3 grid gap-1">
                      <span className="text-[0.85rem] text-muted-foreground">Note for the student</span>
                      <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} className="rounded-md border border-input bg-white px-3 py-1.5" />
                    </label>
                    {(props.commentBank?.[r.q] ?? []).filter((c) => c !== note).length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Notes you used before on this question">
                        {(props.commentBank?.[r.q] ?? []).filter((c) => c !== note).slice(0, 6).map((c) => (
                          <button key={c} type="button" onClick={() => setNote(c)} title={c}
                            className="max-w-full truncate rounded-full border border-ruling bg-white px-2.5 py-0.5 text-[0.8rem] hover:bg-secondary">{c.length > 48 ? `${c.slice(0, 47)}…` : c}</button>
                        ))}
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      {!r.approved ? (
                        <button type="button" onClick={() => decide("approve")} className="rounded-md bg-redpen px-5 py-2 font-semibold text-white hover:bg-[#b81f1f] disabled:opacity-50">
                          Approve {fmtMark(markOf(r))}/{fmtMark(r.max)}
                        </button>
                      ) : (
                        <button type="button" onClick={() => decide("unapprove")} className="rounded-md border border-ink/25 px-4 py-2 font-semibold hover:bg-secondary">
                          Undo approval
                        </button>
                      )}
                      <button type="button" onClick={() => setShowKeys(true)} className="text-[0.8rem] text-muted-foreground underline underline-offset-4">Keyboard shortcuts</button>
                    </div>
                  </div>
                </article>
              )}
            </>
          ) : <p className="p-6 text-muted-foreground">No marked scripts yet. They appear here as soon as they&apos;re marked.</p>}
        </section>
      </div>
      {toast && <p role="status" className="fixed bottom-5 left-1/2 -translate-x-1/2 rounded-md bg-ink px-4 py-2 text-white shadow-lg">{toast}</p>}
      {showKeys && (
        <div role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" className="fixed inset-0 z-50 grid place-items-center bg-ink/30 p-4" onClick={() => setShowKeys(false)}>
          <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-semibold">Keyboard shortcuts</h2>
            <dl className="mt-3 grid grid-cols-[5rem_1fr] gap-y-1.5 text-[0.95rem]">
              {SHORTCUTS.map(([k, v]) => (
                <Fragment key={k}><dt><kbd className="rounded border border-ruling bg-secondary px-1.5 py-0.5 font-mono text-[0.85rem]">{k}</kbd></dt><dd>{v}</dd></Fragment>
              ))}
            </dl>
            <button type="button" onClick={() => setShowKeys(false)} className="mt-4 rounded-md border border-ink/20 px-3 py-1.5 font-semibold hover:bg-secondary">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Transcript({ text, quote }: { text: string; quote: string }) {
  const q = quote.split(/\.\.\.|…/)[0]?.trim() ?? "";
  const at = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  return (
    <p className="mt-1 whitespace-pre-wrap rounded-md bg-paper px-3 py-2 font-[450] leading-relaxed ruled">
      {at >= 0 ? <>{text.slice(0, at)}<mark className="highlight bg-transparent">{text.slice(at, at + q.length)}</mark>{text.slice(at + q.length)}</> : text}
      {q && at < 0 && <span className="mt-2 block text-[0.85rem] text-muted-foreground">Quoted as evidence: “{q}”</span>}
    </p>
  );
}

function PageView({ pages, result, criterion, zoom, onZoom }: {
  pages: (PageRow & { url: string })[]; result: QuestionResultRow; criterion: string | null; zoom: boolean; onZoom: (z: boolean) => void;
}) {
  const a = result.answer;
  const quote = criterion ? (result.grade_a?.criteria.find((c) => c.id === criterion)?.evidenceQuote || result.grade_b?.criteria.find((c) => c.id === criterion)?.evidenceQuote || "") : "";
  const hit = useMemo(() => new Set(a && quote ? evidenceLines(quote, a.lines) : []), [a, quote]);
  const evidencePage = a && hit.size ? pageOfLine(a, a.lines[[...hit][0]]) : null;
  // Derived, not synced: the evidence's page, unless the teacher picked a page for this same criterion.
  const [picked, setPicked] = useState<{ page: number; criterion: string | null } | null>(null);
  const page = picked && picked.criterion === criterion ? picked.page : evidencePage ?? a?.page ?? 1;
  const box = useRef<HTMLDivElement>(null);
  const shown = pages.find((p) => p.page_no === page) ?? pages[0];
  const lines = (a?.lines ?? []).map((l, i) => ({ ...l, i, pg: pageOfLine(a!, l) })).filter((l) => l.pg === (shown?.page_no ?? 1));
  useEffect(() => {
    const first = box.current?.querySelector("[data-hit='true']") ?? box.current?.querySelector("[data-line]");
    first?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [page, criterion, result.id, zoom]);

  if (!shown) return <p className="p-6 text-muted-foreground">No page images for this script.</p>;
  return (
    <div className="p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[0.9rem]">
        {pages.map((p) => (
          <button key={p.id} type="button" onClick={() => setPicked({ page: p.page_no, criterion })} aria-pressed={p.page_no === shown.page_no}
            className="rounded px-2 py-0.5 ring-1 ring-ruling aria-pressed:bg-ink aria-pressed:text-white">
            Page {p.page_no}
          </button>
        ))}
        <button type="button" onClick={() => onZoom(!zoom)} className="ml-auto rounded px-2 py-0.5 ring-1 ring-ruling">{zoom ? "Fit width" : "Zoom in"}</button>
      </div>
      <div ref={box} className={zoom ? "overflow-auto" : ""}>
        <div className="relative mx-auto bg-white shadow-sm" style={{ width: zoom ? "180%" : "100%" }}>
          {shown.media_type === "application/pdf"
            ? <iframe src={shown.url} title={`Page ${shown.page_no}`} className="aspect-[1/1.414] w-full" />
            : (
              // eslint-disable-next-line @next/next/no-img-element -- signed, expiring storage URL
              <img src={shown.url} alt={`Page ${shown.page_no} of the student's answers`} className="block w-full select-none" draggable={false} />
            )}
          {shown.media_type !== "application/pdf" && lines.map((l) => {
            const [y0, x0, y1, x1] = l.box;
            const isHit = hit.has(l.i);
            return (
              <span key={l.i} data-line data-hit={isHit} aria-hidden
                className={`absolute rounded-[2px] ${isHit ? "highlight mix-blend-multiply" : criterion ? "" : "ring-1 ring-[#3d5a99]/35"}`}
                style={{ top: `${y0 / 10}%`, left: `${x0 / 10}%`, height: `${Math.max(0.6, (y1 - y0) / 10)}%`, width: `${Math.max(1, (x1 - x0) / 10)}%` }} />
            );
          })}
        </div>
      </div>
      {criterion && !hit.size && <p className="mt-2 text-[0.9rem] text-muted-foreground">No evidence line for this criterion (no marks were given for it, or the quote couldn&apos;t be placed on the page).</p>}
    </div>
  );
}
