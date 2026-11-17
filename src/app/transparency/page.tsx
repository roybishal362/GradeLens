import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { DatasetAttribution } from "@/components/attribution";
import summary from "@/data/eval-summary.json";

export const metadata: Metadata = {
  title: "How accurate is it?",
  description: "GradeLens measured against a real teacher's marks on real handwritten exams, with its limits and where student work goes.",
};

type Mode = { n: number; exact: number; withinHalf: number; mae: number; bias: number; qwk: number; autoApprovable: number; withinHalfAmongLow: number | null; errorsCaught: number | null; errors: number; caught: number };
const modes = summary.modes as Record<string, Mode>;
const ORDER: { key: string; label: string; what: string }[] = [
  { key: "rubric only", label: "Mark scheme only", what: "GradeLens with nothing but the mark scheme." },
  { key: "calibrated", label: "With your examples", what: "The graders also see answers the teacher already marked." },
  { key: "rubric + learned shifts", label: "With learned shifts", what: "Each question's suggestion moved by how much more generous the teacher was on it." },
  { key: "calibrated + learned shifts", label: "Both (what GradeLens does)", what: "Examples in the prompt, then the learned shift: how GradeLens re-marks after you review." },
].filter((m) => modes[m.key]);
const main = modes["calibrated + learned shifts"] ?? modes["calibrated"] ?? modes["rubric only"];

