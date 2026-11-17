import { testMarks, safeFileName } from "@/lib/db/results-data";
import { toCsv } from "@/lib/results";
import { userDb } from "@/lib/supabase/clients";

/**
 * Download marks as CSV (opens in Excel / Google Sheets; imports into most school systems).
 *   ?kind=marks    one row per student: each question's mark, total, percent, grade, status
 *   ?kind=answers  one row per answer: mark, suggestion, approved, teacher's note, flags
 */
export async function GET(req: Request, ctx: RouteContext<"/app/tests/[testId]/export">) {
  const { testId } = await ctx.params;
  const db = await userDb();
  const { data: claims } = await db.auth.getClaims();
  if (!claims?.claims?.sub) return new Response("Sign in first.", { status: 401 });
  const data = await testMarks(testId); // Row Level Security: only the owner's test
  if (!data) return new Response("Not found.", { status: 404 });
  const kind = new URL(req.url).searchParams.get("kind") === "answers" ? "answers" : "marks";
  const qs = data.test.rubric.questions.map((q) => q.q);
  const status = (s: string | null) => (s === "approved" ? "approved" : s === "graded" ? "suggested (not all approved)" : s ? "not marked yet" : "not handed in");
  let rows: (string | number | null)[][];
  if (kind === "marks") {
    rows = [["Student", "Code", ...qs.map((q) => `Q${q}`), "Total", "Out of", "Percent", "Grade", "Status"]];
    for (const l of data.lines) {
      rows.push([l.name, l.code, ...qs.map((q) => l.marks.find((m) => m.q === q)?.mark ?? null), l.total, l.max,
        l.percent === null ? null : Math.round(l.percent * 10) / 10, l.grade, status(l.status)]);
    }
  } else {
    rows = [["Student", "Code", "Question", "Mark", "Out of", "GradeLens suggestion", "Approved", "Teacher's note", "Flags"]];
    for (const l of data.lines) for (const m of l.marks) {
      rows.push([l.name, l.code, m.q, m.mark, m.max, m.ai, m.approved ? "yes" : "no", m.note, m.flags.join(" | ")]);
    }
  }
  return new Response(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeFileName(data.test.title)}-${kind}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
