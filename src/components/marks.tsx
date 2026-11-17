import type { Risk } from "@/lib/db/types";

/** "1½", "2", "0" — marks written the way a teacher writes them. */
export function fmtMark(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "–";
  const whole = Math.floor(n), half = Math.abs(n - whole - 0.5) < 1e-9;
  if (half) return whole === 0 ? "½" : `${whole}½`;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** A handwritten mark: pencil while it's the AI's suggestion, red pen once a teacher decided it. */
export function Mark({ value, max, approved, className = "" }: { value: number | null; max?: number; approved: boolean; className?: string }) {
  const label = `${fmtMark(value)}${max !== undefined ? ` out of ${fmtMark(max)}` : ""}, ${approved ? "approved by the teacher" : "suggested by GradeLens"}`;
  return (
    <span className={`mark whitespace-nowrap ${className}`} data-approved={approved} aria-label={label} title={label}>
      {fmtMark(value)}{max !== undefined && <span className="opacity-80">/{fmtMark(max)}</span>}
    </span>
  );
}

const RISK: Record<Risk, { label: string; icon: string; cls: string }> = {
  low: { label: "Ready", icon: "✓", cls: "text-ok" },
  medium: { label: "Needs a look", icon: "◐", cls: "text-check" },
  high: { label: "Check carefully", icon: "⚑", cls: "text-flag" },
};

/** Risk is never colour alone: icon + words. */
export function RiskLabel({ risk, className = "" }: { risk: Risk | null; className?: string }) {
  if (!risk) return null;
  const r = RISK[risk];
  return (
    <span className={`inline-flex items-center gap-1 text-[0.9rem] font-semibold ${r.cls} ${className}`}>
      <span aria-hidden>{r.icon}</span>{r.label}
    </span>
  );
}

export const STATUS_LABEL: Record<string, string> = {
  uploaded: "Uploading",
  queued: "Waiting to be marked",
  reading: "Reading the handwriting",
  grading: "Marking",
  graded: "Marked, waiting for you",
  failed: "Couldn't be marked",
  approved: "Approved",
};
