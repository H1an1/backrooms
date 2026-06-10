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

// square-ish hole
const hole = await page.evaluate(() => window.__qa.findHole());
if (hole) {
  await page.evaluate((h) => { window.__qa.teleport(h.x, h.z + 3.4); window.__qa.look(0, -0.6); }, hole);
  await page.waitForTimeout(900);
  await page.screenshot({ path: OUT + "18-hole-square.png" });
}

// garage (level 1)
await page.evaluate(() => window.__qa.setFloor(1));
await page.waitForTimeout(2800);
await page.evaluate(() => { window.__qa.forward(10); window.__qa.look(0.7, 0.02); });
await page.waitForTimeout(900);
await page.screenshot({ path: OUT + "19-garage.png" });

// tunnels (level 2)
await page.evaluate(() => window.__qa.setFloor(2));
await page.waitForTimeout(2800);
await page.evaluate(() => window.__qa.look(2.1, 0.02));
await page.waitForTimeout(900);
await page.screenshot({ path: OUT + "20-tunnels.png" });

// the pools (level 37)
await page.evaluate(() => window.__qa.pools());
await page.waitForTimeout(2800);
await page.evaluate(() => window.__qa.look(0.8, 0.02));
await page.waitForTimeout(900);
await page.screenshot({ path: OUT + "21-pools.png" });
const st = await page.evaluate(() => window.__qa.state());
console.log("STATE", JSON.stringify(st));
console.log("ERRORS", JSON.stringify(errors));
await browser.close();
