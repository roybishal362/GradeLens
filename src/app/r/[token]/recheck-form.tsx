"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RecheckForm({ token, questions }: { token: string; questions: number[] }) {
  const router = useRouter();
  const [q, setQ] = useState<number | "">("");
  const [message, setMessage] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "sending" | "sent" | "error"; text?: string }>({ kind: "idle" });
  return (
    <form
      className="mt-3 grid gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!q) return;
        setState({ kind: "sending" });
        const res = await fetch("/api/requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, q, message }) });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) { setState({ kind: "error", text: body.error ?? "Couldn't send. Try again." }); return; }
        setState({ kind: "sent" });
        setMessage(""); setQ("");
        router.refresh();
      }}
    >
      <label className="grid gap-1">
        <span className="text-[0.9rem] font-semibold">Question</span>
        <select value={q} onChange={(e) => setQ(e.target.value ? Number(e.target.value) : "")} className="rounded-md border border-input bg-white px-3 py-2">
          <option value="">Choose…</option>
          {questions.map((n) => <option key={n} value={n}>Question {n}</option>)}
        </select>
      </label>
      <label className="grid gap-1">
        <span className="text-[0.9rem] font-semibold">Why should your teacher look again?</span>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} maxLength={1000} className="rounded-md border border-input bg-white px-3 py-2" />
      </label>
      <div className="flex items-center gap-3">
        <button disabled={!q || message.trim().length < 3 || state.kind === "sending"} className="rounded-md bg-ink px-4 py-2 font-semibold text-white disabled:opacity-40">
          {state.kind === "sending" ? "Sending…" : "Send to my teacher"}
        </button>
        {state.kind === "sent" && <span role="status" className="text-ok">Sent. Your teacher will reply here.</span>}
        {state.kind === "error" && <span role="status" className="text-flag">{state.text}</span>}
      </div>
    </form>
  );
}
