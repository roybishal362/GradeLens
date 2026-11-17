import Link from "next/link";
import { MarkedScript } from "@/components/marked-script";
import { heroAnswer } from "@/lib/db/hero";

const MOMENTS = [
  {
    title: "Every mark points at its evidence",
    body: "Each suggested mark quotes the student's own words, highlighted on their page. If a grader quotes words the student didn't write, code catches it and the mark waits for you.",
  },
  {
    title: "See what the class misunderstood",
    body: "Wrong ideas are grouped into misconceptions with the number of students who hold each one, then a 10-minute re-teach plan, a worksheet and a short re-test. When the re-test is marked, you see who improved.",
  },
  {
    title: "Nothing counts until you approve it",
    body: "Two different AI models mark every answer independently. Disagreements, unclear handwriting and suspicious answers wait for you, and every decision you make is logged.",
  },
  {
    title: "It learns how you mark",
    body: "The first scripts you check become examples of your standard. GradeLens can re-mark the rest to match the way you mark.",
  },
];

export default async function Home() {
  const hero = await heroAnswer();
  return (
    <>
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5">
        <Link href="/" className="text-xl font-[750] tracking-tight">GradeLens</Link>
        <nav className="flex items-center gap-5 text-[0.95rem]">
          <Link href="/sample" className="underline-offset-4 hover:underline">Open the sample class</Link>
          <Link href="/transparency" className="hidden underline-offset-4 hover:underline sm:inline">How accurate is it?</Link>
          <Link href="/sign-in" className="font-semibold underline-offset-4 hover:underline">Sign in</Link>
        </nav>
      </header>

      <main className="flex-1">
        <section className="mx-auto grid w-full max-w-6xl gap-12 px-5 pb-16 pt-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-center lg:pt-16">
          <div className="max-w-xl">
            <h1 className="text-[2.45rem] font-[750] leading-[1.1] tracking-tight sm:text-[2.9rem]">
              Marks you can check against the student&apos;s own words.
            </h1>
            <p className="mt-5 text-lg text-muted-foreground">
              GradeLens reads photographed answer sheets, suggests marks from your mark scheme, and shows the exact handwriting
              behind each one. You approve. You don&apos;t grade.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link href="/sample" className="rounded-md bg-redpen px-5 py-3 font-semibold text-white shadow-sm hover:bg-[#b81f1f]">
                Open the sample class
              </Link>
              <Link href="/sign-in" className="px-1 py-3 font-semibold underline underline-offset-4 decoration-ruling hover:decoration-ink">
                Start your own class
              </Link>
            </div>
            <p className="mt-4 text-[0.95rem] text-muted-foreground">
              The sample class is real university exam scripts from a public research dataset, with the teacher&apos;s own marks to compare against.
            </p>
          </div>
          {hero ? <MarkedScript data={hero} /> : (
            <div className="margin-rule bg-white p-6">
              <p className="text-lg font-semibold">See it on real scripts</p>
              <p className="mt-2 text-muted-foreground">Open the sample class to review real handwritten answers marked by GradeLens.</p>
            </div>
          )}
        </section>

        <section className="border-t border-ruling bg-white">
          <div className="mx-auto grid w-full max-w-6xl gap-x-10 gap-y-10 px-5 py-16 md:grid-cols-2 lg:grid-cols-4">
            {MOMENTS.map((m) => (
              <div key={m.title} className="margin-rule pl-5">
                <h2 className="text-xl font-[750] leading-snug">{m.title}</h2>
                <p className="mt-3 text-muted-foreground">{m.body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-ruling">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-6 text-[0.95rem] text-muted-foreground">
          <span>
            Sample scripts: Dinesh K P, Mendeley Data, <a href="https://doi.org/10.17632/sf3kvjwknt.1" className="underline underline-offset-2">doi:10.17632/sf3kvjwknt.1</a>, CC BY 4.0.
          </span>
          <span className="flex gap-4">
            <Link href="/transparency" className="underline underline-offset-4">How we measure accuracy</Link>
            <Link href="/transparency#privacy" className="underline underline-offset-4">Where student work goes</Link>
          </span>
        </div>
      </footer>
    </>
  );
}
