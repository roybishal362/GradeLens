// Every image in the README, captured from the running app with REAL data only (no AI calls).
// A throwaway teacher copies the public sample class (real handwritten scripts), then the dataset's own teacher's marks
// are replayed as that teacher's review decisions on the first waiting scripts: approve when they equal GradeLens'
// suggestion, otherwise adjust to the teacher's mark. The account and its copy are deleted at the end.
//
// Usage (against a production build):
//   npx next build && npx next start -p 3001
//   APP_URL=http://localhost:3001 node scripts/readme-shots.mjs docs/images
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServerClient } from "@supabase/ssr";
import puppeteer from "puppeteer-core";

const out = resolve(process.argv[2] ?? "docs/images");
const REPLAY = 8; // scripts whose decisions are replayed
mkdirSync(out, { recursive: true });
const env = Object.fromEntries(readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL, PUB = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SEC = env.SUPABASE_SECRET_KEY;
const APP = process.env.APP_URL ?? "http://localhost:3000";
const H = { apikey: SEC, Authorization: `Bearer ${SEC}`, "Content-Type": "application/json" };
const rest = async (path) => {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { headers: H });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const studentNo = (s) => Number(s.students.display_name.replace(/\D/g, ""));
const HARSH = "0 marks for a written answer: check it";

const email = `readme-shots-${Date.now()}@gradelens.test`, password = `Shots-${Date.now()}-pw!`;
const created = await (await fetch(`${URL_}/auth/v1/admin/users`, { method: "POST", headers: H, body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: "Demo teacher" } }) })).json();
const jar = new Map();
const sb = createServerClient(URL_, PUB, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach((c) => jar.set(c.name, c.value)) } });
await sb.auth.signInWithPassword({ email, password });
await sb.from("teacher_profiles").upsert({ user_id: created.id, display_name: "Demo teacher" });
const browser = await puppeteer.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });

const DESKTOP = { width: 1440, height: 900, deviceScaleFactor: 1 };
const TALL_2X = { width: 1440, height: 1500, deviceScaleFactor: 2 };
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

