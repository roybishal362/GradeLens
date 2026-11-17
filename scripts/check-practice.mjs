// Live check of the judges' 30-second path: open the sample class's practice page, type two answers, get real AI
// feedback (2 model calls). Usage: node scripts/check-practice.mjs [outDir]
import { mkdirSync } from "node:fs";
import puppeteer from "puppeteer-core";

const out = process.argv[2] ?? "practice-check";
mkdirSync(out, { recursive: true });
const APP = "http://localhost:3000";
const browser = await puppeteer.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
let ok = false;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto(`${APP}/sample`, { waitUntil: "networkidle2", timeout: 120000 });
  const href = await page.evaluate(() => [...document.querySelectorAll("a")].find((a) => a.textContent.includes("Answer a question yourself"))?.getAttribute("href"));
  if (!href) throw new Error("no practice link on the sample page");
  await page.goto(APP + href, { waitUntil: "networkidle2", timeout: 120000 });
  await page.waitForNetworkIdle({ idleTime: 800 }).catch(() => {});
  const set = async (q, text) => page.evaluate((q, text) => {
    const li = [...document.querySelectorAll("ol li")].find((l) => l.textContent.trim().startsWith(`Q${q} `) || l.textContent.includes(`Q${q} (`));
    const ta = li?.querySelector("textarea");
    if (!ta) return false;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(ta, text);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }, q, text);
  const a = await set(22, "The model is overfitting. It memorised the training data, so it does well on training but fails on new test data.");
  const b = await set(29, "Because KNN uses distances, so a feature with big numbers would dominate unless all features are scaled.");
  if (!a || !b) throw new Error("couldn't find the answer boxes");
  const t = Date.now();
  await page.evaluate(() => [...document.querySelectorAll("button")].find((x) => x.textContent.startsWith("Check "))?.click());
  await page.waitForFunction(() => document.body.innerText.includes("Practice feedback") || document.querySelector("[role=alert]"), { timeout: 280000, polling: 1000 });
  const text = await page.evaluate(() => document.body.innerText);
  const err = await page.evaluate(() => document.querySelector("[role=alert]")?.textContent);
  await page.screenshot({ path: `${out}/practice-feedback.png`, fullPage: true });
  if (err) throw new Error(`error shown: ${err}`);
  ok = text.includes("Q22") && text.includes("Q29") && text.includes("Show the model answer");
  console.log(`${ok ? "PASS" : "FAIL"}  real AI practice feedback on the sample class in ${((Date.now() - t) / 1000).toFixed(1)} s`);
  const score = await page.evaluate(() => document.querySelector(".mark")?.textContent);
  console.log(`score shown: ${score}`);
} catch (e) {
  console.log(`FAIL  ${e.message}`);
} finally {
  await browser.close();
  process.exit(ok ? 0 : 1);
}
