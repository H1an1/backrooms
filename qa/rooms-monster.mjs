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

// --- copied rooms: find every type within range, enter one of each
const rooms = await page.evaluate(() => window.__qa.findRooms(50));
const byType = {};
for (const r of rooms) if (!byType[r.type]) byType[r.type] = r;
console.log("room types found:", Object.keys(byType).join(", "), "| total:", rooms.length);
let i = 0;
for (const [type, r] of Object.entries(byType)) {
  await page.evaluate((r) => { window.__qa.teleport(r.x, r.z); window.__qa.look(Math.PI * 0.25, 0); }, r);
  await page.waitForTimeout(1400);
  await page.screenshot({ path: OUT + `10-room-${type}.png` });
  i++;
}

// --- lifeform: spawn ahead, watch it approach
await page.evaluate(() => { window.__qa.teleport(10, 10); window.__qa.look(0.6, 0.05); });
await page.waitForTimeout(1200);
await page.evaluate(() => window.__qa.spawnLifeform(9));
await page.waitForTimeout(600);
await page.screenshot({ path: OUT + "11-lifeform.png" });
const d1 = await page.evaluate(() => window.__qa.lifeform());
await page.waitForTimeout(1200);
const d2 = await page.evaluate(() => window.__qa.lifeform());
console.log("lifeform dist:", d1.dist.toFixed(2), "->", d2.dist.toFixed(2), "(should shrink)");

// --- catch: let it reach us
await page.waitForTimeout(4000);
const st = await page.evaluate(() => window.__qa.state());
const lf = await page.evaluate(() => window.__qa.lifeform());
console.log("after catch: floor =", st.floor, "(expect 1), lifeform active =", lf.active);
const corrupted = await page.evaluate(() => JSON.parse(localStorage.getItem("the-backrooms-v1-qa") || "{}"));
console.log("taken:", corrupted.taken, "| corrupted memories:", (corrupted.memories || []).filter(m => m.corrupted).length, "of", (corrupted.memories || []).length);
await page.screenshot({ path: OUT + "12-after-catch.png" });
console.log("ERRORS", JSON.stringify(errors));
await browser.close();
