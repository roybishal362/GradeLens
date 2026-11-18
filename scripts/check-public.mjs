// Checks every public page a judge sees, in the installed Edge, desktop + phone: renders, no console errors, no
// horizontal overflow, and the real-data elements are there. Saves screenshots. Usage: node scripts/check-public.mjs [outDir]
import { mkdirSync } from "node:fs";
import puppeteer from "puppeteer-core";

const [out = "public-check"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const APP = process.env.APP_URL ?? "http://localhost:3000";
const PAGES = [
  { path: "/", must: ["Marking that shows its working", "dataset's own teacher gave", "How it works", "Built around how teachers mark"] },
  { path: "/sample", must: ["Sample class", "Review the scripts", "Marked by the dataset"] },
  { path: "/sample/review", must: ["as read from the page", "The dataset's teacher gave"] },
  { path: "/sample/insights", must: ["What the class misunderstood", "Question by question", "Feedback for each student"] },
  { path: "/transparency", must: ["How accurate is GradeLens?", "Where students' work goes"] },
  { path: "/sign-in", must: ["Continue with Google", "Try it as a guest"] },
  { path: "/help", must: ["Getting started", "Reviewing marks", "Returning results"] },
];
const views = [
  { name: "desktop", width: 1440, height: 950, deviceScaleFactor: 1 },
  { name: "phone", width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
];
const browser = await puppeteer.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const problems = [];
for (const v of views) {
  for (const p of PAGES) {
    const page = await browser.newPage();
    await page.setViewport(v);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/favicon/.test(m.text())) errors.push(m.text().slice(0, 160)); });
    const t = Date.now();
    await page.goto(APP + p.path, { waitUntil: "networkidle2", timeout: 120000 });
    await page.waitForFunction(() => [...document.images].every((i) => i.complete), { timeout: 30000 }).catch(() => {});
    const ms = Date.now() - t;
    const info = await page.evaluate((must) => ({
      missing: must.filter((m) => !document.body.innerText.includes(m)),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      highlights: document.querySelectorAll(".highlight").length,
    }), p.must);
    const ok = !info.missing.length && !info.overflow && !errors.length;
    console.log(`${ok ? "PASS" : "FAIL"}  ${v.name.padEnd(7)} ${p.path.padEnd(17)} ${String(ms).padStart(5)} ms${info.missing.length ? `  missing: ${info.missing.join(" | ")}` : ""}${info.overflow ? "  OVERFLOW" : ""}${errors.length ? `  errors: ${errors.join(" | ")}` : ""}`);
    if (!ok) problems.push(`${v.name} ${p.path}`);
    await page.screenshot({ path: `${out}/${v.name}${p.path.replace(/\//g, "_") || "_home"}.png` });
    await page.close();
  }
}
await browser.close();
console.log(problems.length ? `\n${problems.length} page(s) with problems` : "\nall public pages pass");
process.exit(problems.length ? 1 : 0);
