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
  const afterBulk = await rest(`question_results?submission_id=eq.${sub.id}&approved=is.true&select=id,q`);
  const bulkIds = new Set((await rest(`review_events?action=eq.bulk_approve&select=question_result_id`)).map((e) => e.question_result_id));
  const bulkWritten = afterBulk.filter((x) => bulkIds.has(x.id) && x.q > 20).length;
  check("approve-earned approves ready multiple-choice marks in one go", afterBulk.length > nApproved, `${nApproved} -> ${afterBulk.length} (${Date.now() - t} ms)`);
  check("…but no written answer: those questions haven't earned it yet (5 checked, 90% kept)", bulkWritten === 0, `${bulkWritten} written answers bulk-approved`);
  const [s2] = await rest(`submissions?id=eq.${sub.id}&select=total,status`);
  log(`script total now ${s2.total} (${s2.status})`);

  // ---- exports, gradebook, settings
  const csv = await page.evaluate(async (u) => (await fetch(u)).text(), `${APP}/app/tests/${test.id}/export?kind=marks`);
  check("marks export downloads as CSV with every question", csv.includes("Student,Code,Q1") && csv.includes("Grace Hopper") && csv.includes("Q35"), `${csv.split("\n").length} lines`);
  const answersCsv = await page.evaluate(async (u) => (await fetch(u)).text(), `${APP}/app/tests/${test.id}/export?kind=answers`);
  check("every-answer export has one row per answer", answersCsv.split("\n").filter((l) => l.startsWith("Grace Hopper")).length === 35);
  await page.goto(`${APP}/app/classes/${classId}/gradebook`, { waitUntil: "domcontentloaded" });
  await waitText("Class average", 60000);
  check("gradebook shows the student and the class average", await page.evaluate(() => document.body.innerText.includes("Grace Hopper") && document.body.innerText.includes("Class average")));
  await page.goto(`${APP}/app/settings`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("input[name=display_name]", { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 800)); // let the streamed form settle
  await page.evaluate(() => {
    const el = document.querySelector("input[name=display_name]");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "Ms Offline");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Save")?.click());
  await waitText("Saved.", 30000);
  const savedProfile = await rest(`teacher_profiles?user_id=eq.${created.id}&select=display_name`);
  check("teacher can save the name shown to students", savedProfile[0]?.display_name === "Ms Offline", `stored: ${JSON.stringify(savedProfile)}`);

  // ---- return results: approve the whole script, release, student opens their page and asks for a re-check
  const { data: pendingRows } = await sb.from("question_results").select("id").eq("submission_id", sub.id).eq("approved", false);
  for (const r of pendingRows ?? []) await sb.rpc("review_mark", { qid: r.id, act: "approve" });
  await page.goto(`${APP}/app/tests/${test.id}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Release results"), { timeout: 60000 });
  await page.waitForNetworkIdle({ idleTime: 800, timeout: 30000 }).catch(() => {}); // interactive (hydrated) before clicking
  for (let i = 0; i < 3 && !(await page.evaluate(() => document.body.innerText.includes("Released to students"))); i++) {
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Release results")?.click());
    await page.waitForFunction(() => document.body.innerText.includes("Released to students"), { timeout: 10000 }).catch(() => {});
  }
  await waitText("Released to students", 5000);
  check("teacher releases results from the test page", true);
  const [{ result_token: token }] = await rest(`submissions?id=eq.${sub.id}&select=result_token`);
  const student = await browser.createBrowserContext();
  const sp = await student.newPage();
  await sp.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await sp.goto(`${APP}/r/${token}`, { waitUntil: "domcontentloaded" });
  await sp.waitForFunction(() => document.body.innerText.includes("Your marks"), { timeout: 60000 });
  const studentView = await sp.evaluate(() => document.body.innerText);
  check("the student sees their approved marks, feedback and the teacher's name (no sign-in)", studentView.includes("What to work on") && studentView.includes("Ms Offline") && studentView.includes("Q21"));
  await sp.screenshot({ path: `${out}/07-student-results.png`, fullPage: true });
  await sp.select("form select", "21");
  await sp.type("form textarea", "I explained labelled data, please check Q21 again.");
  await sp.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Send to my teacher"))?.click());
  await sp.waitForFunction(() => document.body.innerText.includes("Sent."), { timeout: 30000 });
  const [reqRow] = await rest(`review_requests?submission_id=eq.${sub.id}&select=id,status,q`);
  check("the student's re-check request reaches the teacher", reqRow?.q === 21 && reqRow?.status === "open");
  await page.goto(`${APP}/app/tests/${test.id}/review?s=${sub.id}&q=21`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.innerText.includes("asked you to look again"), { timeout: 60000 });
  await page.type("section[aria-label='Marking sheet'] textarea", "Checked: the mark stands, you needed the mapping from inputs to outputs.");
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Mark as answered")?.click());
  await waitText("Request answered.", 30000);
  await sp.reload({ waitUntil: "domcontentloaded" });
  await sp.waitForFunction(() => document.body.innerText.includes("answered"), { timeout: 30000 });
  check("the teacher's reply appears on the student's page", await sp.evaluate(() => document.body.innerText.includes("the mark stands")));
  await student.close();

  // ---- practice: the teacher opens it from the test page
  await page.goto(`${APP}/app/tests/${test.id}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Open practice"), { timeout: 60000 });
  await page.waitForNetworkIdle({ idleTime: 800, timeout: 30000 }).catch(() => {});
  for (let i = 0; i < 3 && !(await page.evaluate(() => [...document.querySelectorAll("code")].some((c) => c.textContent.includes("/p/")))); i++) {
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Open practice")?.click());
    await page.waitForFunction(() => [...document.querySelectorAll("code")].some((c) => c.textContent.includes("/p/")), { timeout: 10000 }).catch(() => {});
  }
  const [pt] = await rest(`tests?id=eq.${test.id}&select=practice_open,practice_token`);
  const practiceUrl = await page.evaluate(() => [...document.querySelectorAll("code")].map((c) => c.textContent).find((x) => x.includes("/p/")));
  check("teacher opens practice and gets the practice link", pt.practice_open === true && practiceUrl?.endsWith(pt.practice_token));
  const pp = await browser.newPage();
  await pp.goto(practiceUrl, { waitUntil: "domcontentloaded" });
  await pp.waitForFunction(() => document.body.innerText.includes("Practise:"), { timeout: 60000 });
  check("the practice page opens for students without signing in", await pp.evaluate(() => document.querySelectorAll("textarea").length > 0 && document.body.innerText.includes("doesn't count towards a grade")));
  await pp.close();

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
  await page.waitForFunction(() => document.querySelectorAll("main section:has(svg)").length === 6, { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 800)); // let the streamed page settle before photographing the sheets
  const sheets = await page.$$("main section:has(svg)");
  if (sheets.length !== 6) throw new Error(`expected 6 printed sheets, found ${sheets.length}`);
  const shots = [];
  for (const [i, el] of sheets.entries()) { const p = `${out}/sheet-${i}.png`; await el.screenshot({ path: p }); shots.push(p); }
  log(`printed ${shots.length} sheets (3 students x 2 pages) and photographed them`);
  const shuffled = [shots[3], shots[0], shots[5], shots[2], shots[1], shots[4]].map((p) => p.replace(/\//g, "\\"));
  await page.goto(`${APP}/app/tests/${test.id}/scan`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("input[type=file]", { timeout: 60000 });
  await page.waitForNetworkIdle({ idleTime: 800, timeout: 30000 }).catch(() => {}); // interactive before choosing files
  t = Date.now();
  for (let i = 0; i < 3 && !(await page.evaluate(() => document.body.innerText.includes("photos →"))); i++) {
    await (await page.$("input[type=file]")).uploadFile(...shuffled);
    await page.waitForFunction(() => document.body.innerText.includes("photos →") || document.body.innerText.includes("Reading QR"), { timeout: 15000 }).catch(() => {});
    await page.waitForFunction(() => document.body.innerText.includes("photos →"), { timeout: 60000 }).catch(() => {});
  }
  await waitText("photos →", 5000);
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
  // typed hand-in (mark scheme is in draft here, so nothing goes to the AI)
  const [{ upload_token: up }] = await rest(`tests?id=eq.${test.id}&select=upload_token`);
  const tp = await browser.newPage();
  await tp.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await tp.goto(`${APP}/u/${up}`, { waitUntil: "domcontentloaded" });
  await tp.waitForSelector("select", { timeout: 60000 });
  await tp.waitForNetworkIdle({ idleTime: 800, timeout: 30000 }).catch(() => {});
  const alanId = await tp.evaluate(() => [...document.querySelectorAll("option")].find((o) => o.textContent === "Alan Turing")?.value);
  await tp.select("select", alanId);
  await tp.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Type answers")?.click());
  await tp.waitForSelector("textarea", { timeout: 15000 });
  await tp.evaluate(() => {
    const ta = document.querySelector("textarea");
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(ta, "Supervised learning uses labelled data to learn a mapping from inputs to outputs.");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    [...document.querySelectorAll("button[role=radio]")].find((b) => b.textContent === "B")?.click();
  });
  await tp.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.startsWith("Send 2 answers"))?.click());
  await tp.waitForFunction(() => document.body.innerText.includes("typed answers"), { timeout: 30000 });
  await tp.close();
  const alanSub = (await rest(`submissions?test_id=eq.${test.id}&select=id,status,warnings,student_id,students!inner(display_name)&students.display_name=eq.Alan Turing`))[0];
  const [run] = await rest(`grading_runs?submission_id=eq.${alanSub.id}&select=models,read_result`);
  check("a student can hand in typed answers (stored as the transcription, labelled as typed)",
    alanSub.warnings.includes("Typed answers (no photos).") && run?.models?.reader === "typed" && run.read_result.answers.length === 2,
    `status ${alanSub.status}, ${run?.read_result?.answers?.length ?? 0} answers`);
  const refused = await page.evaluate(() => document.body.innerText.includes("already started marking"));
  check("a script the teacher already started reviewing is NOT replaced by a scan", refused);
  // copy the sample class into this workspace (no uploads, no AI): what judges and pilot teachers use
  await page.goto(`${APP}/app`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent.includes("Copy the sample class")), { timeout: 60000 }).catch(() => {});
  const hasCopy = await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent.includes("Copy the sample class")));
  if (!hasCopy) {
    // the getting-started box is hidden once everything is done: use the sample page's button instead
    await page.goto(`${APP}/sample`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent.includes("Mark these scripts in your own workspace")), { timeout: 60000 });
  }
  await page.waitForNetworkIdle({ idleTime: 800, timeout: 30000 }).catch(() => {});
  t = Date.now();
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Copy the sample class") || b.textContent.includes("Mark these scripts in your own workspace"))?.click());
  await page.waitForFunction(() => /\/app\/tests\//.test(location.pathname) && document.body.innerText.includes("Scripts"), { timeout: 120000 });
  const copiedTestId = page.url().split("/tests/")[1].split(/[/?#]/)[0];
  const copied = await rest(`submissions?test_id=eq.${copiedTestId}&select=id`);
  const copiedMarks = await rest(`question_results?select=id,submissions!inner(test_id)&submissions.test_id=eq.${copiedTestId}`);
  check("one click copies the 20 real sample scripts into the teacher's own workspace", copied.length === 20 && copiedMarks.length === 700, `${copied.length} scripts, ${copiedMarks.length} marks in ${((Date.now() - t) / 1000).toFixed(1)} s`);
  // earned trust in the copied class: check 5 written Q25 answers one by one (keyboard A), then Q25 has earned
  // approval together; nothing else written gets bulk-approved
  const q25 = (await rest(`question_results?q=eq.25&approved=is.false&learned=is.true&select=id,submission_id,risk,answer,submissions!inner(test_id)&submissions.test_id=eq.${copiedTestId}`))
    .filter((x) => x.answer?.text?.trim());
  const reviewUrl = (sid) => `${APP}/app/tests/${copiedTestId}/review?s=${sid}&q=25`;
  for (const x of q25.slice(0, 5)) {
    await page.goto(reviewUrl(x.submission_id), { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.innerText.includes("Question 25"), { timeout: 60000 });
    await page.waitForNetworkIdle({ idleTime: 600, timeout: 30000 }).catch(() => {});
    await page.keyboard.press("a");
    await page.waitForFunction(() => !document.body.innerText.includes("saving…"), { timeout: 15000 }).catch(() => {});
    await page.waitForNetworkIdle({ idleTime: 800, timeout: 30000 }).catch(() => {});
  }
  const sixth = q25.slice(5).find((x) => x.risk === "low") ?? q25[5];
  await page.goto(reviewUrl(sixth.submission_id), { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.innerText.includes("Question 25"), { timeout: 60000 });
  const earnedText = await page.evaluate(() => document.body.innerText.includes("kept GradeLens' mark on 5 of the 5 answers"));
  check("after 5 answers checked and kept, the question shows it has earned approval together", earnedText);
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.startsWith("Approve every ready Q25 mark"))?.click());
  await page.waitForFunction(() => document.body.innerText.includes("Approved "), { timeout: 20000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));
  const bulkEv = new Set((await rest(`review_events?action=eq.bulk_approve&select=question_result_id`)).map((e) => e.question_result_id));
  const copiedQr = await rest(`question_results?approved=is.true&select=id,q,submissions!inner(test_id)&submissions.test_id=eq.${copiedTestId}`);
  const bulkQs = [...new Set(copiedQr.filter((x) => bulkEv.has(x.id)).map((x) => x.q))];
  check("…and one click approves the other ready Q25 marks, and no other written question", bulkQs.includes(25) && bulkQs.every((q) => q === 25 || q <= 20),
    `bulk-approved questions: ${bulkQs.join(", ") || "none"}; Q25 approved in bulk: ${copiedQr.filter((x) => bulkEv.has(x.id) && x.q === 25).length}`);
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