try {
  const page = await browser.newPage();
  await page.setCookie(...[...jar].map(([name, value]) => ({ name, value, domain: "localhost", path: "/", sameSite: "Lax" })));
  const go = async (path, view = DESKTOP) => {
    await page.setViewport(view);
    await page.goto(APP + path, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForNetworkIdle({ idleTime: 700, concurrency: 2, timeout: 25000 }).catch(() => {}); // link prefetching can keep the network busy
    await page.waitForFunction(() => [...document.images].every((i) => i.complete), { timeout: 30000 }).catch(() => {});
    await page.evaluate(() => document.fonts.ready);
    await sleep(500);
  };
  const shot = async (file, opts = {}) => { await page.screenshot({ path: `${out}/${file}.png`, ...opts }); console.log(`saved ${file}`); };
  /** Clip between two elements (from the top of `from` to the bottom of `to`), both found by a page function. */
  const clipBetween = async (file, finder, pad = 12) => {
    const r = await page.evaluate(finder);
    if (!r) { console.log(`SKIPPED ${file}: element not found`); return; }
    await shot(file, { clip: { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: r.w + 2 * pad, height: r.h + 2 * pad } });
  };
  const showEvidence = async () => {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("section[aria-label='Marking sheet'] ol li button[aria-pressed]")].find((x) => !/^0/.test(x.querySelector(".mark")?.textContent?.trim() ?? "0"));
      b?.click();
    });
    await sleep(900);
  };

  // ---- public pages
  await go("/"); await shot("landing");
  await go("/sample"); await shot("sample");
  await go("/sample/insights", { ...DESKTOP, height: 1050 }); await shot("insights");
  await go("/transparency", TALL_2X);
  await clipBetween("transparency-trust", () => { const r = document.querySelector("#trust").getBoundingClientRect(); return { x: r.x, y: r.y + scrollY, w: r.width, h: r.height }; });

  // ---- copy the sample class through the real UI
  await go("/sample");
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Mark these scripts in your own workspace"))?.click());
  await page.waitForFunction(() => /\/app\/tests\//.test(location.pathname), { timeout: 180000 });
  const testId = page.url().split("/tests/")[1].split(/[/?#]/)[0];
  const [{ class_id: classId, upload_token: uploadToken }] = await rest(`tests?id=eq.${testId}&select=class_id,upload_token`);
  console.log(`copied the sample class: test ${testId}`);

  // ---- replay the dataset teacher's real marks on the first waiting scripts, in student order
  const all = (await rest(`submissions?test_id=eq.${testId}&select=id,status,result_token,students!inner(display_name)`)).sort((a, b) => studentNo(a) - studentNo(b));
  const waiting = all.filter((s) => s.status === "graded");
  let kept = 0, changed = 0;
  for (const s of waiting.slice(0, REPLAY)) {
    const rows = await rest(`question_results?submission_id=eq.${s.id}&approved=is.false&q=gt.20&select=id,q,max,ai_score,reference_score&order=q`);
    for (const r of rows) {
      const ref = r.reference_score === null ? null : Number(r.reference_score);
      if (ref === null || ref > Number(r.max) || ref * 2 !== Math.floor(ref * 2)) continue; // unmarked or out of range in the dataset
      const same = ref === Number(r.ai_score);
      const { error } = await sb.rpc("review_mark", same ? { qid: r.id, act: "approve" } : { qid: r.id, act: "adjust", score: ref });
      if (error) throw new Error(error.message);
      if (same) kept++; else changed++;
    }
  }
  const { data: track } = await sb.rpc("question_track", { tid: testId });
  const earned = track.filter((t) => t.q > 20 && t.checked >= 5 && t.kept >= 0.9 * t.checked);
  const weakest = track.filter((t) => t.q > 20 && t.checked >= 5).sort((a, b) => a.kept / a.checked - b.kept / b.checked)[0];
  console.log(`replayed ${REPLAY} scripts: kept ${kept}, changed ${changed}; earned: ${earned.map((t) => `Q${t.q} ${t.kept}/${t.checked}`).join(", ") || "none"}; weakest Q${weakest?.q} ${weakest?.kept}/${weakest?.checked}`);

  const left = waiting.slice(REPLAY);
  const scriptFor = async (q) => {
    for (const s of left) {
      const [r] = await rest(`question_results?submission_id=eq.${s.id}&q=eq.${q}&select=ai_score,risk`);
      if (r && Number(r.ai_score) > 0 && r.risk === "low") return s;
    }
    return left[0];
  };
  const reviewUrl = (sid, q) => `/app/tests/${testId}/review?s=${sid}&q=${q}`;
  // the question's heading down to the "earned / check" box
  const toTrustBox = () => {
    const a = document.querySelector("section[aria-label='Marking sheet'] article"), box = [...a.querySelectorAll("div")].find((d) => d.innerText.startsWith("You kept GradeLens'"));
    if (!box) return null;
    const t = a.getBoundingClientRect(), b = box.getBoundingClientRect();
    return { x: t.x, y: t.y, w: t.width, h: b.bottom - t.y };
  };
  const toFlags = () => {
    const a = document.querySelector("section[aria-label='Marking sheet'] article"), ul = a.querySelector("ul");
    if (!ul) return null;
    const t = a.getBoundingClientRect(), b = ul.getBoundingClientRect();
    return { x: t.x, y: t.y, w: t.width, h: b.bottom - t.y };
  };

  // ---- review screen
  const best = earned.find((t) => t.q === 25) ?? earned[0];
  if (best) {
    const s = await scriptFor(best.q);
    await go(reviewUrl(s.id, best.q)); await showEvidence(); await shot("review");
    await go(reviewUrl(s.id, best.q), TALL_2X); await clipBetween("trust-earned", toTrustBox, 8);
  }
  if (weakest) {
    const s = await scriptFor(weakest.q);
    await go(reviewUrl(s.id, weakest.q), TALL_2X); await clipBetween("trust-check", toTrustBox, 8);
  }
  // a harsh mark the guard stopped: GradeLens gave 0 to a written answer, the dataset's teacher gave marks
  const leftIds = new Set(left.map((s) => s.id));
  const harsh = (await rest(`question_results?approved=is.false&q=gt.20&ai_score=eq.0&select=submission_id,q,flags,reference_score,submissions!inner(test_id)&submissions.test_id=eq.${testId}`))
    .filter((r) => leftIds.has(r.submission_id) && r.flags.includes(HARSH) && Number(r.reference_score) >= 1)
    .sort((a, b) => Number(b.reference_score) - Number(a.reference_score))[0];
  if (harsh) { await go(reviewUrl(harsh.submission_id, harsh.q), TALL_2X); await clipBetween("harsh-guard", toFlags, 8); }

  // ---- test page: the score chart and "how closely it marks like you" (not the marking-time line: a replay takes no time)
  await go(`/app/tests/${testId}`, TALL_2X);
  await clipBetween("results-chart", () => {
    const s = [...document.querySelectorAll("section")].find((x) => x.innerText.startsWith("Results so far")), c = s?.querySelector("div.mt-4");
    if (!c) return null;
    const a = s.getBoundingClientRect(), b = c.getBoundingClientRect();
    return { x: a.x, y: a.y + scrollY, w: a.width, h: b.bottom - a.y + 14 };
  }, 0);
  await clipBetween("agreement", () => {
    const p = [...document.querySelectorAll("section p")].find((x) => x.innerText.startsWith("How closely GradeLens marks like you"));
    if (!p) return null;
    const r = p.getBoundingClientRect();
    return { x: r.x, y: r.y + scrollY, w: r.width, h: r.height };
  }, 10);

  // ---- other teacher screens
  await go(`/app/tests/${testId}/mark-scheme`);
  // the marking criteria of the first written questions (section 2 of the page)
  await page.evaluate(() => [...document.querySelectorAll("h3")].find((h) => h.innerText.startsWith("Q21."))?.scrollIntoView({ block: "start" }));
  await page.evaluate(() => { const m = [...document.querySelectorAll("main, main *")].find((e) => e.scrollTop > 0); (m ?? document.scrollingElement).scrollBy(0, -24); });
  await sleep(400); await shot("mark-scheme");
  await go(`/app/classes/${classId}/gradebook`); await shot("gradebook");
  await go(`/app/tests/${testId}/sheets?pages=2`);
  await page.waitForFunction(() => document.querySelectorAll("section svg").length >= 6, { timeout: 60000 });
  await shot("answer-sheets");
  const sheetFiles = [];
  for (const [i, el] of (await page.$$("main section")).slice(0, 6).entries()) { const p = `${out}/_sheet-${i}.png`; await el.screenshot({ path: p }); sheetFiles.push(p); }
  await go(`/app/tests/${testId}/scan`);
  await (await page.$("input[type=file]")).uploadFile(...[3, 0, 5, 1, 4, 2].map((i) => sheetFiles[i]));
  await page.waitForFunction(() => document.body.innerText.includes("photos →"), { timeout: 120000 });
  await sleep(600); await shot("scan-sorted");

  // ---- phones. Students 1-5 already carry the dataset teacher's marks, so Student 1's results page is real.
  const reviewS = best ? await scriptFor(best.q) : left[0];
  await go(reviewUrl(reviewS.id, best?.q ?? 25), PHONE); await shot("phone-review");
  await sb.from("tests").update({ uploads_open: true }).eq("id", testId); // the copied test starts with uploads closed
  await go(`/u/${uploadToken}`, PHONE);
  const opt = await page.evaluate(() => [...document.querySelectorAll("select option")].find((o) => o.value && /Student/.test(o.textContent))?.value);
  if (opt) await page.select("select", opt);
  await sleep(300); await shot("phone-upload");
  await sb.from("tests").update({ results_released: true, released_at: new Date().toISOString() }).eq("id", testId);
  const first = all.find((s) => s.status === "approved");
  await go(`/r/${first.result_token}`, PHONE); await shot("phone-results");
  const [{ practice_token: sampleToken }] = await rest(`tests?select=practice_token,classes!inner(is_sample)&classes.is_sample=is.true&limit=1`);
  await go(`/p/${sampleToken}`, PHONE); await shot("phone-practice");
} finally {
  await browser.close();
  const del = await fetch(`${URL_}/auth/v1/admin/users/${created.id}`, { method: "DELETE", headers: H });
  console.log(`cleaned up (user delete ${del.status})`);
}
