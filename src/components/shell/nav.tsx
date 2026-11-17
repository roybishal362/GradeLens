"use client";

import { BookOpen, GraduationCap, LayoutGrid, LifeBuoy, Menu, Plus, Settings, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { signOut } from "@/app/sign-in/actions";

export type ShellData = {
  name: string;
  isGuest: boolean;
  classes: { id: string; name: string }[];
  usage: { scripts: number; scriptLimit: number };
};

const MAIN = [
  { href: "/app", label: "Classes", icon: LayoutGrid, exact: true },
  { href: "/sample", label: "Sample class", icon: BookOpen },
  { href: "/help", label: "Help", icon: LifeBuoy },
  { href: "/app/settings", label: "Settings", icon: Settings },
];

function Item({ href, label, Icon, active, onClick }: { href: string; label: string; Icon?: typeof LayoutGrid; active: boolean; onClick?: () => void }) {
  return (
    <Link href={href} onClick={onClick} aria-current={active ? "page" : undefined}
      className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[0.95rem] ${active ? "bg-secondary font-semibold text-ink" : "text-ink/80 hover:bg-secondary/70 hover:text-ink"}`}>
      {Icon && <Icon aria-hidden className="size-4 shrink-0" />}
      <span className="truncate">{label}</span>
    </Link>
  );
}

function NavBody({ data, onNavigate }: { data: ShellData; onNavigate?: () => void }) {
  const path = usePathname();
  const on = (href: string, exact = false) => (exact ? path === href : path === href || path.startsWith(`${href}/`));
  const usedPct = Math.min(100, (100 * data.usage.scripts) / Math.max(1, data.usage.scriptLimit));
  return (
    <div className="flex h-full flex-col">
      <nav aria-label="Main" className="space-y-0.5">
        {MAIN.map((m) => <Item key={m.href} href={m.href} label={m.label} Icon={m.icon} active={on(m.href, m.exact)} onClick={onNavigate} />)}
      </nav>
      <div className="mt-6">
        <p className="px-2.5 text-[0.8rem] font-semibold uppercase tracking-wide text-muted-foreground">Your classes</p>
        <nav aria-label="Your classes" className="mt-1.5 space-y-0.5">
          {data.classes.map((c) => <Item key={c.id} href={`/app/classes/${c.id}`} label={c.name} Icon={GraduationCap} active={path.startsWith(`/app/classes/${c.id}`)} onClick={onNavigate} />)}
          <Link href="/app#new-class" onClick={onNavigate} className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[0.95rem] text-muted-foreground hover:bg-secondary/70 hover:text-ink">
            <Plus aria-hidden className="size-4" /> New class
          </Link>
        </nav>
      </div>
      <div className="mt-auto space-y-3 border-t border-ruling pt-4">
        <div>
          <div className="flex justify-between text-[0.8rem] text-muted-foreground">
            <span>Scripts marked today</span><span className="tabular-nums">{data.usage.scripts} / {data.usage.scriptLimit}</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-[#e3e9f4]" role="img" aria-label={`${data.usage.scripts} of ${data.usage.scriptLimit} scripts marked today`}>
            <div className="h-full rounded-full bg-[#2f4b8f]" style={{ width: `${usedPct}%` }} />
          </div>
        </div>
        <form action={signOut} className="flex items-center justify-between gap-2 text-[0.9rem]">
          <span className="min-w-0 truncate font-semibold">{data.name}{data.isGuest && <span className="ml-1 font-normal text-muted-foreground">· guest</span>}</span>
          <button className="shrink-0 text-muted-foreground underline underline-offset-4 hover:text-ink">Sign out</button>
        </form>
      </div>
    </div>
  );
}

export function DesktopNav({ data }: { data: ShellData }) {
  return <NavBody data={data} />;
}

export function MobileNav({ data }: { data: ShellData }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)} className="rounded-md p-1.5 hover:bg-secondary">
        <Menu aria-hidden className="size-5" />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-ink/30" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col bg-white p-4 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <Link href="/app" onClick={() => setOpen(false)} className="text-lg font-[750] tracking-tight">GradeLens</Link>
              <button type="button" aria-label="Close menu" onClick={() => setOpen(false)} className="rounded-md p-1.5 hover:bg-secondary"><X aria-hidden className="size-5" /></button>
            </div>
            <NavBody data={data} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
