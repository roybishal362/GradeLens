// End-to-end check of the real product in the installed Edge, against the running dev server, with the real database,
// the real free AI models and a REAL handwritten script (Mendeley dataset, CC BY 4.0).
//   teacher signs in -> creates class + roster -> new test -> pastes a question paper -> AI drafts the mark scheme ->
//   approves it -> student uploads photos from a phone -> GradeLens reads + grades -> teacher reviews and approves.
// A throwaway teacher account is created and deleted (with all its data and files) at the end. Never prints keys.
// Usage: node scripts/e2e.mjs [studentNumber=6] [outDir]
import { readFileSync, mkdirSync } from "node:fs";
import { createServerClient } from "@supabase/ssr";
import puppeteer from "puppeteer-core";

const [studentNo = "6", out = "e2e-shots"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const env = Object.fromEntries(readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL, PUB = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SEC = env.SUPABASE_SECRET_KEY;
const APP = "http://localhost:3000";
const DATA = new URL("../../datasets/mendeley-sf3kvjwknt/", import.meta.url);
const t0 = Date.now();
const log = (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s] ${s}`);
const admin = (path, init = {}) => fetch(URL_ + path, { ...init, headers: { apikey: SEC, Authorization: `Bearer ${SEC}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });

// ---- the paper: 2 multiple-choice + 3 short-answer questions from the real exam
const questionTxt = readFileSync(new URL("extracted/data/Question.txt", DATA), "utf8");
const block = (n) => { const m = questionTxt.match(new RegExp(`^${n}\\. [\\s\\S]*?(?=^\\d{1,2}\\. |^Part|$(?![\\s\\S]))`, "m")); return m ? m[0].trim() : ""; };
const paper = ["Part I: Multiple Choice Questions (1 Mark Each)", block(2), block(3), "Part II: Short Answer Questions (2 Marks Each)", block(21), block(22), block(29)].join("\n\n");
const keyRows = readFileSync(new URL("extracted/data/answerkey.txt", DATA), "utf8").split(/\r?\n/).slice(1);
const key = keyRows.filter((r) => /^(2|3|21|22|29),/.test(r)).map((r) => { const [n, , ...a] = r.split(","); return `${n}. ${a.join(",").replace(/^"|"$/g, "")}`; }).join("\n");
const pageFiles = JSON.parse(readFileSync(new URL("pages/index.json", DATA), "utf8"))[`Student_${studentNo}`]
  .map((f) => decodeURIComponent(new URL(`pages/${f}`, DATA).pathname).replace(/^\/([A-Za-z]:)/, "$1"));

// ---- throwaway teacher + session cookies (exactly what the browser would hold after signing in)
const email = `e2e-${Date.now()}@gradelens.test`, password = `E2e-${Date.now()}-pw!`;
const created = await (await admin("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: "E2E Teacher" } }) })).json();
if (!created.id) throw new Error("could not create the test teacher");
const jar = new Map();
const sb = createServerClient(URL_, PUB, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach((c) => jar.set(c.name, c.value)) } });
const { error: signErr } = await sb.auth.signInWithPassword({ email, password });
if (signErr) throw new Error("sign-in failed");
log("throwaway teacher created and signed in");

