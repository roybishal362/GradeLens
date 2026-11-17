import { histogram } from "@/lib/results";
import { VIZ } from "./charts";

/**
 * How the class scored: one series, 10-point bands, counts on the bars (dataviz skill: thin columns with rounded
 * data ends on one baseline, recessive axis, no legend for a single series, hover/focus label on every bar).
 */
export function ScoreChart({ percentages }: { percentages: number[] }) {
  const bands = histogram(percentages);
  const top = Math.max(1, ...bands.map((b) => b.count));
  return (
    <figure>
      <div className="flex h-36 items-end gap-[2px] border-b border-ruling" role="img"
        aria-label={`Scores of ${percentages.length} scripts: ${bands.filter((b) => b.count).map((b) => `${b.count} between ${b.from} and ${b.to}%`).join(", ")}`}>
        {bands.map((b) => (
          <div key={b.from} className="group relative flex h-full flex-1 flex-col items-center justify-end">
            {b.count > 0 && <span className="mb-0.5 text-[0.75rem] tabular-nums text-muted-foreground">{b.count}</span>}
            <div className="w-full max-w-6 rounded-t-[4px]" style={{ height: `${(b.count / top) * 80}%`, minHeight: b.count ? 3 : 0, background: VIZ.fill }} />
            <span role="tooltip" className="pointer-events-none absolute bottom-full mb-1 hidden whitespace-nowrap rounded bg-ink px-2 py-1 text-[0.75rem] text-white group-hover:block">
              {b.count} script{b.count === 1 ? "" : "s"}, {b.from}–{b.to}%
            </span>
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-[2px] text-[0.7rem] tabular-nums text-muted-foreground">
        {bands.map((b) => <span key={b.from} className="flex-1 text-center">{b.from}</span>)}
      </div>
      <figcaption className="sr-only">Number of scripts in each 10% score band</figcaption>
    </figure>
  );
}
