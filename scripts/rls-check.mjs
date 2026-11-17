// Security check for Row Level Security + storage. Creates two throwaway teachers, verifies isolation, cleans up.
// Usage: npm run db:rls-check   (exits 1 if any check fails). Never prints keys.
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL, PUB = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SEC = env.SUPABASE_SECRET_KEY;
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };

async function api(path, { method = "GET", token, key = PUB, body, prefer } = {}) {
  const r = await fetch(URL_ + path, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${token ?? key}`, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json };
}

const stamp = Date.now();
const users = [];
async function makeTeacher(tag) {
  const email = `rls-${tag}-${stamp}@gradelens.test`, password = `Pw-${stamp}-${tag}-x9!`;
  const created = await api("/auth/v1/admin/users", { method: "POST", key: SEC, token: SEC, body: { email, password, email_confirm: true } });
  if (created.status >= 300) throw new Error(`create user failed: ${created.status}`);
  users.push(created.json.id);
  const session = await api("/auth/v1/token?grant_type=password", { method: "POST", body: { email, password } });
  return { id: created.json.id, token: session.json.access_token };
}

const db = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
try {
  // 0. RLS is on for every public table
  const off = (await db.query(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`)).rows.map((r) => r.relname);
  check("RLS enabled on every public table", off.length === 0, off.join(", "));

  const A = await makeTeacher("a"), B = await makeTeacher("b");

  // 1. Teacher A creates a class + test
  const cls = await api("/rest/v1/classes", { method: "POST", token: A.token, body: { name: "RLS test class", owner_id: A.id }, prefer: "return=representation" });
  check("teacher A can create own class", cls.status === 201, `status ${cls.status}`);
  const classId = cls.json?.[0]?.id;
  const test = await api("/rest/v1/tests?select=id,title", { method: "POST", token: A.token, body: { class_id: classId, title: "RLS test" }, prefer: "return=representation" });
  check("teacher A can create a test in own class", test.status === 201, `status ${test.status}`);

  // 2. Isolation
  const bSees = await api(`/rest/v1/classes?id=eq.${classId}`, { token: B.token });
  check("teacher B cannot see teacher A's class", Array.isArray(bSees.json) && bSees.json.length === 0);
  const bTests = await api(`/rest/v1/tests?class_id=eq.${classId}&select=id,title`, { token: B.token });
  check("teacher B cannot see teacher A's tests", Array.isArray(bTests.json) && bTests.json.length === 0);
  const bSteal = await api("/rest/v1/tests", { method: "POST", token: B.token, body: { class_id: classId, title: "hijack" } });
  check("teacher B cannot add a test to A's class", bSteal.status >= 400, `status ${bSteal.status}`);
  const bFake = await api("/rest/v1/classes", { method: "POST", token: B.token, body: { name: "fake", owner_id: A.id } });
  check("teacher B cannot create a class owned by A", bFake.status >= 400, `status ${bFake.status}`);
  const bSample = await api("/rest/v1/classes", { method: "POST", token: B.token, body: { name: "fake sample", owner_id: B.id, is_sample: true } });
  check("a teacher cannot mark their class as the public sample", bSample.status >= 400, `status ${bSample.status}`);

  // 3. Anonymous visitors
  const anonSees = await api(`/rest/v1/classes?id=eq.${classId}`);
  check("anonymous visitor cannot see private classes", Array.isArray(anonSees.json) && anonSees.json.length === 0);
  const anonWrite = await api("/rest/v1/classes", { method: "POST", body: { name: "spam", owner_id: A.id } });
  check("anonymous visitor cannot write", anonWrite.status >= 400, `status ${anonWrite.status}`);
  const anonUsage = await api("/rest/v1/usage_counters");
  check("usage counters invisible to the public", Array.isArray(anonUsage.json) ? anonUsage.json.length === 0 : anonUsage.status >= 400);

  // 4. Sample class: public, but its upload token stays secret
  const sample = await db.query(`insert into public.classes (owner_id, name, is_sample) values ($1, 'RLS sample', true) returning id`, [A.id]);
  await db.query(`insert into public.tests (class_id, title) values ($1, 'sample test')`, [sample.rows[0].id]);
  const anonSample = await api(`/rest/v1/classes?id=eq.${sample.rows[0].id}`);
  check("anonymous visitor CAN see the sample class (demo mode)", Array.isArray(anonSample.json) && anonSample.json.length === 1);
  const anonToken = await api(`/rest/v1/tests?class_id=eq.${sample.rows[0].id}&select=upload_token`);
  check("sample test's upload token is hidden from the public", anonToken.status >= 400 || (Array.isArray(anonToken.json) && !anonToken.json[0]?.upload_token), `status ${anonToken.status}`);
  const anonTitle = await api(`/rest/v1/tests?class_id=eq.${sample.rows[0].id}&select=title`);
  check("sample test's title is readable", Array.isArray(anonTitle.json) && anonTitle.json[0]?.title === "sample test");
  const bToken = await api(`/rest/v1/tests?class_id=eq.${sample.rows[0].id}&select=upload_token`, { token: B.token });
  check("a signed-in teacher cannot read the sample's upload token either", bToken.status >= 400 || (Array.isArray(bToken.json) && !bToken.json[0]?.upload_token), `status ${bToken.status}`);
  const aOwnToken = await api(`/rest/v1/tests?class_id=eq.${classId}&select=upload_token`, { token: A.token });
  check("upload tokens are never exposed through the public API (server hands them out)", aOwnToken.status >= 400, `status ${aOwnToken.status}`);
  const aOwnTitle = await api(`/rest/v1/tests?class_id=eq.${classId}&select=id,title`, { token: A.token });
  check("owner can still read their test's normal columns", Array.isArray(aOwnTitle.json) && aOwnTitle.json[0]?.title === "RLS test");

  // 5. Storage bucket is private
  const bucket = (await db.query(`select public from storage.buckets where id = 'pages'`)).rows[0];
  check("page-image bucket exists and is private", bucket && bucket.public === false);
  const anonList = await api("/storage/v1/object/list/pages", { method: "POST", body: { prefix: "" } });
  check("anonymous visitor cannot list page images", anonList.status >= 400 || (Array.isArray(anonList.json) && anonList.json.length === 0), `status ${anonList.status}`);

  // 6. Review decisions: only through review_mark / bulk_approve, always audited
  const testId = test.json[0].id;
  const stu = (await db.query(`insert into public.students (class_id, display_name, anon_code) values ($1, 'Ada', 'S01') returning id`, [classId])).rows[0].id;
  const sub = (await db.query(`insert into public.submissions (test_id, student_id, status) values ($1, $2, 'graded') returning id`, [testId, stu])).rows[0].id;
  const qr = (await db.query(`insert into public.question_results (submission_id, q, max, score_a, score_b, ai_score, risk)
    values ($1, 1, 2, 1, 1, 1, 'medium') returning id`, [sub])).rows[0].id;
  const qr2 = (await db.query(`insert into public.question_results (submission_id, q, max, score_a, score_b, ai_score, risk)
    values ($1, 2, 2, 2, 2, 2, 'low') returning id`, [sub])).rows[0].id;
  const patch = await api(`/rest/v1/question_results?id=eq.${qr}`, { method: "PATCH", token: A.token, body: { teacher_score: 2, approved: true }, prefer: "return=representation" });
  const after1 = (await db.query(`select teacher_score, approved from public.question_results where id = $1`, [qr])).rows[0];
  check("a teacher cannot change a mark without the audit log (direct update blocked)", after1.teacher_score === null && after1.approved === false, `status ${patch.status}`);
  const subPatch = await api(`/rest/v1/submissions?id=eq.${sub}`, { method: "PATCH", token: A.token, body: { total: 99 } });
  const subTotal = (await db.query(`select total from public.submissions where id = $1`, [sub])).rows[0].total;
  check("a teacher cannot edit a submission total directly", subTotal === null, `status ${subPatch.status}`);
  const fakeEvent = await api("/rest/v1/review_events", { method: "POST", token: A.token, body: { question_result_id: qr, actor_id: A.id, action: "approve" } });
  check("a teacher cannot write audit events directly", fakeEvent.status >= 400, `status ${fakeEvent.status}`);
  const bReview = await api("/rest/v1/rpc/review_mark", { method: "POST", token: B.token, body: { qid: qr, act: "adjust", score: 2 } });
  check("teacher B cannot mark teacher A's students", bReview.status >= 400, `status ${bReview.status}`);
  const badScore = await api("/rest/v1/rpc/review_mark", { method: "POST", token: A.token, body: { qid: qr, act: "adjust", score: 2.3 } });
  const tooHigh = await api("/rest/v1/rpc/review_mark", { method: "POST", token: A.token, body: { qid: qr, act: "adjust", score: 3 } });
  check("marks must be half marks within the question's maximum", badScore.status >= 400 && tooHigh.status >= 400, `status ${badScore.status}/${tooHigh.status}`);
  const adjust = await api("/rest/v1/rpc/review_mark", { method: "POST", token: A.token, body: { qid: qr, act: "adjust", score: 1.5, note: "method fine" } });
  const after2 = (await db.query(`select teacher_score, approved, approved_by from public.question_results where id = $1`, [qr])).rows[0];
  const events = (await db.query(`select action, from_score, to_score, actor_id from public.review_events where question_result_id = $1`, [qr])).rows;
  check("the owner's adjustment is applied and audited in one step",
    adjust.status < 300 && Number(after2.teacher_score) === 1.5 && after2.approved && after2.approved_by === A.id &&
    events.length === 1 && events[0].action === "adjust" && Number(events[0].from_score) === 1 && Number(events[0].to_score) === 1.5,
    `status ${adjust.status}`);
  const bulk = await api("/rest/v1/rpc/bulk_approve", { method: "POST", token: A.token, body: { tid: testId } });
  const s2 = (await db.query(`select status, total from public.submissions where id = $1`, [sub])).rows[0];
  const ev2 = (await db.query(`select action from public.review_events where question_result_id = $1`, [qr2])).rows;
  check("bulk approve accepts low-risk marks, audits each, and completes the script",
    bulk.json === 1 && ev2.length === 1 && ev2[0].action === "bulk_approve" && s2.status === "approved" && Number(s2.total) === 3.5,
    `returned ${JSON.stringify(bulk.json)}, status ${s2.status}, total ${s2.total}`);
  const evDelete = await api(`/rest/v1/review_events?question_result_id=eq.${qr}`, { method: "DELETE", token: A.token, prefer: "return=representation" });
  const evLeft = (await db.query(`select count(*)::int as n from public.review_events where question_result_id = $1`, [qr])).rows[0].n;
  check("audit history cannot be deleted by the teacher", evLeft === 1, `status ${evDelete.status}`);

  // 7. Server-only functions are not callable from the browser
  for (const [fn, body] of [["claim_submission", { sid: sub }], ["bump_usage", { b: "x", lim: 1 }], ["stale_guests", {}], ["refresh_submission", { sid: sub }]]) {
    const anon = await api(`/rest/v1/rpc/${fn}`, { method: "POST", body });
    const teacher = await api(`/rest/v1/rpc/${fn}`, { method: "POST", token: A.token, body });
    check(`${fn} is server-only`, anon.status >= 400 && teacher.status >= 400, `anon ${anon.status}, teacher ${teacher.status}`);
  }
} finally {
  // cleanup: deleting the users cascades to their classes/tests
  for (const id of users) await api(`/auth/v1/admin/users/${id}`, { method: "DELETE", key: SEC, token: SEC });
  await db.end();
}
const failed = results.filter((x) => !x).length;
console.log(failed ? `\n${failed} check(s) FAILED` : `\nall ${results.length} security checks passed`);
process.exit(failed ? 1 : 0);