const browser = await puppeteer.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const problems = [];
let classId = null;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 950 });
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text().slice(0, 200)}`); });
  await page.setCookie(...[...jar].map(([name, value]) => ({ name, value, domain: "localhost", path: "/", sameSite: "Lax" })));
  const clickText = async (p, sel, text) => {
    const ok = await p.evaluate((sel, text) => {
      const el = [...document.querySelectorAll(sel)].find((e) => e.textContent.trim().startsWith(text) && !e.disabled);
      if (el) el.click();
      return Boolean(el);
    }, sel, text);
    if (!ok) throw new Error(`no clickable ${sel} "${text}"`);
  };
  const waitText = (p, text, timeout = 30000) => p.waitForFunction((t) => document.body.innerText.includes(t), { timeout, polling: 500 }, text);
  const shot = (p, name) => p.screenshot({ path: `${out}/${name}.png`, fullPage: true });

  // 1. class + roster
  await page.goto(`${APP}/app`, { waitUntil: "networkidle0" });
  await shot(page, "01-dashboard");
  await page.type("input[name=name]", "E2E Data Science");
  await page.type("input[name=subject]", "Data Science");
  await clickText(page, "button", "Create class");
  await page.waitForFunction(() => location.pathname.includes("/classes/"), { timeout: 60000 });
  classId = page.url().split("/classes/")[1];
  log(`class created: ${page.url().replace(APP, "")}`);
  await page.waitForSelector("#names", { timeout: 30000 });
  await page.type("#names", "Ada Lovelace\nAlan Turing\nKatherine Johnson");
  await clickText(page, "button", "Add to class");
  await waitText(page, "Added 3 students");
  await page.waitForFunction(() => document.body.innerText.includes("Katherine Johnson") && document.body.innerText.includes("S03"), { timeout: 15000 });
  await shot(page, "02-class");
  log("roster added");

  // 2. test + mark scheme (pasted paper -> AI draft -> approve)
  await page.type("input[name=title]", "E2E quiz");
  await clickText(page, "button", "Create test");
  await page.waitForFunction(() => location.pathname.endsWith("/mark-scheme"), { timeout: 60000 });
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent.includes("Read the paper")), { timeout: 60000 });
  const testId = page.url().split("/tests/")[1].split("/")[0];
  // set the pasted text the way a paste does (one input event), not 4,000 simulated keystrokes
  const filled = await page.evaluate((paper, key) => {
    const areas = [...document.querySelectorAll("textarea")];
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    [paper, key].forEach((v, i) => { if (areas[i]) { set.call(areas[i], v); areas[i].dispatchEvent(new Event("input", { bubbles: true })); } });
    return areas.length;
  }, paper, key);
  log(`mark-scheme page: ${filled} text boxes; pasted ${paper.length} + ${key.length} characters`);
  await clickText(page, "button", "Read the paper");
  await waitText(page, "Found ", 180000);
  const found = await page.evaluate(() => document.querySelector("[role=status]")?.textContent);
  log(`paper read: ${found}`);
  await shot(page, "03-questions");
  await clickText(page, "button", "Draft the mark scheme");
  await waitText(page, "Draft ready", 240000);
  log("mark scheme drafted");
  await shot(page, "04-mark-scheme");
  const problemsShown = await page.evaluate(() => document.querySelector("[role=alert]")?.textContent ?? "");
  if (problemsShown) log(`mark-scheme problems shown: ${problemsShown}`);
  await clickText(page, "button", "Approve mark scheme");
  await page.waitForFunction(() => [...document.querySelectorAll("code")].some((c) => c.textContent.includes("/u/")), { timeout: 90000 });
  log("mark scheme approved");
  const uploadUrl = await page.evaluate(() => [...document.querySelectorAll("code")].map((c) => c.textContent).find((t) => t.includes("/u/")));
  if (!uploadUrl) throw new Error("no upload link shown");
  await shot(page, "05-test-before-upload");

  // 3. student uploads real handwriting from a phone
  const phone = await browser.newPage();
  await phone.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  phone.on("pageerror", (e) => problems.push(`phone page error: ${e.message}`));
  await phone.goto(uploadUrl, { waitUntil: "networkidle0" });
  const alan = await phone.evaluate(() => [...document.querySelectorAll("option")].find((o) => o.textContent === "Alan Turing")?.value);
  await phone.select("select", alan);
  const input = await phone.$("input[type=file][multiple]");
  await input.uploadFile(...pageFiles);
  await phone.waitForFunction((n) => document.querySelectorAll("ol[aria-label='Your pages'] li").length === n, { timeout: 30000 }, pageFiles.length);
  await shot(phone, "06-phone-pages");
  await clickText(phone, "button", "Send ");
  await waitText(phone, "Sent", 120000);
  await shot(phone, "07-phone-sent");
  log(`student uploaded ${pageFiles.length} pages (Student_${studentNo} of the dataset, as "Alan Turing")`);

  // 4. wait for reading + grading
  await page.goto(`${APP}/app/tests/${testId}`, { waitUntil: "networkidle0" });
  const deadline = Date.now() + 6 * 60_000;
  let status = "";
  while (Date.now() < deadline) {
    status = await page.evaluate(() => document.querySelector("tbody")?.innerText ?? "");
    if (/Marked, waiting for you|Couldn't be marked/.test(status)) break;
    await new Promise((r) => setTimeout(r, 5000));
    await page.reload({ waitUntil: "networkidle0" });
  }
  log(`script status: ${status.replace(/\s+/g, " ").slice(0, 300)}`);
  await shot(page, "08-test-after-grading");
  if (!/Marked, waiting for you/.test(status)) throw new Error("the script was not marked in time");

  // 5. review: evidence + approve
  await page.goto(`${APP}/app/tests/${testId}/review`, { waitUntil: "networkidle0" });
  await shot(page, "09-review");
  const crit = await page.$("section[aria-label='Marking sheet'] button[aria-pressed]");
  if (crit) { await crit.click(); await new Promise((r) => setTimeout(r, 900)); await shot(page, "10-review-evidence"); }
  const highlighted = await page.evaluate(() => document.querySelectorAll("[data-hit='true']").length);
  log(`evidence lines highlighted on the page: ${highlighted}`);
  const before = await page.evaluate(() => document.querySelector("section[aria-label='Marking sheet'] header p")?.textContent ?? "");
  await clickText(page, "button", "Approve ");
  await new Promise((r) => setTimeout(r, 2500));
  const after = await page.evaluate(() => document.querySelector("section[aria-label='Marking sheet'] header p")?.textContent ?? "");
  log(`approve one mark: "${before}" -> "${after}"`);
  await shot(page, "11-review-approved");
  const { data: events } = await sb.from("review_events").select("action,from_score,to_score");
  log(`audit log rows visible to the teacher: ${JSON.stringify(events)}`);
} catch (e) {
  problems.push(`FAILED: ${e.message}`);
  for (const p of await browser.pages()) await p.screenshot({ path: `${out}/zz-failure-${(await browser.pages()).indexOf(p)}.png`, fullPage: true }).catch(() => {});
} finally {
  await browser.close();
  // clean up: files, then the user (cascades to classes, tests, scripts, marks)
  if (classId) {
    const list = await (await admin("/storage/v1/object/list/pages", { method: "POST", body: JSON.stringify({ prefix: `${classId}/`, limit: 1000 }) })).json();
    for (const folder of Array.isArray(list) ? list : []) {
      const inner = await (await admin("/storage/v1/object/list/pages", { method: "POST", body: JSON.stringify({ prefix: `${classId}/${folder.name}/`, limit: 1000 }) })).json();
      for (const sub of Array.isArray(inner) ? inner : []) {
        const files = await (await admin("/storage/v1/object/list/pages", { method: "POST", body: JSON.stringify({ prefix: `${classId}/${folder.name}/${sub.name}/`, limit: 1000 }) })).json();
        const paths = (Array.isArray(files) ? files : []).map((f) => `${classId}/${folder.name}/${sub.name}/${f.name}`);
        if (paths.length) await admin("/storage/v1/object/pages", { method: "DELETE", body: JSON.stringify({ prefixes: paths }) });
      }
    }
  }
  await admin(`/auth/v1/admin/users/${created.id}`, { method: "DELETE" });
  log("cleaned up the throwaway teacher and their files");
  console.log(problems.length ? `\nPROBLEMS:\n- ${problems.join("\n- ")}` : "\nno problems");
  process.exit(problems.some((p) => p.startsWith("FAILED")) ? 1 : 0);
}
