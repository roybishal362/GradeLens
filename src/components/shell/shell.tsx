import Link from "next/link";
import { Suspense } from "react";
import { requireTeacher } from "@/lib/dal";
import { LIMITS } from "@/lib/jobs/grade";
import { adminDb, userDb } from "@/lib/supabase/clients";
import { DesktopNav, MobileNav, type ShellData } from "./nav";

async function shellData(): Promise<ShellData> {
  const t = await requireTeacher();
  const db = await userDb();
  const [{ data: classes }, { data: profile }, { data: usage }] = await Promise.all([
    db.from("classes").select("id,name").eq("is_sample", false).order("created_at", { ascending: false }).limit(30),
    db.from("teacher_profiles").select("display_name").eq("user_id", t.id).maybeSingle<{ display_name: string | null }>(),
    // usage counters are server-only; the key is this teacher's own bucket
    adminDb().from("usage_counters").select("count").eq("day", new Date().toISOString().slice(0, 10)).eq("bucket", `grade:owner:${t.id}`).maybeSingle<{ count: number }>(),
  ]);
  const limit = t.isGuest ? LIMITS.guestScriptsPerDay : LIMITS.teacherScriptsPerDay;
  return {
    name: profile?.display_name || t.name || (t.isGuest ? "Guest" : t.email ?? "Teacher"),
    isGuest: t.isGuest,
    classes: (classes ?? []) as { id: string; name: string }[],
    usage: { scripts: Math.min(usage?.count ?? 0, limit), scriptLimit: limit },
  };
}

async function Desktop() { return <DesktopNav data={await shellData()} />; }
async function Mobile() { return <MobileNav data={await shellData()} />; }

/** Teacher area: sidebar on desktop, a menu drawer on phones. */
export function TeacherShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-1">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-ruling bg-white px-3 py-4 lg:flex">
        <Link href="/app" className="mb-5 px-2.5 text-lg font-[750] tracking-tight">GradeLens</Link>
        <Suspense fallback={<div className="flex-1" />}><Desktop /></Suspense>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-ruling bg-white px-4 py-2.5 lg:hidden">
          <Suspense fallback={<span className="size-8" />}><Mobile /></Suspense>
          <Link href="/app" className="text-lg font-[750] tracking-tight">GradeLens</Link>
        </header>
        <div className="flex-1">{children}</div>
      </div>
    </div>
  );
}
