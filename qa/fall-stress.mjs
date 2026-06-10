import { createRequire } from "node:module";
// Playwright deps: `npm i playwright` in the repo root, or point QA_DEPS at a node_modules dir.
import { fileURLToPath } from "node:url";
const require = createRequire(process.env.QA_DEPS || fileURLToPath(new URL("../node_modules/", import.meta.url)));
const { chromium } = require("playwright");
const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto("http://127.0.0.1:4790/?qa=1");
await page.waitForTimeout(2500);
await page.evaluate(() => localStorage.removeItem("the-backrooms-v1-qa"));

let fails = 0;
for (let i = 0; i < 6; i++) {
  const before = await page.evaluate(() => window.__qa.state());
  const hole = await page.evaluate(() => window.__qa.findHole(120));
  if (!hole) { // no hole nearby (rare) — use stairs or skip deeper
    console.log(`fall ${i}: no hole found on floor ${before.floor}, teleporting far`);
    await page.evaluate(() => window.__qa.teleport(300 + Math.random() * 200, 300));
    await page.waitForTimeout(1200);
    continue;
  }
  await page.evaluate((h) => window.__qa.teleport(h.x, h.z), hole);
  await page.waitForTimeout(3800);   // fall + fade + grace partially
  const after = await page.evaluate(() => window.__qa.state());
  if (after.floor === before.floor && !await page.evaluate(() => window.__qa.state().y < -1)) {
    console.log(`fall ${i}: did not transition (floor ${before.floor})`); fails++;
    continue;
  }
  // (a) standing still for 3s must not re-transition
  await page.waitForTimeout(3000);
  const stable = await page.evaluate(() => window.__qa.state());
  const stableOk = stable.floor === after.floor && stable.y >= -0.01;
  // (b) movement must work: hold W for 700ms
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(700);
  await page.keyboard.up("KeyW");
  const moved = await page.evaluate(() => window.__qa.state());
  const dist = Math.hypot(moved.x - stable.x, moved.z - stable.z);
  const moveOk = dist > 0.5;
  console.log(`fall ${i}: floor ${before.floor} -> ${after.floor} | stable: ${stableOk} | moved ${dist.toFixed(2)}m: ${moveOk}`);
  if (!stableOk || !moveOk) fails++;
}
console.log("FAILS:", fails);
console.log("ERRORS", JSON.stringify(errors));
await browser.close();
