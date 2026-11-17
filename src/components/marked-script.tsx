"use client";

import Link from "next/link";
import { useState } from "react";
import { fmtMark } from "@/components/marks";
import type { HeroData } from "@/lib/db/hero";

/**
 * The landing-page hero: a REAL answer from the public sample class, exactly as GradeLens marked it (scan crop, line
 * boxes from the reader, criteria and reasons from the grader, the dataset teacher's mark for comparison).
 */
export function MarkedScript({ data }: { data: HeroData }) {
  const first = data.criteria.find((c) => c.score > 0)?.id ?? data.criteria[0]?.id;
  const [active, setActive] = useState<string>(first);
  const [approved, setApproved] = useState(false);
  const { crop, image } = data;
  const cw = ((crop.x1 - crop.x0) / 1000) * image.w, ch = ((crop.y1 - crop.y0) / 1000) * image.h;
  const pos = ([y0, x0, y1, x1]: [number, number, number, number]): React.CSSProperties => ({
    left: `${((x0 - crop.x0) / (crop.x1 - crop.x0)) * 100}%`,
    top: `${((y0 - crop.y0) / (crop.y1 - crop.y0)) * 100}%`,
    width: `${((x1 - x0) / (crop.x1 - crop.x0)) * 100}%`,
    height: `${((y1 - y0) / (crop.y1 - crop.y0)) * 100}%`,
  });

  return (
    <figure className="w-full">
      <div className="mb-2 flex items-end justify-between gap-4">
        <p className="text-[0.95rem] text-muted-foreground">
          <span className="font-semibold text-ink">Question {data.question.q}.</span> {data.question.text}
        </p>
        <span className="mark shrink-0 text-4xl" data-approved={approved} aria-label={`${fmtMark(data.suggested)} out of ${fmtMark(data.question.max)}, ${approved ? "approved" : "suggested"}`}>
          {fmtMark(data.suggested)}/{fmtMark(data.question.max)}
        </span>
      </div>
      <div className="relative overflow-hidden rounded-md border bg-white shadow-[0_1px_0_var(--gl-ruling)]" style={{ aspectRatio: `${cw} / ${ch}` }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- absolute crop of a large scan */}
        <img
          src={image.src}
          alt={`${data.student}'s handwritten answer to question ${data.question.q}`}
          className="absolute max-w-none select-none"
          style={{
            width: `${(1000 / (crop.x1 - crop.x0)) * 100}%`,
            left: `${(-crop.x0 / (crop.x1 - crop.x0)) * 100}%`,
            top: `${(-crop.y0 / (crop.y1 - crop.y0)) * 100}%`,
          }}
          draggable={false}
        />
        {data.lines.map((l, i) => l.criteria.includes(active) && (
          <span key={`${active}-${i}`} aria-hidden className="highlight absolute origin-left animate-[sweep_450ms_ease-out_both] mix-blend-multiply" style={pos(l.box)} />
        ))}
      </div>

      <ol className="mt-4 divide-y divide-ruling border-y border-ruling">
        {data.criteria.map((c) => (
          <li key={c.id}>
            <button type="button" aria-pressed={active === c.id} onMouseEnter={() => setActive(c.id)} onFocus={() => setActive(c.id)} onClick={() => setActive(c.id)}
              className="grid w-full grid-cols-[1fr_auto] items-baseline gap-x-3 gap-y-0.5 px-1 py-2.5 text-left hover:bg-secondary/60 aria-pressed:bg-secondary">
              <span className="font-semibold">{c.label}</span>
              <span className="mark text-2xl" data-approved={approved}>{fmtMark(c.score)}/{fmtMark(c.max)}</span>
              <span className="col-span-2 text-[0.95rem] text-muted-foreground">{c.reason}</span>
            </button>
          </li>
        ))}
      </ol>

      <figcaption className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <span className="text-[0.95rem] text-muted-foreground">
          {approved ? "Approved. This mark now counts." : "Pencil means suggested. Select a line to see its evidence."}{" "}
          The dataset&apos;s own teacher gave {fmtMark(data.teacherMark)}/{fmtMark(data.question.max)}.
        </span>
        <button type="button" onClick={() => setApproved((a) => !a)} className="rounded-md border border-redpen px-3 py-1.5 font-semibold text-redpen hover:bg-redpen hover:text-white">
          {approved ? "Undo approval" : `Approve ${fmtMark(data.suggested)}/${fmtMark(data.question.max)}`}
        </button>
      </figcaption>
      <p className="mt-2 text-[0.8rem] text-muted-foreground">
        {data.student}, a real script from the <Link href="/sample" className="underline underline-offset-2">public sample class</Link> (Mendeley dataset, CC BY 4.0).
      </p>
    </figure>
  );
}
