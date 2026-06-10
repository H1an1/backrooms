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
await page.evaluate(() => { localStorage.removeItem("the-backrooms-v1-qa"); });

const shot = (n) => page.screenshot({ path: OUT + n + ".png" });

await page.evaluate(() => window.__qa.look(0.6, 0.02));
await page.waitForTimeout(800);
await shot("01-level0-base");

// walk forward a bit
await page.evaluate(() => window.__qa.forward(14));
await page.waitForTimeout(700);
await shot("02-level0-walk");

// give memories, jump ahead so memory rooms can manifest
await page.evaluate(() => {
  window.__qa.give("the summer house by the lake where grandma kept bees");
  window.__qa.give("my first apartment, the radiator that sang at night");
  window.__qa.give("the day we drove to the coast and the car smelled of oranges");
});
await page.waitForTimeout(400);
await page.evaluate(() => window.__qa.teleport(260, 180));
await page.waitForTimeout(900);
await shot("03-after-memories");

// hunt for a memory room: scan tiles via state — just take a few hops and shoot
for (let i = 0; i < 3; i++) {
  await page.evaluate((d) => window.__qa.teleport(260 + d * 90, 180 + d * 60), i + 1);
  await page.waitForTimeout(700);
  await shot("04-hop-" + i);
}

// deeper floors
await page.evaluate(() => window.__qa.setFloor(1));
await page.waitForTimeout(2600);
await shot("05-level1");
await page.evaluate(() => window.__qa.setFloor(2));
await page.waitForTimeout(2600);
await shot("06-level2");
await page.evaluate(() => window.__qa.setFloor(4));
await page.waitForTimeout(2600);
await shot("07-level4");

const st = await page.evaluate(() => window.__qa.state());
console.log("STATE", JSON.stringify(st));
console.log("ERRORS", JSON.stringify(errors, null, 2));
await browser.close();
