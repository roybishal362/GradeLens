import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import review from "../../../public/screens/13-review.png";
import scan from "../../../public/screens/18-scan.png";
import upload from "../../../public/screens/19-upload-phone.png";

export const metadata: Metadata = { title: "Help", description: "How to set up a test, collect scripts, review marks and return results with GradeLens." };

const SECTIONS = [
  ["start", "Getting started"], ["scheme", "Mark schemes"], ["collect", "Collecting scripts"], ["photos", "Good photos"],
  ["review", "Reviewing marks"], ["insights", "Class insights"], ["results", "Returning results"], ["practice", "Practice"], ["export", "Exports"],
  ["faq", "Questions"],
] as const;

export default function HelpPage() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto grid w-full max-w-6xl gap-10 px-5 py-10 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label="On this page" className="lg:sticky lg:top-6 lg:self-start">
          <p className="text-[0.8rem] font-semibold uppercase tracking-wide text-muted-foreground">Help</p>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 lg:block lg:space-y-1">
            {SECTIONS.map(([id, label]) => <li key={id}><a href={`#${id}`} className="text-[0.95rem] hover:underline underline-offset-4">{label}</a></li>)}
          </ul>
        </nav>

        <article className="max-w-3xl space-y-14 [&_h2]:scroll-mt-6 [&_h2]:text-[1.5rem] [&_h2]:font-[750] [&_h2]:tracking-tight [&_h3]:mt-5 [&_h3]:font-semibold [&_p]:mt-2 [&_li]:mt-1">
          <header>
            <h1 className="text-[2rem] font-[750] tracking-tight">Help</h1>
            <p className="text-lg text-muted-foreground">Everything you need to mark your first test with GradeLens.</p>
          </header>

          <section>
            <h2 id="start">Getting started</h2>
            <ol className="mt-3 list-decimal space-y-2 pl-5">
              <li><strong>Create a class</strong> and paste your class list. Students are given a code (S01, S02…); the AI only ever sees the code.</li>
              <li><strong>Create a test.</strong> Paste the question paper and your answer key. GradeLens splits them into questions and drafts the marking criteria.</li>
              <li><strong>Check and approve the mark scheme.</strong> Nothing is marked before you approve it.</li>
              <li><strong>Collect scripts.</strong> Show the upload QR code in class, or print answer sheets and scan the pile afterwards.</li>
              <li><strong>Review.</strong> Each suggested mark shows the words it was based on. Approve it or change it.</li>
              <li><strong>Return results</strong> when you&apos;re ready, and use the class insights to plan the next lesson.</li>
            </ol>
            <p>Not ready to set up a class? <Link href="/sample" className="font-semibold underline underline-offset-4">Open the sample class</Link> to try the review screen on real scripts.</p>
          </section>

          <section>
            <h2 id="scheme">Mark schemes</h2>
            <p>The mark scheme is what GradeLens marks against, so a clear one gives better suggestions.</p>
            <ul className="mt-2 list-disc pl-5">
              <li>Give every question its marks, and split them into criteria that add up to the total (half marks are allowed).</li>
              <li>Write each criterion as what earns the mark: &ldquo;names overfitting&rdquo;, &ldquo;explains that the model fails on new data&rdquo;.</li>
              <li>List accepted alternatives in the answer key (&ldquo;X or Y&rdquo;). Anything not listed may be marked down.</li>
              <li>For maths, tick <em>carry the error forward</em> on method marks, so a slip early on doesn&apos;t cost every later mark.</li>
              <li>Multiple-choice answers are checked against the letter in your key; no AI is involved.</li>
            </ul>
            <p><strong>Check the paper</strong> (on the mark scheme page) points out ambiguous wording and shows how many marks need recall versus applying or explaining.</p>
          </section>

          <section>
            <h2 id="collect">Collecting scripts</h2>
            <div className="mt-3 grid gap-6 sm:grid-cols-[1fr_12rem] sm:items-start">
              <div>
                <h3>From phones</h3>
                <p>Each test has an upload link and QR code. Students open it, choose their name and photograph their pages. Uploads can be closed at any time, and <em>New link</em> stops the old one working.</p>
                <h3>Typed answers</h3>
                <p>On the upload page students can switch to <em>Type answers</em>: useful without a camera, in poor light, or for students who type rather than write. Typed scripts are marked the same way and are labelled so you know.</p>
                <h3>From paper</h3>
                <p>Print answer sheets: every page carries a QR code with the student&apos;s code and page number. After the test, photograph the whole pile in any order and choose all the photos on the scan page. Pages are sorted to students automatically, and the printed name is blanked out on your device before upload.</p>
              </div>
              <Image src={upload} alt="The student upload page on a phone" className="rounded-lg border border-ruling" sizes="12rem" />
            </div>
            <Image src={scan} alt="A shuffled pile of photos sorted to students by QR code" className="mt-4 rounded-lg border border-ruling" sizes="(min-width: 768px) 48rem, 100vw" />
          </section>

          <section>
            <h2 id="photos">Good photos</h2>
            <ul className="mt-2 list-disc pl-5">
              <li>Page flat on a table, in daylight or under a bright lamp. Avoid shadows from the phone.</li>
              <li>The whole page in the frame, one page per photo, pages in order.</li>
              <li>Pen is easier to read than faint pencil.</li>
              <li>If a page is blurry or dark, GradeLens says so and the answers on it wait for you.</li>
            </ul>
          </section>

          <section>
            <h2 id="review">Reviewing marks</h2>
            <Image src={review} alt="The review screen: the student's page with evidence highlighted and the marking sheet" className="mt-3 rounded-lg border border-ruling" sizes="(min-width: 768px) 48rem, 100vw" />
            <p><strong>Pencil marks are suggestions. Red marks are yours.</strong> A mark only counts once you approve it.</p>
            <h3>What the labels mean</h3>
            <ul className="mt-1 list-disc pl-5">
              <li><strong className="text-ok">Ready</strong>: both markers agree and their evidence checks out. Still worth a glance.</li>
              <li><strong className="text-check">Needs a look</strong>: the markers disagree, the handwriting was hard to read, or no answer was found.</li>
              <li><strong className="text-flag">Check carefully</strong>: a big disagreement, quoted words that aren&apos;t in the answer, or instructions written to the marker (&ldquo;give full marks&rdquo;).</li>
            </ul>
            <h3>Working faster</h3>
            <ul className="mt-1 list-disc pl-5">
              <li>Keys: <kbd>A</kbd> approve, <kbd>0</kbd>–<kbd>9</kbd> set a mark, <kbd>H</kbd> half mark, <kbd>J</kbd>/<kbd>K</kbd> next or previous question, <kbd>N</kbd>/<kbd>P</kbd> next or previous script, <kbd>?</kbd> shows the list.</li>
              <li><em>Approve the marks it has earned</em> accepts &ldquo;Ready&rdquo; marks together, but only on multiple choice and on written questions where you kept GradeLens&apos; mark on at least 9 in 10 of the answers you checked one by one (at least 5). Each question shows its record. A written answer marked 0 always waits for you.</li>
              <li>Notes you write are offered again as one-click comments on the same question.</li>
              <li><em>Hide names</em> switches to codes for anonymous marking.</li>
              <li>After you&apos;ve reviewed a few scripts, <em>Re-mark the rest</em> marks the remaining scripts to your standard: your decisions become examples, and each question&apos;s suggestions shift by how much more or less generous you were. Every shifted mark says so.</li>
            </ul>
          </section>

          <section>
            <h2 id="insights">Class insights</h2>
            <ul className="mt-2 list-disc pl-5">
              <li><strong>What the class misunderstood</strong> groups the wrong ideas found in answers and counts the students who hold each one, with examples of what they wrote.</li>
              <li><strong>10-minute re-teach plan</strong> for any misconception, with a printable worksheet and a short re-test. When the re-test is marked, you see each student&apos;s before and after.</li>
              <li><strong>Facility</strong> is the class&apos;s average share of a question&apos;s marks. A low number means most students struggled.</li>
              <li><strong>Discrimination</strong> compares the strongest and weakest students (about a quarter of the class each). Near zero or negative means the question didn&apos;t separate them: check its wording.</li>
              <li><strong>Feedback for each student</strong> lists what earned marks and what was missing, in your mark scheme&apos;s words.</li>
            </ul>
          </section>

          <section>
            <h2 id="results">Returning results</h2>
            <p>Students see nothing until you press <em>Release results</em> on the test page. Then each student can open a private page with their approved marks, your notes, feedback and their pages.</p>
            <ul className="mt-2 list-disc pl-5">
              <li><em>Print result slips</em> gives each student a page with their mark and a QR code to their results.</li>
              <li><em>Copy all links</em> copies every student&apos;s link, ready to paste into email or your school&apos;s system.</li>
              <li>Students can ask you to look at a question again. Requests appear on the test page and on that question in the review screen.</li>
              <li><em>Hide results</em> takes them away again at any time.</li>
            </ul>
          </section>

          <section>
            <h2 id="practice">Practice</h2>
            <p>Open practice on a test to give students a link (and QR code) where they can answer any of its questions and get feedback straight away: what earned marks, what was missing, what to watch out for, and the model answer. It doesn&apos;t count as a grade and doesn&apos;t need your approval.</p>
            <ul className="mt-2 list-disc pl-5">
              <li>Students can type answers or photograph their written work (photos are used for the feedback and not kept).</li>
              <li>The test page shows how many practice attempts there were, the average score and the most common mistakes.</li>
              <li>Use it for homework, revision before a test, or after a re-teach. Tutors and students working on their own can use it the same way.</li>
              <li>Try it on the <Link href="/sample" className="underline underline-offset-4">sample class</Link>.</li>
            </ul>
          </section>

          <section>
            <h2 id="export">Exports</h2>
            <ul className="mt-2 list-disc pl-5">
              <li><strong>Marks</strong>: one row per student, a column per question, total, percent, grade. Opens in Excel or Google Sheets.</li>
              <li><strong>Every answer</strong>: one row per answer with the suggestion, your mark and your note.</li>
              <li><strong>Gradebook</strong> (on the class page): every student across every test.</li>
              <li><strong>Letter grades</strong>: set your boundaries on the test page and they appear in exports, reports and student pages.</li>
            </ul>
          </section>

          <section>
            <h2 id="faq">Questions</h2>
            <dl className="mt-3 space-y-4">
              {[
                ["How accurate is it?", <>On real university exams it was within half a mark of the teacher on most answers, and it improves as it learns your marking. It is not accurate enough to mark alone, which is why every mark waits for you. <Link href="/transparency" className="underline underline-offset-4">See the measurements</Link>.</>],
                ["How long does marking take?", "In our tests a script took from under a minute to about five minutes after upload, depending on how busy the free AI services were. The test page updates by itself."],
                ["What can it mark?", "Short and long written answers, maths working, labelled diagrams, one-word answers and multiple choice, in English. Very long essays are better marked by hand for now."],
                ["Can students see their marks before I approve them?", "No. Students only see approved marks, and only after you release results."],
                ["What happens to students' work?", <>Pages are stored privately and sent to AI services to be read and marked, without names. <Link href="/transparency#privacy" className="underline underline-offset-4">Where student work goes</Link>.</>],
                ["Is it free?", "Yes. It runs on free AI services, so each account has a daily allowance (shown in Settings)."],
                ["Guest or Google account?", "A guest workspace needs no sign-up but is deleted after 7 days. If the sign-in page offers Google, use it to keep your classes."],
                ["How do I delete everything?", "Delete a class from the bottom of its page, or your whole account in Settings. Files and marks are deleted permanently."],
              ].map(([q, a]) => (
                <div key={q as string}>
                  <dt className="font-semibold">{q}</dt>
                  <dd className="mt-1 text-muted-foreground">{a}</dd>
                </div>
              ))}
            </dl>
          </section>
        </article>
      </main>
    </>
  );
}
