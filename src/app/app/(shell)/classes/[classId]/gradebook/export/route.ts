import { classGradebook } from "@/lib/db/gradebook";
import { safeFileName } from "@/lib/db/results-data";
import { toCsv } from "@/lib/results";
import { userDb } from "@/lib/supabase/clients";

/** The class gradebook as CSV: one row per student, a percent (and grade) column per test, and the average. */
export async function GET(_req: Request, ctx: RouteContext<"/app/classes/[classId]/gradebook/export">) {
  const { classId } = await ctx.params;
  const db = await userDb();
  const { data: claims } = await db.auth.getClaims();
  if (!claims?.claims?.sub) return new Response("Sign in first.", { status: 401 });
  const gb = await classGradebook(classId);
  if (!gb) return new Response("Not found.", { status: 404 });
  const header = ["Student", "Code", ...gb.tests.flatMap((t) => (t.boundaries?.length ? [`${t.title} (%)`, `${t.title} (grade)`] : [`${t.title} (%)`])), "Average (%)"];
  const rows = gb.rows.map((r) => [
    r.name, r.code,
    ...r.cells.flatMap((c, i) => {
      const pct = c ? Math.round(c.percent * 10) / 10 : null;
      return gb.tests[i].boundaries?.length ? [pct, c?.grade ?? null] : [pct];
    }),
    r.average === null ? null : Math.round(r.average * 10) / 10,
  ]);
  return new Response(toCsv([header, ...rows]), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeFileName(gb.className)}-gradebook.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
