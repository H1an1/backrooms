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
await page.goto("http://127.0.0.1:4790/?qa=1");
await page.waitForTimeout(2500);
await page.evaluate(() => {
  window.__qa.give("the summer house by the lake where grandma kept bees");
  window.__qa.give("my first apartment, the radiator that sang at night");
  window.__qa.give("the day we drove to the coast and the car smelled of oranges");
});
await page.waitForTimeout(500);
// memory room
const tile = await page.evaluate(() => window.__qa.findMemoryTile());
console.log("memory tile:", JSON.stringify(tile));
if (tile) {
  await page.evaluate((t) => {
    window.__qa.teleport(t.x - 5, t.z);
    window.__qa.look(Math.PI / 2, 0);  // face +x? forward = (-sin,-cos): yaw=PI/2 -> (-1,0) hmm
  }, tile);
  await page.waitForTimeout(1200);
  await page.evaluate((t) => { window.__qa.look(-Math.PI / 2, 0); }, tile); // face +x
  await page.waitForTimeout(800);
  await page.screenshot({ path: OUT + "08-memory-room.png" });
}
// wall scrawl
const frames = await page.evaluate(() => window.__qa.frames());
console.log("frames loaded:", frames.length);
const scrawl = frames.find(f => f.whisperOnly);
if (scrawl) {
  await page.evaluate((f) => {
    window.__qa.teleport(f.x + 0.1, f.z + 3.2);
    window.__qa.look(Math.PI, 0); // face -z
  }, scrawl);
  await page.waitForTimeout(900);
  await page.screenshot({ path: OUT + "09-wall-scrawl.png" });
}
console.log("ERRORS", JSON.stringify(errors));
await browser.close();
