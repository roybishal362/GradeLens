/**
 * Small charts for class insights (dataviz skill: meter list, thin segmented bar, dumbbell).
 * One hue (the ink-blue ramp), validated with the skill's palette checker (ordinal: monotone lightness, single hue).
 * Text never wears the data colour; every mark has a hover/focus label, and every figure is also printed as text.
 */
export const VIZ = {
  fill: "#2f4b8f", // meter fill, "after" dot
  track: "#e3e9f4", // lighter step of the same ramp
  zero: "#9db3d9", // ordinal: no marks (answered)
  partial: "#5b7bbf", // ordinal: some marks
  full: "#1c2541", // ordinal: full marks
  blank: "#d4d8df", // neutral: not answered (outside the ramp, named in the legend)
  before: "#9db3d9",
};

/** A ratio against its whole: name + bar + figure (the figure is the source of truth; the bar is a glance). */
export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <span className="group relative block h-2.5 w-full rounded-full" style={{ background: VIZ.track }} role="img" aria-label={label} tabIndex={0}>
      {pct > 0 && <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct * 100}%`, background: VIZ.fill }} />}
      <Tip>{label}</Tip>
    </span>
  );
}

/** One whole split into ordered parts (full / partial / zero / blank), 8 px, no text on the bar. */
export function MarkSplit({ full, partial, zero, blank, label }: { full: number; partial: number; zero: number; blank: number; label: string }) {
  const total = full + partial + zero + blank;
  const parts = [
    { k: "full", v: full, c: VIZ.full },
    { k: "partial", v: partial, c: VIZ.partial },
    { k: "zero", v: zero, c: VIZ.zero },
    { k: "blank", v: blank, c: VIZ.blank },
  ].filter((p) => p.v > 0);
  return (
    <span className="group relative flex h-2 w-full gap-[2px]" role="img" aria-label={label} tabIndex={0}>
      {total === 0 ? <span className="h-full w-full rounded-full" style={{ background: VIZ.track }} /> : parts.map((p) => (
        <span key={p.k} className="h-full rounded-full" style={{ width: `${(p.v / total) * 100}%`, background: p.c }} />
      ))}
      <Tip>{label}</Tip>
    </span>
  );
}

export function MarkSplitLegend() {
  const items = [["Full marks", VIZ.full], ["Some marks", VIZ.partial], ["No marks", VIZ.zero], ["Not answered", VIZ.blank]] as const;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[0.85rem] text-muted-foreground" aria-label="Legend">
      {items.map(([name, c]) => (
        <li key={name} className="inline-flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-full" style={{ background: c }} />{name}</li>
      ))}
    </ul>
  );
}

/** Before -> after for one student, on a 0-100% scale. */
export function Dumbbell({ pre, post, label }: { pre: number; post: number; label: string }) {
  const a = Math.max(0, Math.min(1, pre)) * 100, b = Math.max(0, Math.min(1, post)) * 100;
  return (
    <span className="group relative block h-4 w-full" role="img" aria-label={label} tabIndex={0}>
      <span aria-hidden className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2" style={{ background: VIZ.track }} />
      <span aria-hidden className="absolute top-1/2 h-0.5 -translate-y-1/2" style={{ left: `${Math.min(a, b)}%`, width: `${Math.abs(b - a)}%`, background: VIZ.before }} />
      <Dot at={a} color={VIZ.before} />
      <Dot at={b} color={VIZ.fill} />
      <Tip>{label}</Tip>
    </span>
  );
}

function Dot({ at, color }: { at: number; color: string }) {
  return <span aria-hidden className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white" style={{ left: `${at}%`, background: color }} />;
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <span role="tooltip" className="pointer-events-none absolute bottom-full left-0 z-10 mb-1.5 hidden whitespace-nowrap rounded bg-ink px-2 py-1 text-[0.8rem] text-white shadow group-hover:block group-focus-visible:block">
      {children}
    </span>
  );
}
