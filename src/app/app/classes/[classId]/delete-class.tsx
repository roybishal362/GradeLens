"use client";

import { useState, useTransition } from "react";
import { deleteClass } from "../../actions";

export function DeleteClass({ classId, name }: { classId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} className="text-[0.9rem] text-muted-foreground underline underline-offset-4 hover:text-flag">Delete this class</button>;
  }
  return (
    <div className="rounded-md border border-flag/40 bg-flag/5 p-4">
      <p className="font-semibold">Delete {name} and everything in it?</p>
      <p className="mt-1 text-[0.95rem]">Students, tests, scanned pages, marks and the audit history are permanently deleted. This can&apos;t be undone.</p>
      <label className="mt-3 grid gap-1">
        <span className="text-[0.9rem]">Type the class name to confirm</span>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} className="rounded-md border border-input bg-white px-3 py-2" />
      </label>
      <div className="mt-3 flex items-center gap-3">
        <button type="button" disabled={pending || typed.trim() !== name} onClick={() => start(async () => { const r = await deleteClass(classId, typed); if (r && !r.ok) setError(r.error); })}
          className="rounded-md bg-flag px-4 py-2 font-semibold text-white disabled:opacity-40">
          {pending ? "Deleting…" : "Delete permanently"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="underline underline-offset-4">Cancel</button>
      </div>
      {error && <p role="status" className="mt-2 text-flag">{error}</p>}
    </div>
  );
}
