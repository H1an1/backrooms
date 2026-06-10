import { createRequire } from "node:module";
// Playwright deps: `npm i playwright` in the repo root, or point QA_DEPS at a node_modules dir.
import { fileURLToPath } from "node:url";
const require = createRequire(process.env.QA_DEPS || fileURLToPath(new URL("../node_modules/", import.meta.url)));
const { chromium } = require("playwright");
const OUT = new URL(".", import.meta.url).pathname;
const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto("http://127.0.0.1:4790/?qa=1");
await page.waitForTimeout(2500);

await page.evaluate(() => window.__qa.look(0.8, 0.02));
await page.waitForTimeout(600);
await page.screenshot({ path: OUT + "13-spawn.png" });

// a long wall hall ("halls" region)
await page.evaluate(() => { window.__qa.teleport(150, 90); window.__qa.look(2.2, 0.02); });
await page.waitForTimeout(1200);
await page.screenshot({ path: OUT + "14-halls.png" });

// hole closeup
const hole = await page.evaluate(() => window.__qa.findHole());
console.log("hole:", JSON.stringify(hole));
if (hole) {
  await page.evaluate((h) => {
    window.__qa.teleport(h.x - 3.5, h.z - 3.5);
    window.__qa.look(Math.atan2(3.5, 3.5) + Math.PI, -0.55);
  }, hole);
  await page.waitForTimeout(900);
  await page.screenshot({ path: OUT + "15-hole.png" });
}

// mound + chair
const mound = await page.evaluate(() => window.__qa.findMound());
console.log("mound:", JSON.stringify(mound));
if (mound) {
  await page.evaluate((m) => {
    window.__qa.teleport(m.x - 5, m.z);
    window.__qa.look(Math.PI / 2, -0.08);
  }, mound);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: OUT + "16-mound.png" });
}

// the map
await page.evaluate(() => { window.__qa.explore(40); window.__qa.map(true); });
await page.waitForTimeout(900);
await page.screenshot({ path: OUT + "17-map.png" });
await page.evaluate(() => window.__qa.map(false));

const st = await page.evaluate(() => window.__qa.state());
console.log("STATE", JSON.stringify(st));
console.log("ERRORS", JSON.stringify(errors));
await browser.close();
