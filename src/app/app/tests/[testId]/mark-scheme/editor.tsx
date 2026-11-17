"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { fmtMark } from "@/components/marks";
import { checkOwnRubric, type QuestionInput } from "@/lib/grading/rubric-check";
import type { Rubric, RubricQuestion } from "@/lib/grading/schemas";
import { approveMarkScheme, draftMarkScheme, readQuestionPaper, reopenMarkScheme, saveMarkScheme } from "../../../actions";

const TYPES: { value: NonNullable<QuestionInput["type"]>; label: string }[] = [
  { value: "short", label: "Short answer" },
  { value: "long", label: "Long answer" },
  { value: "math", label: "Maths working" },
  { value: "diagram", label: "Diagram" },
  { value: "one_word", label: "One word" },
  { value: "mcq", label: "Multiple choice" },
];

const input = "rounded-md border border-input bg-white px-3 py-2";

export function MarkSchemeEditor({ testId, initial, status, markedScripts }: { testId: string; initial: Rubric; status: string; markedScripts: number }) {
  const router = useRouter();
  const [questions, setQuestions] = useState<QuestionInput[]>(() =>
    initial.questions.map((q) => ({ q: q.q, text: q.text, marks: q.marks, answerKey: q.modelAnswer, type: q.type })),
  );
  const [rubric, setRubric] = useState<Rubric | null>(initial.questions.length ? initial : null);
  const [approved, setApproved] = useState(status === "approved");
  const [paper, setPaper] = useState("");
  const [key, setKey] = useState("");
  const [showPaste, setShowPaste] = useState(!initial.questions.length);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();
  const problems = useMemo(() => (rubric ? checkOwnRubric(rubric) : []), [rubric]);

  const run = (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setMsg(null);
    start(async () => {
      try { await fn(); } finally { setBusy(null); }
    });
  };

  const editQ = (i: number, patch: Partial<QuestionInput>) => setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const editR = (qn: number, patch: (q: RubricQuestion) => RubricQuestion) => {
    setApproved(false);
    setRubric((r) => (r ? { questions: r.questions.map((q) => (q.q === qn ? patch(q) : q)) } : r));
  };

  return (
    <div className="mt-8 space-y-12">
      {approved && (
        <div className="margin-rule pl-4">
          <p className="font-semibold text-ok">✓ Approved. Scripts are being marked with this scheme.</p>
          <button
            type="button"
            className="mt-1 text-[0.95rem] underline underline-offset-4"
            onClick={() => run("reopen", async () => { const r = await reopenMarkScheme(testId); if (r.ok) setApproved(false); })}
          >
            Edit the mark scheme
          </button>
          {markedScripts > 0 && <span className="ml-2 text-[0.95rem] text-muted-foreground">({markedScripts} scripts already marked keep their marks until you re-mark them.)</span>}
        </div>
      )}

      {/* ---------------------------------------------------------------- 1. questions */}
      <section aria-labelledby="q-head" className={approved ? "pointer-events-none opacity-60" : ""}>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="q-head" className="text-xl font-semibold">1. Questions and answer key</h2>
          <button type="button" onClick={() => setShowPaste((s) => !s)} className="text-[0.95rem] underline underline-offset-4">
            {showPaste ? "Hide the paste box" : "Paste a question paper instead"}
          </button>
        </div>

        {showPaste && (
          <div className="mt-4 grid gap-3 rounded-md border border-ruling bg-white p-4">
            <p className="text-[0.95rem] text-muted-foreground">
              Paste the question paper and, below it, your answer key or mark scheme notes. GradeLens splits them into
              questions for you to check. It copies your questions; it never answers them.
            </p>
            <label className="grid gap-1.5">
              <span className="font-semibold">Question paper</span>
              <textarea value={paper} onChange={(e) => setPaper(e.target.value)} rows={7} className={input} placeholder={"1. Define supervised learning. [2]\n2. Which of these is a clustering algorithm?\n   A. Linear regression  B. K-means ..."} />
            </label>
            <label className="grid gap-1.5">
              <span className="font-semibold">Answer key <span className="font-normal text-muted-foreground">(recommended)</span></span>
              <textarea value={key} onChange={(e) => setKey(e.target.value)} rows={5} className={input} placeholder={"1. Learning from labelled examples (inputs with known outputs)\n2. B"} />
            </label>
            <div>
              <button
                type="button"
                disabled={!!busy || paper.trim().length < 10}
                onClick={() => run("paper", async () => {
                  const r = await readQuestionPaper(testId, paper, key);
                  if (!r.ok) { setMsg({ ok: false, text: r.error }); return; }
                  setQuestions(r.questions);
                  setShowPaste(false);
                  setMsg({ ok: true, text: `Found ${r.questions.length} questions. Check them below${r.missingMarks.length ? `; the paper didn't give marks for Q${r.missingMarks.join(", Q")}, so set those` : ""}.` });
                })}
                className="rounded-md border border-ink/25 bg-white px-4 py-2 font-semibold hover:bg-secondary disabled:opacity-50"
              >
                {busy === "paper" ? "Reading the paper…" : "Read the paper"}
              </button>
            </div>
          </div>
        )}

        <ol className="mt-6 space-y-5">
          {questions.map((q, i) => (
            <li key={i} className="grid gap-3 border-t border-ruling pt-4 sm:grid-cols-[4.5rem_10rem_6rem_1fr]">
              <label className="grid gap-1">
                <span className="text-[0.85rem] font-semibold">Number</span>
                <input type="number" min={1} value={q.q} onChange={(e) => editQ(i, { q: Number(e.target.value) })} className={input} />
              </label>
              <label className="grid gap-1">
                <span className="text-[0.85rem] font-semibold">Type</span>
                <select value={q.type ?? "short"} onChange={(e) => editQ(i, { type: e.target.value as QuestionInput["type"] })} className={input}>
                  {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </label>
              <label className="grid gap-1">
                <span className="text-[0.85rem] font-semibold">Marks</span>
                <input type="number" min={0.5} step={0.5} value={q.marks} onChange={(e) => editQ(i, { marks: Number(e.target.value) })} className={input} />
              </label>
              <div className="grid gap-3 sm:col-span-1">
                <label className="grid gap-1">
                  <span className="text-[0.85rem] font-semibold">Question</span>
                  <textarea value={q.text} onChange={(e) => editQ(i, { text: e.target.value })} rows={2} className={input} />
                </label>
                <label className="grid gap-1">
                  <span className="text-[0.85rem] font-semibold">{q.type === "mcq" ? "Correct option (letter first, e.g. \"B\")" : "Answer key / key points"}</span>
                  <textarea value={q.answerKey} onChange={(e) => editQ(i, { answerKey: e.target.value })} rows={q.type === "mcq" ? 1 : 2} className={input} />
                </label>
                <button type="button" onClick={() => setQuestions((qs) => qs.filter((_, j) => j !== i))} className="justify-self-start text-[0.9rem] text-muted-foreground underline underline-offset-4 hover:text-flag">
                  Remove question {q.q}
                </button>
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setQuestions((qs) => [...qs, { q: (qs.at(-1)?.q ?? 0) + 1, text: "", marks: qs.at(-1)?.marks ?? 2, answerKey: "", type: qs.at(-1)?.type ?? "short" }])}
            className="rounded-md border border-ink/25 bg-white px-4 py-2 font-semibold hover:bg-secondary"
          >
            Add a question
          </button>
          <button
            type="button"
            disabled={!!busy || !questions.length}
            onClick={() => run("draft", async () => {
              const r = await draftMarkScheme(testId, questions);
              if (!r.ok) { setMsg({ ok: false, text: r.error }); return; }
              setRubric(r.rubric);
              setApproved(false);
              setMsg({ ok: true, text: "Draft ready. Check each question's criteria below, then approve." });
            })}
            className="rounded-md bg-ink px-4 py-2 font-semibold text-white hover:bg-ink/90 disabled:opacity-50"
          >
            {busy === "draft" ? "Drafting the mark scheme…" : rubric ? "Draft it again from these questions" : "Draft the mark scheme"}
          </button>
        </div>
      </section>

      {msg && <p role="status" className={`rounded-md border px-4 py-3 ${msg.ok ? "border-ok/40 bg-ok/5" : "border-flag/40 bg-flag/5"}`}>{msg.text}</p>}

      {/* ---------------------------------------------------------------- 2. criteria */}
      {rubric && (
        <section aria-labelledby="r-head" className={approved ? "pointer-events-none opacity-60" : ""}>
          <h2 id="r-head" className="text-xl font-semibold">2. Check the marking criteria</h2>
          <p className="mt-1 max-w-2xl text-[0.95rem] text-muted-foreground">
            The graders award each criterion separately and must quote the student&apos;s words as evidence. Make each
            one say exactly what earns the marks. &quot;Carry the error forward&quot; gives method marks when the method is
            right but built on an earlier mistake.
          </p>
          <div className="mt-6 space-y-8">
            {rubric.questions.map((q) => {
              const sum = q.criteria.reduce((s, c) => s + c.points, 0);
              return (
                <article key={q.q} className="margin-rule bg-white py-3 pl-5 pr-3">
                  <header className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="font-semibold">Q{q.q}. <span className="font-normal">{q.text}</span></h3>
                    <span className={`text-[0.95rem] ${Math.abs(sum - q.marks) > 1e-9 ? "font-semibold text-flag" : "text-muted-foreground"}`}>
                      criteria add up to {fmtMark(sum)} of {fmtMark(q.marks)}
                    </span>
                  </header>
                  {q.type === "mcq" ? (
                    <p className="mt-2 text-[0.95rem]">Multiple choice, marked by code: the correct option is <strong>{q.modelAnswer.trim().slice(0, 1).toUpperCase()}</strong>.</p>
                  ) : (
                    <>
                      <ul className="mt-3 space-y-3">
                        {q.criteria.map((c, ci) => (
                          <li key={ci} className="grid gap-2 sm:grid-cols-[5.5rem_1fr_auto] sm:items-start">
                            <label className="grid gap-1">
                              <span className="text-[0.8rem] font-semibold">Marks</span>
                              <input type="number" min={0.5} step={0.5} value={c.points} className={input}
                                onChange={(e) => editR(q.q, (x) => ({ ...x, criteria: x.criteria.map((y, k) => (k === ci ? { ...y, points: Number(e.target.value) } : y)) }))} />
                            </label>
                            <label className="grid gap-1">
                              <span className="text-[0.8rem] font-semibold">Earned when the answer…</span>
                              <textarea value={c.mustMention} rows={2} className={input}
                                onChange={(e) => editR(q.q, (x) => ({ ...x, criteria: x.criteria.map((y, k) => (k === ci ? { ...y, mustMention: e.target.value } : y)) }))} />
                            </label>
                            <div className="grid gap-2 pt-5">
                              {(q.type === "math" || c.ecf) && (
                                <label className="flex items-center gap-2 text-[0.9rem]">
                                  <input type="checkbox" checked={Boolean(c.ecf)}
                                    onChange={(e) => editR(q.q, (x) => ({ ...x, criteria: x.criteria.map((y, k) => (k === ci ? { ...y, ecf: e.target.checked } : y)) }))} />
                                  Carry the error forward
                                </label>
                              )}
                              <button type="button" className="justify-self-start text-[0.9rem] text-muted-foreground underline underline-offset-4 hover:text-flag"
                                onClick={() => editR(q.q, (x) => ({ ...x, criteria: x.criteria.filter((_, k) => k !== ci) }))}>
                                Remove
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                      <button type="button" className="mt-3 text-[0.95rem] font-semibold underline underline-offset-4"
                        onClick={() => editR(q.q, (x) => ({ ...x, criteria: [...x.criteria, { id: `${x.q}${String.fromCharCode(97 + x.criteria.length)}`, points: 1, mustMention: "" }] }))}>
                        Add a criterion
                      </button>
                      <details className="mt-3">
                        <summary className="cursor-pointer text-[0.95rem] text-muted-foreground">Model answer and common misconceptions</summary>
                        <div className="mt-2 grid gap-3">
                          <label className="grid gap-1">
                            <span className="text-[0.8rem] font-semibold">Model answer</span>
                            <textarea value={q.modelAnswer} rows={2} className={input} onChange={(e) => editR(q.q, (x) => ({ ...x, modelAnswer: e.target.value }))} />
                          </label>
                          <label className="grid gap-1">
                            <span className="text-[0.8rem] font-semibold">Misconceptions to look for (one per line)</span>
                            <textarea value={q.commonMisconceptions.join("\n")} rows={3} className={input}
                              onChange={(e) => editR(q.q, (x) => ({ ...x, commonMisconceptions: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) }))} />
                          </label>
                        </div>
                      </details>
                    </>
                  )}
                </article>
              );
            })}
          </div>

          {problems.length > 0 && (
            <div role="alert" className="mt-6 rounded-md border border-flag/40 bg-flag/5 px-4 py-3">
              <p className="font-semibold">Fix before approving:</p>
              <ul className="mt-1 list-disc pl-5">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
            </div>
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={!!busy}
              onClick={() => run("save", async () => {
                const r = await saveMarkScheme(testId, rubric);
                setMsg(r.ok ? { ok: true, text: "Saved." } : { ok: false, text: r.error });
              })}
              className="rounded-md border border-ink/25 bg-white px-4 py-2 font-semibold hover:bg-secondary disabled:opacity-50"
            >
              {busy === "save" ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              disabled={!!busy || problems.length > 0}
              onClick={() => run("approve", async () => {
                const s = await saveMarkScheme(testId, rubric);
                if (!s.ok) { setMsg({ ok: false, text: s.error }); return; }
                const r = await approveMarkScheme(testId);
                if (!r.ok) { setMsg({ ok: false, text: r.error }); return; }
                setApproved(true);
                setMsg({ ok: true, text: r.message ?? "Approved." });
                router.push(`/app/tests/${testId}`);
              })}
              className="rounded-md bg-redpen px-5 py-2 font-semibold text-white hover:bg-[#b81f1f] disabled:opacity-50"
            >
              {busy === "approve" ? "Approving…" : "Approve mark scheme"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
