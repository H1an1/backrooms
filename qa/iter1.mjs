import { createRequire } from "node:module";
// Playwright deps: `npm i playwright` in the repo root, or point QA_DEPS at a node_modules dir.
import { fileURLToPath } from "node:url";
const require = createRequire(process.env.QA_DEPS || fileURLToPath(new URL("../node_modules/", import.meta.url)));
const { chromium } = require("playwright");

const ROOT = new URL("..", import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const notes = [];

const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

await page.goto("http://127.0.0.1:4790/?qa=1");
await sleep(2500);

const qa = async (expr) => page.evaluate(expr);
const shot = async (name) => page.screenshot({ path: `${ROOT}/qa/${name}` });

// ---------- 1. PITS ----------
let pits = await qa(`window.__qa.findRegion('pits')`);
if (!pits) {
  notes.push("pits not found on floor 0; trying setFloor(3)");
  await qa(`window.__qa.setFloor(3)`);
  await sleep(2800);
  pits = await qa(`window.__qa.findRegion('pits')`);
}
if (pits) {
  notes.push(`pits region at ${JSON.stringify(pits)} on floor ${(await qa(`window.__qa.state()`)).floor}`);
  // edge view
  await qa(`window.__qa.teleport(${pits.x - 20}, ${pits.z})`);
  await sleep(1200);
  const st = await qa(`window.__qa.state()`);
  const yaw = Math.atan2(-(pits.x - st.x), -(pits.z - st.z));
  await qa(`window.__qa.look(${yaw}, -0.25)`);
  await sleep(300);
  await shot("iter1-pits-edge.png");
  // inside, on bridge
  await qa(`window.__qa.teleport(${pits.x + 2}, ${pits.z + 2})`);
  await sleep(1200);
  const before = await qa(`window.__qa.state()`);
  await qa(`window.__qa.look(${yaw}, -0.5)`);
  await sleep(300);
  await shot("iter1-pits-inside.png");
  await sleep(2000);
  const after = await qa(`window.__qa.state()`);
  notes.push(`pits stand test: floor before=${before.floor} y=${before.y.toFixed(2)} | after 2s floor=${after.floor} y=${after.y.toFixed(2)}`);
} else {
  notes.push("FAIL: pits region not found on floor 0 or 3");
}

// ---------- 2. STAIRS ----------
// go back to floor 0 if needed
let st0 = await qa(`window.__qa.state()`);
if (st0.floor !== 0) {
  await qa(`window.__qa.setFloor(0)`);
  await sleep(2800);
}
const stairs = await qa(`window.__qa.findStairs()`);
if (stairs) {
  notes.push(`stairs at ${JSON.stringify(stairs)}`);
  await qa(`window.__qa.teleport(${stairs.x}, ${stairs.z + 4})`);
  await sleep(1200);
  const p = await qa(`window.__qa.state()`);
  const yaw = Math.atan2(-(stairs.x - p.x), -(stairs.z - p.z));
  await qa(`window.__qa.look(${yaw}, -0.1)`);
  await sleep(300);
  await shot("iter1-stairs-approach.png");
  const fBefore = (await qa(`window.__qa.state()`)).floor;
  await qa(`window.__qa.teleport(${stairs.x}, ${stairs.z})`);
  let fAfter = fBefore;
  for (let i = 0; i < 10; i++) {
    await sleep(350);
    fAfter = (await qa(`window.__qa.state()`)).floor;
    if (fAfter !== fBefore) break;
  }
  notes.push(`stairs teleport: floor ${fBefore} -> ${fAfter} ${fAfter === fBefore + 1 ? "(INCREMENTED OK)" : "(NO INCREMENT)"}`);
  await sleep(2800); // let transition finish
  await shot("iter1-stairs-after.png");
} else {
  notes.push("FAIL: findStairs() returned null on floor 0");
}

// ---------- 3. GREEN ZONE ----------
let s = await qa(`window.__qa.state()`);
if (s.floor !== 0) {
  await qa(`window.__qa.setFloor(0)`);
  await sleep(2800);
}
const green = await qa(`window.__qa.findGreenZone()`);
if (green) {
  notes.push(`green zone at ${JSON.stringify(green)}`);
  await qa(`window.__qa.teleport(${green.x}, ${green.z})`);
  await sleep(1200);
  await qa(`window.__qa.look(0.8, -0.05)`);
  await sleep(300);
  await shot("iter1-green.png");
} else {
  notes.push("FAIL: findGreenZone() returned null");
}

// ---------- 4. BLACKOUT DECAY ----------
const blackout = await qa(`window.__qa.findBlackout()`);
if (blackout) {
  notes.push(`blackout at ${JSON.stringify(blackout)}`);
  await qa(`window.__qa.teleport(${blackout.x}, ${blackout.z})`);
  await sleep(1200);
  await qa(`window.__qa.look(2.2, -0.1)`);
  await sleep(300);
  await shot("iter1-blackout.png");
  await qa(`window.__qa.look(4.5, -0.1)`);
  await sleep(300);
  await shot("iter1-blackout-2.png");
} else {
  notes.push("FAIL: findBlackout() returned null");
}

// ---------- 5. EXIT DOOR ----------
const exit = await qa(`window.__qa.exit()`);
if (exit) {
  notes.push(`exit at ${JSON.stringify(exit)}`);
  await qa(`window.__qa.teleport(${exit.x}, ${exit.z + 7})`);
  await sleep(1200);
  await qa(`window.__qa.look(0, 0)`);
  await sleep(300);
  await shot("iter1-exit.png");
} else {
  notes.push("FAIL: exit() returned null");
}

await browser.close();
console.log("NOTES:");
for (const n of notes) console.log("  - " + n);
console.log("ERRORS", JSON.stringify(errors, null, 1));
