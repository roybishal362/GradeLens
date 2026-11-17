import Link from "next/link";
import { Suspense } from "react";
import { signOut } from "@/app/sign-in/actions";
import { currentTeacher } from "@/lib/dal";

/** Top bar for the teacher area and the sample class. The account part streams in (it reads the session). */
export function AppHeader({ sample = false }: { sample?: boolean }) {
  return (
    <header className="border-b border-ruling bg-white/70">
      <div className="mx-auto grid w-full max-w-7xl grid-cols-[auto_1fr_auto] items-center gap-x-5 gap-y-1 px-5 py-2.5 sm:py-3">
        <Link href="/" className="col-start-1 row-start-1 text-lg font-[750] tracking-tight">GradeLens</Link>
        {/* on phones the links sit on their own row under the logo and account */}
        <nav className="col-span-3 col-start-1 row-start-2 flex items-center gap-4 overflow-x-auto whitespace-nowrap text-[0.9rem] sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:text-[0.95rem]">
          <Link href="/app" className="underline-offset-4 hover:underline">Your classes</Link>
          <Link href="/sample" className={`underline-offset-4 hover:underline ${sample ? "font-semibold" : ""}`}>Sample class</Link>
          <Link href="/transparency" className="underline-offset-4 hover:underline"><span className="sm:hidden">Accuracy</span><span className="hidden sm:inline">How accurate is it?</span></Link>
        </nav>
        <div className="col-start-3 row-start-1 justify-self-end">
          <Suspense fallback={<span className="h-6 w-24" />}>
            <Account />
          </Suspense>
        </div>
      </div>
    </header>
  );
}

async function Account() {
  const t = await currentTeacher();
  if (!t) {
    return <Link href="/sign-in" className="text-[0.95rem] font-semibold underline underline-offset-4">Sign in</Link>;
  }
  return (
    <form action={signOut} className="flex items-center gap-3 text-[0.95rem]">
      <span className="text-muted-foreground">
        {t.isGuest ? <>Guest<span className="hidden sm:inline"> (deleted after 7 days)</span></> : <span className="hidden sm:inline">{t.name ?? t.email ?? "Signed in"}</span>}
      </span>
      <button className="underline underline-offset-4">Sign out</button>
    </form>
  );
}
