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

// find an item and pick it up
const item = await page.evaluate(() => window.__qa.findItem());
console.log("item:", JSON.stringify(item));
if (item) {
  await page.evaluate((i) => { window.__qa.teleport(i.x - 2, i.z); window.__qa.look(-Math.PI / 2, -0.3); }, item);
  await page.waitForTimeout(800);
  await page.screenshot({ path: OUT + "24-find.png" });
  await page.evaluate((i) => window.__qa.teleport(i.x, i.z), item);
  await page.waitForTimeout(800);
  console.log("after pickup:", JSON.stringify(await page.evaluate(() => window.__qa.finds())));
}

// the a-sync site
const site = await page.evaluate(() => window.__qa.site());
console.log("site:", JSON.stringify(site));
await page.evaluate((s) => { window.__qa.teleport(s.x, s.z + 9); window.__qa.look(0, 0.0); }, site);
await page.waitForTimeout(1500);
await page.screenshot({ path: OUT + "25-site.png" });
await page.evaluate(() => { window.__qa.explore(20); window.__qa.map(true); });
await page.waitForTimeout(800);
await page.screenshot({ path: OUT + "26-map-site.png" });
await page.evaluate(() => window.__qa.map(false));

// garage: tall and open
await page.evaluate(() => window.__qa.setFloor(1));
await page.waitForTimeout(2800);
await page.evaluate(() => { window.__qa.forward(8); window.__qa.look(0.7, 0.06); });
await page.waitForTimeout(900);
await page.screenshot({ path: OUT + "27-garage-tall.png" });

// tunnels: low and tight
await page.evaluate(() => window.__qa.setFloor(2));
await page.waitForTimeout(2800);
await page.evaluate(() => window.__qa.look(2.1, 0.0));
await page.waitForTimeout(900);
await page.screenshot({ path: OUT + "28-tunnels-low.png" });

const st = await page.evaluate(() => window.__qa.state());
console.log("STATE", JSON.stringify(st));
console.log("ERRORS", JSON.stringify(errors));
await browser.close();
