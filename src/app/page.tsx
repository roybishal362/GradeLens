import { FileSpreadsheet, GraduationCap, Highlighter, Lightbulb, ScanLine, Send, ShieldCheck, SlidersHorizontal } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { MarkedScript } from "@/components/marked-script";
import summary from "@/data/eval-summary.json";
import { heroAnswer } from "@/lib/db/hero";
import { samplePracticePath } from "@/lib/db/sample";
import reviewShot from "../../public/screens/13-review.png";
import collectShot from "../../public/screens/how-collect.png";
import reviewCrop from "../../public/screens/how-review.png";
import teachShot from "../../public/screens/how-teach.png";

const main = (summary.modes as Record<string, { n: number; withinHalf: number }>)["calibrated + learned shifts"];
const mcqPct = Math.round((100 * summary.mcq.lettersCorrect) / Math.max(1, summary.mcq.lettersRead));

const FEATURES = [
  { icon: Highlighter, title: "Every mark shows its evidence", body: "The words behind each mark are highlighted on the student's page. Quotes are checked against the answer." },
  { icon: ScanLine, title: "Paper, phone or typed", body: "Students photograph their pages or type their answers, or you print QR answer sheets and scan the pile in any order." },
  { icon: SlidersHorizontal, title: "Learns how you mark", body: "Your first decisions become the standard for the rest of the class, and it shows how often you keep its marks. Every adjusted mark says why." },
  { icon: Lightbulb, title: "What the class misunderstood", body: "Wrong ideas grouped and counted, with a 10-minute re-teach plan, a worksheet and a re-test." },
  { icon: Send, title: "Results for students and parents", body: "Release when you're ready. Each student gets a private page with marks and feedback to read or listen to, and can ask for a re-check." },
  { icon: FileSpreadsheet, title: "Gradebook and exports", body: "Every student across every test, letter grades, and CSV files for Excel, Sheets or your school's system." },
  { icon: GraduationCap, title: "Practice for students", body: "A practice link gives instant feedback on any question, typed or handwritten, without it counting as a grade. Tutors and self-learners can use it too." },
  { icon: ShieldCheck, title: "Trust is earned, not assumed", body: "Nothing counts until you approve it. Marks can only be approved together on questions where it has matched you, and a 0 on a written answer always waits for you." },
];

const FAQ = [
  ["Is it accurate enough to mark on its own?", "No, and it isn't meant to. It does the first pass and shows its evidence; you make every decision, and it tells you how often you've kept its marks on each question."],
  ["What do students need?", "A phone with a camera, a device to type on, or nothing at all if you use printed answer sheets."],
  ["What can it mark?", "Written answers, maths working, labelled diagrams and multiple choice, in English."],
  ["Does it cost anything?", "No. It runs on free AI services, with a daily allowance per account."],
];

