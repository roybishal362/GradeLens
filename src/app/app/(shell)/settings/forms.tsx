"use client";

import { useState, useTransition } from "react";
import { btn } from "@/components/page-header";
import { deleteAccount, saveProfile } from "@/app/app/actions";

export function ProfileForm({ displayName, school }: { displayName: string; school: string }) {
  const [name, setName] = useState(displayName);
  const [sch, setSch] = useState(school);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form className="mt-3 grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await saveProfile({ displayName: name, school: sch }); setMsg(r.ok ? { ok: true, text: r.message ?? "Saved." } : { ok: false, text: r.error }); }); }}>
      <label className="grid gap-1.5">
        <span className="text-[0.9rem] font-semibold">Name students see</span>
        <input name="display_name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Ms Rivera" className="rounded-md border border-input bg-white px-3 py-2" />
      </label>
      <label className="grid gap-1.5">
        <span className="text-[0.9rem] font-semibold">School <span className="font-normal text-muted-foreground">(optional)</span></span>
        <input name="school" value={sch} onChange={(e) => setSch(e.target.value)} maxLength={120} className="rounded-md border border-input bg-white px-3 py-2" />
      </label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button disabled={pending} className={btn.primary}>{pending ? "Saving…" : "Save"}</button>
        {msg && <span role="status" className={msg.ok ? "text-ok" : "text-flag"}>{msg.text}</span>}
      </div>
    </form>
  );
}

export function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="text-[0.95rem] text-muted-foreground underline underline-offset-4 hover:text-flag">Delete my account and all its data</button>;
  return (
    <div className="rounded-md border border-flag/40 bg-flag/5 p-4">
      <p className="font-semibold">Delete everything?</p>
      <p className="mt-1 text-[0.95rem]">All your classes, students, tests, scanned pages, marks and history are deleted permanently.</p>
      <label className="mt-3 grid gap-1">
        <span className="text-[0.9rem]">Type <strong>delete</strong> to confirm</span>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} className="max-w-xs rounded-md border border-input bg-white px-3 py-2" />
      </label>
      <div className="mt-3 flex items-center gap-3">
        <button type="button" disabled={pending || typed.trim().toLowerCase() !== "delete"} onClick={() => start(async () => { const r = await deleteAccount(typed); if (r && !r.ok) setError(r.error); })}
          className="rounded-md bg-flag px-4 py-2 font-semibold text-white disabled:opacity-40">{pending ? "Deleting…" : "Delete permanently"}</button>
        <button type="button" onClick={() => setOpen(false)} className="underline underline-offset-4">Cancel</button>
      </div>
      {error && <p role="status" className="mt-2 text-flag">{error}</p>}
    </div>
  );
}
