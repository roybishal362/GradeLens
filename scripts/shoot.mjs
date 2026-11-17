// UI check: real mobile + desktop emulation in the installed Edge. Reports horizontal overflow and saves screenshots.
// Usage: node scripts/shoot.mjs <url> <outDir>
import puppeteer from "puppeteer-core";
const [url = "http://localhost:3000", out = "."] = process.argv.slice(2);
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
});
const views = [
  { name: "desktop", width: 1440, height: 1000, deviceScaleFactor: 1, isMobile: false },
  { name: "mobile", width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
];
for (const v of views) {
  const page = await browser.newPage();
  await page.setViewport(v);
  await page.goto(url, { waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 800));
  const m = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const wide = [...document.querySelectorAll("body *")]
      .filter((el) => el.getBoundingClientRect().right > vw + 1)
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 2).join(".")}`);
    return { vw, scrollW: document.documentElement.scrollWidth, wide };
  });
  console.log(`${v.name}: viewport ${m.vw}px, page ${m.scrollW}px ${m.scrollW > m.vw ? "OVERFLOW: " + m.wide.join(", ") : "ok (no horizontal overflow)"}`);
  await page.screenshot({ path: `${out}/${v.name}.png`, fullPage: true });
  await page.close();
}
await browser.close();
