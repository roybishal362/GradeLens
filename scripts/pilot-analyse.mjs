// Pilot analysis. Usage (from gradelens/): node scripts/pilot-analyse.mjs ../pilot/part-a-marks.json
// part-a-marks.json = { "start": "14:05", "end": "14:21", "marks": { "Student_1": { "21": 1.5, ... }, "Student_2": { ... } } }
// Reads the teacher's own Part B session (display name "Pilot 1") from the database. Prints only aggregates.
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const partA = JSON.parse(readFileSync(process.argv[2], "utf8"));
const csv = readFileSync("../datasets/mendeley-sf3kvjwknt/Teacher_manual_marks_Anonymized.csv", "utf8").split(/\r?\n/).filter(Boolean).map((l) => l.split(","));
const head = csv[0];
const teacher = Object.fromEntries(csv.slice(1).map((r) => [r[0], r]));
const qwk = (pairs) => { // quadratic weighted kappa on half-mark categories 0..4 (marks ×2)
  const k = 5, O = Array.from({ length: k }, () => Array(k).fill(0));
  for (const [a, b] of pairs) O[Math.round(a * 2)][Math.round(b * 2)]++;
  const n = pairs.length, ra = O.map((r) => r.reduce((s, x) => s + x, 0)), cb = O[0].map((_, j) => O.reduce((s, r) => s + r[j], 0));
  let num = 0, den = 0;
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) { const w = ((i - j) ** 2) / ((k - 1) ** 2); num += w * O[i][j]; den += w * (ra[i] * cb[j]) / n; }
  return den ? 1 - num / den : 1;
};

// Part A: the pilot teacher vs the dataset's teacher (a human-human baseline on the same answers)
const pairs = [];
for (const [student, marks] of Object.entries(partA.marks)) {
  const row = teacher[student];
  for (const [q, mine] of Object.entries(marks)) {
    const col = head.findIndex((h) => h.trim() === String(q));
    const v = row?.[col]?.trim();
    if (col < 0 || !v || Number.isNaN(Number(v))) continue;
    pairs.push([Number(mine), Number(v)]);
  }
}
const mins = (() => { const [h1, m1] = partA.start.split(":").map(Number), [h2, m2] = partA.end.split(":").map(Number); return h2 * 60 + m2 - (h1 * 60 + m1); })();
const within = pairs.filter(([a, b]) => Math.abs(a - b) <= 0.5).length, exact = pairs.filter(([a, b]) => a === b).length;
console.log(`Part A: ${pairs.length} answers marked by hand in ${mins} min (${Math.round((mins * 60) / Math.max(1, Object.values(partA.marks).reduce((s, m) => s + Object.keys(m).length, 0)))} s per answer)`);
console.log(`  pilot teacher vs dataset teacher: within ±0.5 ${((100 * within) / pairs.length).toFixed(1)}%, exact ${((100 * exact) / pairs.length).toFixed(1)}%, QWK ${qwk(pairs).toFixed(2)}`);

// Part B: her session in the app
const db = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const owner = (await db.query(`select user_id from public.teacher_profiles where display_name = 'Pilot 1' order by updated_at desc nulls last limit 1`)).rows[0];
if (!owner) { console.log("Part B: no workspace named 'Pilot 1' yet"); process.exit(0); }
const test = (await db.query(`select t.id from public.tests t join public.classes c on c.id = t.class_id where c.owner_id = $1 order by t.created_at desc limit 1`, [owner.user_id])).rows[0];
const ev = (await db.query(`select e.created_at, e.action, e.from_score, e.to_score, qr.q, qr.ai_score from public.review_events e join public.question_results qr on qr.id = e.question_result_id
  join public.submissions s on s.id = qr.submission_id where s.test_id = $1 order by e.created_at`, [test.id])).rows;
let active = 0; for (let i = 1; i < ev.length; i++) active += Math.min(120, (ev[i].created_at - ev[i - 1].created_at) / 1000);
const indiv = ev.filter((e) => e.action !== "bulk_approve" && e.action !== "unapprove");
const written = indiv.filter((e) => e.q > 20);
const kept = written.filter((e) => Number(e.to_score) === Number(e.ai_score)).length;
const close = written.filter((e) => Math.abs(Number(e.to_score) - Number(e.ai_score)) <= 0.5).length;
const track = (await db.query(`select * from public.question_track($1)`, [test.id])).rows;
console.log(`Part B: ${indiv.length} decisions one by one (${written.length} written), ${ev.length - indiv.length} other; active time ${Math.round(active / 60)} min, ${Math.round(active / Math.max(1, indiv.length))} s per decision`);
console.log(`  kept GradeLens' mark on ${kept}/${written.length} written answers (${((100 * kept) / Math.max(1, written.length)).toFixed(0)}%), within ±0.5 on ${close} (${((100 * close) / Math.max(1, written.length)).toFixed(0)}%)`);
console.log(`  questions that earned approval together: ${track.filter((t) => t.q > 20 && t.checked >= 5 && t.kept >= 0.9 * t.checked).map((t) => `Q${t.q}`).join(", ") || "none"}`);
await db.end();
