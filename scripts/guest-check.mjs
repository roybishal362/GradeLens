// The path a judge takes: sign-in page -> guest -> copy the sample class -> review. Works against any address.
// Usage: APP_URL=https://... node scripts/guest-check.mjs   (the guest account created is deleted afterwards)
import { readFileSync } from "node:fs";
import puppeteer from "puppeteer-core";
const env = Object.fromEntries(readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const APP = process.env.APP_URL ?? "http://localhost:3000", URL_ = env.NEXT_PUBLIC_SUPABASE_URL, SEC = env.SUPABASE_SECRET_KEY;
const H = { apikey: SEC, Authorization: `Bearer ${SEC}`, "Content-Type": "application/json" };
const started = Date.now() - 5000;
let bad = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); if (!ok) bad++; };
const has = (p, t) => p.evaluate((x) => document.body.innerText.includes(x), t);
const click = (p, t) => p.evaluate((x) => [...document.querySelectorAll("button, a")].find((b) => b.textContent.includes(x))?.click(), t);
const browser = await puppeteer.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${APP}/sign-in`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 20000 }).catch(() => {});
  const { external } = await (await fetch(`${URL_}/auth/v1/settings`, { headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY } })).json();
  check("the Google button matches whether Google sign-in is on", (await has(page, "Continue with Google")) === Boolean(external?.google), `google ${external?.google ? "on" : "off"}`);
  await click(page, "Try it as a guest");
  await page.waitForFunction(() => location.pathname === "/app", { timeout: 60000 });
  await page.waitForFunction(() => document.body.innerText.includes("Copy the sample class"), { timeout: 60000 });
  check("a visitor gets a guest workspace with one click", true);
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 20000 }).catch(() => {});
  const t = Date.now();
  await click(page, "Copy the sample class");
  await page.waitForFunction(() => /\/app\/tests\//.test(location.pathname) && document.body.innerText.includes("Scripts"), { timeout: 180000 });
  check("the sample class copies into the guest workspace", true, `${((Date.now() - t) / 1000).toFixed(0)} s`);
  await page.goto(`${page.url().split("?")[0]}/review`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForFunction(() => document.body.innerText.includes("Question"), { timeout: 60000 });
  check("the guest can open the review screen", await has(page, "Approve the marks it has earned"));
} catch (e) { check("flow finished", false, String(e).slice(0, 160)); } finally {
  await browser.close();
  const { users = [] } = await (await fetch(`${URL_}/auth/v1/admin/users?per_page=200`, { headers: H })).json();
  const mine = users.filter((u) => u.is_anonymous && Date.parse(u.created_at) >= started);
  for (const u of mine) await fetch(`${URL_}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: H });
  console.log(`cleaned up ${mine.length} guest account(s)`);
}
process.exit(bad ? 1 : 0);