const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)}%`);
/** Wilson score interval (95%) for a proportion: honest error bars for a small sample. */
function wilson(p: number, n: number): [number, number] {
  const z = 1.96, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n), m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)];
}
const [lo, hi] = wilson(main.withinHalf, main.n);

const ROWS: { label: string; help: string; get: (m: Mode) => string }[] = [
  { label: "Within half a mark of the teacher", help: "Answers out of 2 marks where the suggestion was at most ½ away from the teacher's mark.", get: (m) => pct(m.withinHalf) },
  { label: "Exactly the teacher's mark", help: "", get: (m) => pct(m.exact) },
  { label: "Average difference (marks)", help: "Mean absolute difference, out of 2.", get: (m) => m.mae.toFixed(2) },
  { label: "Stricter or more generous", help: "Average of (GradeLens − teacher). Negative = GradeLens is stricter.", get: (m) => `${m.bias >= 0 ? "+" : "−"}${Math.abs(m.bias).toFixed(2)}` },
  { label: "Agreement (quadratic weighted kappa)", help: "1 = perfect agreement, 0 = chance. The standard measure for marking agreement.", get: (m) => m.qwk.toFixed(2) },
  { label: "Marked 'ready' (low risk)", help: "Share of answers GradeLens didn't flag for a closer look.", get: (m) => pct(m.autoApprovable) },
  { label: "…of which within half a mark", help: "", get: (m) => pct(m.withinHalfAmongLow) },
  { label: "Big differences flagged", help: "Differences over ½ mark that GradeLens had flagged for the teacher.", get: (m) => `${pct(m.errorsCaught)} (${m.caught} of ${m.errors})` },
];

export default function TransparencyPage() {
  const tc = summary.teacherConsistency;
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-4xl px-5 py-10">
        <h1 className="text-[2.2rem] font-[750] leading-tight tracking-tight">How accurate is GradeLens?</h1>
        <p className="mt-4 text-lg">
          We compared GradeLens with a real teacher&apos;s marks on real handwritten university exams. On {main.n} short answers from{" "}
          {summary.testStudents} students that were never used to tune it, its suggestion was within half a mark of the teacher&apos;s for{" "}
          <strong>{pct(main.withinHalf)}</strong> of answers (95% interval {pct(lo)} to {pct(hi)}).
        </p>
        <p className="mt-3 text-lg">
          That is not good enough to mark on its own, and GradeLens doesn&apos;t: <strong>nothing counts until a teacher approves it</strong>,
          and every suggestion shows the student&apos;s words it was based on, so checking takes seconds.
        </p>

        <section className="mt-10" aria-labelledby="results">
          <h2 id="results" className="text-xl font-semibold">Results</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse text-left">
              <thead>
                <tr className="border-b-2 border-ink align-bottom text-[0.9rem]">
                  <th className="py-2 pr-3 font-semibold">Short answers (2 marks each), {main.n} answers</th>
                  {ORDER.map((m) => <th key={m.key} className="py-2 pr-3 text-right font-semibold" title={m.what}>{m.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r) => (
                  <tr key={r.label} className="border-b border-ruling align-top">
                    <td className="py-2 pr-3"><span className="font-semibold">{r.label}</span>{r.help && <span className="block text-[0.85rem] text-muted-foreground">{r.help}</span>}</td>
                    {ORDER.map((m) => <td key={m.key} className="py-2 pr-3 text-right tabular-nums">{r.get(modes[m.key])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="mt-3 space-y-1 text-[0.9rem] text-muted-foreground">
            {ORDER.map((m) => <li key={m.key}><span className="font-semibold text-ink">{m.label}:</span> {m.what}</li>)}
          </ul>
          <p className="mt-4">
            <strong>Multiple choice:</strong> GradeLens read {summary.mcq.lettersCorrect} of {summary.mcq.lettersRead} handwritten answer letters
            correctly ({pct(summary.mcq.lettersCorrect / Math.max(1, summary.mcq.lettersRead))}), then marked them against the key with plain code.
          </p>
        </section>

        <section className="mt-10" aria-labelledby="context">
          <h2 id="context" className="text-xl font-semibold">How to read these numbers</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              Trained human markers working from a shared mark scheme reach a kappa of about <strong>0.89</strong> on average for short
              answers (<a className="underline underline-offset-2" href="https://arxiv.org/abs/2408.09540">Shermis, &ldquo;Using ChatGPT to Score Essays and Short-Form Constructed Responses&rdquo;</a>,
              reporting the ASAP short-answer competition). A kappa of 0.70 is a common minimum for automated scoring used on its own
              (Williamson, Xi &amp; Breyer, 2012). GradeLens&apos; {main.qwk.toFixed(2)} on this data is well below both: it is a co-pilot, not a replacement.
            </li>
            <li>
              The teacher&apos;s marks are not a perfect answer key either. {tc.bestAlternativeKey && (
                <>The published key gives question {tc.bestAlternativeKey.question} as <strong>{tc.bestAlternativeKey.published}</strong>, but the
                teacher&apos;s multiple-choice totals match the students&apos; recorded answers for {tc.bestAlternativeKey.matches} of {summary.dataset.students} students
                if {tc.bestAlternativeKey.alternative} is counted as correct, and for only {tc.mcqTotalsMatchPublishedKey} with the published key.</>
              )} Some short-answer marks are generous to vague answers. Part of the disagreement is the teacher&apos;s, which is exactly why a
              teacher stays in charge.
            </li>
            <li>
              GradeLens is stricter than this teacher (the negative numbers above). It learns from the teacher&apos;s decisions: examples of
              their marking go into the graders&apos; prompt, and each question&apos;s suggestions move by how much more generous the teacher
              was on it, shown on every adjusted mark. Both were measured only on students whose marks GradeLens never saw.
            </li>
          </ul>
        </section>

        <section className="mt-10" aria-labelledby="method">
          <h2 id="method" className="text-xl font-semibold">Method</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>Data: {summary.dataset.students} university students&apos; handwritten Data Science exams (20 multiple choice + 15 short answers), with the teacher&apos;s mark for every question; {summary.dataset.license}.</li>
            <li>The first {summary.calibrationStudents} students act as the scripts a teacher reviews first: GradeLens marked them, and the teacher&apos;s real marks for them became the examples ({summary.examplesUsed} used) and the learned shifts. The other {summary.testStudents} students were the test.</li>
            <li>Each script: one AI reads the photographed pages (it is given question numbers only, never the questions, so it copies mistakes instead of correcting them); two different AI models mark each answer independently against the mark scheme; plain code checks every quoted piece of evidence, compares the two marks and flags disagreements, unclear handwriting and instructions aimed at the grader.</li>
            <li>The mark scheme was drafted by GradeLens from the dataset&apos;s answer key and reviewed by us before marking (two corrections, recorded with the evaluation).</li>
            <li>Models: free tiers only ({summary.models.join(", ")}). Results vary with which free model answers on a given day.</li>
            <li>Reproducible: the evaluation, its cached model outputs and this page&apos;s numbers come from <code>npm run eval</code> in the GradeLens repository. Generated {new Date(summary.generatedAt).toISOString().slice(0, 10)}.</li>
          </ul>
        </section>

        <section className="mt-10" aria-labelledby="limits">
          <h2 id="limits" className="text-xl font-semibold">Limits</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>One teacher, one subject, one exam, university level, English, short answers worth 2 marks. Other subjects, ages, languages and longer answers are untested here.</li>
            <li>{main.n} answers is a small sample: the interval above shows how much the headline could move.</li>
            <li>Flags catch only some of the big differences ({pct(main.errorsCaught)}): a &ldquo;ready&rdquo; mark still needs a glance. Bulk-approving ready marks is a convenience, not a guarantee.</li>
            <li>Diagrams and long multi-step maths were tested only on a handful of practice pages, not on a public dataset.</li>
          </ul>
        </section>

        <section id="privacy" className="mt-10 scroll-mt-6" aria-labelledby="priv">
          <h2 id="priv" className="text-xl font-semibold">Where students&apos; work goes</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>Photos of pages are stored in a private database bucket. Teachers see them through links that expire after an hour; nobody else can list or open them.</li>
            <li>To read and mark, page images and answer text are sent to AI services. This hackathon version uses <strong>free tiers</strong>: Google&apos;s terms for unpaid Gemini API use allow submitted content to be used to improve Google&apos;s products, may involve human reviewers, and advise against sending personal information (<a className="underline underline-offset-2" href="https://ai.google.dev/gemini-api/terms">Gemini API terms</a>). Groq states it does not train on API data (<a className="underline underline-offset-2" href="https://console.groq.com/docs/your-data">Groq: your data</a>). Free models on OpenRouter depend on the provider (<a className="underline underline-offset-2" href="https://openrouter.ai/docs/guides/privacy/logging">OpenRouter privacy</a>).</li>
            <li>So GradeLens keeps names out: the graders get answer text under a code (S07), never a name; printed answer sheets carry only a code in their QR, and their printed name band is blanked out on the teacher&apos;s device before upload; students are told they don&apos;t need to write their name.</li>
            <li>For real classes, a school should use paid API keys (Google says it doesn&apos;t use paid-tier prompts to improve its products), which GradeLens supports without code changes.</li>
            <li>Guest workspaces are deleted after 7 days. Teachers can delete a class with all its scans and marks at any time.</li>
          </ul>
        </section>

        <p className="mt-10"><Link href="/sample" className="font-semibold underline underline-offset-4">See the marked scripts in the sample class</Link></p>
        <DatasetAttribution className="mt-6" />
      </main>
    </>
  );
}
