import { createRequire } from "node:module";
// Deps: `npm i playwright sharp` in the repo root, or point QA_DEPS at a node_modules dir.
import { fileURLToPath } from "node:url";
const require = createRequire(process.env.QA_DEPS || fileURLToPath(new URL("../node_modules/", import.meta.url)));
const { chromium } = require("playwright");
const sharp = require("sharp");

const ROOT = new URL("..", import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const notes = [];

// ---- color stats of existing shots: green zone vs baseline ----
async function avgRGB(file, region) {
  const img = sharp(`${ROOT}/qa/${file}`).extract(region);
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  let r = 0, g = 0, b = 0, n = data.length / info.channels;
  for (let i = 0; i < data.length; i += info.channels) { r += data[i]; g += data[i + 1]; b += data[i + 2]; }
  return [r / n, g / n, b / n].map((v) => v.toFixed(1));
}
// middle band of each (avoid HUD top/bottom)
const band = { left: 200, top: 200, width: 880, height: 320 };
notes.push(`baseline avg RGB: ${await avgRGB("iter1-baseline.png", band)}`);
notes.push(`green zone avg RGB: ${await avgRGB("iter1-green.png", band)}`);
notes.push(`blackout avg RGB: ${await avgRGB("iter1-blackout-dir0.png", band)}`);

const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

await page.goto("http://127.0.0.1:4790/?qa=1");
await sleep(2500);
const qa = async (expr) => page.evaluate(expr);
const shot = async (name) => page.screenshot({ path: `${ROOT}/qa/${name}` });

// ---- green zone: look up at light panels ----
const green = await qa(`window.__qa.findGreenZone()`);
if (green) {
  await qa(`window.__qa.teleport(${green.x}, ${green.z})`);
  await sleep(1200);
  await qa(`window.__qa.look(0.4, 0.9)`);
  await sleep(300);
  await shot("iter1-green-ceiling.png");
}

// ---- debris hunt: sweep blackout region with low gaze ----
const blk = await qa(`window.__qa.findBlackout()`);
if (blk) {
  const spots = [[0, 0], [12, 0], [-12, 8], [8, -14], [-10, -10], [14, 14]];
  let k = 0;
  for (const [ox, oz] of spots) {
    await qa(`window.__qa.teleport(${blk.x + ox}, ${blk.z + oz})`);
    await sleep(1100);
    for (const yaw of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
      await qa(`window.__qa.look(${yaw}, -0.35)`);
      await sleep(220);
      await shot(`iter1-debris-${k++}.png`);
    }
    if (k >= 24) break;
  }
}

// ---- exit door close-up ----
const exit = await qa(`window.__qa.exit()`);
if (exit) {
  await qa(`window.__qa.teleport(${exit.x}, ${exit.z + 3.2})`);
  await sleep(1200);
  await qa(`window.__qa.look(0, 0.05)`);
  await sleep(300);
  await shot("iter1-exit-close.png");
}

await browser.close();
console.log("NOTES:");
for (const n of notes) console.log("  - " + n);
console.log("ERRORS", JSON.stringify(errors, null, 1));
