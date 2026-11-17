import { ChevronRight } from "lucide-react";
import Link from "next/link";

/** One consistent page header: breadcrumb, title, an optional line under it, and the page's actions on the right. */
export function PageHeader({ crumbs = [], title, sub, actions }: {
  crumbs?: { href: string; label: string }[];
  title: React.ReactNode;
  sub?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-8">
      {crumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-1.5 flex flex-wrap items-center gap-1 text-[0.9rem] text-muted-foreground">
          {crumbs.map((c, i) => (
            <span key={c.href} className="inline-flex items-center gap-1">
              {i > 0 && <ChevronRight aria-hidden className="size-3.5" />}
              <Link href={c.href} className="hover:text-ink hover:underline underline-offset-4">{c.label}</Link>
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[1.85rem] font-[750] leading-tight tracking-tight">{title}</h1>
          {sub && <div className="mt-1 text-muted-foreground">{sub}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/** Button-looking links and buttons in three weights, so every page uses the same ones. */
export const btn = {
  primary: "inline-flex items-center gap-2 rounded-md bg-redpen px-4 py-2 font-semibold text-white shadow-sm hover:bg-[#b81f1f] disabled:opacity-50",
  secondary: "inline-flex items-center gap-2 rounded-md border border-ink/20 bg-white px-3.5 py-2 font-semibold hover:bg-secondary disabled:opacity-50",
  quiet: "inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[0.95rem] font-semibold text-ink/80 hover:bg-secondary hover:text-ink",
};
