// Screenshots of every GradeLens screen (public + teacher), desktop and phone, into a folder with an index.html gallery.
// Teacher screens use a throwaway demo class with REAL marked scripts (cached GradeLens outcomes of the Mendeley
// dataset, CC BY 4.0) and is deleted at the end. No AI calls. Usage: node scripts/screenshots.mjs <outDir>
import { readFileSync, readdirSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { createServerClient } from "@supabase/ssr";
import puppeteer from "puppeteer-core";

const out = process.argv[2] ?? "ui-screenshots";
mkdirSync(out, { recursive: true });
const env = Object.fromEntries(readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL, PUB = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SEC = env.SUPABASE_SECRET_KEY;
const APP = "http://localhost:3000";
const DATA = new URL("../../datasets/mendeley-sf3kvjwknt/", import.meta.url);
const fsPath = (u) => decodeURIComponent(u.pathname).replace(/^\/([A-Za-z]:)/, "$1");
const H = { apikey: SEC, Authorization: `Bearer ${SEC}`, "Content-Type": "application/json" };
const rest = async (path, init = {}) => {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { ...init, headers: { ...H, Prefer: "return=representation", ...(init.headers ?? {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path}: ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
};
const shots = [];
const rubric = JSON.parse(readFileSync(new URL("rubric.json", DATA), "utf8")).rubric;
const gradesDir = new URL("grades/", DATA);
const newest = (n) => readdirSync(gradesDir).filter((f) => f.startsWith(`Student_${n}-`)).sort((a, b) => statSync(new URL(b, gradesDir)).mtimeMs - statSync(new URL(a, gradesDir)).mtimeMs)[0];
const index = JSON.parse(readFileSync(new URL("pages/index.json", DATA), "utf8"));

const email = `e2e-shots-${Date.now()}@gradelens.test`, password = `Shots-${Date.now()}-pw!`;
const created = await (await fetch(`${URL_}/auth/v1/admin/users`, { method: "POST", headers: H, body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: "Ms Rivera (demo)" } }) })).json();
const jar = new Map();
const sb = createServerClient(URL_, PUB, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach((c) => jar.set(c.name, c.value)) } });
await sb.auth.signInWithPassword({ email, password });
const browser = await puppeteer.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
let classId;
try {
  // ---- demo class with three real marked scripts
  const [cls] = (await sb.from("classes").insert({ name: "Data Science, group B (demo)", subject: "Data Science", owner_id: created.id }).select("id")).data;
  classId = cls.id;
  const roster = [["Grace Hopper", "S01", 6], ["Alan Turing", "S02", 7], ["Ada Lovelace", "S03", 8], ["Katherine Johnson", "S04", null]];
  const { data: studs } = await sb.from("students").insert(roster.map(([display_name, anon_code]) => ({ class_id: classId, display_name, anon_code }))).select("id,anon_code");
  const { data: [test] } = await sb.from("tests").insert({ class_id: classId, title: "Data Science mid-term", rubric, rubric_status: "approved" }).select("id");
  const subIds = [];
  for (const [name, code, n] of roster) {
    if (!n) continue;
    const outcome = JSON.parse(readFileSync(new URL(newest(n), gradesDir), "utf8"));
    const st = studs.find((s) => s.anon_code === code);
    const [sub] = await rest("submissions", { method: "POST", body: JSON.stringify({ test_id: test.id, student_id: st.id, status: "graded", risk: outcome.risk, warnings: outcome.warnings ?? [] }) });
    for (const [i, f] of index[`Student_${n}`].entries()) {
      const path = `${classId}/${test.id}/${sub.id}/${i + 1}-demo.jpg`;
      await fetch(`${URL_}/storage/v1/object/pages/${path}`, { method: "POST", headers: { apikey: SEC, Authorization: `Bearer ${SEC}`, "Content-Type": "image/jpeg" }, body: readFileSync(fsPath(new URL(`pages/${f}`, DATA))) });
      await rest("pages", { method: "POST", body: JSON.stringify({ submission_id: sub.id, page_no: i + 1, storage_path: path, media_type: "image/jpeg" }) });
    }
    await rest("question_results", { method: "POST", body: JSON.stringify(outcome.questions.map((q) => ({
      submission_id: sub.id, q: q.q, max: q.max, score_a: q.scoreA, score_b: q.scoreB, ai_score: q.final, risk: q.risk, flags: q.flags,
      answer: q.answer ?? null, grade_a: q.gradeA ?? null, grade_b: q.gradeB ?? null,
    }))) });
    await rest("rpc/refresh_submission", { method: "POST", body: JSON.stringify({ sid: sub.id }) });
    subIds.push(sub.id);
    console.log(`demo script: ${name} <- Student_${n} (real cached outcome)`);
  }
  // the teacher approves one script completely (so red pen, the report and progress show approved marks)
  await sb.rpc("bulk_approve", { tid: test.id, sid: subIds[0] });
  const { data: left } = await sb.from("question_results").select("id").eq("submission_id", subIds[0]).eq("approved", false);
  for (const r of left ?? []) await sb.rpc("review_mark", { qid: r.id, act: "approve" });

  const desktop = { width: 1440, height: 900, deviceScaleFactor: 1 };
  const phone = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
  const page = await browser.newPage();
  await page.setCookie(...[...jar].map(([name, value]) => ({ name, value, domain: "localhost", path: "/", sameSite: "Lax" })));
  async function shot(file, title, path, { view = desktop, full = true, before } = {}) {
    await page.setViewport(view);
    await page.goto(APP + path, { waitUntil: "networkidle2", timeout: 120000 });
    await page.waitForFunction(() => [...document.images].every((i) => i.complete), { timeout: 30000 }).catch(() => {});
    if (before) await before();
    await new Promise((r) => setTimeout(r, 700));
    await page.screenshot({ path: `${out}/${file}.png`, fullPage: full });
    shots.push({ file, title });
    console.log(`saved ${file}`);
  }
  const clickCriterion = async () => {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("section[aria-label='Marking sheet'] ol li button[aria-pressed]")].find((x) => !/^0/.test(x.querySelector(".mark")?.textContent?.trim() ?? "0"));
      b?.click();
    });
    await new Promise((r) => setTimeout(r, 900));
  };

  // ---- public
  await shot("01-landing", "Landing page (real marked answer as the hero)", "/");
  await shot("02-landing-phone", "Landing page on a phone", "/", { view: phone });
  await shot("03-sample", "Sample class: real scripts from a public dataset", "/sample");
  await shot("04-sample-review", "Review screen: the student's page with the evidence highlighted", "/sample/review", { full: false, before: clickCriterion });
  await shot("05-sample-review-phone", "Review screen on a phone", "/sample/review", { view: phone, full: false });
  await shot("06-sample-insights", "Class insights: misconceptions, re-teach plan, item analysis, feedback", "/sample/insights");
  await shot("07-transparency", "How accurate is it? (measured on real exams) and where student work goes", "/transparency");
  await shot("08-sign-in", "Sign in (Google or guest)", "/sign-in");
  // ---- teacher
  await shot("09-dashboard", "Teacher: your classes", "/app");
  await shot("10-class", "Teacher: class page (tests and roster)", `/app/classes/${classId}`);
  await shot("11-test", "Teacher: test page (scripts, upload link + QR code)", `/app/tests/${test.id}`);
  await shot("12-mark-scheme", "Teacher: mark scheme (criteria, live checks, approve)", `/app/tests/${test.id}/mark-scheme`);
  await shot("13-review", "Teacher: reviewing a script (pencil = suggested, red = approved)", `/app/tests/${test.id}/review?s=${subIds[1]}`, { full: false, before: clickCriterion });
  await shot("14-insights", "Teacher: class insights", `/app/tests/${test.id}/insights`);
  await shot("15-sheets", "Teacher: printable QR answer sheets", `/app/tests/${test.id}/sheets?pages=1`, { full: false });
  await shot("16-report", "Teacher: report for the student and parents", `/app/report/${subIds[0]}`);
  await shot("17-progress", "Teacher: a student's progress and misconceptions", `/app/students/${studs[0].id}`);
  // scan page with real sheet photos (from the sheets page) sorted by QR
  await page.setViewport(desktop);
  await page.goto(`${APP}/app/tests/${test.id}/sheets?pages=2`, { waitUntil: "networkidle2" });
  await page.waitForFunction(() => document.querySelectorAll("section svg").length === 8, { timeout: 60000 });
  const files = [];
  for (const [i, el] of (await page.$$("main section")).entries()) { const p = `${out}/_sheet-${i}.png`; await el.screenshot({ path: p }); files.push(p.replace(/\//g, "\\")); }
  await page.goto(`${APP}/app/tests/${test.id}/scan`, { waitUntil: "networkidle2" });
  await (await page.$("input[type=file]")).uploadFile(...[files[5], files[0], files[3], files[6], files[1], files[7], files[2], files[4]]);
  await page.waitForFunction(() => document.body.innerText.includes("photos →"), { timeout: 120000 });
  await page.screenshot({ path: `${out}/18-scan.png`, fullPage: true });
  shots.push({ file: "18-scan", title: "Teacher: a shuffled pile of answer-sheet photos sorted to students by QR (names blanked on the device)" });
  // the student's upload page on a phone
  const { data: tok } = await (await fetch(`${URL_}/rest/v1/tests?id=eq.${test.id}&select=upload_token`, { headers: H })).json().then((j) => ({ data: j }));
  await shot("19-upload-phone", "Student: hand in answers from a phone", `/u/${tok[0].upload_token}`, { view: phone, before: async () => {
    const v = await page.evaluate(() => [...document.querySelectorAll("option")].find((o) => o.textContent === "Katherine Johnson")?.value);
    if (v) await page.select("select", v);
  } });
} finally {
  await browser.close();
  if (classId) {
    const walk = async (prefix) => {
      const items = await (await fetch(`${URL_}/storage/v1/object/list/pages`, { method: "POST", headers: H, body: JSON.stringify({ prefix, limit: 1000 }) })).json();
      for (const it of Array.isArray(items) ? items : []) {
        if (it.id === null) await walk(`${prefix}${it.name}/`);
        else await fetch(`${URL_}/storage/v1/object/pages`, { method: "DELETE", headers: H, body: JSON.stringify({ prefixes: [`${prefix}${it.name}`] }) });
      }
    };
    await walk(`${classId}/`);
  }
  await fetch(`${URL_}/auth/v1/admin/users/${created.id}`, { method: "DELETE", headers: H });
  const html = `<!doctype html><meta charset="utf-8"><title>GradeLens screens</title>
<style>body{font:16px system-ui;background:#f4f6fa;color:#1c2541;margin:0;padding:24px}h1{margin:0 0 4px}p{color:#4a5672;margin:0 0 24px}
figure{background:#fff;border:1px solid #d6e2f3;border-radius:8px;margin:0 0 28px;padding:12px;max-width:1460px}figcaption{font-weight:600;margin-bottom:8px}
img{max-width:100%;border:1px solid #e3e9f4;display:block}</style>
<h1>GradeLens: every screen</h1><p>Captured ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC from the running app. Teacher screens use a demo class with real marked scripts (Mendeley dataset, CC BY 4.0).</p>
${shots.map((s) => `<figure><figcaption>${s.title}</figcaption><img src="${s.file}.png" alt="${s.title}" loading="lazy"></figure>`).join("\n")}`;
  writeFileSync(`${out}/index.html`, html);
  console.log(`\n${shots.length} screens saved; open ${out}/index.html`);
}