export default async function Home() {
  const [hero, practice] = await Promise.all([heroAnswer(), samplePracticePath()]);
  return (
    <>
      <header className="sticky top-0 z-30 border-b border-ruling/70 bg-paper/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-3">
          <Link href="/" className="text-xl font-[750] tracking-tight">GradeLens</Link>
          <nav className="hidden items-center gap-6 text-[0.95rem] md:flex">
            <a href="#how" className="hover:underline underline-offset-4">How it works</a>
            <a href="#features" className="hover:underline underline-offset-4">Features</a>
            <Link href="/transparency" className="hover:underline underline-offset-4">Accuracy</Link>
            <Link href="/help" className="hover:underline underline-offset-4">Help</Link>
          </nav>
          <div className="flex items-center gap-3 text-[0.95rem]">
            <Link href="/sample" className="hidden rounded-md border border-ink/20 bg-white px-3 py-1.5 font-semibold hover:bg-secondary sm:inline-block">Sample class</Link>
            <Link href="/sign-in" className="rounded-md bg-ink px-3 py-1.5 font-semibold text-white hover:bg-ink/90">Sign in</Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* hero */}
        <section className="mx-auto grid w-full max-w-6xl gap-12 px-5 pb-14 pt-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-center lg:pt-16">
          <div className="max-w-xl">
            <p className="text-[0.95rem] font-semibold text-redpen">For teachers, tutors and their students</p>
            <h1 className="mt-3 text-[2.5rem] font-[750] leading-[1.08] tracking-tight sm:text-[3rem]">
              Marking that shows its working.
            </h1>
            <p className="mt-5 text-lg text-muted-foreground">
              GradeLens reads photographed answer sheets and suggests every mark from your mark scheme, pointing to the
              student&apos;s own words on the page. It learns how you mark, and has to match you before it can save you a click.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/sample" className="rounded-md bg-redpen px-5 py-3 font-semibold text-white shadow-sm hover:bg-[#b81f1f]">Try it on real scripts</Link>
              <Link href="/sign-in" className="rounded-md border border-ink/20 bg-white px-5 py-3 font-semibold hover:bg-secondary">Start your class</Link>
            </div>
            <p className="mt-4 text-[0.95rem] text-muted-foreground">
              No sign-up needed.{practice && <> Or <Link href={practice} className="font-semibold text-ink underline underline-offset-4">answer an exam question yourself</Link> and get feedback in under a minute.</>}
            </p>
          </div>
          {hero ? <MarkedScript data={hero} /> : <Image src={reviewShot} alt="The review screen" className="rounded-lg border border-ruling shadow-sm" priority sizes="(min-width: 1024px) 40rem, 100vw" />}
        </section>

        {/* measured, not claimed */}
        <section aria-label="Measured results" className="border-y border-ruling bg-white">
          <dl className="mx-auto grid w-full max-w-6xl gap-px bg-ruling px-0 sm:grid-cols-3">
            {[
              [`${Math.round(main.withinHalf * 100)}%`, `of marks within half a mark of a real teacher's, on ${main.n} answers it had never seen`],
              [`${mcqPct}%`, "of handwritten multiple-choice answers read correctly"],
              ["2", "independent AI markers on every written answer, checked against each other"],
            ].map(([n, t]) => (
              <div key={t} className="bg-white px-6 py-6">
                <dt className="text-[2.2rem] font-[750] leading-none tracking-tight">{n}</dt>
                <dd className="mt-2 text-[0.95rem] text-muted-foreground">{t}</dd>
              </div>
            ))}
          </dl>
          <p className="mx-auto max-w-6xl px-6 pb-4 text-[0.85rem] text-muted-foreground">
            Measured on a public dataset of real university exams. <Link href="/transparency" className="underline underline-offset-2">Method and limits</Link>
          </p>
        </section>

        {/* how it works */}
        <section id="how" className="mx-auto w-full max-w-6xl scroll-mt-16 px-5 py-16">
          <h2 className="text-[1.9rem] font-[750] tracking-tight">How it works</h2>
          <ol className="mt-8 grid gap-8 md:grid-cols-3">
            {[
              { n: 1, t: "Collect", d: "Students photograph their pages on a phone, or you scan a pile of printed answer sheets.", img: collectShot, alt: "The student upload page on a phone" },
              { n: 2, t: "Review", d: "Each mark comes with the student's words highlighted. Approve it, change it, move on.", img: reviewCrop, alt: "Reviewing a script with the evidence highlighted" },
              { n: 3, t: "Teach", d: "See what the class misunderstood and get a plan for the next lesson.", img: teachShot, alt: "Class insights with misconceptions and a re-teach plan" },
            ].map((s) => (
              <li key={s.n} className="flex flex-col">
                <div className="relative aspect-[4/3] overflow-hidden rounded-lg border border-ruling bg-[#eef1f6]">
                  <Image src={s.img} alt={s.alt} fill sizes="(min-width: 768px) 24rem, 100vw" className="object-cover object-left-top" />
                </div>
                <p className="mt-4 flex items-center gap-2 font-semibold"><span className="grid size-6 place-items-center rounded-full bg-ink text-[0.8rem] text-white">{s.n}</span>{s.t}</p>
                <p className="mt-1 text-muted-foreground">{s.d}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* features */}
        <section id="features" className="scroll-mt-16 border-y border-ruling bg-white">
          <div className="mx-auto w-full max-w-6xl px-5 py-16">
            <h2 className="text-[1.9rem] font-[750] tracking-tight">Built around how teachers mark</h2>
            <ul className="mt-8 grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURES.map((f) => (
                <li key={f.title}>
                  <f.icon aria-hidden className="size-6 text-redpen" />
                  <h3 className="mt-3 font-semibold">{f.title}</h3>
                  <p className="mt-1 text-[0.95rem] text-muted-foreground">{f.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* questions + call to action */}
        <section className="mx-auto grid w-full max-w-6xl gap-12 px-5 py-16 lg:grid-cols-2">
          <div>
            <h2 className="text-[1.9rem] font-[750] tracking-tight">Questions</h2>
            <dl className="mt-6 space-y-5">
              {FAQ.map(([q, a]) => <div key={q}><dt className="font-semibold">{q}</dt><dd className="mt-1 text-muted-foreground">{a}</dd></div>)}
            </dl>
            <p className="mt-6"><Link href="/help#faq" className="font-semibold underline underline-offset-4">More questions</Link></p>
          </div>
          <div className="self-start rounded-lg bg-ink p-8 text-white">
            <h2 className="text-[1.6rem] font-[750] leading-tight tracking-tight">See it on real exam scripts</h2>
            <p className="mt-3 text-white/80">Real handwritten scripts with the real teacher&apos;s marks next to every suggestion. No sign-up.</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/sample" className="rounded-md bg-redpen px-5 py-2.5 font-semibold text-white hover:bg-[#b81f1f]">Open the sample class</Link>
              <Link href="/sign-in" className="rounded-md border border-white/40 px-5 py-2.5 font-semibold hover:bg-white/10">Start your class</Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-ruling bg-white">
        <div className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-8 text-[0.95rem] sm:grid-cols-[1fr_auto]">
          <div>
            <p className="font-[750]">GradeLens</p>
            <p className="mt-1 max-w-xl text-[0.85rem] text-muted-foreground">
              Sample scripts: Dinesh K P, Mendeley Data, <a href="https://doi.org/10.17632/sf3kvjwknt.1" className="underline underline-offset-2">doi:10.17632/sf3kvjwknt.1</a>, CC BY 4.0.
            </p>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href="/sample" className="hover:underline underline-offset-4">Sample class</Link>
            <Link href="/help" className="hover:underline underline-offset-4">Help</Link>
            <Link href="/transparency" className="hover:underline underline-offset-4">Accuracy</Link>
            <Link href="/transparency#privacy" className="hover:underline underline-offset-4">Privacy</Link>
          </nav>
        </div>
      </footer>
    </>
  );
}
