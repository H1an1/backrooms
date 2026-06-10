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

// ---------- baseline corridor (for green-zone color comparison) ----------
await qa(`window.__qa.teleport(40, 40)`);
await sleep(1200);
await qa(`window.__qa.look(0.8, -0.05)`);
await sleep(300);
await shot("iter1-baseline.png");

// ---------- 1. PITS (corrected: stand on carpet strip / bridge lane) ----------
const pits = await qa(`window.__qa.findRegion('pits')`);
if (pits) {
  // stand exactly on the strip intersection (returned center), look down
  await qa(`window.__qa.teleport(${pits.x}, ${pits.z})`);
  await sleep(1200);
  let before = await qa(`window.__qa.state()`);
  await qa(`window.__qa.look(0.7, -0.5)`);
  await sleep(300);
  await shot("iter1-pits-stand.png");
  await sleep(2000);
  let after = await qa(`window.__qa.state()`);
  notes.push(`pits strip stand: floor ${before.floor}->${after.floor}, y ${before.y.toFixed(2)}->${after.y.toFixed(2)} ${after.floor === before.floor ? "(NO FALL — OK)" : "(FELL)"}`);
  // bridge lane: cell cx multiple of 16 → x = cx*4..cx*4+4; pick lane west of center
  const laneCellX = Math.round((pits.x - 30) / 64) * 16; // nearest bridge column
  const laneX = laneCellX * 4 + 2;
  await qa(`window.__qa.teleport(${laneX}, ${pits.z})`);
  await sleep(1200);
  await qa(`window.__qa.look(${Math.PI}, -0.3)`); // look along +z down the lane? forward=(-sin,-cos): yaw=PI → (0,1) → +z
  await sleep(300);
  await shot("iter1-pits-bridge.png");
  const st2 = await qa(`window.__qa.state()`);
  notes.push(`bridge lane at x=${laneX}: floor=${st2.floor} y=${st2.y.toFixed(2)}`);
} else notes.push("FAIL: pits not found");

// ---------- 2. BLACKOUT, 4 directions ----------
if ((await qa(`window.__qa.state()`)).floor !== 0) { await qa(`window.__qa.setFloor(0)`); await sleep(2800); }
const blk = await qa(`window.__qa.findBlackout()`);
if (blk) {
  await qa(`window.__qa.teleport(${blk.x}, ${blk.z})`);
  await sleep(1200);
  for (let i = 0; i < 4; i++) {
    await qa(`window.__qa.look(${i * Math.PI / 2}, -0.05)`);
    await sleep(250);
    await shot(`iter1-blackout-dir${i}.png`);
  }
} else notes.push("FAIL: blackout not found");

// ---------- 3. STAIRS: orbit shots + trigger via offsets ----------
const stairs = await qa(`window.__qa.findStairs()`);
if (stairs) {
  notes.push(`stairs at ${JSON.stringify(stairs)}`);
  // 4 views from 5m in each cardinal direction, facing the stairwell
  const dirs = [[0, 5], [5, 0], [0, -5], [-5, 0]];
  for (let i = 0; i < 4; i++) {
    const [dx, dz] = dirs[i];
    await qa(`window.__qa.teleport(${stairs.x + dx}, ${stairs.z + dz})`);
    await sleep(1000);
    const yaw = Math.atan2(-(-dx), -(-dz));
    await qa(`window.__qa.look(${yaw}, -0.05)`);
    await sleep(250);
    await shot(`iter1-stairs-v${i}.png`);
  }
  // trigger: try the 4 candidate trigger offsets (0.9m from center)
  const offs = [[0, 0.9], [0.9, 0], [0, -0.9], [-0.9, 0]];
  let triggered = false;
  const f0 = (await qa(`window.__qa.state()`)).floor;
  for (const [ox, oz] of offs) {
    await qa(`window.__qa.teleport(${stairs.x + ox}, ${stairs.z + oz})`);
    let f1 = f0;
    for (let i = 0; i < 9; i++) {
      await sleep(330);
      f1 = (await qa(`window.__qa.state()`)).floor;
      if (f1 !== f0) break;
    }
    if (f1 === f0 + 1) {
      notes.push(`stairs trigger at offset (${ox},${oz}): floor ${f0} -> ${f1} (INCREMENTED OK)`);
      triggered = true;
      await sleep(2800);
      await shot("iter1-stairs-landed.png");
      break;
    }
  }
  if (!triggered) notes.push(`FAIL: stairs never triggered from any offset (floor stayed ${f0})`);
} else notes.push("FAIL: stairs not found");

await browser.close();
console.log("NOTES:");
for (const n of notes) console.log("  - " + n);
console.log("ERRORS", JSON.stringify(errors, null, 1));
