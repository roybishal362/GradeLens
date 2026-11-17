// End-to-end check of every teacher screen WITHOUT any AI call (no free-tier quota used):
//   a throwaway teacher + class + test with the real Mendeley mark scheme, one script put in place exactly as the
//   grading job stores it (a real cached GradeLens outcome + the real page images), then in Edge:
//   review (evidence highlight, change a mark, approve, undo) -> audit log + totals checked in the database ->
//   insights page -> printable QR answer sheets -> photos of those sheets, shuffled, on the scan page -> grouped -> uploaded.
// Usage: node scripts/e2e-offline.mjs [outDir]
import { readFileSync, readdirSync, mkdirSync, statSync } from "node:fs";
import { createServerClient } from "@supabase/ssr";
import puppeteer from "puppeteer-core";

const [out = "e2e-offline"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const env = Object.fromEntries(readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL, PUB = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SEC = env.SUPABASE_SECRET_KEY;
const APP = "http://localhost:3000";
const DATA = new URL("../../datasets/mendeley-sf3kvjwknt/", import.meta.url);
const fsPath = (u) => decodeURIComponent(u.pathname).replace(/^\/([A-Za-z]:)/, "$1");
const t0 = Date.now();
const log = (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s] ${s}`);
const H = { apikey: SEC, Authorization: `Bearer ${SEC}`, "Content-Type": "application/json" };
const rest = async (path, init = {}) => {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { ...init, headers: { ...H, Prefer: "return=representation", ...(init.headers ?? {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path}: ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
};
const problems = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); if (!ok) problems.push(name); };

// ---- fixtures: the real mark scheme + a real cached outcome (newest grading of Student_4)
const rubric = JSON.parse(readFileSync(new URL("rubric.json", DATA), "utf8")).rubric;
const gradesDir = new URL("grades/", DATA);
const outcomeFile = readdirSync(gradesDir).filter((f) => f.startsWith("Student_4-")).sort((a, b) => statSync(new URL(b, gradesDir)).mtimeMs - statSync(new URL(a, gradesDir)).mtimeMs)[0];
const outcome = JSON.parse(readFileSync(new URL(outcomeFile, gradesDir), "utf8"));
const pageFiles = JSON.parse(readFileSync(new URL("pages/index.json", DATA), "utf8")).Student_4;

// ---- throwaway teacher
const email = `e2e-off-${Date.now()}@gradelens.test`, password = `Off-${Date.now()}-pw!`;
const created = await (await fetch(`${URL_}/auth/v1/admin/users`, { method: "POST", headers: H, body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: "Offline Tester" } }) })).json();
const jar = new Map();
const sb = createServerClient(URL_, PUB, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach((c) => jar.set(c.name, c.value)) } });
await sb.auth.signInWithPassword({ email, password });
let classId;
const browser = await puppeteer.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
try {
  // ---- data, through the teacher's own client where the app would (RLS), the server's key where the job would
  const [cls] = (await sb.from("classes").insert({ name: "Offline E2E", owner_id: created.id }).select("id")).data;
  classId = cls.id;
  const { data: studs } = await sb.from("students").insert([["Grace Hopper", "S01"], ["Alan Turing", "S02"], ["Ada Lovelace", "S03"]].map(([display_name, anon_code]) => ({ class_id: classId, display_name, anon_code }))).select("id,anon_code");
  const { data: [test] } = await sb.from("tests").insert({ class_id: classId, title: "Offline exam", rubric, rubric_status: "approved" }).select("id");
  const [sub] = await rest("submissions", { method: "POST", body: JSON.stringify({ test_id: test.id, student_id: studs[0].id, status: "graded", risk: outcome.risk, warnings: outcome.warnings ?? [] }) });
  for (const [i, f] of pageFiles.entries()) {
    const path = `${classId}/${test.id}/${sub.id}/${i + 1}-e2e.jpg`;
    const up = await fetch(`${URL_}/storage/v1/object/pages/${path}`, { method: "POST", headers: { apikey: SEC, Authorization: `Bearer ${SEC}`, "Content-Type": "image/jpeg" }, body: readFileSync(fsPath(new URL(`pages/${f}`, DATA))) });
    if (!up.ok) throw new Error(`storage upload ${up.status}`);
    await rest("pages", { method: "POST", body: JSON.stringify({ submission_id: sub.id, page_no: i + 1, storage_path: path, media_type: "image/jpeg" }) });
  }
  await rest("question_results", { method: "POST", body: JSON.stringify(outcome.questions.map((q) => ({
    submission_id: sub.id, q: q.q, max: q.max, score_a: q.scoreA, score_b: q.scoreB, ai_score: q.final, risk: q.risk, flags: q.flags,
    answer: q.answer ?? null, grade_a: q.gradeA ?? null, grade_b: q.gradeB ?? null,
  }))) });
  await rest("rpc/refresh_submission", { method: "POST", body: JSON.stringify({ sid: sub.id }) });
  log(`fixture ready: a real script (Student_4, ${outcome.total}/${outcome.max} suggested) in a throwaway class`);

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 950 });
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text())) problems.push(`console: ${m.text().slice(0, 160)}`); });
  await page.setCookie(...[...jar].map(([name, value]) => ({ name, value, domain: "localhost", path: "/", sameSite: "Lax" })));
  const shot = (name) => page.screenshot({ path: `${out}/${name}.png` }); // viewport only: full-page shots of the 100dvh review layout are very slow
  const waitText = (text, timeout = 30000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout, polling: 250 }, text);

  // ---- review
  let t = Date.now();
  await page.goto(`${APP}/app/tests/${test.id}/review`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("section[aria-label='Marking sheet'] h1", { timeout: 60000 });
  await page.waitForFunction(() => [...document.images].every((i) => i.complete), { timeout: 60000 });
  log(`review page ready in ${Date.now() - t} ms`);
  await shot("01-review");
  // pick an answered short question with marks so there is evidence to show
  const qWithEvidence = outcome.questions.find((q) => q.q > 20 && q.answer && q.gradeA?.criteria.some((c) => c.points > 0 && c.evidenceQuote))?.q;
  t = Date.now();
  await page.evaluate((q) => [...document.querySelectorAll("nav[aria-label=Questions] button")].find((b) => b.textContent.replace(/[⚑◐]/g, "") === String(q))?.click(), qWithEvidence);
  await page.waitForFunction((q) => document.querySelector("section[aria-label='Marking sheet'] article h2")?.textContent === `Question ${q}`, { timeout: 10000 }, qWithEvidence);
  const critIdx = await page.evaluate(() => {
    const items = [...document.querySelectorAll("section[aria-label='Marking sheet'] ol li button[aria-pressed]")];
    const i = items.findIndex((b) => !/^0(?!\.)/.test(b.querySelector(".mark")?.textContent?.trim() ?? "0"));
    (items[i >= 0 ? i : 0])?.click();
    return i;
  });
  await page.waitForFunction(() => document.querySelectorAll("[data-hit='true']").length > 0, { timeout: 5000 }).catch(() => {});
  const hits = await page.evaluate(() => document.querySelectorAll("[data-hit='true']").length);
  log(`selected Q${qWithEvidence}, criterion #${critIdx}: ${Date.now() - t} ms`);
  check("evidence is highlighted on the student's page", hits > 0, `${hits} line(s)`);
  await shot("02-evidence");

  // change the mark, then approve the next one, then undo
  const qr = (await rest(`question_results?submission_id=eq.${sub.id}&q=eq.${qWithEvidence}&select=id,ai_score,max`))[0];
  const newMark = qr.ai_score >= qr.max ? qr.max - 0.5 : qr.ai_score + 0.5;
  t = Date.now();
  await page.evaluate((v) => [...document.querySelectorAll("[aria-label='Set the mark'] button")].find((b) => b.textContent.trim() === v)?.click(), newMark % 1 ? (Math.floor(newMark) ? `${Math.floor(newMark)}½` : "½") : String(newMark));
  await new Promise((r) => setTimeout(r, 2500));
  const after = (await rest(`question_results?id=eq.${qr.id}&select=teacher_score,approved`))[0];
  check("changing a mark saves the teacher's mark and approves it", Number(after.teacher_score) === newMark && after.approved, `${qr.ai_score} -> ${after.teacher_score}, ${Date.now() - t} ms`);
  await page.keyboard.press("a"); // keyboard approve on the question it moved to
  await new Promise((r) => setTimeout(r, 2500));
  const events = await rest(`review_events?select=action,from_score,to_score,question_result_id&order=created_at`, { headers: {} });
  const mine = events.filter((e) => e.question_result_id === qr.id);
  check("the decision is in the audit log", mine.length === 1 && mine[0].action === "adjust" && Number(mine[0].to_score) === newMark);
  const nApproved = (await rest(`question_results?submission_id=eq.${sub.id}&approved=is.true&select=id`)).length;
  check("keyboard A approves the next mark", nApproved === 2, `${nApproved} approved`);
  await shot("03-after-decisions");
  t = Date.now();
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent.startsWith("approve the") && !b.disabled), { timeout: 15000 });
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.startsWith("approve the"))?.click());
  await page.waitForFunction(() => document.body.innerText.includes("Approved "), { timeout: 15000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1000));
  const ready = (await rest(`question_results?submission_id=eq.${sub.id}&approved=is.true&select=id`)).length;
  check("approve-all-ready approves the low-risk marks in one go", ready > nApproved, `${nApproved} -> ${ready} (${Date.now() - t} ms)`);
  const [s2] = await rest(`submissions?id=eq.${sub.id}&select=total,status`);
  log(`script total now ${s2.total} (${s2.status})`);

  // ---- insights
  t = Date.now();
  await page.goto(`${APP}/app/tests/${test.id}/insights`, { waitUntil: "domcontentloaded" });
  await waitText("Question by question", 60000);
  log(`insights page ready in ${Date.now() - t} ms`);
  const meters = await page.evaluate(() => document.querySelectorAll("[role=img]").length);
  check("insights show the item analysis and feedback", meters > 10 && (await page.evaluate(() => document.body.innerText.includes("Feedback for each student"))), `${meters} chart marks`);
  await page.screenshot({ path: `${out}/04-insights.png`, fullPage: true });

  // ---- answer sheets -> photos -> scan (mark scheme set back to draft so nothing is sent to the AI)
  await sb.from("tests").update({ rubric_status: "draft" }).eq("id", test.id);
  await page.goto(`${APP}/app/tests/${test.id}/sheets?pages=2`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll("section svg").length === 6, { timeout: 60000 });
  const sheets = await page.$$("main section");
  const shots = [];
  for (const [i, el] of sheets.entries()) { const p = `${out}/sheet-${i}.png`; await el.screenshot({ path: p }); shots.push(p); }
  log(`printed ${shots.length} sheets (3 students x 2 pages) and photographed them`);
  const shuffled = [shots[3], shots[0], shots[5], shots[2], shots[1], shots[4]].map((p) => p.replace(/\//g, "\\"));
  await page.goto(`${APP}/app/tests/${test.id}/scan`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("input[type=file]", { timeout: 60000 });
  t = Date.now();
  await (await page.$("input[type=file]")).uploadFile(...shuffled);
  await waitText("photos →", 120000);
  const summary = await page.evaluate(() => [...document.querySelectorAll("p")].find((p) => p.textContent.includes("photos →"))?.textContent);
  check("the shuffled pile is sorted to 3 students by QR code", /6 photos → 3 students$/.test(summary ?? ""), `${summary} in ${Date.now() - t} ms`);
  await page.screenshot({ path: `${out}/05-scan.png`, fullPage: true });
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.startsWith("Upload 3"))?.click());
  await waitText("Marking has started", 120000);
  const subs = await rest(`submissions?test_id=eq.${test.id}&source=eq.scan&select=id,status,pages(page_no)`);
  check("the two new students' pages were uploaded (2 pages each, waiting for the mark scheme)", subs.length === 2 && subs.every((s) => s.pages.length === 2 && s.status === "queued"), subs.map((s) => `${s.pages.length} pages, ${s.status}`).join("; "));
  // privacy: the stored photo must have the printed name band blanked out (it was done on the device)
  const [firstPage] = await rest(`pages?submission_id=eq.${subs[0].id}&page_no=eq.1&select=storage_path`);
  const signed = await (await fetch(`${URL_}/storage/v1/object/sign/pages/${firstPage.storage_path}`, { method: "POST", headers: H, body: JSON.stringify({ expiresIn: 300 }) })).json();
  const band = await page.evaluate(async (src) => {
    const img = new Image(); img.crossOrigin = "anonymous"; img.src = src; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0);
    const dark = (y0, y1) => { const d = ctx.getImageData(0, Math.floor(img.height * y0), img.width, Math.floor(img.height * (y1 - y0))).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] < 300) n++; return n; };
    return { header: dark(0.02, 0.12), body: dark(0.2, 0.95) };
  }, `${URL_}/storage/v1${signed.signedURL}`);
  check("the printed name band is blank in the uploaded photo (redacted on the device)", band.header === 0 && band.body > 0, `dark pixels: header ${band.header}, answer area ${band.body}`);
  const refused = await page.evaluate(() => document.body.innerText.includes("already started marking"));
  check("a script the teacher already started reviewing is NOT replaced by a scan", refused);
  await page.screenshot({ path: `${out}/06-scan-sent.png` });
} catch (e) {
  problems.push(`FAILED: ${e.message}`);
  for (const p of await browser.pages()) await p.screenshot({ path: `${out}/zz-failure-${(await browser.pages()).indexOf(p)}.png` }).catch(() => {});
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
  const del = await fetch(`${URL_}/auth/v1/admin/users/${created.id}`, { method: "DELETE", headers: H });
  log(`cleaned up (user delete ${del.status})`);
  console.log(problems.length ? `\nPROBLEMS:\n- ${problems.join("\n- ")}` : "\nall checks passed, no problems");
  process.exit(problems.length ? 1 : 0);
}
