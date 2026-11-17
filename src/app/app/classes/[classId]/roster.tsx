"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { addStudents, removeStudent } from "../../actions";

type Student = { id: string; display_name: string; anon_code: string };

export function Roster({ classId, students }: { classId: string; students: Student[] }) {
  const [names, setNames] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="mt-4">
      {students.length > 0 && (
        <ul className="divide-y divide-ruling border-y border-ruling">
          {students.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 px-1 py-2">
              <Link href={`/app/students/${s.id}`} className="underline-offset-4 hover:underline">
                {s.display_name} <span className="text-[0.9rem] text-muted-foreground">{s.anon_code}</span>
              </Link>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (!confirm(`Remove ${s.display_name}? Their uploaded scripts and marks are deleted too.`)) return;
                  start(async () => {
                    const r = await removeStudent(classId, s.id);
                    if (!r.ok) setMsg({ ok: false, text: r.error });
                  });
                }}
                className="text-[0.9rem] text-muted-foreground underline underline-offset-4 hover:text-flag"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="mt-4 grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await addStudents(classId, names);
            setMsg(r.ok ? { ok: true, text: r.message ?? "Added." } : { ok: false, text: r.error });
            if (r.ok) setNames("");
          });
        }}
      >
        <label htmlFor="names" className="text-[0.95rem] font-semibold">Add students</label>
        <textarea
          id="names"
          value={names}
          onChange={(e) => setNames(e.target.value)}
          rows={4}
          placeholder={"One name per line, or paste a list\nAda Lovelace\nAlan Turing"}
          className="rounded-md border border-input bg-white px-3 py-2"
        />
        <div className="flex items-center gap-3">
          <button disabled={pending || !names.trim()} className="rounded-md border border-ink/25 bg-white px-4 py-2 font-semibold hover:bg-secondary disabled:opacity-50">
            {pending ? "Adding…" : "Add to class"}
          </button>
          {msg && <span role="status" className={msg.ok ? "text-ok" : "text-flag"}>{msg.text}</span>}
        </div>
      </form>
    </div>
  );
}
