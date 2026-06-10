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
await page.evaluate(() => localStorage.removeItem("the-backrooms-v1-qa"));

// door 1: level 0
let exit = await page.evaluate(() => window.__qa.exit());
console.log("exit L0:", JSON.stringify(exit));
await page.evaluate((e) => { window.__qa.teleport(e.x, e.z + 7); window.__qa.look(0, 0.02); }, exit);
await page.waitForTimeout(1500);
await page.screenshot({ path: OUT + "29-green-door.png" });
const guard = await page.evaluate(() => window.__qa.lifeform());
console.log("guard spawned:", guard.active);
await page.evaluate((e) => window.__qa.teleport(e.x, e.z), exit);
await page.waitForTimeout(2600);
let st = await page.evaluate(() => window.__qa.state());
console.log("after door 1: floor =", st.floor, "(expect 1)");

// door 2: level 1
exit = await page.evaluate(() => window.__qa.exit());
await page.evaluate((e) => window.__qa.teleport(e.x, e.z), exit);
await page.waitForTimeout(2600);
st = await page.evaluate(() => window.__qa.state());
console.log("after door 2: floor =", st.floor, "(expect 2)");

// door 3: level 2 -> escape
exit = await page.evaluate(() => window.__qa.exit());
await page.evaluate((e) => { window.__qa.teleport(e.x, e.z + 6); window.__qa.look(0, 0.02); }, exit);
await page.waitForTimeout(1200);
await page.screenshot({ path: OUT + "30-final-door.png" });
await page.evaluate((e) => window.__qa.teleport(e.x, e.z), exit);
await page.waitForTimeout(1500);
console.log("ending open:", await page.evaluate(() => window.__qa.endingOpen()),
  "escapes:", await page.evaluate(() => window.__qa.escapes()));
await page.screenshot({ path: OUT + "31-ending.png" });

// go back in
await page.evaluate(() => window.__qa.goBackIn());
await page.waitForTimeout(2600);
st = await page.evaluate(() => window.__qa.state());
console.log("back in: floor =", st.floor, "(expect 0)");
console.log("ERRORS", JSON.stringify(errors));
await browser.close();
