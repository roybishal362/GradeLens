import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { requireTeacher } from "@/lib/dal";
import { LIMITS } from "@/lib/jobs/grade";
import { adminDb, userDb } from "@/lib/supabase/clients";
import { DeleteAccount, ProfileForm } from "./forms";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-8">
      <PageHeader title="Settings" />
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <View />
      </Suspense>
    </main>
  );
}

const panel = "rounded-lg border border-ruling bg-white p-5";

async function View() {
  const t = await requireTeacher("/app/settings");
  const db = await userDb();
  const today = new Date().toISOString().slice(0, 10);
  const [{ data: profile }, { data: counters }] = await Promise.all([
    db.from("teacher_profiles").select("display_name,school").eq("user_id", t.id).maybeSingle<{ display_name: string | null; school: string | null }>(),
    adminDb().from("usage_counters").select("bucket,count").eq("day", today).in("bucket", [`grade:owner:${t.id}`, `ai:text:${t.id}`]),
  ]);
  const used = (b: string) => (counters ?? []).find((c: { bucket: string }) => c.bucket === b)?.count ?? 0;
  const scriptLimit = t.isGuest ? LIMITS.guestScriptsPerDay : LIMITS.teacherScriptsPerDay;
  const aiLimit = t.isGuest ? 15 : 60;
  return (
    <div className="space-y-6">
      <section className={panel} aria-labelledby="p">
        <h2 id="p" className="font-semibold">Your details</h2>
        <p className="mt-1 text-[0.95rem] text-muted-foreground">Shown on reports and on your students&apos; results pages.</p>
        <ProfileForm displayName={profile?.display_name ?? t.name ?? ""} school={profile?.school ?? ""} />
      </section>

      <section className={panel} aria-labelledby="u">
        <h2 id="u" className="font-semibold">Today&apos;s free usage</h2>
        <p className="mt-1 text-[0.95rem] text-muted-foreground">GradeLens runs on free AI services, so each account has a daily allowance. It resets every day.</p>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          {[["Scripts marked", used(`grade:owner:${t.id}`), scriptLimit], ["Mark schemes, paper checks and insights", used(`ai:text:${t.id}`), aiLimit]].map(([k, n, max]) => (
            <div key={k as string}>
              <dt className="text-[0.9rem]">{k}</dt>
              <dd className="mt-1 flex items-center gap-3">
                <div className="h-2 flex-1 rounded-full bg-[#e3e9f4]"><div className="h-full rounded-full bg-[#2f4b8f]" style={{ width: `${Math.min(100, (100 * Number(n)) / Number(max))}%` }} /></div>
                <span className="text-[0.9rem] tabular-nums">{Math.min(Number(n), Number(max))} / {max}</span>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className={panel} aria-labelledby="a">
        <h2 id="a" className="font-semibold">Account</h2>
        <p className="mt-1 text-[0.95rem]">{t.isGuest ? "Guest workspace. It is deleted automatically 7 days after it was created." : `Signed in as ${t.email ?? t.name ?? "your Google account"}.`}</p>
        <div className="mt-4 border-t border-ruling pt-4"><DeleteAccount /></div>
      </section>
    </div>
  );
}
