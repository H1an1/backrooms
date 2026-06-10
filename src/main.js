import * as THREE from 'three';

/* ============================================================
   THE BACKROOMS — an absorbing, growing, walkable Level 0+
   - infinite procedural floors, holes that drop you deeper
   - it absorbs your memories and rebuilds them, badly
   ============================================================ */

const QA = new URLSearchParams(location.search).has('qa');

const CELL = 4;          // meters per grid cell
let H = 3.0;             // ceiling height — per floor: the garage soars, the pit stops crush
const CHUNK = 8;         // cells per chunk side
const RADIUS = 2;        // chunk load radius
const SPAWN_CX = 8, SPAWN_CZ = 8;
const SAVE_KEY = new URLSearchParams(location.search).has('qa')
  ? 'the-backrooms-v1-qa'   // QA sessions persist to their own slot, never the player's
  : 'the-backrooms-v1';

/* ---------------- deterministic hashing ---------------- */
function hash(...n) {
  let h = 2166136261 >>> 0;
  for (const v of n) {
    let x = (v | 0) + 0x9e3779b9;
    x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
    x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
    x ^= x >>> 16;
    h = (h ^ x) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
const rand = (...n) => hash(...n) / 4294967296;
const mod = (a, b) => ((a % b) + b) % b;

/* ---------------- persistent state ---------------- */
const state = {
  floor: 0,
  special: null,
  memories: [],          // {id, text, t, floor}
  meters: 0,
  stills: 0,
  taken: 0,
  foundKeys: new Set(),  // discoverables already picked up
  findCount: 0,
  foundSpots: {},        // floorKey -> [[cx,cz],...] for the map
  sanity: 100,
  kline: 0,              // "THE WINDOW WITHIN" tapes collected (3 completes the set)
};
function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      memories: state.memories, meters: Math.round(state.meters), stills: state.stills, taken: state.taken || 0,
      explored: Object.fromEntries(
        Object.entries(state.explored || {}).map(([f, s]) => [f, [...s].slice(-30000)])),
      foundKeys: [...state.foundKeys].slice(-2000),
      findCount: state.findCount,
      foundSpots: state.foundSpots,
      escapes: state.escapes || 0,
      sanity: Math.round(state.sanity),
      kline: state.kline || 0,
    }));
  } catch (e) { /* private mode */ }
}
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (d) {
      state.memories = d.memories || [];
      state.meters = d.meters || 0;
      state.stills = d.stills || 0;
      state.taken = d.taken || 0;
      state.explored = {};
      for (const [f, arr] of Object.entries(d.explored || {})) state.explored[f] = new Set(arr);
      state.foundKeys = new Set(d.foundKeys || []);
      state.findCount = d.findCount || 0;
      state.foundSpots = d.foundSpots || {};
      state.escapes = d.escapes || 0;
      state.sanity = d.sanity ?? 100;
      state.kline = d.kline || 0;
    }
  } catch (e) { /* ignore */ }
}
load();

/* ---------------- palettes per floor ---------------- */
function paletteFor(f, special) {
  if (special === 'pools') return {
    name: 'SUBLIMITY', code: '37', style: 'pools',
    wallBase: '#e9ede8', wallPat: '#c9d4ce', wallDark: '#aebbb4',
    carpet: '#a8d4c2', carpetDark: '#86b8a4',
    ceil: '#edf0ea', ceilLine: '#cdd6cf',
    panel: '#ffffff', panelEdge: '#b9c4bd',
    fog: 0xc2d8cc, fogNear: 16, fogFar: 60,
    hemiSky: 0xffffff, hemiGround: 0x9cc2b2, hemiI: 1.15,
    amb: 0xb8ccc2, ambI: 0.8,
    lightDensity: 0.4, flicker: 0, holes: 0.008, ceilH: 3.4,
  };
  if (f === 0) return {
    name: 'THE LOBBY', style: 'lobby',
    wallBase: '#d4bc66', wallPat: '#bba24c', wallDark: '#826c34',
    carpet: '#bba153', carpetDark: '#94803f',
    ceil: '#e5dcc0', ceilLine: '#bdb396',
    panel: '#fff8dd', panelEdge: '#7a745e',
    fog: 0xcdb56a, fogNear: 13, fogFar: 60,
    hemiSky: 0xfff3cf, hemiGround: 0xa89455, hemiI: 1.4,
    amb: 0x968756, ambI: 0.85,
    lightDensity: 0.95, flicker: 0.05, holes: 0.0022, ceilH: 3.0,
  };
  if (f === 1) return {
    name: 'HABITABLE ZONE', style: 'garage',   // the parking garage
    wallBase: '#aaa297', wallPat: '#948c80', wallDark: '#6a655c',
    carpet: '#6e6a63', carpetDark: '#54514b',
    ceil: '#8e887e', ceilLine: '#6e6960',
    panel: '#eef4ff', panelEdge: '#3e4146',
    fog: 0x6e6b62, fogNear: 8, fogFar: 44,
    hemiSky: 0xe6ecf0, hemiGround: 0x6e6a5e, hemiI: 1.15,
    amb: 0x6e6b60, ambI: 0.85,
    lightDensity: 0.5, flicker: 0.14, holes: 0.004, ceilH: 3.8,
  };
  if (f === 2) return {
    name: 'THE PIT STOPS', style: 'tunnels',   // hot pipe warrens
    wallBase: '#6e5e4a', wallPat: '#5a4c3a', wallDark: '#3c321f',
    carpet: '#54483a', carpetDark: '#3e342a',
    ceil: '#5e5142', ceilLine: '#46392c',
    panel: '#ffd9a8', panelEdge: '#3a3026',
    fog: 0x4d4234, fogNear: 6, fogFar: 30,
    hemiSky: 0xdcc398, hemiGround: 0x645541, hemiI: 1.1,
    amb: 0x645640, ambI: 0.85,
    lightDensity: 0.45, flicker: 0.24, holes: 0.005, ceilH: 2.35,
  };
  const d = Math.min(f, 6);
  return {
    name: 'DEEP SECTION −' + f, style: 'deep',
    wallBase: '#5e4036', wallPat: '#4c322a', wallDark: '#2c1c16',
    carpet: '#4a342c', carpetDark: '#352420',
    ceil: '#4e3c34', ceilLine: '#3a2c26',
    panel: '#ffb09a', panelEdge: '#3a2520',
    fog: 0x1d0f0c, fogNear: 3, fogFar: Math.max(14, 26 - d * 2),
    hemiSky: 0xc98f78, hemiGround: 0x402822, hemiI: 0.55,
    amb: 0x3a2620, ambI: 0.5,
    lightDensity: 0.32, flicker: 0.3, holes: 0.008, ceilH: 2.7,
  };
}

/* ---------------- procedural textures ---------------- */
function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 8;
  return t;
}

function makeTextures(P) {
  const grime = (g, w, h, n = 0, a = 0.05) => {
    const count = n || Math.floor(w * h / 160);
    for (let i = 0; i < count; i++) {
      g.fillStyle = Math.random() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,230,${a * 0.8})`;
      g.fillRect(Math.random() * w, Math.random() * h, 1.6, 1.6);
    }
  };
  const baseboard = (g, w, h) => {
    const grd = g.createLinearGradient(0, h * 0.62, 0, h);
    grd.addColorStop(0, 'rgba(40,28,8,0)');
    grd.addColorStop(1, 'rgba(40,28,8,0.16)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    const bb = Math.round(h * 0.051);
    g.fillStyle = P.wallDark; g.fillRect(0, h - bb, w, bb);
    g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(0, h - bb, w, Math.max(2, bb * 0.12));
  };
  // wallpaper relief: every motif gets a shadow pass below-right and a highlight pass
  // above-left, so the pattern reads as embossed paper instead of flat ink
  const paperStrips = (g, w, h) => {       // hung paper: strip seams with per-strip tone jitter
    for (let x = 0, i = 0; x < w; x += 96, i++) {
      const j = (Math.sin(i * 12.9898) * 43758.5453) % 1;
      g.fillStyle = `rgba(${j > 0 ? '255,250,220' : '0,0,0'},${0.018 + Math.abs(j) * 0.02})`;
      g.fillRect(x, 0, 96, h);
      g.fillStyle = 'rgba(0,0,0,0.06)'; g.fillRect(x, 0, 1.5, h);          // seam line
      g.fillStyle = 'rgba(255,252,230,0.05)'; g.fillRect(x + 1.5, 0, 1.5, h);
    }
  };
  const mottle = (g, w, h, n = 12, a = 0.05) => {   // low-frequency tonal clouds — kills the "flat fill" look
    for (let i = 0; i < n; i++) {
      const x = Math.random() * w, y = Math.random() * h, r = 90 + Math.random() * 220;
      const grd = g.createRadialGradient(x, y, r * 0.15, x, y, r);
      const dark = Math.random() < 0.55;
      grd.addColorStop(0, dark ? `rgba(40,28,8,${a})` : `rgba(255,250,225,${a * 0.9})`);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
  };
  const drawOgee = (g, w, h) => {
    g.fillStyle = P.wallBase; g.fillRect(0, 0, w, h);
    paperStrips(g, w, h);
    const sx = 44, sy = 37;
    const motif = (dx, dy, style, alpha, lw) => {
      g.strokeStyle = style; g.lineWidth = lw; g.globalAlpha = alpha;
      for (let row = 0; row * sy < h + sy; row++) {
        const off = (row % 2) ? sx / 2 : 0;
        for (let i = -1; i * sx < w + sx; i++) {
          const cx = i * sx + off + dx, cy = row * sy + dy;
          g.beginPath();
          g.moveTo(cx, cy - 9);
          g.quadraticCurveTo(cx + 11, cy, cx, cy + 9);
          g.quadraticCurveTo(cx - 11, cy, cx, cy - 9);
          g.stroke();
        }
      }
    };
    motif(1.4, 1.8, 'rgba(30,20,4,0.5)', 0.55, 2.5);          // embossed shadow
    motif(-1.1, -1.4, 'rgba(255,250,225,0.5)', 0.5, 2.2);     // embossed highlight
    motif(0, 0, P.wallPat, 0.85, 2.5);                        // the ink itself
    g.fillStyle = P.wallPat;
    for (let row = 0; row * sy < h + sy; row++) {             // flock dots, with their own shadow
      const off = (row % 2) ? sx / 2 : 0;
      for (let i = -1; i * sx < w + sx; i++) {
        const cx = i * sx + off, cy = row * sy;
        g.globalAlpha = 0.18; g.fillStyle = 'rgba(30,20,4,1)';
        g.beginPath(); g.arc(cx + 1, cy + 1.2, 2.3, 0, 7); g.fill();
        g.globalAlpha = 0.3; g.fillStyle = P.wallPat;
        g.beginPath(); g.arc(cx, cy, 2.2, 0, 7); g.fill();
      }
    }
    g.globalAlpha = 1;
    mottle(g, w, h);
    grime(g, w, h);
    baseboard(g, w, h);
  };
  const drawChevron = (g, w, h) => {   // the arrow-pattern wallpaper from the film stills
    g.fillStyle = P.wallBase; g.fillRect(0, 0, w, h);
    paperStrips(g, w, h);
    const pass = (dx, dy, style, alpha, lw) => {
      g.strokeStyle = style; g.lineWidth = lw; g.globalAlpha = alpha;
      for (let col = 0; col * 38 < w + 38; col++) {
        const cx = col * 38 + 8 + dx;
        for (let row = 0; row * 30 < h + 30; row++) {
          const cy = row * 30 + ((col % 2) ? 15 : 0) + dy;
          g.beginPath();
          g.moveTo(cx - 7, cy + 6);
          g.lineTo(cx, cy - 5);
          g.lineTo(cx + 7, cy + 6);
          g.stroke();
          g.beginPath();
          g.moveTo(cx - 4, cy + 9);
          g.lineTo(cx, cy + 2);
          g.lineTo(cx + 4, cy + 9);
          g.stroke();
        }
      }
    };
    pass(1.2, 1.5, 'rgba(30,20,4,0.5)', 0.5, 2.2);          // embossed shadow
    pass(-1, -1.2, 'rgba(255,250,225,0.5)', 0.45, 2);       // embossed highlight
    pass(0, 0, P.wallPat, 0.8, 2.2);
    g.globalAlpha = 1;
    mottle(g, w, h);
    grime(g, w, h);
    baseboard(g, w, h);
  };
  const drawConcrete = (g, w, h) => {
    g.fillStyle = P.wallBase; g.fillRect(0, 0, w, h);
    grime(g, w, h, Math.floor(w * h / 80), 0.05);
    g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 2;
    for (let y = 96; y < h; y += 128) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }  // formwork seams
    for (let i = 0; i < 9; i++) {       // water streaks
      const x = Math.random() * w;
      const grd = g.createLinearGradient(x, 0, x, h);
      grd.addColorStop(0, 'rgba(30,28,24,0.14)');
      grd.addColorStop(1, 'rgba(30,28,24,0)');
      g.fillStyle = grd;
      g.fillRect(x, 0, 3 + Math.random() * 8, h);
    }
    g.fillStyle = 'rgba(20,18,14,0.25)'; g.fillRect(0, h - 18, w, 18);
  };
  const drawTile = (g, w, h) => {
    g.fillStyle = P.wallBase; g.fillRect(0, 0, w, h);
    g.strokeStyle = P.ceilLine; g.lineWidth = 2;
    for (let y = 0; y <= h; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    for (let x = 0; x <= w; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    grime(g, w, h, Math.floor(w * h / 375), 0.03);
  };

  const wallDraw = P.style === 'garage' ? drawConcrete
    : P.style === 'tunnels' ? drawConcrete
    : P.style === 'pools' ? drawTile
    : drawOgee;
  const wall = canvasTex(1024, 1024, wallDraw);
  wall.wrapT = THREE.ClampToEdgeWrapping;
  const wall2 = canvasTex(1024, 1024, P.style === 'lobby' || P.style === 'deep' ? drawChevron : wallDraw);
  wall2.wrapT = THREE.ClampToEdgeWrapping;

  const floor = canvasTex(1024, 1024, (g, w, h) => {
    if (P.style === 'garage' || P.style === 'tunnels') {
      g.fillStyle = P.carpet; g.fillRect(0, 0, w, h);
      grime(g, w, h, 4000, 0.05);
      for (let i = 0; i < 10; i++) {   // oil stains and tire scuffs
        g.fillStyle = 'rgba(10,10,8,0.12)';
        g.beginPath();
        g.ellipse(Math.random() * w, Math.random() * h, 14 + Math.random() * 44, 10 + Math.random() * 28, Math.random() * 3, 0, 7);
        g.fill();
      }
      return;
    }
    if (P.style === 'pools') { drawTile(g, w, h); return; }
    g.fillStyle = P.carpet; g.fillRect(0, 0, w, h);
    mottle(g, w, h, 14, 0.045);   // low-frequency tonal clouds under the speckle
    // dense carpet speckle at two scales
    for (let i = 0; i < w * h / 29; i++) {
      const v = Math.random();
      g.fillStyle = v < 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(255,250,220,0.07)';
      g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
    }
    // carpet fiber strokes — short directional dashes
    g.strokeStyle = 'rgba(0,0,0,0.045)'; g.lineWidth = 1;
    for (let i = 0; i < w * h / 220; i++) {
      const x = Math.random() * w, y = Math.random() * h, a = Math.random() * Math.PI;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * 4, y + Math.sin(a) * 4);
      g.stroke();
    }
    // broad mottling for wear paths
    for (let i = 0; i < 20; i++) {
      g.fillStyle = `rgba(${Math.random() < 0.5 ? '30,20,5' : '255,245,210'},0.04)`;
      g.beginPath();
      g.ellipse(Math.random() * w, Math.random() * h, 40 + Math.random() * 130, 30 + Math.random() * 90, Math.random() * 3, 0, 7);
      g.fill();
    }
    for (let i = 0; i < 14; i++) {
      g.fillStyle = 'rgba(30,20,5,0.07)';
      g.beginPath();
      g.ellipse(Math.random() * w, Math.random() * h, 18 + Math.random() * 50, 14 + Math.random() * 36, Math.random() * 3, 0, 7);
      g.fill();
    }
  });

  // 2×2 acoustic tiles per texture (repeat 0.5 → texture spans 2m), each tile with its own
  // tone, fissured speckle, bevelled inner edge and the odd water stain — no two neighbours equal
  const ceil = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = P.ceil; g.fillRect(0, 0, w, h);
    if (P.style === 'garage' || P.style === 'tunnels') {   // raw slab, no grid
      grime(g, w, h, 7000, 0.05);
      return;
    }
    const q = w / 2;
    for (let tx = 0; tx < 2; tx++) for (let tz = 0; tz < 2; tz++) {
      const x0 = tx * q, y0 = tz * q;
      const jitter = ((tx * 3 + tz * 7) % 5 - 2) * 0.022;          // per-tile tone variation
      g.fillStyle = `rgba(${jitter > 0 ? '255,250,228' : '30,22,6'},${Math.abs(jitter)})`;
      g.fillRect(x0, y0, q, q);
      for (let i = 0; i < 900; i++) {                              // fissured mineral-fibre pocks
        const px = x0 + Math.random() * q, py = y0 + Math.random() * q;
        g.fillStyle = Math.random() < 0.6 ? 'rgba(85,70,40,0.10)' : 'rgba(255,252,235,0.08)';
        const len = Math.random() < 0.25 ? 3 + Math.random() * 4 : 1.4;
        g.fillRect(px, py, len, 1.4);
      }
      // bevelled tile edge: light catch on two sides, shadow on the others
      g.fillStyle = 'rgba(255,252,235,0.16)';
      g.fillRect(x0 + 3, y0 + 3, q - 6, 2); g.fillRect(x0 + 3, y0 + 3, 2, q - 6);
      g.fillStyle = 'rgba(40,30,10,0.2)';
      g.fillRect(x0 + 3, y0 + q - 5, q - 6, 2); g.fillRect(x0 + q - 5, y0 + 3, 2, q - 6);
      if ((tx + tz * 2 + 1) % 3 === 0) {                           // occasional water stain
        g.fillStyle = 'rgba(110,82,26,0.13)';
        g.beginPath(); g.ellipse(x0 + q * (0.3 + tx * 0.4), y0 + q * (0.35 + tz * 0.3), 40, 26, 0.5, 0, 7); g.fill();
        g.strokeStyle = 'rgba(110,82,26,0.18)'; g.lineWidth = 2;
        g.beginPath(); g.ellipse(x0 + q * (0.3 + tx * 0.4), y0 + q * (0.35 + tz * 0.3), 44, 29, 0.5, 0, 7); g.stroke();
      }
    }
    // T-bar grid between tiles: shadow gap + thin metal rail highlight
    g.strokeStyle = 'rgba(35,26,8,0.5)'; g.lineWidth = 7;
    g.strokeRect(0, 0, w, h);
    g.beginPath(); g.moveTo(q, 0); g.lineTo(q, h); g.moveTo(0, q); g.lineTo(w, q); g.stroke();
    g.strokeStyle = P.ceilLine; g.lineWidth = 2.6;
    g.strokeRect(1, 1, w - 2, h - 2);
    g.beginPath(); g.moveTo(q, 0); g.lineTo(q, h); g.moveTo(0, q); g.lineTo(w, q); g.stroke();
  });
  if (P.style !== 'garage' && P.style !== 'tunnels') ceil.repeat.set(0.5, 0.5);

  const panel = canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = P.panelEdge; g.fillRect(0, 0, w, h);
    const grd = g.createRadialGradient(w / 2, h / 2, 8, w / 2, h / 2, w / 2);
    grd.addColorStop(0, '#ffffff');
    grd.addColorStop(0.75, P.panel);
    grd.addColorStop(1, P.panel);
    g.fillStyle = grd; g.fillRect(8, 8, w - 16, h - 16);
    // diffuser ribs
    g.strokeStyle = 'rgba(120,110,80,0.25)'; g.lineWidth = 1;
    for (let x = 16; x < w - 8; x += 12) { g.beginPath(); g.moveTo(x, 8); g.lineTo(x, h - 8); g.stroke(); }
  }, false);

  const water = canvasTex(256, 256, (g, w, h) => {   // caustic webbing
    g.fillStyle = 'rgba(190,235,220,0)'; g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 1.6;
    for (let i = 0; i < 40; i++) {
      g.beginPath();
      const x = Math.random() * w, y = Math.random() * h;
      g.moveTo(x, y);
      g.bezierCurveTo(x + 30 - Math.random() * 60, y + 30 - Math.random() * 60,
        x + 60 - Math.random() * 120, y + 60 - Math.random() * 120,
        x + 40 - Math.random() * 80, y + 40 - Math.random() * 80);
      g.stroke();
    }
  });

  return { wall, wall2, floor, ceil, panel, water };
}

/* ---------------- memory artwork textures (cached) ---------------- */
const memTexCache = new Map();
function wrapText(g, text, maxW) {
  const words = text.split(/\s+/); const lines = []; let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (g.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; }
    else cur = t;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 7);
}
function scribbleOver(g, w, h) {
  g.strokeStyle = 'rgba(22,12,6,0.8)';
  g.lineWidth = 5;
  for (let i = 0; i < 26; i++) {
    g.beginPath();
    g.moveTo(Math.random() * w, h * 0.2 + Math.random() * h * 0.6);
    g.bezierCurveTo(Math.random() * w, Math.random() * h, Math.random() * w, Math.random() * h,
      Math.random() * w, h * 0.2 + Math.random() * h * 0.6);
    g.stroke();
  }
}
function writingTexture(mem) {
  const key = 'w' + mem.id + (mem.corrupted ? 'X' : '');
  if (memTexCache.has(key)) return memTexCache.get(key);
  const t = canvasTex(512, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.font = '34px "Bradley Hand", "Marker Felt", cursive';
    g.fillStyle = 'rgba(58,38,16,0.62)';
    g.save();
    g.translate(w / 2, h / 2);
    g.rotate((rand(mem.id, 11) - 0.5) * 0.14);
    const lines = wrapText(g, mem.text, w - 70);
    lines.forEach((ln, i) => {
      g.fillText(ln, -g.measureText(ln).width / 2, (i - (lines.length - 1) / 2) * 42);
    });
    g.restore();
    if (mem.corrupted) scribbleOver(g, w, h);
  }, false);
  memTexCache.set(key, t);
  return t;
}
function frameTexture(mem) {
  const key = 'f' + mem.id + (mem.corrupted ? 'X' : '');
  if (memTexCache.has(key)) return memTexCache.get(key);
  const t = canvasTex(256, 320, (g, w, h) => {
    g.fillStyle = '#3c2c1c'; g.fillRect(0, 0, w, h);            // frame
    g.fillStyle = '#d6cba6'; g.fillRect(14, 14, w - 28, h - 28); // matte
    g.fillStyle = '#c4b58c'; g.fillRect(26, 26, w - 52, h - 92); // photo area
    for (let i = 0; i < 500; i++) {
      g.fillStyle = 'rgba(60,40,10,0.06)';
      g.fillRect(20 + Math.random() * (w - 40), 20 + Math.random() * (h - 40), 2, 2);
    }
    g.font = '15px "Courier New", monospace';
    g.fillStyle = 'rgba(50,35,14,0.9)';
    const lines = wrapText(g, mem.text, w - 76);
    lines.forEach((ln, i) => g.fillText(ln, 34, 56 + i * 22));
    g.font = 'italic 13px "Courier New", monospace';
    g.fillStyle = 'rgba(80,55,20,0.75)';
    g.fillText(mem.corrupted ? 'this one is ours now' : 'do you remember?', 34, h - 38);
    if (mem.corrupted) scribbleOver(g, w, h);
  }, false);
  memTexCache.set(key, t);
  return t;
}

/* ---------------- copied rooms (they are not from here) ---------------- */
const ROOM_TYPES = ['showroom', 'therapy', 'interrogation', 'motel', 'cubicles',
  'junction', 'kitchen', 'plans', 'office', 'congregation', 'static', 'poolside'];
const ROOM_CAPTIONS = {
  showroom: 'a furniture showroom. everything must go. nothing ever has.',
  therapy: "her office. the clock is wrong on purpose.",
  interrogation: 'an interrogation room. someone is still answering.',
  motel: 'a motel room. the bed is made. the bed is warm.',
  cubicles: 'the async floor. they were mapping this place.',
  junction: 'an intersection for roads that were never built',
  kitchen: 'the table is set and the candle is lit and you are very late',
  plans: 'someone explained everything in crayon',
  office: "the building's paperwork, filed by someone who never left",
  congregation: 'the meeting ended years ago. the chairs disagree.',
  static: 'every room you have walked through is still being watched',
  poolside: "the pool has been drained for everyone's safety",
};
const roomTex = {
  plaster: canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#d8d2c2'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = 'rgba(80,70,50,0.05)';
      g.fillRect(Math.random() * w, Math.random() * h, 1.6, 1.6);
    }
    const grd = g.createLinearGradient(0, h * 0.7, 0, h);
    grd.addColorStop(0, 'rgba(60,50,30,0)'); grd.addColorStop(1, 'rgba(60,50,30,0.16)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  }),
  wood: canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#85653f'; g.fillRect(0, 0, w, h);
    for (let p = 0; p < 8; p++) {
      g.fillStyle = `rgba(40,24,8,${0.12 + Math.random() * 0.1})`;
      g.fillRect(0, p * 32, w, 2);
    }
    for (let i = 0; i < 1200; i++) {
      g.fillStyle = 'rgba(30,18,6,0.06)';
      g.fillRect(Math.random() * w, Math.random() * h, 2.5, 1);
    }
  }),
  poster: canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#e8ddc2'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#a33'; g.lineWidth = 6; g.strokeRect(8, 8, w - 16, h - 16);
    g.fillStyle = '#a33'; g.font = 'bold 38px Arial';
    g.fillText('EVERYTHING', 18, 90);
    g.fillText('MUST GO', 44, 140);
    g.font = '20px Arial'; g.fillStyle = '#444';
    g.save(); g.translate(w / 2, 190); g.scale(-1, 1);   // the copy got it backwards
    g.fillText('final days', -40, 0); g.restore();
  }, false),
  clock: canvasTex(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#efe9da'; g.beginPath(); g.arc(128, 128, 120, 0, 7); g.fill();
    g.strokeStyle = '#403828'; g.lineWidth = 8; g.beginPath(); g.arc(128, 128, 120, 0, 7); g.stroke();
    g.fillStyle = '#2c2418'; g.font = 'bold 26px Arial';
    const nums = [7, 2, 11, 4, 12, 6, 1, 8, 3, 10, 5, 9];   // wrong on purpose
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6 - Math.PI / 2;
      g.fillText(String(nums[i]), 120 + Math.cos(a) * 92, 138 + Math.sin(a) * 92);
    }
    g.strokeStyle = '#2c2418'; g.lineWidth = 7;
    g.beginPath(); g.moveTo(128, 128); g.lineTo(128 + 52, 128 + 52); g.stroke();
    g.beginPath(); g.moveTo(128, 128); g.lineTo(128 + 52, 128 + 52); g.stroke();  // both hands the same
  }, false),
  painting: canvasTex(256, 200, (g, w, h) => {
    g.fillStyle = '#3c2c1c'; g.fillRect(0, 0, w, h);
    const sky = g.createLinearGradient(0, 12, 0, h - 12);
    sky.addColorStop(0, '#b8c4c2'); sky.addColorStop(1, '#7c8a84');
    g.fillStyle = sky; g.fillRect(12, 12, w - 24, h - 24);
    g.fillStyle = '#4a5450';
    g.beginPath(); g.moveTo(12, h - 12); g.lineTo(90, 60); g.lineTo(150, h - 12); g.fill();
    g.beginPath(); g.moveTo(110, h - 12); g.lineTo(190, 80); g.lineTo(244, h - 12); g.fill();
    g.fillStyle = '#7c8a84';  // the sun is below the mountains
    g.beginPath(); g.arc(128, h - 40, 18, 0, 7); g.fill();
  }, false),
  screen: canvasTex(256, 160, (g, w, h) => {
    g.fillStyle = '#0a1410'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(80,220,160,0.5)'; g.lineWidth = 1;
    for (let i = 0; i < 14; i++) {
      g.strokeRect(20 + Math.random() * 180, 14 + Math.random() * 110, 10 + Math.random() * 40, 8 + Math.random() * 26);
    }
    g.fillStyle = 'rgba(80,220,160,0.9)'; g.font = '12px monospace';
    g.fillText('MAPPING… 3%', 16, 148);
  }, false),
  mural: canvasTex(512, 512, (g, w, h) => {   // crayon plans wall: figures, scrawl, houses
    g.fillStyle = '#d8d2c2'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1a1612';                                          // hooded scarecrow figure
    g.beginPath(); g.moveTo(140, 80); g.lineTo(110, 130); g.lineTo(128, 130); g.lineTo(118, 330);
    g.lineTo(160, 330); g.lineTo(152, 130); g.lineTo(170, 130); g.closePath(); g.fill();
    g.fillRect(60, 150, 170, 9);                                      // outstretched arms
    g.strokeStyle = '#b09a2c'; g.lineWidth = 7;                        // thin yellow long-necked thing
    g.beginPath(); g.moveTo(250, 320); g.lineTo(258, 180); g.lineTo(280, 150); g.stroke();
    g.fillStyle = '#b09a2c'; g.beginPath(); g.ellipse(286, 142, 16, 10, 0.4, 0, 7); g.fill();
    for (const [bx, by, r] of [[210, 200, 26], [232, 250, 18], [196, 260, 13]]) {   // red bursts
      g.fillStyle = 'rgba(150,30,20,0.75)';
      for (let i = 0; i < 9; i++) {
        const a = i / 9 * 6.28;
        g.beginPath(); g.ellipse(bx + Math.cos(a) * r, by + Math.sin(a) * r, 7, 3.5, a, 0, 7); g.fill();
      }
    }
    g.strokeStyle = '#2c2418'; g.lineWidth = 2;                        // barred window near the top
    g.strokeRect(330, 60, 60, 46);
    for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(330 + i * 15, 60); g.lineTo(330 + i * 15, 106); g.stroke(); }
    g.fillStyle = 'rgba(44,36,24,0.8)'; g.font = 'italic 13px "Bradley Hand", cursive';
    const scrawl = ['why think in terms of magic', 'be REALISTIC the plans work', 'i drew the door and it learned',
      'tables dont bleed they dont', 'the man in the wall counts wrong', 'do not sleep past the candle'];
    scrawl.forEach((t, i) => g.fillText(t, 300, 170 + i * 22));
    for (let i = 0; i < 7; i++) {                                      // bottom row: houses with X windows
      const hx = 20 + i * 70, hy = 420;
      g.strokeStyle = '#2c2418'; g.lineWidth = 2.4;
      g.strokeRect(hx, hy, 44, 50);
      g.beginPath(); g.moveTo(hx - 4, hy); g.lineTo(hx + 22, hy - 24); g.lineTo(hx + 48, hy); g.stroke();
      g.beginPath(); g.moveTo(hx + 8, hy + 10); g.lineTo(hx + 20, hy + 22); g.moveTo(hx + 20, hy + 10); g.lineTo(hx + 8, hy + 22); g.stroke();
    }
    g.strokeStyle = 'rgba(150,30,20,0.85)'; g.lineWidth = 3;           // the red spiral
    g.beginPath();
    for (let a = 0; a < 18; a += 0.2) {
      const r = a * 2.1, px = 440 + Math.cos(a) * r, py = 430 + Math.sin(a) * r;
      a === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
    }
    g.stroke();
    g.strokeStyle = '#2c2418'; g.lineWidth = 1.6;                      // crossed-off calendar
    for (let r2 = 0; r2 < 4; r2++) for (let c2 = 0; c2 < 7; c2++) {
      g.strokeRect(34 + c2 * 18, 330 + r2 * 16, 16, 14);
      if (r2 * 7 + c2 < 23) {
        g.beginPath(); g.moveTo(36 + c2 * 18, 332 + r2 * 16); g.lineTo(48 + c2 * 18, 342 + r2 * 16); g.stroke();
      }
    }
    g.fillStyle = '#2c2418'; g.font = 'bold 30px "Bradley Hand", cursive';
    g.fillText('Plans', 22, 500);
  }, false),
  corkboard: canvasTex(256, 192, (g, w, h) => {
    g.fillStyle = '#a3804e'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#6b4f2a'; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8);
    for (let i = 0; i < 14; i++) {                                      // pinned receipts & notes
      const px = 16 + Math.random() * (w - 60), py = 16 + Math.random() * (h - 70);
      g.save(); g.translate(px, py); g.rotate((Math.random() - 0.5) * 0.4);
      g.fillStyle = Math.random() < 0.3 ? '#f2eccf' : '#fdfdf6';
      g.fillRect(0, 0, 26 + Math.random() * 22, 34 + Math.random() * 22);
      g.fillStyle = 'rgba(60,60,70,0.7)';
      for (let l = 0; l < 5; l++) g.fillRect(3, 5 + l * 6, 18 + Math.random() * 14, 1.4);
      g.restore();
      g.fillStyle = '#a32a22'; g.beginPath(); g.arc(px + 12, py + 2, 2.4, 0, 7); g.fill();   // pin
    }
  }, false),
  elevations: canvasTex(512, 256, (g, w, h) => {   // shingled architectural drawings
    g.fillStyle = '#e9e4d4'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 12; i++) {
      const px = (i % 4) * 128 + (Math.random() - 0.5) * 30, py = Math.floor(i / 4) * 86 + (Math.random() - 0.5) * 18;
      g.save(); g.translate(px, py); g.rotate((Math.random() - 0.5) * 0.12);
      g.fillStyle = '#f6f2e6'; g.fillRect(0, 0, 132, 92);
      g.strokeStyle = 'rgba(40,60,120,0.75)'; g.lineWidth = 1.4;
      g.strokeRect(8, 10, 116, 60);
      for (let c2 = 1; c2 < 6; c2++) { g.beginPath(); g.moveTo(8 + c2 * 19, 10); g.lineTo(8 + c2 * 19, 70); g.stroke(); }
      g.beginPath(); g.moveTo(8, 40); g.lineTo(124, 40); g.stroke();
      g.strokeStyle = 'rgba(30,30,30,0.6)';
      for (let l = 0; l < 3; l++) { g.beginPath(); g.moveTo(10, 76 + l * 5); g.lineTo(60 + Math.random() * 40, 76 + l * 5); g.stroke(); }
      g.restore();
    }
  }),
  tile: canvasTex(256, 256, (g, w, h) => {         // white poolside tile, greying grout
    g.fillStyle = '#dde2dd'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#a8b0a8'; g.lineWidth = 3;
    for (let y = 0; y <= h; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    for (let x = 0; x <= w; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let i = 0; i < 500; i++) {
      g.fillStyle = 'rgba(90,100,90,0.05)';
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    g.fillStyle = 'rgba(110,90,40,0.08)';
    g.beginPath(); g.ellipse(w * 0.3, h * 0.7, 40, 24, 0.6, 0, 7); g.fill();
  }),
  stop: canvasTex(128, 128, (g, w, h) => {         // regulation octagon
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#9e1f1a';
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2 + Math.PI / 8;
      const px = 64 + Math.cos(a) * 60, py = 64 + Math.sin(a) * 60;
      i === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
    }
    g.closePath(); g.fill();
    g.strokeStyle = '#f4efe2'; g.lineWidth = 5; g.stroke();
    g.fillStyle = '#f4efe2'; g.font = 'bold 36px Helvetica, Arial'; g.textAlign = 'center';
    g.fillText('STOP', 64, 77);
  }, false),
  osd: canvasTex(256, 192, (g, w, h) => {          // security feed with burned-in OSD
    g.fillStyle = '#0d1024'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2400; i++) {               // analog noise
      g.fillStyle = `rgba(${120 + Math.random() * 80},${120 + Math.random() * 90},${170 + Math.random() * 60},0.08)`;
      g.fillRect(Math.random() * w, Math.random() * h, 1.6, 1.2);
    }
    g.strokeStyle = 'rgba(180,190,230,0.5)'; g.lineWidth = 1.4;        // the watched yellow room, in wireframe ghost
    g.strokeRect(60, 60, 140, 90);
    g.beginPath(); g.moveTo(60, 60); g.lineTo(20, 30); g.moveTo(200, 60); g.lineTo(236, 30); g.stroke();
    g.fillStyle = 'rgba(220,228,255,0.92)'; g.font = 'bold 12px monospace';
    g.fillText('KLWNA mtr CH J3', 8, 18);
    g.fillText('06/28/1998  23:31:07', 8, 34);
    g.fillStyle = 'rgba(220,228,255,0.7)'; g.fillText('REC ●', 210, 18);
  }, false),
};
const roomMat = {
  plaster: new THREE.MeshLambertMaterial({ map: roomTex.plaster, side: THREE.DoubleSide }),
  wood: new THREE.MeshLambertMaterial({ map: roomTex.wood, side: THREE.DoubleSide }),
  dark: new THREE.MeshLambertMaterial({ color: 0x18140f }),
  fabric: new THREE.MeshLambertMaterial({ color: 0x6b5a48 }),
  fabric2: new THREE.MeshLambertMaterial({ color: 0x49565e }),
  metal: new THREE.MeshLambertMaterial({ color: 0x8e9498 }),
  glass: new THREE.MeshBasicMaterial({ color: 0x12181c }),
  screen: new THREE.MeshBasicMaterial({ map: roomTex.screen, side: THREE.DoubleSide }),
  shade: new THREE.MeshLambertMaterial({ color: 0xd9c89a, emissive: 0x6b5530 }),
  linen: new THREE.MeshLambertMaterial({ color: 0xbab2a2 }),
  poster: new THREE.MeshLambertMaterial({ map: roomTex.poster }),
  clock: new THREE.MeshLambertMaterial({ map: roomTex.clock, transparent: true }),
  painting: new THREE.MeshLambertMaterial({ map: roomTex.painting }),
  figure: new THREE.MeshLambertMaterial({ color: 0x16120d }),
  lifeform: new THREE.MeshLambertMaterial({ color: 0x080807 }),   // ink-black scribble flesh
  plastic: new THREE.MeshLambertMaterial({ color: 0xe9e7e0 }),
  paper: new THREE.MeshLambertMaterial({ color: 0xe6e1d2 }),
  crate: new THREE.MeshLambertMaterial({ color: 0x59584a }),
  cardboard: new THREE.MeshLambertMaterial({ color: 0x8a6f44 }),
  step: new THREE.MeshLambertMaterial({ color: 0x474239 }),
  // furniture detail palette
  woodDark: new THREE.MeshLambertMaterial({ color: 0x4a3826 }),
  fabricDark: new THREE.MeshLambertMaterial({ color: 0x564738 }),
  fabric2Dk: new THREE.MeshLambertMaterial({ color: 0x3a464e }),
  chrome: new THREE.MeshLambertMaterial({ color: 0xb6bcc2 }),
  bookA: new THREE.MeshLambertMaterial({ color: 0x6e3f33 }),
  bookB: new THREE.MeshLambertMaterial({ color: 0x44563c }),
  bookC: new THREE.MeshLambertMaterial({ color: 0x46506b }),
  bulb: new THREE.MeshBasicMaterial({ color: 0xfff2cc }),
  // film-study additions
  pine: new THREE.MeshLambertMaterial({ color: 0xc9a96e }),           // raw showroom pine
  cream: new THREE.MeshLambertMaterial({ color: 0xd9cdb2 }),          // overstuffed cream upholstery
  mural: new THREE.MeshLambertMaterial({ map: roomTex.mural }),
  corkboard: new THREE.MeshLambertMaterial({ map: roomTex.corkboard }),
  elevations: new THREE.MeshLambertMaterial({ map: roomTex.elevations, side: THREE.DoubleSide }),
  osd: new THREE.MeshBasicMaterial({ map: roomTex.osd }),
  signRed: new THREE.MeshLambertMaterial({ color: 0x9e1f1a }),
  signWhite: new THREE.MeshBasicMaterial({ color: 0xf4efe2 }),
  plasterPink: new THREE.MeshLambertMaterial({ color: 0xc9a4a0, side: THREE.DoubleSide }),
  plasterBrown: new THREE.MeshLambertMaterial({ color: 0x5c4a38, side: THREE.DoubleSide }),
  curtain: new THREE.MeshLambertMaterial({ color: 0x2c3f7a }),
  tumbler: new THREE.MeshLambertMaterial({ color: 0x7fa3c9 }),
  oakLight: new THREE.MeshLambertMaterial({ color: 0xb08a52 }),
  candle: new THREE.MeshLambertMaterial({ color: 0xd9c25e, emissive: 0x4a3a08 }),
  amber: new THREE.MeshLambertMaterial({ color: 0x8a5a18 }),
  cordBlue: new THREE.MeshLambertMaterial({ color: 0x2a55b8 }),
  shoeBlack: new THREE.MeshLambertMaterial({ color: 0x1c1a18 }),
  shoeRed: new THREE.MeshLambertMaterial({ color: 0x6e2026 }),
  leaf: new THREE.MeshLambertMaterial({ color: 0x4e3415, side: THREE.DoubleSide }),
  bag: new THREE.MeshLambertMaterial({ color: 0x16181a }),
  blanket: new THREE.MeshLambertMaterial({ color: 0x33302c }),
  tag: new THREE.MeshLambertMaterial({ color: 0xf2eee0, side: THREE.DoubleSide }),
  stop: new THREE.MeshLambertMaterial({ map: roomTex.stop, transparent: true, side: THREE.DoubleSide }),
  tile: new THREE.MeshLambertMaterial({ map: roomTex.tile, side: THREE.DoubleSide }),
  poolBlue: new THREE.MeshLambertMaterial({ color: 0x6f98a4, side: THREE.DoubleSide }),
  poolDeep: new THREE.MeshLambertMaterial({ color: 0x2c3a40 }),
  // floor-dressing palette (garage / tunnels / deep)
  cone: new THREE.MeshLambertMaterial({ color: 0xc2581c }),
  rust: new THREE.MeshLambertMaterial({ color: 0x6e4a2a }),
  steelBlue: new THREE.MeshLambertMaterial({ color: 0x46505a }),
  carPaint: new THREE.MeshLambertMaterial({ color: 0x6a6e72 }),
};
roomTex.wood.repeat.set(4, 4);

/* ---------------- furniture builders (shared by copied rooms & lobby piles) ----------------
   Each builder is (p) => void, where p(geo, mat, x, y, z, ry, rx, rz) adds a mesh
   in the furniture's local space. Parametric builders return such a function. */
const FURN = (() => {
  const legs = (p, lx, lz, h = 0.12, mat = roomMat.woodDark) => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1])
      p(new THREE.CylinderGeometry(0.024, 0.018, h, 8), mat, sx * lx, h / 2, sz * lz);
  };
  const sofa = (len, fab, fabD) => (p) => {
    p(new THREE.BoxGeometry(len, 0.2, 0.8), fabD, 0, 0.22, 0);                       // frame
    p(new THREE.BoxGeometry(len, 0.5, 0.16), fab, 0, 0.56, -0.34);                   // back panel
    const n = Math.max(2, Math.round(len / 0.7)), cw = (len - 0.3) / n;
    for (let i = 0; i < n; i++) {
      const cx = -len / 2 + 0.15 + cw * (i + 0.5);
      p(new THREE.BoxGeometry(cw - 0.04, 0.15, 0.58), fab, cx, 0.4, 0.05, (i % 2 ? 0.02 : -0.015));
      p(new THREE.BoxGeometry(cw - 0.05, 0.38, 0.15), fab, cx, 0.68, -0.24, 0, -0.16);
    }
    for (const s of [-1, 1]) {
      p(new THREE.BoxGeometry(0.16, 0.28, 0.74), fabD, s * (len / 2 - 0.06), 0.33, 0.02);
      p(new THREE.CylinderGeometry(0.085, 0.085, 0.76, 10), fab, s * (len / 2 - 0.06), 0.52, 0.02, 0, Math.PI / 2);
    }
    legs(p, len / 2 - 0.12, 0.3);
  };
  const loungeChair = (p) => {
    p(new THREE.BoxGeometry(0.74, 0.16, 0.7), roomMat.fabric2Dk, 0, 0.2, 0);
    p(new THREE.BoxGeometry(0.6, 0.12, 0.58), roomMat.fabric2, 0, 0.34, 0.03);
    p(new THREE.BoxGeometry(0.6, 0.55, 0.14), roomMat.fabric2, 0, 0.6, -0.27, 0, -0.18);
    for (const s of [-1, 1]) {
      p(new THREE.BoxGeometry(0.1, 0.28, 0.58), roomMat.fabric2Dk, s * 0.34, 0.4, 0.02);
      p(new THREE.CylinderGeometry(0.05, 0.05, 0.56, 8), roomMat.fabric2, s * 0.34, 0.56, 0.02, 0, Math.PI / 2);
    }
    legs(p, 0.28, 0.26);
  };
  const coffeeTable = (p) => {
    p(new THREE.BoxGeometry(1.1, 0.045, 0.6), roomMat.wood, 0, 0.43, 0);
    p(new THREE.BoxGeometry(0.98, 0.06, 0.48), roomMat.woodDark, 0, 0.38, 0);
    p(new THREE.BoxGeometry(0.92, 0.03, 0.42), roomMat.woodDark, 0, 0.15, 0);        // magazine shelf
    p(new THREE.BoxGeometry(0.3, 0.012, 0.22), roomMat.paper, 0.18, 0.46, 0.06, 0.5);
    for (const sx of [-1, 1]) for (const sz of [-1, 1])
      p(new THREE.CylinderGeometry(0.025, 0.018, 0.4, 8), roomMat.woodDark, sx * 0.47, 0.2, sz * 0.22);
  };
  const floorLamp = (p) => {
    p(new THREE.CylinderGeometry(0.16, 0.19, 0.025, 12), roomMat.dark, 0, 0.013, 0);
    p(new THREE.CylinderGeometry(0.013, 0.013, 1.6, 8), roomMat.dark, 0, 0.82, 0);
    p(new THREE.CylinderGeometry(0.17, 0.24, 0.32, 12), roomMat.shade, 0, 1.76, 0);
  };
  const sideTable = (p) => {
    p(new THREE.CylinderGeometry(0.3, 0.3, 0.035, 14), roomMat.wood, 0, 0.45, 0);
    p(new THREE.CylinderGeometry(0.028, 0.028, 0.42, 8), roomMat.woodDark, 0, 0.23, 0);
    p(new THREE.CylinderGeometry(0.15, 0.19, 0.03, 12), roomMat.woodDark, 0, 0.02, 0);
    p(new THREE.BoxGeometry(0.17, 0.06, 0.12), roomMat.paper, 0.07, 0.5, 0.05, 0.4); // tissue box
  };
  const bookcase = (seed) => (p) => {
    p(new THREE.BoxGeometry(1.7, 2.05, 0.04), roomMat.woodDark, 0, 1.02, -0.14);
    p(new THREE.BoxGeometry(1.7, 0.06, 0.34), roomMat.wood, 0, 2.02, 0);
    p(new THREE.BoxGeometry(1.7, 0.1, 0.34), roomMat.wood, 0, 0.05, 0);
    for (const s of [-1, 1]) p(new THREE.BoxGeometry(0.05, 2.05, 0.34), roomMat.wood, s * 0.825, 1.02, 0);
    for (let i = 0; i < 4; i++) {
      const sy = 0.55 + i * 0.47;
      p(new THREE.BoxGeometry(1.6, 0.035, 0.3), roomMat.wood, 0, sy, 0);
      let bx = -0.74, k = 0;
      while (bx < 0.6 && k < 14) {                                   // a shelf of mismatched books
        const bw = 0.04 + rand(seed, 70 + i * 17 + k) * 0.05;
        const bh = 0.24 + rand(seed, 90 + i * 13 + k) * 0.14;
        const lean = hash(seed, i * 7 + k) % 9 === 0 ? 0.13 : 0;
        const bm = [roomMat.bookA, roomMat.bookB, roomMat.bookC, roomMat.paper][hash(seed, i * 31 + k * 3) % 4];
        p(new THREE.BoxGeometry(bw, bh, 0.2), bm, bx + bw / 2, sy + 0.02 + bh / 2, 0.02, 0, 0, lean);
        bx += bw + 0.014 + (hash(seed, i * 3 + k * 5) % 7 === 0 ? 0.12 : 0);
        k++;
      }
    }
  };
  const metalTable = (p) => {
    p(new THREE.BoxGeometry(1.5, 0.05, 0.8), roomMat.metal, 0, 0.76, 0);
    p(new THREE.BoxGeometry(1.34, 0.06, 0.64), roomMat.chrome, 0, 0.71, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1])
      p(new THREE.CylinderGeometry(0.024, 0.024, 0.74, 8), roomMat.chrome, sx * 0.6, 0.37, sz * 0.3, 0, 0, sx * 0.04);
    for (const sz of [-1, 1]) p(new THREE.BoxGeometry(1.14, 0.035, 0.035), roomMat.chrome, 0, 0.16, sz * 0.3);
  };
  const metalChair = (p) => {
    p(new THREE.BoxGeometry(0.44, 0.04, 0.44), roomMat.metal, 0, 0.46, 0);
    p(new THREE.BoxGeometry(0.44, 0.48, 0.04), roomMat.metal, 0, 0.73, -0.21, 0, -0.1);
    for (const sx of [-1, 1]) for (const sz of [-1, 1])
      p(new THREE.CylinderGeometry(0.017, 0.017, 0.46, 8), roomMat.chrome, sx * 0.18, 0.23, sz * 0.18);
    for (const s of [-1, 1]) p(new THREE.BoxGeometry(0.035, 0.035, 0.38), roomMat.chrome, s * 0.18, 0.1, 0);
  };
  const bed = (p) => {
    p(new THREE.BoxGeometry(1.5, 0.28, 2.05), roomMat.woodDark, 0, 0.15, 0);
    p(new THREE.BoxGeometry(1.42, 0.2, 1.95), roomMat.linen, 0, 0.39, 0);
    p(new THREE.BoxGeometry(1.5, 0.15, 1.4), roomMat.fabric, 0, 0.49, 0.3);          // tucked blanket
    p(new THREE.BoxGeometry(1.42, 0.04, 0.26), roomMat.linen, 0, 0.51, -0.27);       // fold-back
    for (const s of [-1, 1])
      p(new THREE.CapsuleGeometry(0.095, 0.3, 4, 8), roomMat.linen, s * 0.33, 0.55, -0.68, 0, 0, Math.PI / 2);
    p(new THREE.BoxGeometry(1.56, 0.8, 0.07), roomMat.wood, 0, 0.75, -1.06);
    for (const s of [-1, 1]) p(new THREE.CylinderGeometry(0.034, 0.034, 1.12, 8), roomMat.woodDark, s * 0.74, 0.56, -1.06);
  };
  const nightstand = (p) => {
    p(new THREE.BoxGeometry(0.52, 0.5, 0.46), roomMat.wood, 0, 0.31, 0);
    p(new THREE.BoxGeometry(0.44, 0.15, 0.025), roomMat.woodDark, 0, 0.42, 0.235);
    p(new THREE.SphereGeometry(0.02, 8, 6), roomMat.dark, 0, 0.42, 0.255);
    legs(p, 0.21, 0.18);
    p(new THREE.CylinderGeometry(0.07, 0.09, 0.02, 10), roomMat.dark, 0, 0.57, 0);   // lamp
    p(new THREE.CylinderGeometry(0.011, 0.011, 0.33, 8), roomMat.dark, 0, 0.73, 0);
    p(new THREE.CylinderGeometry(0.1, 0.145, 0.2, 10), roomMat.shade, 0, 0.97, 0);
  };
  const deskUnit = (p) => {
    p(new THREE.BoxGeometry(1.5, 0.05, 0.7), roomMat.wood, 0, 0.74, 0);
    for (const s of [-1, 1]) p(new THREE.BoxGeometry(0.04, 0.72, 0.6), roomMat.metal, s * 0.71, 0.36, 0);
    p(new THREE.BoxGeometry(1.38, 0.3, 0.03), roomMat.metal, 0, 0.48, -0.3);
    p(new THREE.BoxGeometry(0.5, 0.34, 0.05), roomMat.dark, 0, 1.02, -0.18);         // monitor
    p(new THREE.CylinderGeometry(0.024, 0.03, 0.12, 8), roomMat.dark, 0, 0.82, -0.2);
    p(new THREE.CylinderGeometry(0.09, 0.11, 0.02, 10), roomMat.dark, 0, 0.78, -0.2);
    p(new THREE.BoxGeometry(0.42, 0.02, 0.15), roomMat.plastic, 0, 0.775, 0.1, 0.04);
    p(new THREE.BoxGeometry(0.06, 0.015, 0.1), roomMat.plastic, 0.32, 0.775, 0.12);
  };
  const officeChair = (p) => {
    p(new THREE.BoxGeometry(0.46, 0.07, 0.46), roomMat.fabric2, 0, 0.46, 0);
    p(new THREE.BoxGeometry(0.44, 0.5, 0.08), roomMat.fabric2, 0, 0.78, 0.22, 0, 0.14);
    p(new THREE.CylinderGeometry(0.024, 0.024, 0.2, 8), roomMat.chrome, 0, 0.33, 0);
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * Math.PI * 2;
      p(new THREE.BoxGeometry(0.24, 0.025, 0.045), roomMat.dark, Math.cos(a) * 0.12, 0.06, Math.sin(a) * 0.12, -a);
      p(new THREE.SphereGeometry(0.027, 6, 5), roomMat.dark, Math.cos(a) * 0.23, 0.03, Math.sin(a) * 0.23);
    }
  };
  const partition = (p) => {
    p(new THREE.BoxGeometry(0.06, 1.42, 1.62), roomMat.fabric2, 0, 0.78, 0);
    p(new THREE.BoxGeometry(0.085, 0.06, 1.7), roomMat.metal, 0, 1.52, 0);
    for (const s of [-1, 1]) {
      p(new THREE.BoxGeometry(0.085, 1.52, 0.05), roomMat.metal, 0, 0.79, s * 0.83);
      p(new THREE.BoxGeometry(0.24, 0.03, 0.06), roomMat.metal, 0, 0.015, s * 0.78);  // feet
    }
  };
  // pile-only pieces
  const mattress = (p) => {
    p(new THREE.BoxGeometry(1.4, 0.22, 1.95), roomMat.linen, 0, 0.11, 0);
    p(new THREE.BoxGeometry(1.42, 0.03, 1.97), roomMat.fabricDark, 0, 0.11, 0);      // piping line
  };
  const rolledRug = (p) => {
    p(new THREE.CylinderGeometry(0.16, 0.16, 1.8, 10), roomMat.fabricDark, 0, 0.16, 0, 0, 0, Math.PI / 2);
    p(new THREE.CylinderGeometry(0.06, 0.06, 1.84, 8), roomMat.fabric, 0, 0.16, 0, 0, 0, Math.PI / 2);
  };
  const sheeted = (w, h, d) => (p) => {                       // dust-sheet over something boxy
    p(new THREE.BoxGeometry(w, h, d), roomMat.linen, 0, h / 2 + 0.05, 0);
    p(new THREE.BoxGeometry(w + 0.14, h * 0.55, d + 0.14), roomMat.linen, 0, h * 0.275, 0);
    p(new THREE.BoxGeometry(w + 0.2, 0.06, d + 0.2), roomMat.linen, 0, 0.03, 0);     // hem pooling on the floor
  };
  const tvSet = (p) => {                                       // old CRT
    p(new THREE.BoxGeometry(0.62, 0.5, 0.5), roomMat.woodDark, 0, 0.25, 0);
    p(new THREE.BoxGeometry(0.46, 0.36, 0.02), roomMat.glass, 0, 0.27, 0.25);
    p(new THREE.CylinderGeometry(0.02, 0.02, 0.05, 8), roomMat.dark, 0.22, 0.14, 0.25, 0, Math.PI / 2);
    p(new THREE.CylinderGeometry(0.02, 0.02, 0.05, 8), roomMat.dark, 0.22, 0.22, 0.25, 0, Math.PI / 2);
  };
  // ---- film-study pieces (showroom stock) ----
  const priceTag = (p, x, y, z) => {                           // white string tag — showroom stock
    p(new THREE.CylinderGeometry(0.0022, 0.0022, 0.12, 4), roomMat.tag, x, y - 0.06, z);
    p(new THREE.BoxGeometry(0.05, 0.03, 0.004), roomMat.tag, x, y - 0.13, z, 0.4);
  };
  const wardrobe = (ajar) => (p) => {                          // light pine, coffered doors
    p(new THREE.BoxGeometry(0.95, 1.95, 0.55), roomMat.pine, 0, 0.975, 0);
    p(new THREE.BoxGeometry(1.0, 0.06, 0.6), roomMat.pine, 0, 1.97, 0);
    for (const s of [-1, 1]) {                                 // coffered door fronts
      p(new THREE.BoxGeometry(0.4, 1.7, 0.02), roomMat.oakLight, s * 0.225, 1.02, ajar && s === 1 ? 0.36 : 0.285, ajar && s === 1 ? 0.5 : 0);
      p(new THREE.BoxGeometry(0.26, 0.6, 0.012), roomMat.pine, s * 0.225, 1.45, ajar && s === 1 ? 0.39 : 0.297, ajar && s === 1 ? 0.5 : 0);
      p(new THREE.BoxGeometry(0.26, 0.6, 0.012), roomMat.pine, s * 0.225, 0.62, ajar && s === 1 ? 0.39 : 0.297, ajar && s === 1 ? 0.5 : 0);
      p(new THREE.SphereGeometry(0.016, 8, 6), roomMat.woodDark, s * 0.06, 1.0, ajar && s === 1 ? 0.38 : 0.3);
    }
    priceTag(p, -0.34, 1.6, 0.31);
  };
  const dresser = (spilled) => (p) => {                        // wide pine dresser, drawers pulled
    p(new THREE.BoxGeometry(1.3, 0.82, 0.5), roomMat.pine, 0, 0.41, 0);
    p(new THREE.BoxGeometry(1.36, 0.04, 0.55), roomMat.oakLight, 0, 0.84, 0);
    for (let r2 = 0; r2 < 2; r2++) for (let c2 = 0; c2 < 2; c2++) {
      const pull = spilled && (r2 + c2) % 2 === 0 ? 0.16 + r2 * 0.1 : 0.02;
      p(new THREE.BoxGeometry(0.56, 0.3, 0.04), roomMat.oakLight, (c2 - 0.5) * 0.62, 0.26 + r2 * 0.36, 0.25 + pull);
      p(new THREE.BoxGeometry(0.14, 0.025, 0.02), roomMat.woodDark, (c2 - 0.5) * 0.62, 0.26 + r2 * 0.36, 0.27 + pull);
      if (pull > 0.1) p(new THREE.BoxGeometry(0.5, 0.05, 0.3), roomMat.linen, (c2 - 0.5) * 0.62, 0.29 + r2 * 0.36, 0.3 + pull, 0.2, 0, 0.06);
    }
  };
  const ladderChairM = (mat) => (p) => {                       // ladder-back dining chair
    p(new THREE.BoxGeometry(0.42, 0.035, 0.42), mat, 0, 0.45, 0);
    for (const sx of [-1, 1]) {
      p(new THREE.CylinderGeometry(0.018, 0.014, 0.45, 6), mat, sx * 0.18, 0.225, 0.18);
      p(new THREE.CylinderGeometry(0.018, 0.018, 1.0, 6), mat, sx * 0.18, 0.5, -0.18);
    }
    for (let i = 0; i < 3; i++) p(new THREE.BoxGeometry(0.37, 0.05, 0.02), mat, 0, 0.62 + i * 0.13, -0.18);
    for (const sz of [-1, 1]) p(new THREE.BoxGeometry(0.33, 0.025, 0.02), mat, 0, 0.2, sz * 0.18);
  };
  const ladderChair = ladderChairM(roomMat.woodDark);
  const cafeTable = (p) => {                                   // round pedestal cafe table
    p(new THREE.CylinderGeometry(0.5, 0.5, 0.04, 14), roomMat.woodDark, 0, 0.72, 0);
    p(new THREE.CylinderGeometry(0.04, 0.04, 0.68, 8), roomMat.dark, 0, 0.36, 0);
    p(new THREE.CylinderGeometry(0.26, 0.3, 0.04, 12), roomMat.dark, 0, 0.02, 0);
  };
  const filingCab = (p) => {
    p(new THREE.BoxGeometry(0.4, 0.72, 0.5), roomMat.metal, 0, 0.36, 0);
    for (let i = 0; i < 2; i++) {
      p(new THREE.BoxGeometry(0.34, 0.3, 0.02), roomMat.chrome, 0, 0.2 + i * 0.34, 0.255);
      p(new THREE.BoxGeometry(0.12, 0.025, 0.02), roomMat.dark, 0, 0.3 + i * 0.34, 0.27);
    }
  };
  const trunk = (p) => {
    p(new THREE.BoxGeometry(0.8, 0.42, 0.45), roomMat.metal, 0, 0.21, 0);
    p(new THREE.BoxGeometry(0.84, 0.05, 0.49), roomMat.dark, 0, 0.44, 0);
    for (const s of [-1, 1]) p(new THREE.BoxGeometry(0.05, 0.42, 0.46), roomMat.dark, s * 0.3, 0.21, 0);
  };
  const pictureFrame = (p) => {                                // black-framed picture, propped
    p(new THREE.BoxGeometry(0.7, 0.9, 0.03), roomMat.dark, 0, 0.45, 0);
    p(new THREE.PlaneGeometry(0.58, 0.78), roomMat.painting, 0, 0.45, 0.017);
  };
  const garbageBags = (p) => {                                 // slumped black bags
    for (let i = 0; i < 5; i++) {
      const m = p(new THREE.SphereGeometry(0.26, 8, 6), roomMat.bag,
        (i % 3 - 1) * 0.42 + (i * 0.07), 0.2 + Math.floor(i / 3) * 0.3, (i % 2) * 0.3 - 0.15, i, 0, 0);
      m.scale.set(1, 0.72, 0.92);
    }
  };
  // ---- floor-specific set dressing (garage / tunnels / deep) ----
  const pallet = (p) => {
    for (let i = 0; i < 5; i++) p(new THREE.BoxGeometry(1.1, 0.025, 0.13), roomMat.pine, 0, 0.135, -0.44 + i * 0.22);
    for (const sx of [-0.5, 0, 0.5]) {
      p(new THREE.BoxGeometry(0.09, 0.1, 1.02), roomMat.oakLight, sx, 0.07, 0);
      p(new THREE.BoxGeometry(0.09, 0.025, 1.02), roomMat.pine, sx, 0.012, 0);
    }
  };
  const drum = (p) => {
    p(new THREE.CylinderGeometry(0.29, 0.29, 0.88, 14), roomMat.steelBlue, 0, 0.44, 0);
    for (const y of [0.22, 0.66]) p(new THREE.TorusGeometry(0.295, 0.013, 5, 14), roomMat.rust, 0, y, 0, 0, Math.PI / 2, 0);
    p(new THREE.CylinderGeometry(0.27, 0.27, 0.02, 14), roomMat.rust, 0, 0.89, 0);
  };
  const cone = (p) => {
    p(new THREE.BoxGeometry(0.34, 0.02, 0.34), roomMat.cone, 0, 0.01, 0);
    p(new THREE.CylinderGeometry(0.02, 0.16, 0.5, 10), roomMat.cone, 0, 0.27, 0);
    p(new THREE.CylinderGeometry(0.095, 0.115, 0.07, 10), roomMat.tag, 0, 0.3, 0);
  };
  const tireStack = (n) => (p) => {
    for (let i = 0; i < n; i++)
      p(new THREE.TorusGeometry(0.27, 0.105, 8, 14), roomMat.bag, (i % 2) * 0.05, 0.11 + i * 0.21, (i % 3) * 0.04, 0, Math.PI / 2, 0);
  };
  const deadCar = (p) => {                                     // a sedan that will never leave
    p(new THREE.BoxGeometry(3.6, 0.5, 1.5), roomMat.carPaint, 0, 0.5, 0);
    p(new THREE.BoxGeometry(1.9, 0.44, 1.4), roomMat.carPaint, -0.15, 0.95, 0);
    p(new THREE.BoxGeometry(1.96, 0.26, 1.42), roomMat.glass, -0.15, 0.92, 0);
    for (const sx of [-1.78, 1.78]) p(new THREE.BoxGeometry(0.1, 0.13, 1.32), roomMat.chrome, sx, 0.36, 0);
    for (const sx of [-1.15, 1.15]) for (const sz of [-0.72, 0.72]) {
      const m = p(new THREE.CylinderGeometry(0.3, 0.3, 0.17, 12), roomMat.bag, sx, 0.22, sz, 0, Math.PI / 2, 0);
      m.scale.z = 0.78;   // flat tires
      p(new THREE.CylinderGeometry(0.13, 0.13, 0.18, 10), roomMat.chrome, sx, 0.22, sz, 0, Math.PI / 2, 0);
    }
  };
  const cableSpool = (p) => {
    for (const sx of [-0.33, 0.33]) p(new THREE.CylinderGeometry(0.55, 0.55, 0.07, 16), roomMat.pine, sx, 0.55, 0, 0, 0, Math.PI / 2);
    p(new THREE.CylinderGeometry(0.22, 0.22, 0.6, 10), roomMat.oakLight, 0, 0.55, 0, 0, 0, Math.PI / 2);
    p(new THREE.TorusGeometry(0.34, 0.05, 6, 16), roomMat.dark, 0, 0.55, 0, 0, 0, Math.PI / 2);
  };
  const sawhorse = (p) => {
    p(new THREE.BoxGeometry(1.1, 0.07, 0.09), roomMat.cone, 0, 0.78, 0);
    for (const sx of [-0.48, 0.48]) for (const sz of [-1, 1])
      p(new THREE.BoxGeometry(0.05, 0.82, 0.05), roomMat.steelBlue, sx, 0.39, sz * 0.12, 0, sz * 0.26, 0);
  };
  const toolClutter = (p) => {
    p(new THREE.BoxGeometry(0.5, 0.24, 0.24), roomMat.signRed, 0, 0.12, 0);
    p(new THREE.CylinderGeometry(0.014, 0.014, 0.3, 6), roomMat.chrome, 0, 0.27, 0, 0, 0, Math.PI / 2);
    p(new THREE.BoxGeometry(0.16, 0.012, 0.03), roomMat.chrome, 0.45, 0.007, 0.12, 0.5);
    p(new THREE.BoxGeometry(0.12, 0.012, 0.025), roomMat.chrome, 0.38, 0.007, -0.16, 1.2);
    p(new THREE.CylinderGeometry(0.1, 0.085, 0.2, 10), roomMat.steelBlue, -0.42, 0.1, 0.15);   // bucket
    p(new THREE.BoxGeometry(0.22, 0.05, 0.18), roomMat.linen, -0.35, 0.025, -0.2, 0.7);        // rags
  };
  const pipeStack = (p) => {
    for (let i = 0; i < 3; i++)
      p(new THREE.CylinderGeometry(0.09, 0.09, 2.4, 10), roomMat.rust, -0.19 + i * 0.19, 0.09, 0, 0, Math.PI / 2, 0);
    for (let i = 0; i < 2; i++)
      p(new THREE.CylinderGeometry(0.09, 0.09, 2.4, 10), roomMat.rust, -0.095 + i * 0.19, 0.245, 0, 0, Math.PI / 2, 0);
  };
  const debrisHeap = (seed) => (p) => {
    const m = p(new THREE.DodecahedronGeometry(0.4, 0), roomMat.plasterBrown, 0, 0.1, 0, seed);
    m.scale.set(1.5, 0.4, 1.25);
    for (let i = 0; i < 7; i++) {
      p(new THREE.BoxGeometry(0.4 + (i % 3) * 0.12, 0.022, 0.34), roomMat.plaster,
        Math.sin(i * 2.3 + seed) * 0.5, 0.05 + i * 0.05, Math.cos(i * 1.9 + seed) * 0.5, i * 0.7, (i % 2) * 0.14, (i % 3) * 0.1);
    }
    for (let i = 0; i < 3; i++)
      p(new THREE.BoxGeometry(1.1, 0.03, 0.04), roomMat.rust,
        Math.sin(i * 4 + seed) * 0.3, 0.2 + i * 0.06, Math.cos(i * 3 + seed) * 0.3, i * 1.1, 0, 0.18);
  };
  const doorLean = (p) => {                                    // a door with no frame, leaned and waiting
    p(new THREE.BoxGeometry(0.92, 2.04, 0.05), roomMat.woodDark, 0, 0.98, 0.26, 0, -0.27);
    p(new THREE.SphereGeometry(0.026, 8, 6), roomMat.chrome, 0.36, 1.0, 0.16);
  };
  const charredChair = (p) => {                                // deep-floor remains
    p(new THREE.BoxGeometry(0.42, 0.035, 0.42), roomMat.dark, 0, 0.28, 0.18, 0, 0, 1.35);   // tipped over
    p(new THREE.CylinderGeometry(0.018, 0.018, 0.95, 6), roomMat.dark, -0.24, 0.16, 0.08, 0, 0, 1.2);
    p(new THREE.CylinderGeometry(0.018, 0.018, 0.95, 6), roomMat.dark, 0.18, 0.14, 0.3, 0, 0.4, 1.5);
    p(new THREE.BoxGeometry(0.37, 0.05, 0.02), roomMat.dark, 0.4, 0.025, -0.25, 0.8);       // loose slats
    p(new THREE.BoxGeometry(0.37, 0.05, 0.02), roomMat.dark, -0.45, 0.025, -0.1, 1.9);
  };
  return { sofa, loungeChair, coffeeTable, floorLamp, sideTable, bookcase, metalTable, metalChair,
           bed, nightstand, deskUnit, officeChair, partition, mattress, rolledRug, sheeted, tvSet,
           priceTag, wardrobe, dresser, ladderChair, ladderChairM, cafeTable, filingCab, trunk,
           pictureFrame, garbageBags,
           pallet, drum, cone, tireStack, deadCar, cableSpool, sawhorse, toolClutter, pipeStack,
           debrisHeap, doorLean, charredChair };
})();

/* ---------------- world predicates ----------------
   Layout follows the film: regions of large irregular rooms divided by long
   continuous walls with door openings, vast halls broken by freestanding
   wall slabs, and pillar-field zones — all stitched seamlessly. */
const RG = 16;   // cells per region side (64m regions)
function makeWorld(floor, special) {
  const F = special === 'pools' ? 37 * 7919 + 1 : floor * 7919 + 1;
  const P = paletteFor(floor, special);
  const memTileCache = new Map();
  const regionCache = new Map();

  const SPAWN_TX = Math.floor(SPAWN_CX / 3), SPAWN_TZ = Math.floor(SPAWN_CZ / 3);
  function setRoomAt(tx, tz) {
    if (P.style === 'pools') return null;                 // sublimity is empty of copies
    if (Math.abs(tx - SPAWN_TX) + Math.abs(tz - SPAWN_TZ) < 3) return null;   // never near spawn
    if (siteAt(tx, tz)) return null;
    if (rand(F, tx, tz, 55) > 0.007) return null;
    return ROOM_TYPES[hash(F, tx, tz, 56) % ROOM_TYPES.length];
  }

  function memoryTile(tx, tz) {
    if (!state.memories.length) return null;
    const key = tx + ',' + tz;
    if (memTileCache.has(key)) return memTileCache.get(key);
    let out = null;
    if (Math.abs(tx - SPAWN_TX) + Math.abs(tz - SPAWN_TZ) > 2 && !setRoomAt(tx, tz) && !exitAt(tx, tz) &&
        rand(F, tx, tz, 77) < 0.016 * Math.min(state.memories.length, 10)) {
      out = state.memories[hash(F, tx, tz, 78) % state.memories.length];
    }
    memTileCache.set(key, out);
    return out;
  }

  function regionType(rx, rz) {
    const r = rand(F, 7, rx, rz);
    // every floor needs real rooms: corners, blind turns, things hidden behind walls —
    // open pillar fields are the seasoning, not the meal
    if (P.style === 'garage') return r < 0.18 ? 'pillars' : r < 0.4 ? 'halls' : r < 0.78 ? 'rooms' : 'mixed';
    if (P.style === 'tunnels') return r < 0.75 ? 'rooms' : 'mixed';
    if (P.style === 'pools') return r < 0.6 ? 'halls' : 'pillars';
    if (floor === 0 && rx === 0 && rz === 0) return 'mixed';   // spawn: open hall, long wall, a few pillars
    if (r < 0.06) return 'pits';      // the floor becomes a lattice of square pits
    if (r < 0.42) return 'rooms';     // warren of rooms (like the hand-drawn map)
    if (r < 0.6) return 'halls';      // vast spaces split by one or two long walls
    if (r < 0.76) return 'pillars';   // the classic pillar field
    return 'mixed';
  }

  function lightTint(rx, rz) {       // sickly green zones from the found footage
    if (P.style !== 'lobby') return false;
    if (rx === 0 && rz === 0) return false;
    return rand(F, 18, rx, rz) < 0.08;
  }

  // recursive division: long walls with door gaps, computed per region
  function regionWalls(rx, rz) {
    const k = rx + ',' + rz;
    if (regionCache.has(k)) return regionCache.get(k);
    const v = new Set(), hh = new Set();
    const cfgs = P.style === 'tunnels'
      ? { rooms: [5, 0.06], halls: [2, 0.2], mixed: [3, 0.18], pillars: [0, 1], pits: [0, 1] }   // claustrophobic warren
      : P.style === 'garage'
      ? { rooms: [4, 0.10], halls: [2, 0.3], mixed: [3, 0.16], pillars: [0, 1], pits: [0, 1] }   // storage bays carved from the deck
      : { rooms: [5, 0.08], halls: [2, 0.24], mixed: [3, 0.2], pillars: [0, 1], pits: [0, 1] };
    const cfg = cfgs[regionType(rx, rz)];
    let salt = 1000;
    const R = () => rand(F, 9, rx, rz, salt++);
    (function divide(x0, z0, x1, z1, depth) {
      const w = x1 - x0, d = z1 - z0;
      if (depth <= 0 || (w < 4 && d < 4) || R() < cfg[1]) return;
      let axis = w > d ? 'x' : d > w ? 'z' : (R() < 0.5 ? 'x' : 'z');
      if (axis === 'x' && w < 4) axis = 'z';
      if (axis === 'z' && d < 4) axis = 'x';
      const doorsOf = (lo, span) => {
        const n = 1 + (R() < 0.6 ? 1 : 0);
        const out = [];
        for (let i = 0; i < n; i++) out.push(lo + Math.floor(R() * span));
        return out;
      };
      if (axis === 'x') {
        const sx = x0 + 2 + Math.floor(R() * (w - 3));
        const doors = doorsOf(z0, d);
        for (let z = z0; z < z1; z++) if (!doors.includes(z)) v.add((rx * RG + sx) + ',' + (rz * RG + z));
        divide(x0, z0, sx, z1, depth - 1);
        divide(sx, z0, x1, z1, depth - 1);
      } else {
        const sz = z0 + 2 + Math.floor(R() * (d - 3));
        const doors = doorsOf(x0, w);
        for (let x = x0; x < x1; x++) if (!doors.includes(x)) hh.add((rx * RG + x) + ',' + (rz * RG + sz));
        divide(x0, z0, x1, sz, depth - 1);
        divide(x0, sz, x1, z1, depth - 1);
      }
    })(0, 0, RG, RG, cfg[0]);
    // open regions get freestanding wall fragments — short runs and L-corners that
    // break sightlines, so even a pillar field makes you turn and wonder
    const ty = regionType(rx, rz);
    if (P.style !== 'pools' && (ty === 'pillars' || ty === 'halls')) {
      const n = ty === 'pillars' ? 4 : 3;
      for (let i = 0; i < n; i++) {
        const len = 2 + Math.floor(R() * 3);
        const alongZ = R() < 0.5;
        const sx2 = 2 + Math.floor(R() * (RG - len - 4));
        const sz2 = 2 + Math.floor(R() * (RG - len - 4));
        for (let j = 0; j < len; j++) {
          if (alongZ) v.add((rx * RG + sx2) + ',' + (rz * RG + sz2 + j));
          else hh.add((rx * RG + sx2 + j) + ',' + (rz * RG + sz2));
        }
        if (R() < 0.55) {                      // turn the corner
          const l2 = 1 + Math.floor(R() * 2);
          const flip = R() < 0.5 ? 0 : len;
          const dir = R() < 0.5 ? -1 : 1;
          for (let j = 0; j < l2; j++) {
            if (alongZ) hh.add((rx * RG + sx2 + dir * j) + ',' + (rz * RG + sz2 + flip));
            else v.add((rx * RG + sx2 + flip) + ',' + (rz * RG + sz2 + dir * j));
          }
        }
      }
    }
    const out = { v, h: hh };
    regionCache.set(k, out);
    return out;
  }

  // walls on region boundaries — same answer from both sides
  const openTypes = new Set(['halls', 'pillars', 'pits']);
  function boundaryV(x, z) {
    const rx = x / RG, rz = Math.floor(z / RG);
    const ta = regionType(rx - 1, rz), tb = regionType(rx, rz);
    if (ta === 'pits' || tb === 'pits') return false;      // the pits open straight onto the maze
    if (openTypes.has(ta) || openTypes.has(tb)) {
      return rand(F, 11, x, Math.floor(z / 3)) < 0.35;     // fragmented freestanding slabs
    }
    const lz = mod(z, RG);
    return lz !== hash(F, 12, rx, rz) % RG && lz !== hash(F, 13, rx, rz) % RG;
  }
  function boundaryH(x, z) {
    const rz = z / RG, rx = Math.floor(x / RG);
    const ta = regionType(rx, rz - 1), tb = regionType(rx, rz);
    if (ta === 'pits' || tb === 'pits') return false;
    if (openTypes.has(ta) || openTypes.has(tb)) {
      return rand(F, 14, Math.floor(x / 3), z) < 0.35;
    }
    const lx = mod(x, RG);
    return lx !== hash(F, 15, rx, rz) % RG && lx !== hash(F, 16, rx, rz) % RG;
  }

  // the a-sync site: one per floor, far out, several rooms' worth of open space
  const siteA = (P.style === 'pools') ? null : (() => {
    const a = rand(F, 61) * Math.PI * 2;
    const d = 13 + rand(F, 62) * 7;   // 13-20 tiles ≈ 160-240m from spawn
    return { tx: Math.round(Math.cos(a) * d), tz: Math.round(Math.sin(a) * d) };
  })();
  const siteAt = (tx, tz) =>
    !!siteA && tx >= siteA.tx && tx <= siteA.tx + 1 && tz >= siteA.tz && tz <= siteA.tz + 1;

  // the green door: one per floor on levels 0-2 — the way out
  const exitSpot = (P.style === 'pools' || floor > 2) ? (() => null)() : (() => {
    const a = rand(F, 66) * Math.PI * 2;
    const d = 14 + rand(F, 67) * 8;   // 14-22 tiles ≈ 170-260m out
    let tx = Math.round(Math.cos(a) * d), tz = Math.round(Math.sin(a) * d);
    if (siteA && Math.abs(tx - siteA.tx) < 4 && Math.abs(tz - siteA.tz) < 4) { tx += 6; tz -= 6; }
    return { tx, tz };
  })();
  const exitAt = (tx, tz) => !!exitSpot && tx === exitSpot.tx && tz === exitSpot.tz;

  const carvedAt = (cx, cz) => {
    const tx = Math.floor(cx / 3), tz = Math.floor(cz / 3);
    return siteAt(tx, tz) || exitAt(tx, tz) || !!setRoomAt(tx, tz) || !!memoryTile(tx, tz);
  };
  function hasWallV(x, z) {    // thin wall between cells (x-1,z) and (x,z)
    if (carvedAt(x - 1, z) || carvedAt(x, z)) return false;
    if (occupied(x - 1, z) || occupied(x, z)) return false;
    if (mod(x, RG) === 0) return boundaryV(x, z);
    return regionWalls(Math.floor(x / RG), Math.floor(z / RG)).v.has(x + ',' + z);
  }
  function hasWallH(x, z) {    // thin wall between cells (x,z-1) and (x,z)
    if (carvedAt(x, z - 1) || carvedAt(x, z)) return false;
    if (occupied(x, z - 1) || occupied(x, z)) return false;
    if (mod(z, RG) === 0) return boundaryH(x, z);
    return regionWalls(Math.floor(x / RG), Math.floor(z / RG)).h.has(x + ',' + z);
  }

  function occupied(cx, cz) {  // solid wallpaper columns, only in pillar zones
    if (P.style === 'pools' || P.style === 'garage') return false;   // those use slender columns
    const t = regionType(Math.floor(cx / RG), Math.floor(cz / RG));
    if (t !== 'pillars' && t !== 'mixed') return false;
    if (mod(cx, 2) !== 0 || mod(cz, 2) !== 0) return false;
    if (floor === 0 && Math.abs(cx - SPAWN_CX) < 2 && Math.abs(cz - SPAWN_CZ) < 2) return false;
    if (carvedAt(cx, cz)) return false;
    return rand(F, cx, cz, 1) < (t === 'pillars' ? 0.85 : 0.16);
  }

  function slimColumn(cx, cz) {   // slender structural columns (pools & the garage)
    if (P.style !== 'pools' && P.style !== 'garage') return false;
    if (mod(cx, 2) !== 0 || mod(cz, 2) !== 0) return false;
    if (carvedAt(cx, cz)) return false;
    return rand(F, cx, cz, 46) < (P.style === 'garage' ? 0.92 : 0.7);
  }

  function blackout(rx, rz) {     // whole regions where the lights are dead
    if (P.style === 'garage' || P.style === 'pools') return false;
    if (floor === 0 && rx === 0 && rz === 0) return false;
    return rand(F, 17, rx, rz) < 0.13;
  }

  function stairsAt(cx, cz) {     // a dark staircase, going down
    if (P.style === 'pools') return false;
    if (Math.abs(cx - SPAWN_CX) + Math.abs(cz - SPAWN_CZ) < 8) return false;
    if (occupied(cx, cz) || isHole(cx, cz) || isMound(cx, cz) || carvedAt(cx, cz) || slimColumn(cx, cz)) return false;
    if (inPitsRegion(cx, cz)) return false;
    return rand(F, cx, cz, 59) < 0.0035;
  }

  const FIND_TYPES = ['tape', 'almond', 'note', 'radio', 'camera', 'camp'];
  function findAt(cx, cz) {       // things the ones before left behind
    if (Math.abs(cx - SPAWN_CX) + Math.abs(cz - SPAWN_CZ) < 10) return null;
    if (occupied(cx, cz) || isHole(cx, cz) || isMound(cx, cz) || carvedAt(cx, cz) || slimColumn(cx, cz)) return null;
    if (stairsAt(cx, cz)) return null;
    if (rand(F, cx, cz, 52) > 0.0015) return null;
    return FIND_TYPES[hash(F, cx, cz, 53) % FIND_TYPES.length];
  }

  const inPitsRegion = (cx, cz) =>
    regionType(Math.floor(cx / RG), Math.floor(cz / RG)) === 'pits';

  function furniturePile(cx, cz) {   // set dressing per floor: showroom stock, garage junk, works clutter, decay
    if (P.style === 'pools') return false;              // the sublimity stays empty
    if (occupied(cx, cz) || carvedAt(cx, cz) || slimColumn(cx, cz) || isHole(cx, cz) || isMound(cx, cz)) return false;
    if (stairsAt(cx, cz) || doorUp(cx, cz) || inPitsRegion(cx, cz) || findAt(cx, cz)) return false;
    const tx2 = Math.floor(cx / 3), tz2 = Math.floor(cz / 3);
    if (setRoomAt(tx2, tz2) || memoryTile(tx2, tz2)) return false;
    if (siteA && Math.abs(tx2 - siteA.tx) < 2 && Math.abs(tz2 - siteA.tz) < 2) return false;
    if (exitSpot && Math.abs(tx2 - exitSpot.tx) < 2 && Math.abs(tz2 - exitSpot.tz) < 2) return false;
    let density;
    if (P.style === 'lobby') {       // the showroom: jumbled stacks, densest near where you wake
      const dSpawn = Math.max(Math.abs(cx - SPAWN_CX), Math.abs(cz - SPAWN_CZ));
      if (dSpawn < 2) return false;                     // keep the waking spot itself clear
      density = dSpawn < 10 ? 0.17 : dSpawn < 22 ? 0.05 : 0.015;
    } else if (P.style === 'garage') density = 0.05;
    else if (P.style === 'tunnels') density = 0.045;
    else if (P.style === 'deep') density = 0.035;
    else return false;
    return rand(F, cx, cz, 137) < density;
  }

  function doorPlugAt(cx, cz) {      // 0 none, 1 plug in the x-running wall line at z=cz, 2 in the z-running line at x=cx
    if (P.style !== 'lobby') return 0;
    if (Math.max(Math.abs(cx - SPAWN_CX), Math.abs(cz - SPAWN_CZ)) < 4) return 0;
    const tx2 = Math.floor(cx / 3), tz2 = Math.floor(cz / 3);
    if (exitSpot && Math.abs(tx2 - exitSpot.tx) < 2 && Math.abs(tz2 - exitSpot.tz) < 2) return 0;
    if (siteA && Math.abs(tx2 - siteA.tx) < 2 && Math.abs(tz2 - siteA.tz) < 2) return 0;
    const bad = (ax, az) =>
      occupied(ax, az) || carvedAt(ax, az) || isHole(ax, az) || isMound(ax, az) ||
      stairsAt(ax, az) || doorUp(ax, az) || inPitsRegion(ax, az) || !!findAt(ax, az) ||
      !!setRoomAt(Math.floor(ax / 3), Math.floor(az / 3)) || !!memoryTile(Math.floor(ax / 3), Math.floor(az / 3));
    // a doorway = the gap cell of an otherwise continuous wall line (film: plug 1 in ~4 exits)
    if (hasWallH(cx - 1, cz) && hasWallH(cx + 1, cz) && !hasWallH(cx, cz) &&
        !bad(cx, cz) && !bad(cx, cz - 1) && rand(F, cx, cz, 171) < 0.22) return 1;
    if (hasWallV(cx, cz - 1) && hasWallV(cx, cz + 1) && !hasWallV(cx, cz) &&
        !bad(cx, cz) && !bad(cx - 1, cz) && rand(F, cx, cz, 172) < 0.22) return 2;
    return 0;
  }

  function holePile(cx, cz) {        // furniture heaped over a floor opening, crawl gap left (f0209)
    if (P.style !== 'lobby') return false;
    if (!isHole(cx, cz) || inPitsRegion(cx, cz)) return false;
    return rand(F, cx, cz, 173) < 0.1;
  }

  function litterAt(cx, cz) {        // ambient floor junk: tapes, papers, bottles
    if (P.style === 'pools') return false;
    if (occupied(cx, cz) || carvedAt(cx, cz) || isHole(cx, cz) || inPitsRegion(cx, cz)) return false;
    if (setRoomAt(Math.floor(cx / 3), Math.floor(cz / 3))) return false;
    return rand(F, cx, cz, 141) < (furniturePile(cx, cz) ? 0.5 : 0.05);
  }

  function isHole(cx, cz) {
    if (occupied(cx, cz) || carvedAt(cx, cz)) return false;
    if (floor === 0 && Math.abs(cx - SPAWN_CX) + Math.abs(cz - SPAWN_CZ) < 7) return false;
    if (inPitsRegion(cx, cz)) {
      // the pitfalls: a full lattice of square pits with carpet bridges
      return mod(cx, RG) !== 0 && mod(cz, RG) !== 0;
    }
    return rand(F, cx, cz, 5) < P.holes;
  }

  // torn floor panel: square-ish like the film, with ragged edges
  function holeShape(cx, cz) {
    if (inPitsRegion(cx, cz)) {
      // pit lattice: clean centered squares, near-identical, machine-made
      const j = [];
      for (let i = 0; i < 16; i++) j.push(0.97 + rand(F, cx, cz, 30 + i) * 0.05);
      return {
        hx: (cx + 0.5) * CELL, hz: (cz + 0.5) * CELL,
        hw: 1.3, hd: 1.3, j, rmax: Math.hypot(1.3, 1.3) * 1.03, rmin: 1.3 * 0.97,
      };
    }
    const hx = (cx + 0.5) * CELL + (rand(F, cx, cz, 28) - 0.5) * 0.7;
    const hz = (cz + 0.5) * CELL + (rand(F, cx, cz, 29) - 0.5) * 0.7;
    const hw = 0.85 + rand(F, cx, cz, 26) * 0.45;   // half extents of the broken slab
    const hd = 0.85 + rand(F, cx, cz, 27) * 0.45;
    const j = [];
    for (let i = 0; i < 16; i++) j.push(0.84 + rand(F, cx, cz, 30 + i) * 0.3);
    const rmax = Math.hypot(hw, hd) * 1.14;
    return { hx, hz, hw, hd, j, rmax, rmin: Math.min(hw, hd) * 0.84 };
  }
  function holeRadiusAt(s, ang) {
    const c = Math.abs(Math.cos(ang)), si = Math.abs(Math.sin(ang));
    const rect = Math.min(s.hw / Math.max(c, 1e-4), s.hd / Math.max(si, 1e-4));
    const a = (((ang % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * 16;
    const i = Math.floor(a) % 16, f = a - Math.floor(a);
    return rect * (s.j[i] * (1 - f) + s.j[(i + 1) % 16] * f);
  }

  function isMound(cx, cz) {
    if (P.style !== 'lobby') return false;
    if (occupied(cx, cz) || isHole(cx, cz) || carvedAt(cx, cz)) return false;
    if (Math.abs(cx - SPAWN_CX) + Math.abs(cz - SPAWN_CZ) < 6) return false;
    return rand(F, cx, cz, 40) < 0.004;
  }
  function moundShape(cx, cz) {
    return {
      mx: (cx + 0.5) * CELL, mz: (cz + 0.5) * CELL,
      h: 0.55 + rand(F, cx, cz, 41) * 0.45, r: 1.85,
      chair: rand(F, cx, cz, 42) < 0.6,
    };
  }

  function isLight(cx, cz) {
    if (occupied(cx, cz)) return false;
    const rx = Math.floor(cx / RG), rz = Math.floor(cz / RG);
    if (blackout(rx, rz)) return false;
    if (mod(cx + cz, 2) !== 0) return false;
    const dens = lightTint(rx, rz) ? P.lightDensity * 0.4 : P.lightDensity;   // green zones: sparse pools
    return rand(F, cx, cz, 6) < dens;
  }

  function doorUp(cx, cz) { // glowing threshold that takes you up one floor
    if (floor === 0) return false;
    if (occupied(cx, cz) || isHole(cx, cz) || isMound(cx, cz) || carvedAt(cx, cz)) return false;
    if (inPitsRegion(cx, cz)) return false;
    return rand(F, cx, cz, 9) < 0.0045;
  }

  return {
    F, P, occupied, isHole, isLight, doorUp, memoryTile, setRoomAt,
    hasWallV, hasWallH, holeShape, holeRadiusAt, isMound, moundShape, regionType,
    slimColumn, blackout, findAt, siteA, siteAt, exitSpot, stairsAt, lightTint, inPitsRegion,
    furniturePile, litterAt, doorPlugAt, holePile,
    clearMemCache: () => memTileCache.clear(),
  };
}

/* ---------------- renderer / scene ---------------- */
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('view'), antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 220);
camera.rotation.order = 'YXZ';

const hemi = new THREE.HemisphereLight(0xfff3cf, 0x9a8850, 1.0);
scene.add(hemi);
const amb = new THREE.AmbientLight(0x8a7c50, 0.5);
scene.add(amb);
const playerLight = new THREE.PointLight(0xfff0c8, 14, 16, 1.8);
scene.add(playerLight);

// flashlight (C) — a tight warm cone with a soft edge
let flashOn = false;
const flashlight = new THREE.SpotLight(0xfff0cc, 0, 30, 0.46, 0.5, 1.5);
flashlight.target = new THREE.Object3D();
scene.add(flashlight);
scene.add(flashlight.target);
const flashAim = new THREE.Vector3(0, 1.5, -10);   // lagged aim point for hand sway

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

/* ---------------- geometry builder ---------------- */
function makeBuffers() { return { pos: [], nor: [], uv: [], col: [] }; }
function quad(b, p1, p2, p3, p4, n, uvs, cols) {
  // two triangles: p1 p2 p3 / p1 p3 p4 (material is DoubleSide; normals drive lighting)
  const order = [0, 1, 2, 0, 2, 3];
  const pts = [p1, p2, p3, p4];
  for (const i of order) {
    b.pos.push(pts[i][0], pts[i][1], pts[i][2]);
    b.nor.push(n[0], n[1], n[2]);
    b.uv.push(uvs[i][0], uvs[i][1]);
    const c = cols[i];
    b.col.push(c[0], c[1], c[2]);
  }
}
function buffersToMesh(b, mat) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
  return new THREE.Mesh(g, mat);
}

/* ---------------- per-floor materials ---------------- */
let world = null;
let mats = null;   // {wall, floor, ceil, panel, dark, tex}
let chunks = new Map();

function makeMaterials(P) {
  const tex = makeTextures(P);
  return {
    tex,
    wall: new THREE.MeshLambertMaterial({ map: tex.wall, vertexColors: true, side: THREE.DoubleSide }),
    wall2: new THREE.MeshLambertMaterial({ map: tex.wall2, vertexColors: true, side: THREE.DoubleSide }),
    column: new THREE.MeshLambertMaterial({ map: tex.wall }),   // no vertex colors: plain geometry
    pipe: new THREE.MeshLambertMaterial({ color: 0x3c3a35, vertexColors: true, side: THREE.DoubleSide }),
    water: new THREE.MeshBasicMaterial({
      map: tex.water, color: 0x8fd8c4, transparent: true, opacity: 0.4, side: THREE.DoubleSide,
    }),
    floor: new THREE.MeshLambertMaterial({ map: tex.floor, vertexColors: true, side: THREE.DoubleSide }),
    ceil: new THREE.MeshLambertMaterial({ map: tex.ceil, vertexColors: true, side: THREE.DoubleSide }),
    panel: (() => {
      const m = new THREE.MeshBasicMaterial({ map: tex.panel, side: THREE.DoubleSide, fog: false, vertexColors: true });
      m.color.setScalar(1.35);   // overdriven, ACES rolls it off like blown-out fluorescents
      return m;
    })(),
    dark: new THREE.MeshLambertMaterial({ color: 0x0a0805, side: THREE.DoubleSide }),
    still: new THREE.MeshLambertMaterial({ color: 0x16120d }),
    trim: new THREE.MeshLambertMaterial({ color: P.wallDark, vertexColors: true }),        // baseboards
    frame: new THREE.MeshLambertMaterial({ color: P.ceilLine, vertexColors: true, side: THREE.DoubleSide }),  // troffer surrounds
    aoStrip: new THREE.MeshBasicMaterial({ map: aoGradTex, transparent: true, depthWrite: false }),
  };
}
function disposeMaterials(m) {
  if (!m) return;
  for (const t of Object.values(m.tex)) t.dispose();
  for (const k of ['wall', 'wall2', 'column', 'pipe', 'water', 'floor', 'ceil', 'panel', 'dark', 'still', 'trim', 'frame', 'aoStrip']) m[k].dispose();
}

/* ---------------- chunk building ---------------- */
const MEM_TINT = [0.74, 0.80, 0.98];   // wrongly-copied rooms read cold blue
const GREEN_CAST = [0.36, 0.62, 0.22]; // sickly green zones: dark, with green pooling under the panels
function tintFor(cx, cz) {
  const mt = world.memoryTile(Math.floor(cx / 3), Math.floor(cz / 3));
  if (mt) return MEM_TINT;
  if (world.lightTint(Math.floor(cx / RG), Math.floor(cz / RG))) return GREEN_CAST;
  return null;
}

function buildChunk(ccx, ccz) {
  const group = new THREE.Group();
  const W = makeBuffers(), W2 = makeBuffers(), FL = makeBuffers(), CE = makeBuffers(),
    PA = makeBuffers(), DK = makeBuffers(), PI = makeBuffers(), WT = makeBuffers(),
    TR = makeBuffers(), FR = makeBuffers(), AO = makeBuffers();   // baseboards, troffer frames, contact shadows
  const wallFaces = [];   // {x, y, z, nx, nz} candidate spots for memory writing
  const chunk = { group, flickers: [], frames: [], doors: [], owned: [], colliders: [], finds: [], exits: [], stairs: [], statics: [], watchRooms: [] };
  const F = world.F;
  const style = world.P.style;
  // construction-detail constants: real baseboards on papered floors, contact shadows everywhere
  const WOOD = style === 'lobby' || style === 'deep';
  const BBH = 0.13, BBD = 0.12 + 0.042, AOW = 0.34, AOC = 0.26;
  // chevron-vs-ogee wallpaper varies by region on carpet floors
  const wallBufFor = (cx, cz) =>
    (style === 'lobby' || style === 'deep') &&
    rand(F, 8, Math.floor(cx / RG), Math.floor(cz / RG)) < 0.4 ? W2 : W;

  // baked light pooling: surfaces brighten under panels, sink between them
  const poolCache = new Map();
  const lightPool = (x, z) => {
    const k = ((x * 4) | 0) + ':' + ((z * 4) | 0);
    let v = poolCache.get(k);
    if (v !== undefined) return v;
    const cx0 = Math.floor(x / CELL), cz0 = Math.floor(z / CELL);
    let p = 0;
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      if (!world.isLight(cx0 + dx, cz0 + dz)) continue;
      const d = Math.hypot((cx0 + dx + 0.5) * CELL - x, (cz0 + dz + 0.5) * CELL - z);
      p += Math.max(0, 1 - d / 8);
    }
    v = 0.58 + Math.min(0.6, p * 0.55);
    poolCache.set(k, v);
    return v;
  };

  for (let lx = 0; lx < CHUNK; lx++) for (let lz = 0; lz < CHUNK; lz++) {
    const cx = ccx * CHUNK + lx, cz = ccz * CHUNK + lz;
    if (world.occupied(cx, cz)) continue;
    const x0 = cx * CELL, x1 = x0 + CELL, z0 = cz * CELL, z1 = z0 + CELL;
    const tint = tintFor(cx, cz);
    const base = tint || [1, 1, 1];
    const hole = world.isHole(cx, cz);

    // ambient-occlusion-ish corner darkening for the floor/ceiling
    const aoAt = (px, pz) => {
      const ox = px === x0 ? -1 : 1, oz = pz === z0 ? -1 : 1;
      let occ = 0;
      if (world.occupied(cx + ox, cz)) occ++;
      if (world.occupied(cx, cz + oz)) occ++;
      if (world.occupied(cx + ox, cz + oz)) occ++;
      let f = occ ? 0.82 : 1.0;
      // corners tucked against thin walls darken too — grounds the rooms
      const wx = px === x0 ? cx : cx + 1, wz = pz === z0 ? cz : cz + 1;
      if (world.hasWallV(wx, cz) || world.hasWallH(cx, wz)) f *= 0.9;
      return f;
    };
    const cornerCol = (px, pz, mul) => {
      const a = aoAt(px, pz) * mul * lightPool(px, pz);
      return [base[0] * a, base[1] * a, base[2] * a];
    };

    if (!hole) {
      quad(FL,
        [x0, 0, z0], [x0, 0, z1], [x1, 0, z1], [x1, 0, z0],
        [0, 1, 0],
        [[x0 / 1.2, z0 / 1.2], [x0 / 1.2, z1 / 1.2], [x1 / 1.2, z1 / 1.2], [x1 / 1.2, z0 / 1.2]],
        [cornerCol(x0, z0, 1), cornerCol(x0, z1, 1), cornerCol(x1, z1, 1), cornerCol(x1, z0, 1)]);
      if (style === 'pools') {   // still green water over the tile
        quad(WT,
          [x0, 0.24, z0], [x0, 0.24, z1], [x1, 0.24, z1], [x1, 0.24, z0],
          [0, 1, 0],
          [[x0 / 3, z0 / 3], [x0 / 3, z1 / 3], [x1 / 3, z1 / 3], [x1 / 3, z0 / 3]],
          [[1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1]]);
      }
    } else {
      // torn floor panel: square-ish like the film, ragged charred edges, dark drop
      const s = world.holeShape(cx, cz);
      const D = -6;
      const SEGS = 16;
      const segPts = [];
      for (let i = 0; i <= SEGS; i++) {
        const ang = (i % SEGS) * Math.PI * 2 / SEGS;
        const r = world.holeRadiusAt(s, ang);
        const dxa = Math.cos(ang), dza = Math.sin(ang);
        // cell-boundary point of the ray (covers the whole cell with floor ring)
        let t = 1e9;
        if (dxa > 1e-6) t = Math.min(t, (x1 - s.hx) / dxa);
        if (dxa < -1e-6) t = Math.min(t, (x0 - s.hx) / dxa);
        if (dza > 1e-6) t = Math.min(t, (z1 - s.hz) / dza);
        if (dza < -1e-6) t = Math.min(t, (z0 - s.hz) / dza);
        segPts.push({
          px: s.hx + dxa * r, pz: s.hz + dza * r,
          sx: s.hx + dxa * t, sz: s.hz + dza * t,
        });
      }
      const charred = [0.42, 0.38, 0.32];
      for (let i = 0; i < SEGS; i++) {
        const a = segPts[i], b2 = segPts[i + 1];
        quad(FL,
          [a.sx, 0, a.sz], [b2.sx, 0, b2.sz], [b2.px, 0, b2.pz], [a.px, 0, a.pz],
          [0, 1, 0],
          [[a.sx / 1.2, a.sz / 1.2], [b2.sx / 1.2, b2.sz / 1.2], [b2.px / 1.2, b2.pz / 1.2], [a.px / 1.2, a.pz / 1.2]],
          [base, base, charred, charred]);
        const mid = (i + 0.5) * Math.PI * 2 / SEGS;
        // lit upper shaft fading to black below — the pit reads as a void, not a decal
        const rimTop = [base[0] * 0.62, base[1] * 0.58, base[2] * 0.5];
        quad(FL,
          [a.px, 0, a.pz], [b2.px, 0, b2.pz], [b2.px, -1.1, b2.pz], [a.px, -1.1, a.pz],
          [-Math.cos(mid), 0, -Math.sin(mid)],
          [[i * 0.6, 0], [(i + 1) * 0.6, 0], [(i + 1) * 0.6, 0.9], [i * 0.6, 0.9]],
          [rimTop, rimTop, [0.03, 0.03, 0.03], [0.03, 0.03, 0.03]]);
        quad(DK,
          [a.px, -1.1, a.pz], [b2.px, -1.1, b2.pz], [b2.px, D, b2.pz], [a.px, D, a.pz],
          [-Math.cos(mid), 0, -Math.sin(mid)],
          [[0, 0], [1, 0], [1, 1], [0, 1]],
          [[0.03, 0.03, 0.03], [0.03, 0.03, 0.03], [0.01, 0.01, 0.01], [0.01, 0.01, 0.01]]);
      }
    }

    // carpet mound (sometimes with the chair)
    if (world.isMound(cx, cz)) {
      const m = world.moundShape(cx, cz);
      const SEG = 16, fr = [0, 0.22, 0.45, 0.68, 0.85, 1.0];
      const hAt = (f) => f >= 1 ? 0.012 : m.h * Math.pow(1 - f * f, 1.5);
      const nAt = (f, a) => {   // surface normal from the dome's slope
        const fm = Math.min(f, 0.98);
        const slope = 3 * m.h * fm * Math.sqrt(Math.max(0, 1 - fm * fm)) / m.r;
        const nx = slope * Math.cos(a), nz = slope * Math.sin(a);
        const l = Math.hypot(nx, 1, nz);
        return [nx / l, 1 / l, nz / l];
      };
      for (let j = 1; j < fr.length; j++) {
        for (let i = 0; i < SEG; i++) {
          const a0 = i * 2 * Math.PI / SEG, a1 = (i + 1) * 2 * Math.PI / SEG;
          const p = (f, a) => [m.mx + Math.cos(a) * f * m.r, hAt(f), m.mz + Math.sin(a) * f * m.r];
          const P1 = p(fr[j - 1], a0), P2 = p(fr[j - 1], a1), P3 = p(fr[j], a1), P4 = p(fr[j], a0);
          const shade = 1.06 - ((fr[j - 1] + fr[j]) / 2) * 0.2;
          const c = [base[0] * shade, base[1] * shade, base[2] * shade];
          quad(FL, P1, P2, P3, P4, nAt((fr[j - 1] + fr[j]) / 2, (a0 + a1) / 2),
            [[P1[0] / 1.2, P1[2] / 1.2], [P2[0] / 1.2, P2[2] / 1.2], [P3[0] / 1.2, P3[2] / 1.2], [P4[0] / 1.2, P4[2] / 1.2]],
            [c, c, c, c]);
        }
      }
      if (m.chair) {
        const top = m.h;
        const cb = (w, h2, d, lx, y, lz, rz = 0) => {
          const geo = new THREE.BoxGeometry(w, h2, d);
          const mesh = new THREE.Mesh(geo, roomMat.plastic);
          mesh.position.set(m.mx + lx, top + y, m.mz + lz);
          mesh.rotation.z = rz;
          group.add(mesh);
          chunk.owned.push(geo);
        };
        cb(0.04, 0.44, 0.04, -0.17, 0.22, -0.15); cb(0.04, 0.44, 0.04, 0.17, 0.22, -0.15);
        cb(0.04, 0.44, 0.04, -0.17, 0.22, 0.15); cb(0.04, 0.44, 0.04, 0.17, 0.22, 0.15);
        cb(0.42, 0.05, 0.4, 0, 0.46, 0);
        cb(0.42, 0.48, 0.05, 0, 0.72, -0.19, 0.05);
      }
    }

    // ceiling (texture repeats once per cell quarter => 1m tiles)
    quad(CE,
      [x0, H, z0], [x1, H, z0], [x1, H, z1], [x0, H, z1],
      [0, -1, 0],
      [[x0, z0], [x1, z0], [x1, z1], [x0, z1]],
      [cornerCol(x0, z0, 0.92), cornerCol(x1, z0, 0.92), cornerCol(x1, z1, 0.92), cornerCol(x0, z1, 0.92)]);

    // slender structural columns (pools & the garage) — with footing and head plate
    if (world.slimColumn(cx, cz)) {
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      const sz2 = style === 'garage' ? 0.75 : 1.05;
      const geo = new THREE.BoxGeometry(sz2, H, sz2);
      const col = new THREE.Mesh(geo, mats.column);
      col.position.set(mx, H / 2, mz);
      group.add(col);
      const pg = new THREE.BoxGeometry(sz2 + 0.18, 0.22, sz2 + 0.18);   // concrete footing
      const plinth = new THREE.Mesh(pg, mats.column);
      plinth.position.set(mx, 0.11, mz);
      group.add(plinth);
      const hg = new THREE.BoxGeometry(sz2 + 0.14, 0.14, sz2 + 0.14);   // head plate under the slab
      const head = new THREE.Mesh(hg, mats.column);
      head.position.set(mx, H - 0.07, mz);
      group.add(head);
      const e = sz2 / 2 + 0.02;
      chunk.colliders.push({ minX: mx - e, maxX: mx + e, minZ: mz - e, maxZ: mz + e });
      chunk.owned.push(geo, pg, hg);
    }

    // things left behind, waiting to be found — and the showroom's jumbled stock
    const findType = world.findAt(cx, cz);
    if (findType) buildFind(findType, cx, cz, chunk, group);
    else if (world.furniturePile(cx, cz)) buildFurniturePile(cx, cz, chunk, group);
    if (!hole && world.litterAt(cx, cz)) buildLitter(cx, cz, chunk, group);
    const plugAxis = world.doorPlugAt(cx, cz);
    if (plugAxis) buildDoorPlug(cx, cz, plugAxis, chunk, group);
    if (hole && world.holePile(cx, cz)) buildHolePile(cx, cz, chunk, group);

    // a dark staircase, going down
    if (world.stairsAt(cx, cz)) buildStairwell(cx, cz, chunk, group);

    // decay in the blacked-out regions: debris and damp
    if (!hole && (style === 'lobby' || style === 'deep') &&
        world.blackout(Math.floor(cx / RG), Math.floor(cz / RG)) &&
        !world.occupied(cx, cz) && rand(F, cx, cz, 86) < 0.05) {
      const dx2 = (cx + 0.5) * CELL + (rand(F, cx, cz, 87) - 0.5) * 2;
      const dz2 = (cz + 0.5) * CELL + (rand(F, cx, cz, 88) - 0.5) * 2;
      const cg = new THREE.BoxGeometry(1.2, 0.025, 0.8);
      const card = new THREE.Mesh(cg, roomMat.cardboard);
      card.position.set(dx2, 0.013, dz2);
      card.rotation.y = rand(F, cx, cz, 89) * 6.28;
      group.add(card);
      chunk.owned.push(cg);
      if (rand(F, cx, cz, 90) < 0.4) {     // an overturned chair
        const chg = new THREE.BoxGeometry(0.45, 0.06, 0.42);
        const ch = new THREE.Mesh(chg, roomMat.fabric2);
        ch.position.set(dx2 + 0.8, 0.25, dz2 + 0.4);
        ch.rotation.set(Math.PI / 2.2, rand(F, cx, cz, 93) * 3, 0.4);
        group.add(ch);
        const lg2 = new THREE.BoxGeometry(0.05, 0.5, 0.05);
        for (let li = 0; li < 3; li++) {
          const leg = new THREE.Mesh(lg2, roomMat.fabric2);
          leg.position.set(dx2 + 0.6 + li * 0.16, 0.3, dz2 + 0.55);
          leg.rotation.z = 1.1 + li * 0.25;
          group.add(leg);
        }
        chunk.owned.push(chg, lg2);
      }
    }

    // the a-sync site (anchor cell builds the whole installation)
    if (world.siteA && cx === world.siteA.tx * 3 && cz === world.siteA.tz * 3) {
      buildAsyncSite(chunk, group);
    }

    // the green door (anchor cell builds it)
    if (world.exitSpot && cx === world.exitSpot.tx * 3 && cz === world.exitSpot.tz * 3) {
      buildExitDoor(chunk, group);
    }

    // garage / tunnels: standing water on the floor
    if ((style === 'garage' || style === 'tunnels') && !hole && rand(F, cx, cz, 47) < 0.08) {
      const pg = new THREE.CircleGeometry(0.7 + rand(F, cx, cz, 48) * 0.9, 14);
      const pm = new THREE.Mesh(pg, puddleMat);
      pm.rotation.x = -Math.PI / 2;
      pm.position.set(x0 + 1 + rand(F, cx, cz, 49) * 2, 0.015, z0 + 1 + rand(F, cx, cz, 50) * 2);
      group.add(pm);
      chunk.owned.push(pg);
    }

    // fluorescent panel
    if (world.isLight(cx, cz)) {
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      const alongX = mod(cz, 3) === 2 ? true : (mod(cx, 3) === 2 ? false : (hash(F, cx, cz, 13) & 1) === 0);
      let hw = alongX ? 1.35 : 0.55, hd = alongX ? 0.55 : 1.35;
      if (style === 'garage' || style === 'tunnels') { hw = alongX ? 1.5 : 0.1; hd = alongX ? 0.1 : 1.5; }  // bare tubes
      if (style === 'pools') { hw = 0.95; hd = 0.95; }                                                      // soft skylights
      const drop = 0.085;                       // troffer protrudes: glowing sides read at distance
      const y = H - drop;
      const greenZone = world.lightTint(Math.floor(cx / RG), Math.floor(cz / RG));
      const lc = greenZone ? [0.26, 1.1, 0.18] : [1, 1, 1];
      // soft halo under the panel — fluorescents glow instead of being flat decals
      const sm = new THREE.SpriteMaterial({
        map: glowTex, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, opacity: greenZone ? 0.34 : 0.26,
      });
      if (greenZone) sm.color.setRGB(0.45, 1, 0.35);
      else sm.color.setRGB(1, 0.95, 0.78);
      const halo = new THREE.Sprite(sm);
      halo.scale.set(Math.max(hw, hd) * 4.4, 2.4, 1);
      halo.position.set(mx, H - 0.34, mz);
      group.add(halo);
      chunk.owned.push(sm);
      // recessed troffer surround: sloped metal reveal from the ceiling plane down to the lens
      if (style !== 'garage' && style !== 'tunnels') {
        const fo = 0.085, fc = [0.6 * lc[0], 0.6 * lc[1], 0.6 * lc[2]];
        const yT = H - 0.004, yB = y + 0.002;
        const ox2 = hw + fo, oz2 = hd + fo, ix = hw + 0.006, iz = hd + 0.006;
        const fu = [[0, 0], [1, 0], [1, 1], [0, 1]];
        const fcols = [fc, fc, fc, fc];
        quad(FR, [mx - ox2, yT, mz - oz2], [mx + ox2, yT, mz - oz2], [mx + ix, yB, mz - iz], [mx - ix, yB, mz - iz], [0, -0.6, -0.8], fu, fcols);
        quad(FR, [mx + ox2, yT, mz + oz2], [mx - ox2, yT, mz + oz2], [mx - ix, yB, mz + iz], [mx + ix, yB, mz + iz], [0, -0.6, 0.8], fu, fcols);
        quad(FR, [mx - ox2, yT, mz + oz2], [mx - ox2, yT, mz - oz2], [mx - ix, yB, mz - iz], [mx - ix, yB, mz + iz], [-0.8, -0.6, 0], fu, fcols);
        quad(FR, [mx + ox2, yT, mz - oz2], [mx + ox2, yT, mz + oz2], [mx + ix, yB, mz + iz], [mx + ix, yB, mz - iz], [0.8, -0.6, 0], fu, fcols);
      }
      const flicker = rand(F, cx, cz, 14) < world.P.flicker;
      if (flicker) {
        const g = new THREE.BoxGeometry(hw * 2, drop, hd * 2);
        const m = mats.panel.clone();
        m.vertexColors = false;   // plain geometry has no color attribute
        const mesh = new THREE.Mesh(g, m);
        mesh.position.set(mx, H - drop / 2, mz);
        group.add(mesh);
        chunk.flickers.push({ mat: m, phase: rand(F, cx, cz, 15) * 100, cx, cz, tint: lc, halo: sm, haloBase: sm.opacity });
        chunk.owned.push(g, m);
      } else {
        const wc = [lc, lc, lc, lc];
        const u = [[0, 0], [1, 0], [1, 1], [0, 1]];
        quad(PA,
          [mx - hw, y, mz - hd], [mx + hw, y, mz - hd], [mx + hw, y, mz + hd], [mx - hw, y, mz + hd],
          [0, -1, 0], u, wc);
        quad(PA, [mx - hw, y, mz - hd], [mx + hw, y, mz - hd], [mx + hw, H, mz - hd], [mx - hw, H, mz - hd], [0, 0, -1], u, wc);
        quad(PA, [mx - hw, y, mz + hd], [mx + hw, y, mz + hd], [mx + hw, H, mz + hd], [mx - hw, H, mz + hd], [0, 0, 1], u, wc);
        quad(PA, [mx - hw, y, mz - hd], [mx - hw, y, mz + hd], [mx - hw, H, mz + hd], [mx - hw, H, mz - hd], [-1, 0, 0], u, wc);
        quad(PA, [mx + hw, y, mz - hd], [mx + hw, y, mz + hd], [mx + hw, H, mz + hd], [mx + hw, H, mz - hd], [1, 0, 0], u, wc);
      }
    }

    // walls against occupied neighbours
    const dirs = [
      { dx: -1, dz: 0, n: [1, 0, 0],  p: [[x0, 0, z1], [x0, 0, z0], [x0, H, z0], [x0, H, z1]], u: [z1, z0] },
      { dx: 1,  dz: 0, n: [-1, 0, 0], p: [[x1, 0, z0], [x1, 0, z1], [x1, H, z1], [x1, H, z0]], u: [z0, z1] },
      { dx: 0, dz: -1, n: [0, 0, 1],  p: [[x0, 0, z0], [x1, 0, z0], [x1, H, z0], [x0, H, z0]], u: [x0, x1] },
      { dx: 0, dz: 1,  n: [0, 0, -1], p: [[x1, 0, z1], [x0, 0, z1], [x0, H, z1], [x1, H, z1]], u: [x1, x0] },
    ];
    for (const d of dirs) {
      if (!world.occupied(cx + d.dx, cz + d.dz)) continue;
      const [a, b2, c, e] = d.p;
      const pA = lightPool(a[0], a[2]), pB = lightPool(b2[0], b2[2]);
      const lo1 = base.map(v => v * 0.78 * pA), lo2 = base.map(v => v * 0.78 * pB);
      const hi1 = base.map(v => v * 1.0 * pB), hi2v = base.map(v => v * 1.0 * pA);
      quad(wallBufFor(cx + d.dx, cz + d.dz), a, b2, c, e, d.n,
        [[d.u[0] / 2, 0.02], [d.u[1] / 2, 0.02], [d.u[1] / 2, 1], [d.u[0] / 2, 1]],
        [lo1, lo2, hi1, hi2v]);
      wallFaces.push({
        x: (a[0] + b2[0]) / 2, z: (a[2] + b2[2]) / 2,
        nx: d.n[0], nz: d.n[2],
      });
      // baseboard + contact shadows ground the column face
      {
        const nx2 = d.n[0], nz2 = d.n[2];
        const U2 = [[0, 0], [1, 0], [1, 1], [0, 1]];
        const cA2 = [pA, pA, pA], cB2 = [pB, pB, pB];
        const wht = [[1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1]];
        if (WOOD) {
          const aF = [a[0] + nx2 * 0.042, 0, a[2] + nz2 * 0.042];
          const bF = [b2[0] + nx2 * 0.042, 0, b2[2] + nz2 * 0.042];
          quad(TR, aF, bF, [bF[0], BBH, bF[2]], [aF[0], BBH, aF[2]], d.n, U2, [cA2, cB2, cB2, cA2]);
          quad(TR, [aF[0], BBH, aF[2]], [bF[0], BBH, bF[2]],
            [b2[0], BBH + 0.018, b2[2]], [a[0], BBH + 0.018, a[2]],
            [nx2 * 0.4, 0.92, nz2 * 0.4], U2, [cA2, cB2, cB2, cA2]);
        }
        quad(AO, [a[0], 0.006, a[2]], [b2[0], 0.006, b2[2]],
          [b2[0] + nx2 * AOW, 0.006, b2[2] + nz2 * AOW], [a[0] + nx2 * AOW, 0.006, a[2] + nz2 * AOW],
          [0, 1, 0], U2, wht);
        quad(AO, [a[0], H - 0.006, a[2]], [b2[0], H - 0.006, b2[2]],
          [b2[0] + nx2 * AOC, H - 0.006, b2[2] + nz2 * AOC], [a[0] + nx2 * AOC, H - 0.006, a[2] + nz2 * AOC],
          [0, -1, 0], U2, wht);
      }
    }

    // ascend threshold — mounts on a pillar face or a thin wall
    if (world.doorUp(cx, cz)) {
      let wx = null, wz = 0, nx2 = 0, nz2 = 0;
      const occN = dirs.find(d => world.occupied(cx + d.dx, cz + d.dz));
      if (occN) {
        wx = occN.dx === -1 ? x0 : occN.dx === 1 ? x1 : (x0 + x1) / 2;
        wz = occN.dz === -1 ? z0 : occN.dz === 1 ? z1 : (z0 + z1) / 2;
        nx2 = occN.n[0]; nz2 = occN.n[2];
      } else if (world.hasWallH(cx, cz)) { wx = (x0 + x1) / 2; wz = z0 + 0.13; nz2 = 1; }
      else if (world.hasWallH(cx, cz + 1)) { wx = (x0 + x1) / 2; wz = z1 - 0.13; nz2 = -1; }
      else if (world.hasWallV(cx, cz)) { wx = x0 + 0.13; wz = (z0 + z1) / 2; nx2 = 1; }
      else if (world.hasWallV(cx + 1, cz)) { wx = x1 - 0.13; wz = (z0 + z1) / 2; nx2 = -1; }
      if (wx !== null) {
        const g = new THREE.PlaneGeometry(1.1, 2.3);
        const m = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, fog: false });
        const door = new THREE.Mesh(g, m);
        door.position.set(wx + nx2 * 0.05, 1.18, wz + nz2 * 0.05);
        door.lookAt(wx + nx2 * 2, 1.18, wz + nz2 * 2);
        group.add(door);
        const halo = new THREE.PointLight(0xeef2ff, 10, 8, 1.6);
        halo.position.set(wx + nx2 * 0.6, 1.6, wz + nz2 * 0.6);
        group.add(halo);
        chunk.doors.push({ x: wx + nx2 * 0.4, z: wz + nz2 * 0.4 });
        chunk.owned.push(g, m);
      }
    }

    // copied rooms from someone's memories (anchor cell builds the whole room)
    const roomType = world.setRoomAt(Math.floor(cx / 3), Math.floor(cz / 3));
    if (roomType && mod(cx, 3) === 0 && mod(cz, 3) === 0) {
      buildSetRoom(roomType, Math.floor(cx / 3), Math.floor(cz / 3), chunk, group);
    }

    // memory room furniture: easel + framed memory + cold light
    const tile = world.memoryTile(Math.floor(cx / 3), Math.floor(cz / 3));
    if (tile && mod(cx, 3) === 0 && mod(cz, 3) === 0) {
      const tcx = (Math.floor(cx / 3) * 3 + 1) * CELL;   // tile center
      const tcz = (Math.floor(cz / 3) * 3 + 1) * CELL;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.15, 0.07), mats.dark);
      post.position.set(tcx, 0.575, tcz);
      group.add(post);
      const fg = new THREE.PlaneGeometry(0.66, 0.82);
      const fm = new THREE.MeshLambertMaterial({ map: frameTexture(tile), side: THREE.DoubleSide });
      const frame = new THREE.Mesh(fg, fm);
      frame.position.set(tcx, 1.5, tcz);
      frame.rotation.y = rand(F, cx, cz, 21) * Math.PI * 2;
      frame.rotation.z = (rand(F, cx, cz, 22) - 0.5) * 0.1;
      group.add(frame);
      const cold = new THREE.PointLight(0xbfd0ff, 10, 11, 1.7);
      cold.position.set(tcx, 2.5, tcz);
      group.add(cold);
      chunk.frames.push({ x: tcx, z: tcz, text: tile.text });
      chunk.owned.push(fg, fm);
    }
  }

  // continuous thin walls — the long walls from the film, merged into runs
  const cLo = [0.84, 0.84, 0.84], cHi = [0.97, 0.97, 0.97];
  const T = 0.12;
  const emitRun = (horizontal, fixed, a, b) => {
    const W = horizontal ? wallBufFor(a, fixed) : wallBufFor(fixed, a);   // shadows outer W on purpose
    const lo = a * CELL, hi = (b + 1) * CELL;
    const contLo = horizontal ? world.hasWallH(a - 1, fixed) : world.hasWallV(fixed, a - 1);
    const contHi = horizontal ? world.hasWallH(b + 1, fixed) : world.hasWallV(fixed, b + 1);
    const e0 = contLo ? 0 : 0.13, e1 = contHi ? 0 : 0.13;
    const L = fixed * CELL;
    // per-cell segments so the baked light pools along the wall's length
    const seg = (p1, p2, p3, p4, n, u0, u1) => {
      const pA = lightPool(p1[0], p1[2]), pB = lightPool(p2[0], p2[2]);
      quad(W, p1, p2, p3, p4, n,
        [[u0 / 2, 0.02], [u1 / 2, 0.02], [u1 / 2, 1], [u0 / 2, 1]],
        [[0.78 * pA, 0.78 * pA, 0.78 * pA], [0.78 * pB, 0.78 * pB, 0.78 * pB],
         [pB, pB, pB], [pA, pA, pA]]);
    };
    // baseboard + floor/ceiling contact shadows for one cell-length of thin wall
    const trimSeg = (horiz, s0, s1) => {
      const pA = lightPool(horiz ? s0 : L, horiz ? L : s0);
      const pB = lightPool(horiz ? s1 : L, horiz ? L : s1);
      const cA = [pA, pA, pA], cB = [pB, pB, pB];
      const U2 = [[0, 0], [1, 0], [1, 1], [0, 1]];
      const wht = [[1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1]];
      if (horiz) {
        if (WOOD) {
          quad(TR, [s0, 0, L - BBD], [s1, 0, L - BBD], [s1, BBH, L - BBD], [s0, BBH, L - BBD], [0, 0, -1], U2, [cA, cB, cB, cA]);
          quad(TR, [s0, BBH, L - BBD], [s1, BBH, L - BBD], [s1, BBH + 0.018, L - T], [s0, BBH + 0.018, L - T], [0, 0.92, -0.4], U2, [cA, cB, cB, cA]);
          quad(TR, [s1, 0, L + BBD], [s0, 0, L + BBD], [s0, BBH, L + BBD], [s1, BBH, L + BBD], [0, 0, 1], U2, [cB, cA, cA, cB]);
          quad(TR, [s1, BBH, L + BBD], [s0, BBH, L + BBD], [s0, BBH + 0.018, L + T], [s1, BBH + 0.018, L + T], [0, 0.92, 0.4], U2, [cB, cA, cA, cB]);
        }
        quad(AO, [s0, 0.006, L - T], [s1, 0.006, L - T], [s1, 0.006, L - T - AOW], [s0, 0.006, L - T - AOW], [0, 1, 0], U2, wht);
        quad(AO, [s1, 0.006, L + T], [s0, 0.006, L + T], [s0, 0.006, L + T + AOW], [s1, 0.006, L + T + AOW], [0, 1, 0], U2, wht);
        quad(AO, [s0, H - 0.006, L - T], [s1, H - 0.006, L - T], [s1, H - 0.006, L - T - AOC], [s0, H - 0.006, L - T - AOC], [0, -1, 0], U2, wht);
        quad(AO, [s1, H - 0.006, L + T], [s0, H - 0.006, L + T], [s0, H - 0.006, L + T + AOC], [s1, H - 0.006, L + T + AOC], [0, -1, 0], U2, wht);
      } else {
        if (WOOD) {
          quad(TR, [L - BBD, 0, s1], [L - BBD, 0, s0], [L - BBD, BBH, s0], [L - BBD, BBH, s1], [-1, 0, 0], U2, [cB, cA, cA, cB]);
          quad(TR, [L - BBD, BBH, s1], [L - BBD, BBH, s0], [L - T, BBH + 0.018, s0], [L - T, BBH + 0.018, s1], [-0.4, 0.92, 0], U2, [cB, cA, cA, cB]);
          quad(TR, [L + BBD, 0, s0], [L + BBD, 0, s1], [L + BBD, BBH, s1], [L + BBD, BBH, s0], [1, 0, 0], U2, [cA, cB, cB, cA]);
          quad(TR, [L + BBD, BBH, s0], [L + BBD, BBH, s1], [L + T, BBH + 0.018, s1], [L + T, BBH + 0.018, s0], [0.4, 0.92, 0], U2, [cA, cB, cB, cA]);
        }
        quad(AO, [L - T, 0.006, s1], [L - T, 0.006, s0], [L - T - AOW, 0.006, s0], [L - T - AOW, 0.006, s1], [0, 1, 0], U2, wht);
        quad(AO, [L + T, 0.006, s0], [L + T, 0.006, s1], [L + T + AOW, 0.006, s1], [L + T + AOW, 0.006, s0], [0, 1, 0], U2, wht);
        quad(AO, [L - T, H - 0.006, s1], [L - T, H - 0.006, s0], [L - T - AOC, H - 0.006, s0], [L - T - AOC, H - 0.006, s1], [0, -1, 0], U2, wht);
        quad(AO, [L + T, H - 0.006, s0], [L + T, H - 0.006, s1], [L + T + AOC, H - 0.006, s1], [L + T + AOC, H - 0.006, s0], [0, -1, 0], U2, wht);
      }
    };
    if (horizontal) {   // along x at z = L
      for (let x = a; x <= b; x++) {
        const s0 = x * CELL - (x === a ? e0 : 0), s1 = (x + 1) * CELL + (x === b ? e1 : 0);
        seg([s0, 0, L - T], [s1, 0, L - T], [s1, H, L - T], [s0, H, L - T], [0, 0, -1], s0, s1);
        seg([s1, 0, L + T], [s0, 0, L + T], [s0, H, L + T], [s1, H, L + T], [0, 0, 1], s1, s0);
        trimSeg(true, s0, s1);
        wallFaces.push({ x: (x + 0.5) * CELL, z: L - T, nx: 0, nz: -1 });
        wallFaces.push({ x: (x + 0.5) * CELL, z: L + T, nx: 0, nz: 1 });
      }
      if (!contLo) seg([lo - e0, 0, L + T], [lo - e0, 0, L - T], [lo - e0, H, L - T], [lo - e0, H, L + T], [-1, 0, 0], 0, 0.24);
      if (!contHi) seg([hi + e1, 0, L - T], [hi + e1, 0, L + T], [hi + e1, H, L + T], [hi + e1, H, L - T], [1, 0, 0], 0, 0.24);
    } else {            // along z at x = L
      for (let z = a; z <= b; z++) {
        const s0 = z * CELL - (z === a ? e0 : 0), s1 = (z + 1) * CELL + (z === b ? e1 : 0);
        seg([L - T, 0, s1], [L - T, 0, s0], [L - T, H, s0], [L - T, H, s1], [-1, 0, 0], s1, s0);
        seg([L + T, 0, s0], [L + T, 0, s1], [L + T, H, s1], [L + T, H, s0], [1, 0, 0], s0, s1);
        trimSeg(false, s0, s1);
        wallFaces.push({ x: L - T, z: (z + 0.5) * CELL, nx: -1, nz: 0 });
        wallFaces.push({ x: L + T, z: (z + 0.5) * CELL, nx: 1, nz: 0 });
      }
      if (!contLo) seg([L - T, 0, lo - e0], [L + T, 0, lo - e0], [L + T, H, lo - e0], [L - T, H, lo - e0], [0, 0, -1], 0, 0.24);
      if (!contHi) seg([L + T, 0, hi + e1], [L - T, 0, hi + e1], [L - T, H, hi + e1], [L + T, H, hi + e1], [0, 0, 1], 0, 0.24);
    }
  };
  for (let lz = 0; lz < CHUNK; lz++) {
    const z = ccz * CHUNK + lz;
    let run = null;
    for (let lx = 0; lx <= CHUNK; lx++) {
      const x = ccx * CHUNK + lx;
      const wall = lx < CHUNK && world.hasWallH(x, z);
      if (wall && run === null) run = x;
      if (!wall && run !== null) { emitRun(true, z, run, x - 1); run = null; }
    }
  }
  for (let lx = 0; lx < CHUNK; lx++) {
    const x = ccx * CHUNK + lx;
    let run = null;
    for (let lz = 0; lz <= CHUNK; lz++) {
      const z = ccz * CHUNK + lz;
      const wall = lz < CHUNK && world.hasWallV(x, z);
      if (wall && run === null) run = z;
      if (!wall && run !== null) { emitRun(false, x, run, z - 1); run = null; }
    }
  }

  // scrawled memories on walls
  for (const mem of state.memories) {
    if (!wallFaces.length) break;
    if (rand(F, ccx, ccz, 1000 + mem.id) < 0.07) {
      const f = wallFaces[hash(F, ccx, ccz, 2000 + mem.id) % wallFaces.length];
      const g = new THREE.PlaneGeometry(1.8, 0.9);
      const m = new THREE.MeshLambertMaterial({ map: writingTexture(mem), transparent: true, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(g, m);
      const y = 1.3 + rand(F, ccx, ccz, 3000 + mem.id) * 0.5;
      mesh.position.set(f.x + f.nx * 0.03, y, f.z + f.nz * 0.03);
      mesh.lookAt(f.x + f.nx * 2, y, f.z + f.nz * 2);
      group.add(mesh);
      chunk.frames.push({ x: f.x, z: f.z, nx: f.nx, nz: f.nz, text: mem.text, whisperOnly: true });
      chunk.owned.push(g, m);
    }
  }

  // ceiling pipes in the garage and tunnel levels
  if (style === 'garage' || style === 'tunnels') {
    const emitBeam = (alongX, lane, y, sz) => {
      const a0 = (alongX ? ccx : ccz) * CHUNK * CELL, a1 = a0 + CHUNK * CELL;
      const c = lane;
      const lo = [0.5, 0.5, 0.5], hi2 = [0.85, 0.85, 0.85];
      if (alongX) {
        quad(PI, [a0, y - sz, c - sz], [a1, y - sz, c - sz], [a1, y - sz, c + sz], [a0, y - sz, c + sz],
          [0, -1, 0], [[0, 0], [8, 0], [8, 1], [0, 1]], [lo, lo, lo, lo]);
        quad(PI, [a0, y - sz, c - sz], [a1, y - sz, c - sz], [a1, y + sz, c - sz], [a0, y + sz, c - sz],
          [0, 0, -1], [[0, 0], [8, 0], [8, 1], [0, 1]], [hi2, hi2, hi2, hi2]);
        quad(PI, [a0, y - sz, c + sz], [a1, y - sz, c + sz], [a1, y + sz, c + sz], [a0, y + sz, c + sz],
          [0, 0, 1], [[0, 0], [8, 0], [8, 1], [0, 1]], [hi2, hi2, hi2, hi2]);
      } else {
        quad(PI, [c - sz, y - sz, a0], [c - sz, y - sz, a1], [c + sz, y - sz, a1], [c + sz, y - sz, a0],
          [0, -1, 0], [[0, 0], [8, 0], [8, 1], [0, 1]], [lo, lo, lo, lo]);
        quad(PI, [c - sz, y - sz, a0], [c - sz, y - sz, a1], [c - sz, y + sz, a1], [c - sz, y + sz, a0],
          [-1, 0, 0], [[0, 0], [8, 0], [8, 1], [0, 1]], [hi2, hi2, hi2, hi2]);
        quad(PI, [c + sz, y - sz, a0], [c + sz, y - sz, a1], [c + sz, y + sz, a1], [c + sz, y + sz, a0],
          [1, 0, 0], [[0, 0], [8, 0], [8, 1], [0, 1]], [hi2, hi2, hi2, hi2]);
      }
    };
    const zLane = (ccz * CHUNK + (hash(F, ccx, ccz, 91) % CHUNK)) * CELL + 1.2;
    const xLane = (ccx * CHUNK + (hash(F, ccx, ccz, 92) % CHUNK)) * CELL + 2.6;
    // hang services from the actual ceiling: the garage soars, the tunnels press down
    const pipeY = style === 'tunnels' ? H - 0.25 : H - 0.96;
    emitBeam(true, zLane, pipeY, 0.09);
    emitBeam(true, zLane + 0.26, pipeY, 0.06);
    emitBeam(false, xLane, pipeY - 0.06, 0.08);
  }

  // graffiti from the ones who came before
  if (style !== 'pools' && wallFaces.length && rand(F, ccx, ccz, 177) < 0.10 + 0.05 * Math.min(state.floor, 4)) {
    const f = wallFaces[hash(F, ccx, ccz, 178) % wallFaces.length];
    const g = new THREE.PlaneGeometry(1.45, 0.8);
    const m = new THREE.MeshLambertMaterial({ map: graffitiTexture(hash(F, ccx, ccz, 179)), transparent: true, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(g, m);
    const y = 1.35 + rand(F, ccx, ccz, 180) * 0.5;
    mesh.position.set(f.x + f.nx * 0.03, y, f.z + f.nz * 0.03);
    mesh.lookAt(f.x + f.nx * 2, y, f.z + f.nz * 2);
    group.add(mesh);
    chunk.owned.push(g, m);
  }

  if (W.pos.length) group.add(buffersToMesh(W, mats.wall));
  if (W2.pos.length) group.add(buffersToMesh(W2, mats.wall2));
  if (TR.pos.length) group.add(buffersToMesh(TR, mats.trim));
  if (FR.pos.length) group.add(buffersToMesh(FR, mats.frame));
  if (AO.pos.length) group.add(buffersToMesh(AO, mats.aoStrip));
  if (FL.pos.length) group.add(buffersToMesh(FL, mats.floor));
  if (CE.pos.length) group.add(buffersToMesh(CE, mats.ceil));
  if (PA.pos.length) group.add(buffersToMesh(PA, mats.panel));
  if (DK.pos.length) group.add(buffersToMesh(DK, mats.dark));
  if (PI.pos.length) group.add(buffersToMesh(PI, mats.pipe));
  if (WT.pos.length) group.add(buffersToMesh(WT, mats.water));
  scene.add(group);
  return chunk;
}

/* ---------------- discoverables ---------------- */
const NOTE_LINES = [
  'day 3. the lights never turn off. i counted.',
  "if you read this: don't count the doors.",
  'M said the walls moved at night. M is gone.',
  'the water tastes like almonds. drink it anyway.',
  "it doesn't go into the rooms. sleep in the rooms.",
  'i heard the machine again today. it hums like a fridge.',
];
/* ---------------- small props, ambient litter & lobby furniture piles ---------------- */
function smallProp(group, chunk, x, z, ry, build) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  group.add(g);
  const p = (geo, mat, dx, y, dz, ry2 = 0, rx = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(dx, y, dz);
    m.rotation.set(rx, ry2, rz, 'YXZ');
    g.add(m);
    chunk.owned.push(geo);
    return m;
  };
  build(p);
  return g;
}
const PROPS = {
  cassette: (p) => {           // audio cassette, reels showing
    p(new THREE.BoxGeometry(0.2, 0.032, 0.125), roomMat.dark, 0, 0.016, 0);
    p(new THREE.BoxGeometry(0.13, 0.034, 0.05), roomMat.paper, 0, 0.017, -0.025);
    for (const s of [-1, 1]) p(new THREE.CylinderGeometry(0.02, 0.02, 0.036, 10), roomMat.plastic, s * 0.04, 0.018, 0.02);
  },
  vhs: (p) => {
    p(new THREE.BoxGeometry(0.29, 0.026, 0.19), roomMat.dark, 0, 0.013, 0);
    p(new THREE.BoxGeometry(0.04, 0.028, 0.17), roomMat.paper, -0.115, 0.014, 0);   // spine label
    p(new THREE.BoxGeometry(0.18, 0.004, 0.11), roomMat.paper, 0.03, 0.027, 0);     // face label
  },
  bottle: (p) => {             // almond water, standing
    p(new THREE.CylinderGeometry(0.042, 0.046, 0.22, 10), roomMat.plastic, 0, 0.11, 0);
    p(new THREE.CylinderGeometry(0.017, 0.034, 0.05, 8), roomMat.plastic, 0, 0.245, 0);
    p(new THREE.CylinderGeometry(0.019, 0.019, 0.026, 8), roomMat.dark, 0, 0.283, 0);
    p(new THREE.CylinderGeometry(0.047, 0.047, 0.085, 10), roomMat.paper, 0, 0.1, 0);
  },
  bottleDown: (p) => {         // empty, on its side
    p(new THREE.CylinderGeometry(0.042, 0.046, 0.22, 10), roomMat.plastic, 0, 0.046, 0, 0, 0, Math.PI / 2);
    p(new THREE.CylinderGeometry(0.017, 0.034, 0.05, 8), roomMat.plastic, -0.135, 0.046, 0, 0, 0, Math.PI / 2);
    p(new THREE.CylinderGeometry(0.047, 0.047, 0.085, 10), roomMat.paper, 0.02, 0.046, 0, 0, 0, Math.PI / 2);
  },
  crumple: (p, seed = 1) => {  // balled-up page
    const m = p(new THREE.DodecahedronGeometry(0.05, 0), roomMat.paper, 0, 0.038, 0, seed % 6, (seed % 3) * 0.7, 0);
    m.scale.set(1, 0.72, 0.9);
    return m;
  },
  sheet: (p) => p(new THREE.BoxGeometry(0.21, 0.003, 0.29), roomMat.paper, 0, 0.01, 0),
  cableCoil: (p) => p(new THREE.TorusGeometry(0.09, 0.016, 6, 14), roomMat.dark, 0, 0.018, 0, 0, Math.PI / 2, 0),
  tileShard: (p) => {          // fallen ceiling tile, snapped
    p(new THREE.BoxGeometry(0.52, 0.02, 0.4), roomMat.plaster, 0, 0.01, 0, 0.12);
    p(new THREE.BoxGeometry(0.26, 0.02, 0.3), roomMat.plaster, 0.32, 0.024, 0.16, 0.7, 0, 0.05);
  },
  can: (p) => p(new THREE.CylinderGeometry(0.033, 0.033, 0.11, 10), roomMat.metal, 0, 0.034, 0, 0, 0, Math.PI / 2),
  floppy: (p, n = 1) => {      // purple-blue 3.5" disks, singles or small stacks
    for (let i = 0; i < n; i++) {
      p(new THREE.BoxGeometry(0.09, 0.004, 0.094), roomMat.fabric2, (i % 2) * 0.018, 0.004 + i * 0.005, i * 0.014, i * 0.4);
      p(new THREE.BoxGeometry(0.032, 0.0045, 0.038), roomMat.chrome, (i % 2) * 0.018, 0.0045 + i * 0.005, -0.024 + i * 0.014, i * 0.4);
    }
  },
  paperFan: (p, seed = 1) => { // fanned spill of letter sheets
    for (let i = 0; i < 4; i++)
      p(new THREE.BoxGeometry(0.21, 0.0025, 0.29), roomMat.paper, i * 0.055, 0.005 + i * 0.003, i * 0.028, (seed + i) * 0.33);
  },
  folderStack: (p) => {        // slumped grey folder pile
    p(new THREE.BoxGeometry(0.26, 0.1, 0.32), roomMat.linen, 0, 0.05, 0, 0.1);
    p(new THREE.BoxGeometry(0.24, 0.02, 0.3), roomMat.paper, 0.03, 0.11, 0.01, 0.3);
  },
  cableRun: (p, seed = 1) => { // black extension cord in a lazy S-curve
    const pts = [];
    for (let i = 0; i <= 4; i++)
      pts.push(new THREE.Vector3(-1.4 + i * 0.7, 0.012, Math.sin(i * 1.7 + seed) * 0.45));
    p(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.006, 5, false), roomMat.dark, 0, 0, 0);
  },
  blueCord: (p) => {           // coiled phone cord pooled with a stretched tail
    for (let i = 0; i < 4; i++)
      p(new THREE.TorusGeometry(0.05 + i * 0.011, 0.008, 5, 12), roomMat.cordBlue, i * 0.018, 0.012 + i * 0.011, 0, 0, Math.PI / 2, 0);
    p(new THREE.CylinderGeometry(0.007, 0.007, 0.7, 5), roomMat.cordBlue, 0.46, 0.012, 0.1, 0, 0, Math.PI / 2);
  },
  amberBottle: (p) => {
    p(new THREE.CylinderGeometry(0.045, 0.05, 0.24, 10), roomMat.amber, 0, 0.12, 0);
    p(new THREE.CylinderGeometry(0.016, 0.03, 0.07, 8), roomMat.amber, 0, 0.275, 0);
    p(new THREE.BoxGeometry(0.068, 0.1, 0.002), roomMat.paper, 0, 0.12, 0.05);
  },
  pillBottles: (p) => {        // pharmacy trio, child-proof caps
    for (let i = 0; i < 3; i++) {
      const hgt = i === 0 ? 0.1 : 0.06;
      p(new THREE.CylinderGeometry(0.022, 0.022, hgt, 8), roomMat.amber, (i - 1) * 0.068, hgt / 2, (i % 2) * 0.05);
      p(new THREE.CylinderGeometry(0.024, 0.024, 0.014, 8), roomMat.plastic, (i - 1) * 0.068, hgt + 0.007, (i % 2) * 0.05);
    }
  },
  leaves: (p, seed = 1) => {   // dried leaves under a stained tile, one twig
    for (let i = 0; i < 8; i++)
      p(new THREE.CircleGeometry(0.034, 5), roomMat.leaf,
        Math.sin(i * 2.1 + seed) * 0.38, 0.004, Math.cos(i * 1.7 + seed) * 0.38, i * 0.8, Math.PI / 2 + 0.18, 0);
    p(new THREE.CylinderGeometry(0.005, 0.007, 0.25, 5), roomMat.woodDark, 0.1, 0.008, 0.05, 0, 0, Math.PI / 2);
  },
  shoe: (p, red = false, flipped = false) => {
    const m = red ? roomMat.shoeRed : roomMat.shoeBlack;
    p(new THREE.BoxGeometry(0.09, 0.06, 0.24), m, 0, flipped ? 0.07 : 0.032, 0, 0, 0, flipped ? Math.PI : 0);
    p(new THREE.BoxGeometry(0.085, 0.05, 0.1), m, 0, flipped ? 0.04 : 0.062, -0.06, 0, 0, flipped ? Math.PI : 0);
  },
  shoePair: (p) => {           // an upright, touching pair — the neatness is the wrong part
    for (const s of [-1, 1]) {
      p(new THREE.BoxGeometry(0.09, 0.09, 0.26), roomMat.shoeBlack, s * 0.055, 0.045, 0);
      p(new THREE.BoxGeometry(0.08, 0.08, 0.08), roomMat.shoeBlack, s * 0.055, 0.11, -0.08);
    }
  },
};
function buildLitter(cx, cz, chunk, group) {
  const F = world.F;
  const n = 1 + hash(F, cx, cz, 142) % 3;
  for (let i = 0; i < n; i++) {
    const x = (cx + 0.2 + rand(F, cx, cz, 143 + i * 7) * 0.6) * CELL;
    const z = (cz + 0.2 + rand(F, cx, cz, 144 + i * 7) * 0.6) * CELL;
    const ry = rand(F, cx, cz, 145 + i * 7) * Math.PI * 2;
    // mix weighted by how often the film shows each: paper & cable everywhere, shoes rare
    const kind = hash(F, cx, cz, 146 + i * 11) % 16;
    smallProp(group, chunk, x, z, ry, (p) => {
      if (kind <= 1) PROPS.paperFan(p, hash(F, cx, cz, 150 + i));
      else if (kind === 2) PROPS.sheet(p);
      else if (kind === 3) PROPS.folderStack(p);
      else if (kind <= 5) PROPS.cableRun(p, hash(F, cx, cz, 153 + i));
      else if (kind === 6) PROPS.cassette(p);
      else if (kind === 7) PROPS.floppy(p, 1 + hash(F, cx, cz, 154 + i) % 3);
      else if (kind === 8) PROPS.vhs(p);
      else if (kind === 9) PROPS.blueCord(p);
      else if (kind === 10) PROPS.bottleDown(p);
      else if (kind === 11) PROPS.amberBottle(p);
      else if (kind === 12) PROPS.pillBottles(p);
      else if (kind === 13) PROPS.crumple(p, hash(F, cx, cz, 150 + i));
      else if (kind === 14) PROPS.tileShard(p);
      else if (hash(F, cx, cz, 155 + i) % 4 === 0) PROPS.shoePair(p);
      else if (hash(F, cx, cz, 156 + i) % 2 === 0) PROPS.leaves(p, hash(F, cx, cz, 157 + i));
      else PROPS.shoe(p, hash(F, cx, cz, 158 + i) % 2 === 0, hash(F, cx, cz, 159 + i) % 2 === 0);
    });
  }
}

// a placed, rotated assembly root: piece(build, dx, dz, {y,rx,ry,rz}) drops FURN/PROPS parts into it
function furnRoot(group, chunk, x, z, ry) {
  const root = new THREE.Group();
  root.position.set(x, 0, z);
  root.rotation.y = ry;
  group.add(root);
  const piece = (build, dx, dz, o = {}) => {
    const g = new THREE.Group();
    g.position.set(dx, o.y || 0, dz);
    g.rotation.set(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ');
    root.add(g);
    const p = (geo, mat, fx, y, fz, ry2 = 0, rx2 = 0, rz2 = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(fx, y, fz);
      m.rotation.set(rx2, ry2, rz2, 'YXZ');
      g.add(m);
      chunk.owned.push(geo);
      return m;
    };
    build(p);
    return g;
  };
  return { root, piece };
}

function buildFurniturePile(cx, cz, chunk, group) {
  const F = world.F;
  const px = (cx + 0.5) * CELL, pz = (cz + 0.5) * CELL;
  const { root, piece } = furnRoot(group, chunk, px, pz, rand(F, cx, cz, 132) * Math.PI * 2);
  const r = (k) => rand(F, cx, cz, 160 + k);
  const style = world.P.style;
  // non-lobby floors get their own dressing — no showroom furniture down here
  if (style === 'garage') {
    const kind = hash(F, cx, cz, 133) % 8;
    if (kind === 0) {            // the sedan that will never leave
      piece(FURN.deadCar, 0, 0, { ry: r(1) * 0.6 - 0.3 });
      piece(FURN.cone, 1.7, 1.2);
      piece(FURN.cone, -1.8, 0.8, { rz: Math.PI / 2, y: 0.13, ry: r(2) * 6.28 });
      // the pile root carries a random yaw, so the collider must be rotation-safe
      chunk.colliders.push({ minX: px - 1.9, maxX: px + 1.9, minZ: pz - 1.9, maxZ: pz + 1.9 });
      return;
    } else if (kind <= 2) {      // pallets, crates, a drum
      piece(FURN.pallet, 0, 0, { ry: r(1) * 0.4 });
      piece(FURN.pallet, 0.06, 0.05, { y: 0.17, ry: 0.25 + r(2) * 0.3 });
      piece((p) => { p(new THREE.BoxGeometry(0.62, 0.5, 0.5), roomMat.crate, 0, 0.25, 0, 0.2); }, 0.15, 0.05, { y: 0.34 });
      piece((p) => { p(new THREE.BoxGeometry(0.5, 0.42, 0.45), roomMat.cardboard, 0, 0.21, 0, 0.7); }, 1.0, 0.75);
      piece(FURN.drum, -1.0, 0.7);
    } else if (kind <= 4) {      // drum cluster, one tipped and leaking dark
      piece(FURN.drum, 0, 0);
      piece(FURN.drum, 0.62, 0.25, { ry: r(1) });
      piece(FURN.drum, 0.2, 0.85, { rz: Math.PI / 2, y: 0.29, ry: r(2) * 6.28 });
      piece((p) => { p(new THREE.CylinderGeometry(0.5, 0.5, 0.008, 12), roomMat.dark, 0, 0.004, 0); }, 0.7, 1.3);
    } else if (kind <= 6) {      // cones and a plank barrier around nothing
      piece(FURN.cone, -0.9, -0.3); piece(FURN.cone, 0.9, -0.25);
      piece(FURN.cone, -0.5, 1.0, { rz: Math.PI / 2, y: 0.13, ry: r(1) * 6.28 });
      piece(FURN.cone, 1.2, 0.9);
      piece((p) => { p(new THREE.BoxGeometry(1.9, 0.05, 0.14), roomMat.pine, 0, 0.46, 0, 0.06); }, 0, -0.28);
    } else {                     // tires
      piece(FURN.tireStack(3), 0, 0);
      piece(FURN.tireStack(1), 0.85, 0.5, { ry: r(1) });
      piece((p) => { p(new THREE.TorusGeometry(0.27, 0.105, 8, 14), roomMat.bag, 0, 0.38, 0, 0, 0, 0.18); }, -0.85, 0.4, { ry: r(2) * 6.28 });
    }
    const e2 = 1.35;
    chunk.colliders.push({ minX: px - e2, maxX: px + e2, minZ: pz - e2, maxZ: pz + e2 });
    return;
  }
  if (style === 'tunnels') {
    const kind = hash(F, cx, cz, 133) % 6;
    if (kind <= 1) {             // a cable spool and its slack
      piece(FURN.cableSpool, 0, 0, { ry: r(1) * 6.28 });
      piece((p) => PROPS.cableRun(p, hash(F, cx, cz, 135)), 0.4, 1.0, { ry: r(2) });
    } else if (kind <= 3) {      // sawhorses mid-job, nobody coming back
      piece(FURN.sawhorse, -0.55, 0, { ry: r(1) * 0.3 });
      piece(FURN.sawhorse, 0.65, 0.1, { ry: r(2) * 0.3 - 0.15 });
      piece((p) => { p(new THREE.BoxGeometry(2.0, 0.045, 0.3), roomMat.pine, 0, 0.83, 0, 0.04); }, 0.05, 0.05);
      piece((p) => { p(new THREE.CylinderGeometry(0.085, 0.085, 0.19, 12), roomMat.plastic, 0, 0.095, 0); }, -1.1, 0.8);
    } else if (kind === 4) {     // tool clutter
      piece(FURN.toolClutter, 0, 0, { ry: r(1) * 6.28 });
      piece((p) => PROPS.sheet(p), 0.8, 0.6, { ry: r(2) });
    } else {                     // pipe stock, stacked and forgotten
      piece(FURN.pipeStack, 0, 0, { ry: r(1) * 0.5 - 0.25 });
      piece(FURN.drum, 1.4, 0.6);
    }
    const e2 = 1.35;
    chunk.colliders.push({ minX: px - e2, maxX: px + e2, minZ: pz - e2, maxZ: pz + e2 });
    return;
  }
  if (style === 'deep') {
    const kind = hash(F, cx, cz, 133) % 6;
    if (kind <= 2) {             // the ceiling has been coming down
      piece(FURN.debrisHeap(hash(F, cx, cz, 136)), 0, 0, { ry: r(1) * 6.28 });
      piece((p) => PROPS.tileShard(p), 1.2, 0.9, { ry: r(2) * 6.28 });
    } else if (kind <= 4) {      // a door with nowhere to hang
      piece(FURN.doorLean, 0, 0, { ry: r(1) * 6.28 });
      piece((p) => PROPS.crumple(p, hash(F, cx, cz, 138)), 0.8, 0.5);
    } else {                     // what's left of a chair
      piece(FURN.charredChair, 0, 0, { ry: r(1) * 6.28 });
      piece((p) => PROPS.can(p), 0.7, 0.4, { ry: r(2) });
    }
    const e2 = 1.1;
    chunk.colliders.push({ minX: px - e2, maxX: px + e2, minZ: pz - e2, maxZ: pz + e2 });
    return;
  }
  // piles hug walls when the cell has one (film rule); root shifts toward it, back to the wall
  const wallSide =
    world.hasWallH(cx, cz) ? 0 : world.hasWallH(cx, cz + 1) ? 1 :
    world.hasWallV(cx, cz) ? 2 : world.hasWallV(cx + 1, cz) ? 3 : -1;
  if (wallSide >= 0) {
    const off = 1.05;
    if (wallSide === 0) { root.position.z = cz * CELL + off; root.rotation.y = 0; }
    if (wallSide === 1) { root.position.z = (cz + 1) * CELL - off; root.rotation.y = Math.PI; }
    if (wallSide === 2) { root.position.x = cx * CELL + off; root.rotation.y = -Math.PI / 2; }
    if (wallSide === 3) { root.position.x = (cx + 1) * CELL - off; root.rotation.y = Math.PI / 2; }
    root.rotation.y += (r(9) - 0.5) * 0.2;
  }
  // film silhouette rule: an inverted item at the apex + one linear element skewering out
  const kinds = wallSide >= 0 ? [0, 1, 2, 5] : [3, 4, 3, 4, 5];
  const kind = kinds[hash(F, cx, cz, 133) % kinds.length];
  if (kind === 0) {            // WARDROBE_SPINE_MOUND — pine wardrobes, spilled dresser, inverted table+chair
    piece(FURN.wardrobe(true), -1.0, -0.35, { ry: r(1) * 0.16 - 0.08 });
    piece(FURN.dresser(true), 0.35, -0.3, { ry: r(2) * 0.2 - 0.1 });
    piece(FURN.coffeeTable, 1.45, -0.1, { y: 0.62, rx: Math.PI, ry: 0.4, rz: 0.1 });   // table legs-up
    piece(FURN.officeChair, 1.45, -0.1, { y: 1.35, rx: Math.PI, ry: r(3) * 6.28 });    // chair on its underside, casters up
    piece(FURN.pictureFrame, 0.35, 0.42, { y: 0.86, rx: -0.18 });                      // propped at the apex
    piece(FURN.floorLamp, -0.2, 0.55, { y: 1.4, rx: Math.PI / 2, ry: r(4) * 6.28 });   // dome lamp skewering out
    for (let i = 0; i < 3; i++) {                                                       // nested chair tower
      piece(FURN.ladderChair, 1.05, 0.85, { y: i * 0.46, ry: 0.3 + i * 0.25, rx: i === 1 ? Math.PI : 0, rz: i * 0.06 });
    }
    piece(FURN.filingCab, -1.55, 0.95, { ry: r(5) });
    piece(FURN.trunk, -0.4, 1.15, { ry: r(6) * 0.5 });
  } else if (kind === 1) {     // DOORWAY_PLUG — tipped dresser, leaned panel, buried desk, dead TV
    piece(FURN.dresser(false), 0, -0.25, { rz: 0.72, y: 0.42, ry: 0.15 });             // tipped onto its end
    piece((p) => { p(new THREE.BoxGeometry(0.9, 1.9, 0.05), roomMat.pine, 0, 0.95, 0); }, 0.45, 0.15, { rx: -0.42 });  // leaned tabletop panel
    piece(FURN.deskUnit, -1.0, 0.2, { rz: 0.5, y: 0.3, ry: 2.6 });                     // desk, legs protruding
    piece(FURN.tvSet, 0.9, 0.85, { ry: 2.8 + r(2) });
    piece(FURN.ladderChair, -0.2, 0.4, { y: 1.7, rx: Math.PI, ry: r(3) * 6.28, rz: 0.08 });   // inverted apex chair
    for (let i = 0; i < 3; i++) piece(FURN.rolledRug, -1.2 + i * 0.12, 1.0, { y: i * 0.33, ry: 0.1 * i });
  } else if (kind === 2) {     // LEANING_BRIDGE — tilted bookcase bridging a dresser, lamp standing beneath
    piece(FURN.dresser(false), 0.85, -0.2, { ry: 0.1 });
    piece(FURN.bookcase(hash(F, cx, cz, 134)), -0.65, -0.15, { rz: -0.5, y: 0.16, ry: 0.08 });   // bridges onto it
    piece((p) => {                                                                       // ceramic lamp in the gap
      p(new THREE.CylinderGeometry(0.07, 0.1, 0.32, 10), roomMat.cream, 0, 0.16, 0);
      p(new THREE.CylinderGeometry(0.13, 0.17, 0.18, 10), roomMat.shade, 0, 0.43, 0);
    }, 0.1, 0.35);
    piece(FURN.ladderChair, 0.2, 1.05, { ry: Math.PI + r(2) * 0.4 });                   // facing outward
    piece(FURN.sideTable, 0.9, 0.35, { y: 0.92, rx: Math.PI, rz: 0.4, ry: r(3) });      // side table upside-down on top
    piece(FURN.nightstand, -1.35, 0.75, { rx: 1.1, y: 0.3, ry: r(4) });                 // tipped onto its face
    piece((p) => FURN.priceTag(p, 0, 0.72, 0.28), 0.85, -0.2);                          // still for sale
  } else if (kind === 3) {     // SEATING_SANDWICH + ESCAPEE — cream armchairs stacked, one got away
    piece(FURN.sofa(0.95, roomMat.cream, roomMat.linen), 0, 0, { ry: r(1) * 0.3 - 0.15 });
    piece(FURN.sofa(0.95, roomMat.cream, roomMat.linen), 0.04, 0.06, { y: 1.42, rx: Math.PI, ry: 0.18, rz: 0.05 });
    piece(FURN.ladderChair, 0.15, 0.55, { y: 1.95, rx: Math.PI * 0.42, ry: 0.7, rz: 0.3 });    // diagonal across the base
    piece(FURN.sofa(1.6, roomMat.cream, roomMat.linen), 1.45, 1.3, { ry: 0.5 + r(2) * 0.3 });  // the escapee, upright & alone
    piece((p) => FURN.priceTag(p, 0.55, 0.58, 0.3), 1.45, 1.3, { ry: 0.5 });                   // its tag still on
  } else if (kind === 4) {     // CHAIR_TOTEM — antler tangle of inverted chairs on a cafe table
    piece(FURN.cafeTable, 0, 0, { ry: r(1) });
    for (let i = 0; i < 3; i++) {
      piece(FURN.ladderChair, (i - 1) * 0.22, (i % 2) * 0.2 - 0.1,
        { y: 0.76 + i * 0.5, rx: Math.PI, ry: i * 1.9, rz: (i - 1) * 0.14 });
    }
    piece(FURN.ladderChair, 0.75, 0.3, { rz: 0.62, y: 0.22, ry: 2.4 });                 // one leaning into the stack
    piece(FURN.ladderChair, -1.2, 0.9, { ry: r(2) * 6.28 });                            // one shoved clear
    piece((p) => FURN.priceTag(p, 0.1, 1.6, 0.1), 0, 0);                                // a tag dangles from the antlers
  } else {                     // DRAPED_MASS — bags, blanket bedroll, leaning pole (someone camped here)
    piece(FURN.garbageBags, 0, -0.2, { ry: r(1) });
    piece((p) => {                                                                       // dark blanket over something boxy
      p(new THREE.BoxGeometry(1.15, 0.85, 0.65), roomMat.blanket, 0, 0.46, 0);
      p(new THREE.BoxGeometry(1.3, 0.07, 0.8), roomMat.blanket, 0, 0.035, 0);
    }, 1.05, 0.1, { ry: r(2) * 0.4 });
    piece((p) => { p(new THREE.BoxGeometry(0.8, 0.04, 1.7), roomMat.blanket, 0, 0.02, 0); }, -0.5, 1.0, { ry: 0.3 });  // zigzag bedroll
    piece((p) => { p(new THREE.CylinderGeometry(0.014, 0.014, 1.9, 6), roomMat.metal, 0, 0.95, 0); }, 0.6, 0.6,
      { rz: 0.9, y: -0.18, ry: r(3) });                                                  // thin pole leaning across
    piece((p) => PROPS.crumple(p, hash(F, cx, cz, 152)), -1.25, 0.4);
  }
  const e = 1.55;
  chunk.colliders.push({ minX: px - e, maxX: px + e, minZ: pz - e, maxZ: pz + e });
}

// DOORWAY_PLUG on a real doorway: the heap blocks most of the gap, a ~1.1m squeeze survives
function buildDoorPlug(cx, cz, axis, chunk, group) {
  const F = world.F;
  const alongX = axis === 1;
  const lineX = alongX ? (cx + 0.5) * CELL : cx * CELL;
  const lineZ = alongX ? cz * CELL : (cz + 0.5) * CELL;
  const side = hash(F, cx, cz, 174) % 2 ? 1 : -1;          // which end the squeeze survives on
  const off = side * -0.55;                                 // pile shifted away from the squeeze
  const px = alongX ? lineX + off : lineX;
  const pz = alongX ? lineZ : lineZ + off;
  const { piece } = furnRoot(group, chunk, px, pz, alongX ? 0 : Math.PI / 2);
  const r = (k) => rand(F, cx, cz, 176 + k);
  piece(FURN.dresser(false), -0.5, 0, { rz: 0.7, y: 0.42, ry: 0.15 });          // tipped onto its end
  piece((p) => { p(new THREE.BoxGeometry(0.9, 1.9, 0.05), roomMat.pine, 0, 0.95, 0); }, 0.1, 0.15, { rx: -0.4, ry: 0.2 });
  piece(FURN.tvSet, 0.85, 0.35, { ry: 2.8 + r(1) });
  piece(FURN.ladderChair, -0.3, 0.1, { y: 1.6, rx: Math.PI, ry: r(2) * 6.28, rz: 0.1 });   // inverted apex
  for (let i = 0; i < 3; i++) piece(FURN.rolledRug, 0.7 - i * 0.1, -0.3, { y: i * 0.33, ry: 0.12 * i });
  piece((p) => FURN.priceTag(p, 0, 1.1, 0.3), -0.5, 0);
  // collider covers the plugged stretch of the gap, leaves the squeeze
  const lo = -2 + (side < 0 ? 1.15 : 0), hi = 2 - (side > 0 ? 1.15 : 0);
  if (alongX) chunk.colliders.push({ minX: cx * CELL + 2 + lo, maxX: cx * CELL + 2 + hi, minZ: lineZ - 0.8, maxZ: lineZ + 0.8 });
  else chunk.colliders.push({ minX: lineX - 0.8, maxX: lineX + 0.8, minZ: cz * CELL + 2 + lo, maxZ: cz * CELL + 2 + hi });
}

// furniture heaped around a torn floor panel — the crawl gap is the only way through, and it drops
function buildHolePile(cx, cz, chunk, group) {
  const F = world.F;
  const s = world.holeShape(cx, cz);
  const { piece } = furnRoot(group, chunk, s.hx, s.hz, rand(F, cx, cz, 175) * Math.PI * 2);
  const r = (k) => rand(F, cx, cz, 178 + k);
  const ring = [0.3, 1.7, 2.9, 4.3];                        // angles; ~5.5 stays open — the crawl gap
  const builds = [
    (p) => { p(new THREE.BoxGeometry(1.4, 0.22, 1.95), roomMat.linen, 0, 0.95, 0, 0, -1.25); },   // mattress on edge
    FURN.ladderChair,
    (p) => { p(new THREE.BoxGeometry(0.9, 1.9, 0.05), roomMat.pine, 0, 0.95, 0); },
    FURN.trunk,
  ];
  ring.forEach((a, i) => {
    const dx = Math.cos(a) * 1.45, dz = Math.sin(a) * 1.45;
    piece(builds[i], dx, dz, { ry: -a + r(i) * 0.4, rx: i === 2 ? -0.35 : 0 });
    const wx = s.hx + Math.cos(a) * 1.45, wz = s.hz + Math.sin(a) * 1.45;
    chunk.colliders.push({ minX: wx - 0.5, maxX: wx + 0.5, minZ: wz - 0.5, maxZ: wz + 0.5 });
  });
  // a plank half-bridges the opening; it does not inspire confidence
  piece((p) => { p(new THREE.BoxGeometry(2.3, 0.045, 0.28), roomMat.pine, 0, 0.5, 0, 0.2, 0, 0.08); }, 0, 0);
}

function buildFind(type, cx, cz, chunk, group) {
  const F = world.F;
  const fx = (cx + 0.5) * CELL + (rand(F, cx, cz, 54) - 0.5) * 1.6;
  const fz = (cz + 0.5) * CELL + (rand(F, cx, cz, 56) - 0.5) * 1.6;
  const add = (geo, mat, x, y, z, ry = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.y = ry;
    group.add(m); chunk.owned.push(geo);
    return m;
  };
  const B = (w, h2, d) => new THREE.BoxGeometry(w, h2, d);
  const ry0 = rand(F, cx, cz, 57) * 6.28;
  if (type === 'tape') {
    smallProp(group, chunk, fx, fz, ry0, PROPS.cassette);
    smallProp(group, chunk, fx + 0.26, fz + 0.14, ry0 + 1.2, PROPS.vhs);
  } else if (type === 'almond') {
    smallProp(group, chunk, fx, fz, ry0, PROPS.bottle);
  } else if (type === 'note') {
    smallProp(group, chunk, fx, fz, ry0, PROPS.sheet);
    smallProp(group, chunk, fx + 0.3, fz - 0.18, ry0 * 1.7, (p) => PROPS.crumple(p, hash(F, cx, cz, 58)));
  } else if (type === 'radio') {
    smallProp(group, chunk, fx, fz, ry0, (p) => {
      p(B(0.34, 0.2, 0.13), roomMat.dark, 0, 0.1, 0);
      p(new THREE.CylinderGeometry(0.06, 0.06, 0.015, 12), roomMat.metal, -0.07, 0.1, 0.07, 0, Math.PI / 2);  // speaker
      p(new THREE.CylinderGeometry(0.017, 0.017, 0.02, 8), roomMat.metal, 0.09, 0.145, 0.07, 0, Math.PI / 2); // knobs
      p(new THREE.CylinderGeometry(0.017, 0.017, 0.02, 8), roomMat.metal, 0.09, 0.07, 0.07, 0, Math.PI / 2);
      p(B(0.16, 0.018, 0.03), roomMat.metal, 0, 0.215, 0);                                                    // handle
      p(new THREE.CylinderGeometry(0.006, 0.006, 0.42, 6), roomMat.metal, 0.14, 0.36, -0.04, 0, 0, 0.55);     // antenna
    });
  } else if (type === 'camera') {
    smallProp(group, chunk, fx, fz, ry0, (p) => {
      for (let i = 0; i < 3; i++) {
        const a = i * 2.09;
        p(B(0.03, 1.3, 0.03), roomMat.dark, Math.sin(a) * 0.26, 0.62, Math.cos(a) * 0.26, 0, Math.cos(a) * 0.22, Math.sin(a) * 0.22);
      }
      p(B(0.1, 0.04, 0.1), roomMat.metal, 0, 1.26, 0);                                                // tripod head
      p(B(0.32, 0.2, 0.18), roomMat.dark, 0, 1.38, 0);
      p(new THREE.CylinderGeometry(0.05, 0.058, 0.13, 10), roomMat.dark, 0, 1.4, 0.15, 0, Math.PI / 2);  // lens
      p(B(0.07, 0.05, 0.09), roomMat.dark, -0.12, 1.51, -0.02);                                       // viewfinder
      p(B(0.05, 0.05, 0.02), redGlowMat, 0.1, 1.46, 0.1);
    });
  } else if (type === 'camp') {
    add(B(1.8, 0.14, 0.7), roomMat.fabric, fx, 0.07, fz, ry0);
    smallProp(group, chunk, fx + 0.7, fz + 0.5, ry0, PROPS.bottle);
    smallProp(group, chunk, fx - 0.7, fz - 0.5, ry0 + 1, PROPS.sheet);
    smallProp(group, chunk, fx + 0.5, fz - 0.55, ry0 + 2, PROPS.cassette);
    smallProp(group, chunk, fx - 0.45, fz + 0.62, ry0 + 3, (p) => {
      PROPS.can(p);
      PROPS.crumple(p, hash(F, cx, cz, 59)).position.z += 0.2;
    });
  }
  chunk.finds.push({ x: fx, z: fz, type, key: world.F + ':' + cx + ',' + cz, cx, cz });
}

const asyncSignTex = canvasTex(512, 256, (g, w, h) => {
  g.fillStyle = '#1d2733'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#aebccd'; g.lineWidth = 6; g.strokeRect(10, 10, w - 20, h - 20);
  g.fillStyle = '#e8eef6'; g.font = 'bold 64px Helvetica, Arial';
  g.fillText('A-SYNC', 30, 90);
  g.font = 'bold 36px Helvetica, Arial';
  g.fillText('PROJECT KV31', 30, 150);
  g.font = '24px Helvetica, Arial'; g.fillStyle = '#9fb2c6';
  g.fillText('AUTHORIZED PERSONNEL ONLY', 30, 205);
}, false);
const redGlowMat = new THREE.MeshBasicMaterial({ color: 0xff3b30 });

function buildAsyncSite(chunk, group) {
  const F = world.F;
  const bx = world.siteA.tx * 3 * CELL, bz = world.siteA.tz * 3 * CELL;
  const cxm = bx + 10, czm = bz + 10;   // site is ~24m square; machine near centre
  const add = (geo, mat, x, y, z, ry = 0, solid = false) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.y = ry;
    group.add(m); chunk.owned.push(geo);
    if (solid) {
      const p = geo.parameters;
      const e = Math.max(p.width, p.depth) / 2;
      chunk.colliders.push({ minX: x - e, maxX: x + e, minZ: z - e, maxZ: z + e });
    }
    return m;
  };
  const B = (w, h2, d) => new THREE.BoxGeometry(w, h2, d);
  // the threshold machine
  const mh = Math.min(3.2, H - 0.1);
  add(B(0.45, mh, 0.45), roomMat.metal, cxm - 1.35, mh / 2, czm, 0, true);
  add(B(0.45, mh, 0.45), roomMat.metal, cxm + 1.35, mh / 2, czm, 0, true);
  add(B(3.2, 0.4, 0.5), roomMat.metal, cxm, mh - 0.2, czm);
  const glowG = new THREE.PlaneGeometry(2.2, mh - 0.5);
  const glowM = new THREE.MeshBasicMaterial({ color: 0xf4f8ff, side: THREE.DoubleSide, fog: false });
  const glow = new THREE.Mesh(glowG, glowM);
  glow.position.set(cxm, (mh - 0.4) / 2, czm);
  group.add(glow);
  chunk.owned.push(glowG, glowM);
  const halo = new THREE.PointLight(0xdfe8ff, 26, 18, 1.6);
  halo.position.set(cxm, 2, czm);
  group.add(halo);
  chunk.doors.push({ x: cxm, z: czm });
  // floodlights on tripods at the corners
  for (const [ox, oz] of [[-7, -7], [7, -7], [-7, 7], [7, 7]]) {
    add(B(0.06, 2.0, 0.06), roomMat.dark, cxm + ox, 1.0, czm + oz);
    const head = add(B(0.4, 0.3, 0.3), roomMat.metal, cxm + ox, 2.1, czm + oz, Math.atan2(-ox, -oz));
    head.rotation.x = 0.5;
    const fl = new THREE.PointLight(0xfff2d8, 9, 13, 1.7);
    fl.position.set(cxm + ox * 0.85, 2.0, czm + oz * 0.85);
    group.add(fl);
  }
  // crates, desk, monitors, cable runs
  for (let i = 0; i < 6; i++) {
    const a = rand(F, 71, i) * 6.28, d = 3.5 + rand(F, 72, i) * 4;
    const s = 0.5 + rand(F, 73, i) * 0.5;
    add(B(s, s, s), roomMat.crate, cxm + Math.sin(a) * d, s / 2, czm + Math.cos(a) * d, rand(F, 74, i), true);
  }
  add(B(1.8, 0.06, 0.8), roomMat.wood, cxm - 4.5, 0.76, czm + 3, 0.2, true);
  add(B(0.5, 0.36, 0.06), roomMat.dark, cxm - 4.7, 1.0, czm + 3, 0.2);
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.3), roomMat.screen);
  scr.position.set(cxm - 4.7 + 0.02, 1.0, czm + 3.04);
  scr.rotation.y = 0.2;
  group.add(scr);
  for (let i = 0; i < 4; i++) {
    add(B(3 + rand(F, 75, i) * 4, 0.03, 0.08), roomMat.dark, cxm + (rand(F, 76, i) - 0.5) * 8, 0.015, czm + (rand(F, 78, i) - 0.5) * 8, rand(F, 79, i) * 3);
  }
  // signage
  const sg = new THREE.PlaneGeometry(2.0, 1.0);
  const sm = new THREE.MeshLambertMaterial({ map: asyncSignTex });
  const sign = new THREE.Mesh(sg, sm);
  sign.position.set(cxm, 1.7, czm - 6);
  sign.rotation.y = Math.PI;
  group.add(sign);
  chunk.owned.push(sg, sm);
  add(B(0.08, 1.7, 0.08), roomMat.metal, cxm, 0.85, czm - 6.02);
  // what they left behind
  chunk.finds.push({
    x: cxm - 4.5, z: czm + 3, type: 'siteNote',
    key: world.F + ':site', cx: Math.floor(cxm / CELL), cz: Math.floor(czm / CELL),
    text: 'KV31 LOG — exposure 9 minutes MAXIMUM. the threshold stays open longer than we ask it to.',
  });
  chunk.frames.push({ x: cxm, z: czm, text: 'the a-sync site. they were here. the machine still hums.', r: 9 });
}

/* ---------------- stairwells (they only go down) ---------------- */
function buildStairwell(cx, cz, chunk, group) {
  const F = world.F;
  const mx = (cx + 0.5) * CELL, mz = (cz + 0.5) * CELL;
  const ry = (hash(F, cx, cz, 94) % 4) * Math.PI / 2;
  const sub = new THREE.Group();
  sub.position.set(mx, 0, mz);
  sub.rotation.y = ry;
  group.add(sub);
  const add = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    sub.add(m); chunk.owned.push(geo);
    return m;
  };
  const wh = H;
  // enclosure: wallpapered outside, dark within; open mouth faces -z (local)
  add(new THREE.BoxGeometry(0.18, wh, 3.6), mats.column, -1.3, wh / 2, 0.1);
  add(new THREE.BoxGeometry(0.18, wh, 3.6), mats.column, 1.3, wh / 2, 0.1);
  add(new THREE.BoxGeometry(2.78, 0.5, 3.6), mats.column, 0, wh - 0.25, 0.1);   // header
  add(new THREE.BoxGeometry(2.42, wh, 0.18), roomMat.dark, 0, wh / 2, 1.85);    // back of the dark
  add(new THREE.BoxGeometry(2.78, wh, 0.12), mats.column, 0, wh / 2, 1.97);     // wallpapered outer back
  add(new THREE.BoxGeometry(2.42, 0.06, 3.4), roomMat.dark, 0, wh - 0.52, 0.1); // dark inner ceiling
  // descending steps fading into black
  for (let i = 0; i < 6; i++) {
    add(new THREE.BoxGeometry(2.4, 0.22, 0.46), roomMat.step, 0, -0.11 - i * 0.2, -1.3 + 0.5 + i * 0.46);
  }
  // dark side skirts below floor level so the descent reads from the mouth
  add(new THREE.BoxGeometry(0.18, 2, 3.4), roomMat.dark, -1.21, -1, 0.2);
  add(new THREE.BoxGeometry(0.18, 2, 3.4), roomMat.dark, 1.21, -1, 0.2);
  // a weak cold light at the mouth, like ff-14
  const lt = new THREE.PointLight(0xbfc8d6, 8, 7, 1.8);
  lt.position.set(mx - Math.sin(ry) * 1.6, wh - 0.7, mz - Math.cos(ry) * 1.6);
  group.add(lt);
  // colliders for the two side walls (conservative, axis-aware)
  const alongZ = (hash(F, cx, cz, 94) % 2) === 0;   // ry 0 or π → walls run along z
  for (const off of [-1.3, 1.3]) {
    const wx = alongZ ? mx + off : mx, wz = alongZ ? mz : mz + off;
    const exx = alongZ ? 0.12 : 1.85, ezz = alongZ ? 1.85 : 0.12;
    chunk.colliders.push({ minX: wx - exx, maxX: wx + exx, minZ: wz - ezz, maxZ: wz + ezz });
  }
  // stepping into the dark takes you down
  const tx2 = mx - Math.sin(ry) * -0.9, tz2 = mz - Math.cos(ry) * -0.9;
  chunk.stairs.push({ x: tx2, z: tz2 });
  chunk.frames.push({ x: mx, z: mz, text: 'a staircase. they only go down.', r: 3.4 });
}

/* ---------------- the green door ---------------- */
const exitSignTex = canvasTex(256, 96, (g, w, h) => {
  // pictogram sign like the informational video: figure, arrow, door
  g.fillStyle = '#0e8a42'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#eafff2'; g.lineWidth = 4; g.strokeRect(5, 5, w - 10, h - 10);
  g.fillStyle = '#eafff2';
  g.fillRect(170, 18, 50, 62);                       // door slab
  g.fillStyle = '#0e8a42'; g.fillRect(178, 24, 34, 50);
  g.fillStyle = '#eafff2';
  g.beginPath(); g.arc(72, 28, 9, 0, 7); g.fill();   // figure: head
  g.fillRect(64, 38, 16, 26);                        // torso
  g.fillRect(56, 64, 10, 18); g.fillRect(78, 64, 10, 18);   // legs mid-stride
  g.beginPath();                                      // arrow
  g.moveTo(110, 48); g.lineTo(150, 48); g.lineTo(150, 36); g.lineTo(166, 52);
  g.lineTo(150, 68); g.lineTo(150, 56); g.lineTo(110, 56); g.closePath(); g.fill();
}, false);
const exitSignMat = new THREE.MeshBasicMaterial({ map: exitSignTex, fog: false });
const hazardTex = canvasTex(256, 64, (g, w, h) => {
  g.fillStyle = '#e8efe6'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#1d7a3c';
  for (let x = -64; x < w + 64; x += 42) {
    g.beginPath();
    g.moveTo(x, h); g.lineTo(x + 21, h); g.lineTo(x + 21 + h, 0); g.lineTo(x + h, 0);
    g.closePath(); g.fill();
  }
}, false);
const hazardMat = new THREE.MeshLambertMaterial({ map: hazardTex });
const doorGreenMat = new THREE.MeshLambertMaterial({ color: 0xe4e8e0 });   // white service door

function buildExitDoor(chunk, group) {
  const e = world.exitSpot;
  const ex = (e.tx * 3 + 1.5) * CELL, ez = (e.tz * 3 + 1.5) * CELL;
  // face the long axis back toward spawn so you approach it head-on
  const ddx = SPAWN_CX * CELL - ex, ddz = SPAWN_CZ * CELL - ez;
  const alongX = Math.abs(ddz) >= Math.abs(ddx);   // wall runs along x, you walk in along z
  const sub = new THREE.Group();
  sub.position.set(ex, 0, ez);
  sub.rotation.y = alongX ? 0 : Math.PI / 2;
  group.add(sub);
  const add = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    sub.add(m); chunk.owned.push(geo);
    return m;
  };
  const wh = H;
  // flanking wall slabs with a 1.6m doorway between
  add(new THREE.BoxGeometry(1.6, wh, 0.3), mats.column, -1.6, wh / 2, 0);
  add(new THREE.BoxGeometry(1.6, wh, 0.3), mats.column, 1.6, wh / 2, 0);
  add(new THREE.BoxGeometry(4.8, Math.max(0.2, wh - 2.16), 0.3), mats.column, 0, (wh + 2.16) / 2, 0);
  // colliders (axis-aware)
  for (const off of [-1.6, 1.6]) {
    const wx = alongX ? ex + off : ex, wz = alongX ? ez : ez + off;
    const exx = alongX ? 0.8 : 0.16, ezz = alongX ? 0.16 : 0.8;
    chunk.colliders.push({ minX: wx - exx, maxX: wx + exx, minZ: wz - ezz, maxZ: wz + ezz });
  }
  // jambs, ajar metal door, light leak
  add(new THREE.BoxGeometry(0.12, 2.16, 0.36), roomMat.metal, -0.86, 1.08, 0);
  add(new THREE.BoxGeometry(0.12, 2.16, 0.36), roomMat.metal, 0.86, 1.08, 0);
  const door = add(new THREE.BoxGeometry(1.5, 2.1, 0.06), doorGreenMat, -0.28, 1.05, 0.52);
  door.rotation.y = -0.75;
  add(new THREE.BoxGeometry(1.5, 0.42, 0.07), hazardMat, -0.28, 0.21, 0.52).rotation.y = -0.75;   // chevron kickplate
  const leakG = new THREE.PlaneGeometry(1.5, 2.1);
  const leakM = new THREE.MeshBasicMaterial({ color: 0xeafff2, side: THREE.DoubleSide, fog: false });
  const leak = new THREE.Mesh(leakG, leakM);
  leak.position.set(0, 1.05, -0.02);
  sub.add(leak);
  chunk.owned.push(leakG, leakM);
  // the sign and its green glow — a beacon down the corridors
  const sg = add(new THREE.PlaneGeometry(1.1, 0.42), exitSignMat, 0, Math.min(2.42, wh - 0.1), 0.22);
  sg.material = exitSignMat;
  const glow = new THREE.PointLight(0x6cf0a0, 16, 22, 1.5);
  glow.position.set(ex, Math.min(2.3, wh - 0.2), ez);
  group.add(glow);
  chunk.exits.push({ x: ex, z: ez });
  chunk.frames.push({ x: ex, z: ez, text: 'a green door. it was always here.', r: 6 });
}

/* ---------------- light glow (cheap bloom) ---------------- */
const glowTex = canvasTex(128, 128, (g, w, h) => {
  const grd = g.createRadialGradient(64, 64, 2, 64, 64, 62);
  grd.addColorStop(0, 'rgba(255,255,255,0.95)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.32)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.clearRect(0, 0, w, h);
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
}, false);

// contact-shadow gradient for the strips that ground walls into floor and ceiling
const aoGradTex = canvasTex(16, 64, (g, w, h) => {
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, 'rgba(0,0,0,0)');
  grd.addColorStop(1, 'rgba(0,0,0,0.34)');
  g.clearRect(0, 0, w, h);
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
}, false);

/* ---------------- graffiti & puddles (shared) ---------------- */
const GRAFFITI = ['EXIT UP ↑', 'NO EXIT', 'KEEP MOVING', 'they hear you', '← BACK', 'it was already here', 'DON\'T', ':)'];
const graffitiCache = new Map();
function graffitiTexture(seed) {
  const idx = seed % GRAFFITI.length;
  if (graffitiCache.has(idx)) return graffitiCache.get(idx);
  const t = canvasTex(512, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.font = 'bold 58px "Marker Felt", "Comic Sans MS", cursive';
    g.fillStyle = 'rgba(28,26,22,0.78)';
    g.save();
    g.translate(w / 2, h / 2);
    g.rotate((rand(idx, 91) - 0.5) * 0.16);
    const txt = GRAFFITI[idx];
    g.fillText(txt, -g.measureText(txt).width / 2, 18);
    g.restore();
  }, false);
  graffitiCache.set(idx, t);
  return t;
}
const puddleMat = (() => {
  const t = canvasTex(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const grd = g.createRadialGradient(64, 64, 8, 64, 64, 62);
    grd.addColorStop(0, 'rgba(22,26,32,0.85)');
    grd.addColorStop(0.7, 'rgba(22,26,32,0.7)');
    grd.addColorStop(1, 'rgba(22,26,32,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(200,220,255,0.18)';
    g.beginPath(); g.ellipse(52, 48, 18, 7, 0.5, 0, 7); g.fill();
  }, false);
  return new THREE.MeshBasicMaterial({ map: t, transparent: true });
})();

/* ---------------- copied-room construction ---------------- */
function buildSetRoom(type, tx, tz, chunk, group) {
  const F = world.F;
  const x0 = tx * 3 * CELL, z0 = tz * 3 * CELL, S = 2 * CELL;   // 8m x 8m within the tile
  const TH = 0.14, WH = H;

  const addBox = (w, h, d, mat, lx, y, lz, ry = 0, solid = true, floaty = false) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x0 + lx, floaty ? y + 0.15 : y, z0 + lz);
    m.rotation.y = ry;
    if (floaty) m.rotation.z = 0.07;
    group.add(m);
    if (solid) {
      // axis-aligned extents; rotated pieces get a conservative square
      const ex = ry === 0 ? w / 2 : Math.max(w, d) / 2;
      const ez = ry === 0 ? d / 2 : Math.max(w, d) / 2;
      chunk.colliders.push({ minX: x0 + lx - ex, maxX: x0 + lx + ex, minZ: z0 + lz - ez, maxZ: z0 + lz + ez });
    }
    chunk.owned.push(geo);
    return m;
  };
  const addPlane = (w, h, mat, lx, y, lz, ry = 0, rx = 0) => {
    const geo = new THREE.PlaneGeometry(w, h);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x0 + lx, y, z0 + lz);
    m.rotation.set(rx, ry, 0, 'YXZ');
    group.add(m);
    chunk.owned.push(geo);
    return m;
  };
  const addLight = (color, intensity, dist, lx, y, lz) => {
    const l = new THREE.PointLight(color, intensity, dist, 1.8);
    l.position.set(x0 + lx, y, z0 + lz);
    group.add(l);
  };

  // shell: plaster walls with a door gap on one side
  const side = hash(F, tx, tz, 57) % 4;                  // 0:z=0  1:z=S  2:x=0  3:x=S
  const dc = 1.8 + rand(F, tx, tz, 58) * (S - 3.6);      // door center along that wall
  const edges = [
    { axis: 'x', fixed: 0 }, { axis: 'x', fixed: S },
    { axis: 'z', fixed: 0 }, { axis: 'z', fixed: S },
  ];
  const shellMat = type === 'office' ? roomMat.plasterPink : roomMat.plaster;
  edges.forEach((e, i) => {
    const segs = (i === side) ? [[0, dc - 0.65], [dc + 0.65, S]] : [[0, S]];
    for (const [a, b] of segs) {
      const len = b - a;
      if (len <= 0.05) continue;
      if (e.axis === 'x') addBox(len, WH, TH, shellMat, a + len / 2, WH / 2, e.fixed);
      else addBox(TH, WH, len, shellMat, e.fixed, WH / 2, a + len / 2);
    }
  });
  // floor & lowered ceiling
  addPlane(S, S, roomMat.wood, S / 2, 0.025, S / 2, 0, -Math.PI / 2).receiveShadow = false;
  addPlane(S, S, roomMat.plaster, S / 2, Math.min(2.62, H - 0.18), S / 2, 0, Math.PI / 2);

  // caption shows when you step inside
  chunk.frames.push({ x: x0 + S / 2, z: z0 + S / 2, text: ROOM_CAPTIONS[type], r: 4.2 });

  // every copied room hides something
  const HIDDEN = {
    showroom: 'a receipt behind the sofa: one settee, paid in full, dated tomorrow.',
    therapy: "her notebook, dropped: 'patient insists the rooms remember him.'",
    interrogation: 'a file under the table: your name. spelled the way you used to spell it.',
    motel: 'under the pillow: a key for room 0.',
    cubicles: "a sticky note on a monitor: 'DO NOT MAP THE POOLS.'",
    junction: 'the signs face both ways. i watched something on the dark side read one, and stop, and turn back. obey the sign.',
    kitchen: 'rules of the table: sit when asked. hold the cup, never drink. when the food comes out of him, smile. you may leave when the candle is done.',
    plans: "why think in terms of magic?? be REALISTIC!!! the plans work. i drew the door and the door learned to open. tables don't bleed blood. they don't. they don't.",
    office: 'day 181. i taped up every elevation and not one matches a building that exists. but the receipts are real. someone keeps buying this furniture.',
    congregation: 'i arranged them facing the wall before i slept. when i woke they were facing me. do not move the chairs. they remember where they want to be.',
    static: "ch J3, 06/28/1998, 23:31. the same man walks into the white room every night and the tape has never once shown him leave. tonight i'm going to wave at the camera. check the tape.",
    poolside: 'maintenance log: drained 6/28/1998. refill request pending. the deep end refills itself on some nights. do not schedule swims.',
  };
  const hx2 = x0 + 1.2 + rand(F, tx, tz, 63) * (S - 2.4);
  const hz2 = z0 + 1.2 + rand(F, tx, tz, 64) * (S - 2.4);
  const noteGeo = new THREE.BoxGeometry(0.26, 0.004, 0.34);
  const note = new THREE.Mesh(noteGeo, roomMat.paper);
  note.position.set(hx2, 0.04, hz2);
  note.rotation.y = rand(F, tx, tz, 65) * 6.28;
  group.add(note);
  chunk.owned.push(noteGeo);
  chunk.finds.push({
    x: hx2, z: hz2, type: 'roomNote', key: world.F + ':room' + tx + ',' + tz,
    cx: Math.floor(hx2 / CELL), cz: Math.floor(hz2 / CELL), text: HIDDEN[type],
  });

  const floaty = hash(F, tx, tz, 59) % 3;   // which piece the copy got wrong

  // furniture group: pieces are built in local coords, the whole thing is placed/rotated/floated
  const furn = (lx, lz, ry, build, fl = false, o = {}) => {
    const g = new THREE.Group();
    g.position.set(x0 + lx, (fl ? 0.15 : 0) + (o.y || 0), z0 + lz);
    g.rotation.set(o.rx || 0, ry, (fl ? 0.07 : 0) + (o.rz || 0), 'YXZ');
    group.add(g);
    const p = (geo, mat, fx, y, fz, ry2 = 0, rx = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(fx, y, fz);
      m.rotation.set(rx, ry2, rz, 'YXZ');
      g.add(m);
      chunk.owned.push(geo);
      return m;
    };
    build(p);
    return g;
  };
  const addCollider = (lx, lz, ex, ez) => chunk.colliders.push({
    minX: x0 + lx - ex, maxX: x0 + lx + ex, minZ: z0 + lz - ez, maxZ: z0 + lz + ez,
  });
  if (type === 'showroom') {
    furn(2.9, 2.6, 0.08, FURN.sofa(2.0, roomMat.fabric, roomMat.fabricDark));
    addCollider(2.9, 2.6, 1.15, 0.6);
    furn(5.45, 5.7, 2.3, FURN.sofa(1.9, roomMat.fabric, roomMat.fabricDark), floaty === 0);
    addCollider(5.45, 5.7, 1.05, 1.05);
    furn(3.3, 4.4, 0.12, FURN.coffeeTable);
    addCollider(3.3, 4.4, 0.62, 0.38);
    furn(6.6, 2.0, 0, FURN.floorLamp);
    addLight(0xffd9a0, 7, 10, 6.6, 1.6, 2.0);
    addPlane(1.5, 1.5, roomMat.poster, 1.6, 1.7, 0.10 + TH, 0);
  } else if (type === 'therapy') {
    furn(2.9, 4.4, 0.2, FURN.loungeChair);
    addCollider(2.9, 4.4, 0.5, 0.5);
    furn(5.1, 4.4, Math.PI + 0.12, FURN.loungeChair, floaty === 1);
    addCollider(5.1, 4.4, 0.5, 0.5);
    furn(4.0, 4.4, 0, FURN.sideTable);
    addCollider(4.0, 4.4, 0.35, 0.35);
    furn(4.2, 0.42, 0, FURN.bookcase(hash(F, tx, tz, 99)));
    addCollider(4.2, 0.42, 0.88, 0.26);
    addPlane(0.62, 0.62, roomMat.clock, 6.8, 1.9, 0.10 + TH, 0);
    addLight(0xffe7c0, 7, 10, 4, 2.3, 4);
  } else if (type === 'interrogation') {
    furn(4, 4, 0, FURN.metalTable);
    addCollider(4, 4, 0.8, 0.45);
    furn(4, 5.1, 0, FURN.metalChair, floaty === 2);
    addCollider(4, 5.1, 0.3, 0.3);
    furn(4, 2.9, Math.PI, FURN.metalChair);
    addCollider(4, 2.9, 0.3, 0.3);
    // a bare pendant hangs over the table
    const ceilY = Math.min(2.62, H - 0.18);
    furn(4, 4, 0, (p) => {
      p(new THREE.CylinderGeometry(0.008, 0.008, ceilY - 1.94, 6), roomMat.dark, 0, (ceilY + 1.94) / 2, 0);
      p(new THREE.CylinderGeometry(0.05, 0.2, 0.17, 12), roomMat.dark, 0, 1.9, 0);
      p(new THREE.SphereGeometry(0.045, 8, 8), roomMat.bulb, 0, 1.81, 0);
    });
    addPlane(2.4, 1.2, roomMat.glass, 4.0, 1.6, 0.10 + TH, 0);
    // someone is still being questioned: a seated still life
    addBox(0.36, 0.62, 0.22, roomMat.figure, 4, 1.2, 5.15, 0, false);
    const hd = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), roomMat.figure);
    hd.position.set(x0 + 4, 1.66, z0 + 5.15); group.add(hd);
    addBox(0.09, 0.5, 0.09, roomMat.figure, 3.82, 0.85, 4.6, 0.5, false);
    addBox(0.09, 0.5, 0.09, roomMat.figure, 4.18, 0.85, 4.6, -0.5, false);
    addBox(0.5, 0.1, 0.3, roomMat.dark, 4, 0.84, 3.9, 0, false);   // its file, closed
    addLight(0xffffff, 14, 9, 4, 1.95, 4);
  } else if (type === 'motel') {
    furn(2.4, 4.9, Math.PI, FURN.bed);
    addCollider(2.4, 4.9, 0.85, 1.1);
    furn(3.6, 5.7, Math.PI, FURN.nightstand, floaty === 0);
    addCollider(3.6, 5.7, 0.3, 0.27);
    addLight(0xffc890, 6, 9, 3.6, 1.1, 5.7);
    addPlane(1.28, 1.0, roomMat.painting, 5.6, 1.7, 0.10 + TH, 0);
  } else if (type === 'cubicles') {
    for (let i = 0; i < 3; i++) {
      const dx = 1.9 + i * 2.1;
      furn(dx, 2.2, 0, FURN.deskUnit);
      addCollider(dx, 2.2, 0.78, 0.4);
      addPlane(0.44, 0.28, roomMat.screen, dx, 1.02, 2.05, Math.PI);
      furn(dx, 3.0, 0.3 * (i - 1), FURN.officeChair, floaty === 1 && i === 1);
      addCollider(dx, 3.0, 0.3, 0.3);
      if (i < 2) {
        furn(dx + 1.05, 2.5, 0, FURN.partition);
        addCollider(dx + 1.05, 2.5, 0.1, 0.85);
      }
    }
    addLight(0xdfe8ff, 8, 11, 4, 2.4, 3.5);
  } else if (type === 'junction') {
    // a road intersection indoors: bright half, dark half, two stop signs facing both ways
    for (const [a, b] of [[0, 2], [6, 8]]) addBox(b - a, WH, 0.14, roomMat.plaster, (a + b) / 2, WH / 2, 4);
    addPlane(S - 0.3, 2.5, roomMat.plasterBrown, S / 2, 1.25, 0.09 + TH, 0);          // dark south lining
    for (const sx of [0.09 + TH, S - 0.09 - TH]) {
      addPlane(3.9, 2.5, roomMat.plasterBrown, sx, 1.25, 2.0, sx < 4 ? Math.PI / 2 : -Math.PI / 2);
    }
    addPlane(S, 3.96, roomMat.plasterBrown, S / 2, Math.min(2.6, H - 0.2) - 0.02, 2, 0, Math.PI / 2);  // unlit south ceiling
    const stopSign = (p) => {
      p(new THREE.CylinderGeometry(0.3, 0.34, 0.05, 12), roomMat.metal, 0, 0.025, 0);
      p(new THREE.CylinderGeometry(0.022, 0.022, 2.0, 8), roomMat.chrome, 0, 1.02, 0);
      p(new THREE.PlaneGeometry(0.62, 0.62), roomMat.stop, 0, 1.85, 0.015);
      p(new THREE.PlaneGeometry(0.62, 0.62), roomMat.stop, 0, 1.85, -0.015, Math.PI);
    };
    furn(4.0, 5.5, Math.PI, stopSign);   addCollider(4.0, 5.5, 0.34, 0.34);
    furn(4.0, 2.5, 0, stopSign);         addCollider(4.0, 2.5, 0.34, 0.34);
    furn(6.0, 4.9, 0, (p) => {           // half-height counter on the bright side
      p(new THREE.BoxGeometry(2.5, 1.1, 0.5), roomMat.cream, 0, 0.55, 0);
      p(new THREE.BoxGeometry(2.6, 0.05, 0.6), roomMat.wood, 0, 1.12, 0);
    });
    addCollider(6.0, 4.9, 1.3, 0.3);
    furn(0.6, 6.0, 0, (p) => {           // low ramp + thin handrail along the west wall
      p(new THREE.BoxGeometry(1.0, 0.04, 3.0), roomMat.wood, 0, 0.13, 0, 0, -0.09);
      p(new THREE.CylinderGeometry(0.016, 0.016, 3.0, 6), roomMat.woodDark, 0.45, 0.85, 0, 0, Math.PI / 2 - 0.09);
      for (const oz of [-1.2, 0, 1.2]) p(new THREE.CylinderGeometry(0.014, 0.014, 0.75, 6), roomMat.woodDark, 0.45, 0.45, oz);
    });
    addCollider(0.6, 6.0, 0.55, 1.55);
    addLight(0xfff2cf, 10, 9, 4, 2.4, 6);                                              // bright north only
  } else if (type === 'kitchen') {
    // dinner is served on carpet, and the candle is lit
    addPlane(S, S, roomMat.fabric, S / 2, 0.028, S / 2, 0, -Math.PI / 2);              // carpet where carpet shouldn't be
    furn(4, 4, 0, (p) => {                                                              // rounded-octagon oak table, set for five
      p(new THREE.CylinderGeometry(0.82, 0.82, 0.05, 8), roomMat.oakLight, 0, 0.74, 0);
      p(new THREE.CylinderGeometry(0.07, 0.09, 0.72, 8), roomMat.woodDark, 0, 0.37, 0);
      p(new THREE.CylinderGeometry(0.3, 0.42, 0.05, 8), roomMat.woodDark, 0, 0.025, 0);
      for (let i = 0; i < 5; i++) {
        const a = i / 5 * Math.PI * 2 + 0.63;
        const mx2 = Math.cos(a) * 0.52, mz2 = Math.sin(a) * 0.52;
        p(new THREE.BoxGeometry(0.3, 0.006, 0.22), roomMat.tumbler, mx2, 0.772, mz2, -a + (i % 2) * 0.2);   // askew placemat
        p(new THREE.CylinderGeometry(0.1, 0.11, 0.012, 12), roomMat.plastic, mx2, 0.782, mz2);              // plate
        p(new THREE.CylinderGeometry(0.03, 0.026, 0.09, 8), roomMat.tumbler, mx2 + 0.13, 0.815, mz2 - 0.05); // tumbler
      }
      p(new THREE.CylinderGeometry(0.035, 0.035, 0.16, 10), roomMat.candle, 0, 0.85, 0);                     // the candle
      p(new THREE.BoxGeometry(0.025, 0.012, 0.2), roomMat.woodDark, 0.26, 0.78, 0.1, 0.8);                   // carving knife: handle
      p(new THREE.BoxGeometry(0.02, 0.006, 0.18), roomMat.chrome, 0.36, 0.78, 0.22, 0.8);                    //   …and blade, pointing in
    });
    addCollider(4, 4, 0.95, 0.95);
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * Math.PI * 2 + 0.63;
      const cxp = 4 + Math.cos(a) * 1.3, czp = 4 + Math.sin(a) * 1.3;
      furn(cxp, czp, -a - Math.PI / 2, i === 0 ? FURN.ladderChairM(roomMat.oakLight) : FURN.ladderChair, floaty === 0 && i === 3);
      addCollider(cxp, czp, 0.26, 0.26);
      if (i === 0) {                                                                    // blue cords looped on the head chair
        smallProp(group, chunk, x0 + cxp, z0 + czp, -a - Math.PI / 2, (p) => {
          p(new THREE.TorusGeometry(0.05, 0.012, 5, 10), roomMat.cordBlue, 0.17, 0.5, 0.05, 0, Math.PI / 2, 0);
          p(new THREE.TorusGeometry(0.05, 0.012, 5, 10), roomMat.cordBlue, -0.17, 0.5, 0.05, 0, Math.PI / 2, 0);
        });
      }
    }
    furn(0.55, 6.5, Math.PI / 2, (p) => {                                                // almond fridge
      p(new THREE.BoxGeometry(0.72, 1.72, 0.66), roomMat.cream, 0, 0.86, 0);
      p(new THREE.BoxGeometry(0.7, 0.02, 0.64), roomMat.linen, 0, 1.18, 0.012);
      p(new THREE.BoxGeometry(0.03, 0.4, 0.04), roomMat.linen, 0.3, 1.42, 0.34);
      p(new THREE.BoxGeometry(0.03, 0.62, 0.04), roomMat.linen, 0.3, 0.7, 0.34);
    });
    addCollider(0.55, 6.5, 0.4, 0.4);
    furn(0.45, 4.5, Math.PI / 2, (p) => {                                                // china hutch with dark bottles
      p(new THREE.BoxGeometry(2.8, 0.95, 0.5), roomMat.woodDark, 0, 0.48, 0);
      p(new THREE.BoxGeometry(2.8, 1.1, 0.34), roomMat.woodDark, 0, 1.6, -0.07);
      p(new THREE.BoxGeometry(2.6, 0.9, 0.02), roomMat.glass, 0, 1.58, 0.11);
      for (let i = 0; i < 6; i++)
        p(new THREE.CylinderGeometry(0.035, 0.04, 0.22, 8), roomMat.amber, -1.1 + i * 0.44, 1.28, -0.05);
    });
    addCollider(0.45, 4.5, 0.32, 1.45);
    addPlane(1.6, 0.7, roomMat.signWhite, 0.1 + TH, 1.95, 4.5, Math.PI / 2);             // glowing glass-block window
    furn(4, 7.55, Math.PI, (p) => {                                                      // the alcove chair, facing out
      p(new THREE.BoxGeometry(1.3, 2.25, 0.12), roomMat.plasterBrown, 0, 1.12, -0.32);   // arched recess, faked dark
      FURN.ladderChair(p);
    });
    addCollider(4, 7.55, 0.3, 0.3);
    addBox(0.35, 0.35, 0.12, roomMat.plastic, 2.8, 2.1, S - 0.12, 0, false);             // speaker/vent box
    addPlane(0.36, 0.46, roomMat.painting, 5.2, 1.6, S - 0.09, Math.PI);                 // family photo
    addPlane(0.26, 0.32, roomMat.painting, S - 0.09, 1.9, 2.5, -Math.PI / 2);            // …hung slightly too high
    furn(5.6, 0.42, 0, (p) => {                                                          // south window, royal-blue curtains
      p(new THREE.PlaneGeometry(1.1, 1.0), roomMat.signWhite, 0, 1.55, 0.02);
      p(new THREE.BoxGeometry(1.5, 0.05, 0.06), roomMat.woodDark, 0, 2.12, 0.05);
      for (const s of [-1, 1]) p(new THREE.BoxGeometry(0.22, 1.15, 0.08), roomMat.curtain, s * 0.72, 1.5, 0.06, 0, 0, s * 0.06);
    });
    addLight(0xffd9a0, 6, 8, 4, 1.6, 4);                                                 // one dim warm source over the table
  } else if (type === 'plans') {
    // a dead-end cell where someone wrote it all down
    addPlane(S, S, roomMat.plaster, S / 2, 0.03, S / 2, 0, -Math.PI / 2);                // bare screed, carpet stops at the door
    addPlane(S - 0.2, 2.6, roomMat.mural, S / 2, 1.34, S - 0.09 - TH, Math.PI);          // the mural wall
    addPlane(1.0, 2.6, roomMat.mural, 0.09 + TH, 1.34, S - 0.6, Math.PI / 2);            // …turning the corner
    smallProp(group, chunk, x0 + 0.4, z0 + 7.6, 0.3, (p) => {                            // brush jar
      p(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 8), roomMat.glass, 0, 0.06, 0);
      for (let i = 0; i < 4; i++) p(new THREE.CylinderGeometry(0.006, 0.006, 0.2, 5), roomMat.woodDark, (i - 1.5) * 0.02, 0.16, 0, 0, 0, (i - 1.5) * 0.15);
    });
    smallProp(group, chunk, x0 + 1.1, z0 + 7.6, 0, (p) => {                              // closed paint can
      p(new THREE.CylinderGeometry(0.085, 0.085, 0.19, 12), roomMat.plastic, 0, 0.095, 0);
      p(new THREE.CylinderGeometry(0.06, 0.06, 0.01, 10), roomMat.metal, 0, 0.196, 0);
    });
    smallProp(group, chunk, x0 + 4.0, z0 + 7.6, 0, (p) => {                              // open bucket, red at the rim
      p(new THREE.CylinderGeometry(0.11, 0.09, 0.22, 12), roomMat.metal, 0, 0.11, 0);
      p(new THREE.CylinderGeometry(0.095, 0.095, 0.015, 12), redGlowMat, 0, 0.215, 0);
    });
    smallProp(group, chunk, x0 + 6.5, z0 + 7.6, 0.8, (p) => {
      p(new THREE.CylinderGeometry(0.085, 0.085, 0.19, 12), roomMat.plastic, 0, 0.095, 0);
    });
    for (let i = 0; i < 5; i++) {                                                        // crayon stubs by the skirting
      smallProp(group, chunk, x0 + 2.0 + i * 0.7, z0 + 7.75, i * 1.3, (p) => {
        p(new THREE.CylinderGeometry(0.008, 0.008, 0.05, 6), [roomMat.bookA, roomMat.bookB, roomMat.bookC, roomMat.amber, roomMat.cordBlue][i], 0, 0.008, 0, 0, 0, Math.PI / 2);
      });
    }
    addBox(0.3, 0.3, 0.1, roomMat.plastic, 0.12, 2.2, 6.5, 0, false);                    // round speaker disc, west wall
    addLight(0xfff2cf, 7, 6, 4, 2.3, 1.0);                                               // lit only at the mouth
  } else if (type === 'office') {
    // pink walls, paper three layers deep
    furn(0.55, 2.75, Math.PI / 2, (p) => {                                               // the desk run, buried
      p(new THREE.BoxGeometry(2.5, 0.05, 0.75), roomMat.wood, 0, 0.73, 0);
      for (const s of [-1, 1]) p(new THREE.BoxGeometry(0.05, 0.72, 0.7), roomMat.metal, s * 1.2, 0.36, 0);
      for (let i = 0; i < 12; i++) {                                                     // shingled paper drifts
        p(new THREE.BoxGeometry(0.21, 0.0025, 0.29), roomMat.paper,
          -1.0 + (i % 6) * 0.4, 0.757 + Math.floor(i / 6) * 0.004 + (i % 3) * 0.002, (i % 4) * 0.1 - 0.15, i * 0.6);
      }
      p(new THREE.BoxGeometry(0.21, 0.0025, 0.29), roomMat.paper, 0.4, 0.45, 0.42, 0.9, 0.5);   // one sliding off the edge
      p(new THREE.BoxGeometry(0.42, 0.36, 0.4), roomMat.plastic, -0.7, 0.96, -0.12);     // white CRT computer
      p(new THREE.BoxGeometry(0.34, 0.26, 0.02), roomMat.glass, -0.7, 0.97, 0.09);
      p(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 6), roomMat.dark, 0.5, 1.18, -0.2, 0, 0, 0.5);   // swing-arm lamp
      p(new THREE.CylinderGeometry(0.05, 0.09, 0.12, 10), roomMat.dark, 0.28, 1.3, -0.08, 0, 0, 1.2);
      p(new THREE.BoxGeometry(0.2, 0.06, 0.16), roomMat.cream, 1.0, 0.79, 0.18, 0.2);    // beige phone
      p(new THREE.BoxGeometry(0.05, 0.04, 0.18), roomMat.cream, 0.93, 0.84, 0.18, 0.2);
      p(new THREE.BoxGeometry(0.16, 0.05, 0.2), roomMat.linen, 0.62, 0.78, -0.2);        // adding machine
      for (let i = 0; i < 3; i++) p(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 8), roomMat.paper, -1.05 + i * 0.09, 0.79, -0.22 + (i % 2) * 0.06, 0, 0, Math.PI / 2 + i * 0.1);  // blueprint rolls
      p(new THREE.CylinderGeometry(0.04, 0.035, 0.1, 8), roomMat.fabric2, 1.14, 0.81, -0.18);   // mug
    });
    addCollider(0.55, 2.75, 0.45, 1.35);
    addPlane(0.9, 0.6, roomMat.corkboard, 1.5, 1.5, S - 0.09, Math.PI);                  // corkboard
    addPlane(0.5, 0.5, roomMat.clock, 4, 2.1, S - 0.09, Math.PI);                        // brass clock
    furn(4, 7.55, Math.PI, (p) => {                                                      // literature organizer, every slot stuffed
      p(new THREE.BoxGeometry(1.0, 0.9, 0.42), roomMat.metal, 0, 0.45, 0);
      p(new THREE.BoxGeometry(1.0, 0.78, 0.3), roomMat.dark, 0, 1.32, -0.05);
      for (let r2 = 0; r2 < 4; r2++) for (let c2 = 0; c2 < 5; c2++) {
        p(new THREE.BoxGeometry(0.15, 0.13, 0.06), roomMat.paper, -0.4 + c2 * 0.2, 1.04 + r2 * 0.18, 0.12, 0, 0.12);
      }
      p(new THREE.BoxGeometry(0.5, 0.16, 0.3), roomMat.bookA, -0.2, 1.79, -0.05);        // books on top
      p(new THREE.BoxGeometry(0.36, 0.12, 0.26), roomMat.bookC, 0.25, 1.77, -0.05, 0.2);
    });
    addCollider(4, 7.55, 0.55, 0.3);
    furn(5.6, 7.5, Math.PI, (p) => {                                                     // side table: stacks + fax
      p(new THREE.BoxGeometry(0.8, 0.62, 0.45), roomMat.wood, 0, 0.31, 0);
      p(new THREE.BoxGeometry(0.3, 0.12, 0.34), roomMat.paper, -0.18, 0.68, 0);
      p(new THREE.BoxGeometry(0.34, 0.1, 0.3), roomMat.plastic, 0.2, 0.67, 0, 0.1);
    });
    addCollider(5.6, 7.5, 0.42, 0.25);
    addPlane(6.6, 2.3, roomMat.elevations, S - 0.09 - TH, 1.35, 4.0, -Math.PI / 2);      // east wall: 100% drawings
    furn(7.1, 7.0, 2.6, FURN.officeChair, floaty === 2);                                 // wedged task chair
    addCollider(7.1, 7.0, 0.3, 0.3);
    smallProp(group, chunk, x0 + 1.6, z0 + 4.6, 0.7, (p) => {                            // the folded hand-drawn map
      p(new THREE.BoxGeometry(0.105, 0.004, 0.148), roomMat.paper, 0, 0.005, 0);
      p(new THREE.BoxGeometry(0.105, 0.001, 0.006), roomMat.linen, 0, 0.008, 0);
    });
    addLight(0xffeede, 8, 10, 4, 2.3, 4);
  } else if (type === 'congregation') {
    // one chair, instanced into a congregation
    addPlane(2.2, WH, roomMat.plasterBrown, 0.1 + TH, WH / 2, 4.0, Math.PI / 2);         // mustard strip, west wall
    addBox(4, 0.34, 4, roomMat.plasterBrown, 6, Math.min(2.6, H - 0.2) - 0.17, 6, 0, false);   // dropped dark soffit, NE
    const gaze = [];                                                                      // upright chairs that remember you
    gaze.push({ g: furn(3.0, 2.5, -Math.PI / 2 + 0.35, FURN.ladderChair), x: x0 + 3.0, z: z0 + 2.5 });   // facing the blank wall
    addCollider(3.0, 2.5, 0.26, 0.26);
    furn(4.5, 4.5, 0, FURN.cafeTable);                                                   // the totem
    for (let i = 0; i < 3; i++) {
      furn(4.5 + (i - 1) * 0.2, 4.5 + (i % 2) * 0.18 - 0.09, i * 1.9, FURN.ladderChair, false,
        { y: 0.76 + i * 0.5, rx: Math.PI, rz: (i - 1) * 0.14 });
    }
    furn(5.2, 4.8, 2.4, FURN.ladderChair, false, { rz: 0.6, y: 0.2 });                   // one leaning into it
    addCollider(4.5, 4.5, 0.75, 0.75);
    furn(6.5, 5.5, 0.5, FURN.cafeTable);                                                 // smaller stack
    furn(6.5, 5.5, 1.2, FURN.ladderChair, false, { y: 0.76, rx: Math.PI });
    addCollider(6.5, 5.5, 0.55, 0.55);
    for (let i = 0; i < 4; i++) {                                                        // jammed cluster at the dark lip
      const lx = 6.2 + (i % 2) * 0.5, lz = 7.2 + Math.floor(i / 2) * 0.45;
      const cg = furn(lx, lz, i === 2 ? Math.PI / 2 : i * 1.7, FURN.ladderChair, floaty === 1 && i === 1);
      if (!(floaty === 1 && i === 1)) gaze.push({ g: cg, x: x0 + lx, z: z0 + lz });
    }
    addCollider(6.45, 7.4, 0.7, 0.6);
    furn(6.7, 7.2, 0.4, (p) => {                                                         // the draped pale jacket
      p(new THREE.BoxGeometry(0.4, 0.34, 0.06), roomMat.linen, 0, 0.88, -0.2, 0, -0.12);
      p(new THREE.BoxGeometry(0.36, 0.2, 0.05), roomMat.linen, 0, 0.66, -0.16, 0, -0.3);
    });
    gaze.push({ g: furn(5.5, 6.8, 2.8, FURN.ladderChair), x: x0 + 5.5, z: z0 + 6.8 });   // a stray
    addCollider(5.5, 6.8, 0.26, 0.26);
    // the procedural wrongness: leave, come back, and they have all turned to face you
    chunk.watchRooms.push({ cx: x0 + 4, cz: z0 + 4, chairs: gaze, key: world.F + ':' + tx + ',' + tz });
    furn(0.35, 5.0, Math.PI / 2 + 1.5, (p) => {                                          // a black door, open against the wall
      p(new THREE.BoxGeometry(0.9, 2.05, 0.05), roomMat.dark, 0.45, 1.02, 0);
      p(new THREE.SphereGeometry(0.025, 8, 6), roomMat.chrome, 0.78, 1.0, 0.04);
    });
    smallProp(group, chunk, x0 + 0.5, z0 + 3.0, 0.06, (p) => {                           // fallen handrail
      p(new THREE.CylinderGeometry(0.016, 0.016, 2.0, 6), roomMat.woodDark, 0, 0.018, 0, 0, 0, Math.PI / 2);
    });
    addBox(0.16, 0.1, 0.02, roomMat.dark, S - 0.1, 1.5, 3.2, 0, false);                  // room-number plaque, no door
    addLight(0xfff2cf, 7, 9, 4, 2.4, 3.4);
  } else if (type === 'static') {
    // no light but the screens
    let blueMesh = null;
    const blueM = new THREE.MeshBasicMaterial({ color: 0x2438c8 });
    chunk.owned.push(blueM);
    furn(4, 7.4, Math.PI, (p) => {                                                       // the live stack
      for (let i = 0; i < 3; i++) p(new THREE.BoxGeometry(0.6, 0.16, 0.42), roomMat.dark, 0, 0.09 + i * 0.17, 0);
      p(new THREE.BoxGeometry(0.62, 0.5, 0.5), roomMat.woodDark, 0, 0.78, 0, -0.5);      // CRT angled toward the entry
      p(new THREE.PlaneGeometry(0.45, 0.35), roomMat.osd, 0.12, 0.79, 0.225, -0.5);
      blueMesh = p(new THREE.PlaneGeometry(0.45, 0.35), blueM, 0.126, 0.79, 0.236, -0.5);   // the cut-to-blue overlay
      blueMesh.visible = false;
    });
    addCollider(4, 7.4, 0.5, 0.4);
    furn(2.5, 7.5, Math.PI + 0.3, FURN.tvSet);                                           // dead CRTs
    addCollider(2.5, 7.5, 0.4, 0.35);
    furn(5.5, 7.4, Math.PI, FURN.tvSet, false, { rx: -0.7, y: 0.25 });                   // tipped back against a box
    addBox(0.5, 0.4, 0.45, roomMat.cardboard, 5.5, 0.2, 7.75);
    addCollider(5.5, 7.5, 0.42, 0.42);
    furn(1.5, 7.0, Math.PI - 0.4, (p) => {                                               // open road case, lid up
      p(new THREE.BoxGeometry(0.7, 0.35, 0.5), roomMat.dark, 0, 0.18, 0);
      p(new THREE.BoxGeometry(0.7, 0.7, 0.06), roomMat.dark, 0, 0.7, -0.26, 0, 0.12);
      for (const s of [-1, 1]) p(new THREE.BoxGeometry(0.06, 0.37, 0.52), roomMat.chrome, s * 0.36, 0.18, 0);
    });
    addCollider(1.5, 7.0, 0.42, 0.32);
    furn(7.45, 5.0, -Math.PI / 2, (p) => {                                               // reel deck on a side shelf
      p(new THREE.BoxGeometry(0.7, 0.08, 0.5), roomMat.wood, 0, 1.0, 0);
      for (const s of [-1, 1]) p(new THREE.BoxGeometry(0.05, 1.0, 0.45), roomMat.metal, s * 0.32, 0.5, 0);
      p(new THREE.BoxGeometry(0.5, 0.12, 0.4), roomMat.dark, 0, 1.1, 0);
      p(new THREE.CylinderGeometry(0.15, 0.15, 0.02, 16), roomMat.dark, 0, 1.18, 0);
      p(new THREE.CylinderGeometry(0.014, 0.014, 0.05, 6), roomMat.chrome, 0, 1.2, 0);
    });
    addCollider(7.45, 5.0, 0.3, 0.4);
    addBox(0.34, 0.34, 0.34, roomMat.dark, 6.8, 0.17, 7.4);                              // speaker cube
    smallProp(group, chunk, x0 + 3.2, z0 + 5.5, 0.4, (p) => PROPS.cableRun(p, 3));
    smallProp(group, chunk, x0 + 2.4, z0 + 3.6, 1.9, (p) => PROPS.cableRun(p, 7));
    smallProp(group, chunk, x0 + 4.6, z0 + 6.8, 0, PROPS.vhs);
    smallProp(group, chunk, x0 + 4.95, z0 + 6.7, 0.9, PROPS.cassette);
    // the screen glow — registered so it can cut to solid blue now and then
    const sl = new THREE.PointLight(0x6a5ad8, 7, 9, 1.8);
    sl.position.set(x0 + 4, 1.3, z0 + 6.8);
    group.add(sl);
    chunk.statics.push({ blue: blueMesh, light: sl, nextAt: 0, until: 0 });
  } else if (type === 'poolside') {
    // tile deck around a drained basin
    addPlane(S, S, roomMat.tile, S / 2, 0.028, S / 2, 0, -Math.PI / 2);
    furn(4.4, 4.0, 0, (p) => {
      const W2 = 2.1, D2 = 1.5;                                       // basin half-extents
      for (const [sx, sz, w2, d2] of [[0, -D2, W2 * 2 + 0.3, 0.3], [0, D2, W2 * 2 + 0.3, 0.3], [-W2, 0, 0.3, D2 * 2 - 0.3], [W2, 0, 0.3, D2 * 2 - 0.3]]) {
        p(new THREE.BoxGeometry(w2, 0.34, d2), roomMat.tile, sx, 0.17, sz);   // coping
      }
      for (const [sx, sz, w2, d2] of [[0, -D2 + 0.3, W2 * 2 - 0.3, 0.02], [0, D2 - 0.3, W2 * 2 - 0.3, 0.02], [-W2 + 0.3, 0, 0.02, D2 * 2 - 0.6], [W2 - 0.3, 0, 0.02, D2 * 2 - 0.6]]) {
        p(new THREE.BoxGeometry(w2 || 0.02, 0.3, d2 || 0.02), roomMat.poolBlue, sx, 0.15, sz);   // stained inner walls
      }
      p(new THREE.BoxGeometry(W2 * 2 - 0.6, 0.02, D2 * 2 - 0.6), roomMat.poolDeep, 0, 0.04, 0);  // the dark bottom
      p(new THREE.CylinderGeometry(0.07, 0.07, 0.012, 10), roomMat.dark, 0.8, 0.052, 0.3);       // the drain
      // chrome ladder hooked over the coping
      for (const s2 of [-1, 1]) {
        p(new THREE.CylinderGeometry(0.02, 0.02, 0.62, 8), roomMat.chrome, 1.7 + s2 * 0.18, 0.42, -D2 - 0.05, 0, 0.5);
        p(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 8), roomMat.chrome, 1.7 + s2 * 0.18, 0.2, -D2 + 0.18);
      }
      for (let i = 0; i < 2; i++) p(new THREE.CylinderGeometry(0.016, 0.016, 0.36, 6), roomMat.chrome, 1.7, 0.12 + i * 0.16, -D2 + 0.18, 0, Math.PI / 2);
    });
    addCollider(4.4, 4.0, 2.35, 1.75);
    // lane rope coiled on the deck
    smallProp(group, chunk, x0 + 1.2, z0 + 6.6, 0.4, (p) => {
      for (let i = 0; i < 5; i++)
        p(new THREE.TorusGeometry(0.22 + (i % 2) * 0.03, 0.025, 6, 14), [roomMat.signRed, roomMat.plastic][i % 2], i * 0.03, 0.028 + i * 0.02, 0, 0, Math.PI / 2, 0);
    });
    // white slat loungers, one knocked over
    const lounger = (p) => {
      for (let i = 0; i < 5; i++) p(new THREE.BoxGeometry(0.56, 0.025, 0.22), roomMat.plastic, 0, 0.32, -0.5 + i * 0.26);
      for (let i = 0; i < 3; i++) p(new THREE.BoxGeometry(0.56, 0.025, 0.2), roomMat.plastic, 0, 0.42 + i * 0.13, 0.62 + i * 0.07, 0, -0.5);
      for (const sx of [-0.24, 0.24]) for (const sz of [-0.42, 0.42])
        p(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 6), roomMat.plastic, sx, 0.15, sz);
    };
    furn(6.6, 6.2, -0.5, lounger);
    addCollider(6.6, 6.2, 0.45, 0.75);
    furn(1.6, 1.6, 2.4, lounger, false, { rz: Math.PI * 0.94, y: 0.62 });        // flipped onto its back
    addCollider(1.6, 1.6, 0.45, 0.75);
    addPlane(0.9, 0.6, roomMat.signWhite, 0.1 + TH, 1.7, 5.6, Math.PI / 2);      // rules sign, rules unreadable
    addLight(0xdfeef2, 8, 10, 4, 2.3, 4);                                        // pale natatorium light
  }
}

function disposeChunk(ch) {
  scene.remove(ch.group);
  ch.group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  for (const o of ch.owned) o.dispose && o.dispose();
}

function chunkKey(x, z) { return x + ',' + z; }
function ensureChunks(allNow = false) {
  const pcx = Math.floor(player.x / CELL / CHUNK), pcz = Math.floor(player.z / CELL / CHUNK);
  const needed = new Set();
  for (let dx = -RADIUS; dx <= RADIUS; dx++) for (let dz = -RADIUS; dz <= RADIUS; dz++) {
    needed.add(chunkKey(pcx + dx, pcz + dz));
  }
  for (const [k, ch] of chunks) {
    const [x, z] = k.split(',').map(Number);
    if (Math.max(Math.abs(x - pcx), Math.abs(z - pcz)) > RADIUS + 1) {
      disposeChunk(ch); chunks.delete(k);
    }
  }
  let built = 0;
  for (const k of needed) {
    if (chunks.has(k)) continue;
    const [x, z] = k.split(',').map(Number);
    chunks.set(k, buildChunk(x, z));
    built++;
    if (!allNow && built >= 1) break;
  }
}
function dropChunksOutside(r) {
  const pcx = Math.floor(player.x / CELL / CHUNK), pcz = Math.floor(player.z / CELL / CHUNK);
  for (const [k, ch] of chunks) {
    const [x, z] = k.split(',').map(Number);
    if (Math.max(Math.abs(x - pcx), Math.abs(z - pcz)) > r) { disposeChunk(ch); chunks.delete(k); }
  }
}
function dropAllChunks() { for (const ch of chunks.values()) disposeChunk(ch); chunks.clear(); }

/* ---------------- the Still Life ---------------- */
let still = null, stillPlacedAt = -1, stillNextAt = 20;
function makeStill() {
  const g = new THREE.Group();
  const m = mats.still;
  const add = (geo, x, y, z) => { const mm = new THREE.Mesh(geo, m); mm.position.set(x, y, z); g.add(mm); };
  add(new THREE.BoxGeometry(0.16, 0.85, 0.18), -0.11, 0.425, 0);
  add(new THREE.BoxGeometry(0.16, 0.85, 0.18), 0.11, 0.425, 0);
  add(new THREE.BoxGeometry(0.44, 0.62, 0.24), 0, 1.16, 0);
  add(new THREE.BoxGeometry(0.12, 0.55, 0.14), -0.29, 1.18, 0);
  add(new THREE.BoxGeometry(0.12, 0.55, 0.14), 0.29, 1.18, 0);
  add(new THREE.SphereGeometry(0.13, 10, 8), 0, 1.62, 0);
  g.visible = false;
  scene.add(g);
  return g;
}
function tryPlaceStill(t) {
  if (state.special === 'pools') return;   // devoid of entities
  if (state.memories.length < 2 || still.visible || t < stillNextAt) return;
  const ang = rand(Math.floor(t * 997), 1) * Math.PI * 2;
  const dist = 13 + rand(Math.floor(t * 997), 2) * 8;
  const x = player.x + Math.cos(ang) * dist, z = player.z + Math.sin(ang) * dist;
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  if (monsterBlockedCell(cx, cz)) { stillNextAt = t + 3; return; }
  still.position.set((cx + 0.5) * CELL, 0, (cz + 0.5) * CELL);
  still.lookAt(player.x, 0, player.z);
  still.visible = true;
  stillPlacedAt = t;
}
function updateStill(t) {
  tryPlaceStill(t);
  if (!still.visible) return;
  const d = Math.hypot(still.position.x - player.x, still.position.z - player.z);
  if (d < 5.5) {
    still.visible = false;
    state.stills++;
    stillNextAt = t + 25 + Math.random() * 30;
    audio.vanish();
    toast(['it had your posture', 'it was standing the way you stand', 'a still life. of you.',
           'it did not breathe. neither did you.'][state.stills % 4]);
    save();
  } else if (t - stillPlacedAt > 30) {
    still.visible = false;
    stillNextAt = t + 25 + Math.random() * 30;
  }
}

/* ---------------- the Lifeform (it hunts) ---------------- */
const lifeform = {
  group: null, limbs: null, active: false,
  x: 0, z: 0, speed: 4.3,
  path: [], repathAt: 0, loseTimer: 0, nextSpawnAt: 50, thumpAt: 0, guardKey: '',
};
function makeLifeform() {
  // the film creature: a scribbled tangle for a head, long bent-wire limbs splayed wide
  const g = new THREE.Group();
  const mat = roomMat.lifeform;
  const part = (geo, x, y, z) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m;
  };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const wire = (pts, r = 0.032) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, r, 5, false);
  // head: the scribble ball
  const head = new THREE.Group();
  head.position.set(0, 2.26, 0);
  g.add(head);
  const hAdd = (mesh) => { head.add(mesh); return mesh; };
  hAdd(new THREE.Mesh(new THREE.TorusKnotGeometry(0.17, 0.05, 40, 6, 2, 3), mat));
  hAdd(new THREE.Mesh(new THREE.TorusKnotGeometry(0.13, 0.046, 36, 6, 3, 4), mat)).rotation.set(1.2, 0.5, 0.8);
  hAdd(new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), mat));
  for (let i = 0; i < 3; i++) {
    const ring = hAdd(new THREE.Mesh(new THREE.TorusGeometry(0.19 + i * 0.025, 0.02, 5, 14), mat));
    ring.rotation.set(rand(31, i) * 3, rand(32, i) * 3, rand(33, i) * 3);
  }
  // neck + spine: kinked strands with wire coils sliding down them
  part(wire([V(0, 2.26, 0), V(0.05, 2.02, 0.03), V(-0.03, 1.82, -0.02), V(0, 1.5, 0)], 0.036), 0, 0, 0);
  part(wire([V(-0.05, 2.1, 0), V(0.08, 1.88, 0.05), V(-0.06, 1.6, 0)], 0.024), 0, 0, 0);
  for (let i = 0; i < 3; i++) {
    const coil = part(new THREE.TorusGeometry(0.1 + (i % 2) * 0.03, 0.02, 5, 12), 0, 1.6 + i * 0.2, 0);
    coil.rotation.x = Math.PI / 2 + (rand(34, i) - 0.5) * 0.5;
    coil.rotation.z = (rand(35, i) - 0.5) * 0.6;
  }
  // limbs: pairs of splayed wire legs pivoted at the hip, long reaching arms at the shoulder
  const limbGroup = (x, y, strands) => {
    const lg = new THREE.Group();
    lg.position.set(x, y, 0);
    g.add(lg);
    for (const pts of strands) lg.add(new THREE.Mesh(wire(pts), mat));
    return lg;
  };
  const limbs = {
    legL: limbGroup(-0.08, 1.52, [
      [V(0, 0, 0), V(-0.3, -0.55, 0.28), V(-0.22, -1.0, 0.36), V(-0.46, -1.52, 0.5)],
      [V(0, 0, 0), V(-0.26, -0.5, -0.3), V(-0.4, -1.05, -0.32), V(-0.3, -1.52, -0.55)],
    ]),
    legR: limbGroup(0.08, 1.52, [
      [V(0, 0, 0), V(0.32, -0.5, 0.3), V(0.24, -1.02, 0.3), V(0.5, -1.52, 0.44)],
      [V(0, 0, 0), V(0.28, -0.55, -0.26), V(0.42, -1.0, -0.36), V(0.34, -1.52, -0.5)],
    ]),
    armL: limbGroup(-0.12, 2.04, [
      [V(0, 0, 0), V(-0.34, -0.3, 0.22), V(-0.3, -0.75, 0.4), V(-0.52, -1.18, 0.3)],
    ]),
    armR: limbGroup(0.12, 2.04, [
      [V(0, 0, 0), V(0.36, -0.28, 0.2), V(0.32, -0.7, 0.42), V(0.54, -1.14, 0.34)],
    ]),
  };
  for (const [lg, ly] of [[limbs.legL, -0.6], [limbs.legR, -0.72], [limbs.armL, -0.42]]) {
    const c = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.018, 5, 10), mat);
    c.position.set(0, ly, 0.12);
    c.rotation.x = Math.PI / 2.4;
    lg.add(c);
  }
  g.visible = false;
  scene.add(g);
  lifeform.group = g;
  lifeform.limbs = limbs;
}
function monsterBlockedCell(cx, cz) {
  return world.occupied(cx, cz) || world.isHole(cx, cz) || world.isMound(cx, cz) ||
         world.furniturePile(cx, cz) ||
         !!world.setRoomAt(Math.floor(cx / 3), Math.floor(cz / 3));   // it will not enter the rooms
}
function monsterWallBlocked(x, z) {
  const r = 0.3;
  for (const dx of [-r, r]) for (const dz of [-r, r]) {
    if (world.occupied(Math.floor((x + dx) / CELL), Math.floor((z + dz) / CELL))) return true;
  }
  if (inPit(x, z)) return true;
  return colliderBlocked(x, z, 0.28) || wallBlocked(x, z, 0.26);
}
function findPath(sx, sz, gx, gz) {
  const key = (x, z) => x + ',' + z;
  const goal = key(gx, gz);
  const start = key(sx, sz);
  if (start === goal) return [];
  const prev = new Map([[start, null]]);
  const q = [[sx, sz]];
  let head = 0, found = false;
  while (head < q.length && head < 2600 && !found) {
    const [x, z] = q[head++];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz, k = key(nx, nz);
      if (prev.has(k) || monsterBlockedCell(nx, nz)) continue;
      if (dx === 1 && world.hasWallV(x + 1, z)) continue;     // walls block its path
      if (dx === -1 && world.hasWallV(x, z)) continue;
      if (dz === 1 && world.hasWallH(x, z + 1)) continue;
      if (dz === -1 && world.hasWallH(x, z)) continue;
      if (dz === 1 && world.doorPlugAt(nx, z + 1) === 1) continue;   // plugged doorways: it won't squeeze
      if (dz === -1 && world.doorPlugAt(nx, z) === 1) continue;
      if (dx === 1 && world.doorPlugAt(x + 1, z) === 2) continue;
      if (dx === -1 && world.doorPlugAt(x, z) === 2) continue;
      prev.set(k, key(x, z));
      if (k === goal) { found = true; break; }
      q.push([nx, nz]);
    }
  }
  if (!found) return null;
  const path = [];
  let cur = goal;
  while (cur !== start) {
    const [x, z] = cur.split(',').map(Number);
    path.push([x, z]);
    cur = prev.get(cur);
  }
  return path.reverse();
}
function spawnLifeform(x, z) {
  lifeform.x = x; lifeform.z = z;
  lifeform.active = true;
  lifeform.group.visible = true;
  lifeform.path = []; lifeform.repathAt = 0; lifeform.loseTimer = 0;
  lifeform.speed = Math.min(5.15, 4.25 + state.floor * 0.12);
  audio.screech();
  audio.setMusicMood('duck');
  flickerPulse = Math.max(flickerPulse, 1.3);
  toast(['something noticed you', 'the hum changed', 'it is awake down here'][hash(state.floor, state.memories.length) % 3], 2600);
}
function despawnLifeform() {
  lifeform.active = false;
  if (lifeform.group) lifeform.group.visible = false;
  audio.setMusicMood(world && world.P.style === 'pools' ? 'muffled' : 'open');
}
function caughtByLifeform() {
  state.taken = (state.taken || 0) + 1;
  const intact = state.memories.filter(m => !m.corrupted);
  if (intact.length) {
    intact[Math.floor(Math.random() * intact.length)].corrupted = true;
  }
  save();
  audio.caught();
  despawnLifeform();
  lifeform.nextSpawnAt = clock.elapsedTime + 60 + Math.random() * 60;
  fadeEl.style.background = '#1a0303';
  setTimeout(() => { fadeEl.style.background = '#000'; }, 1600);
  doFloorChange(state.floor + 1, player.x + (Math.random() - 0.5) * 30, player.z + (Math.random() - 0.5) * 30, true);
  setTimeout(() => toast('it took you deeper. and it kept one of your memories.', 5200), 1700);
}
function updateLifeform(t, dt) {
  if (!lifeform.active) {
    // it guards the green doors
    let nearExit = false;
    if (world.exitSpot) {
      const ex = (world.exitSpot.tx * 3 + 1.5) * CELL, ez = (world.exitSpot.tz * 3 + 1.5) * CELL;
      nearExit = Math.hypot(player.x - ex, player.z - ez) < 28;
    }
    const floorKey = state.floor + ':' + (state.special || '');
    const guardDue = nearExit && lifeform.guardKey !== floorKey;
    const eligible = state.special !== 'pools' && (state.floor >= 1 || state.memories.length >= 3 || guardDue);
    if (!eligible || (t < lifeform.nextSpawnAt && !guardDue)) return;
    if (guardDue) lifeform.guardKey = floorKey;
    const ang = Math.random() * Math.PI * 2;
    const d = 20 + Math.random() * 10;
    const cx = Math.floor((player.x + Math.cos(ang) * d) / CELL);
    const cz = Math.floor((player.z + Math.sin(ang) * d) / CELL);
    if (monsterBlockedCell(cx, cz)) { lifeform.nextSpawnAt = t + 2; return; }
    spawnLifeform((cx + 0.5) * CELL, (cz + 0.5) * CELL);
    return;
  }
  const dist = Math.hypot(player.x - lifeform.x, player.z - lifeform.z);
  // repath
  if (t > lifeform.repathAt) {
    lifeform.repathAt = t + 0.7;
    const pcx = Math.floor(player.x / CELL), pcz = Math.floor(player.z / CELL);
    const mcx = Math.floor(lifeform.x / CELL), mcz = Math.floor(lifeform.z / CELL);
    const playerSafe = monsterBlockedCell(pcx, pcz);   // inside a copied room (or over a hole)
    lifeform.path = playerSafe ? [] : (findPath(mcx, mcz, pcx, pcz) || []);
  }
  // follow waypoints (straight at player when adjacent)
  let txw = player.x, tzw = player.z;
  if (lifeform.path.length && dist > 3) {
    const [wx, wz] = lifeform.path[0];
    txw = (wx + 0.5) * CELL; tzw = (wz + 0.5) * CELL;
    if (Math.hypot(txw - lifeform.x, tzw - lifeform.z) < 0.6) lifeform.path.shift();
  }
  const dl = Math.hypot(txw - lifeform.x, tzw - lifeform.z) || 1;
  const stepLen = lifeform.speed * dt;
  const nx = lifeform.x + ((txw - lifeform.x) / dl) * stepLen;
  const nz = lifeform.z + ((tzw - lifeform.z) / dl) * stepLen;
  if (!monsterWallBlocked(nx, lifeform.z)) lifeform.x = nx;
  if (!monsterWallBlocked(lifeform.x, nz)) lifeform.z = nz;
  // pose: lurching, too fluid
  lifeform.group.position.set(lifeform.x, Math.abs(Math.sin(t * 7)) * 0.04, lifeform.z);
  lifeform.group.lookAt(player.x, 0, player.z);
  const ph = t * 8.5;
  lifeform.limbs.legL.rotation.x = Math.sin(ph) * 0.6;
  lifeform.limbs.legR.rotation.x = -Math.sin(ph) * 0.6;
  lifeform.limbs.armL.rotation.x = -Math.sin(ph) * 0.5 - 0.15;
  lifeform.limbs.armR.rotation.x = Math.sin(ph) * 0.5 - 0.15;
  // heartbeat with proximity
  if (t > lifeform.thumpAt) {
    const c = Math.max(0, Math.min(1, 1 - dist / 32));
    lifeform.thumpAt = t + 1.15 - c * 0.8;
    audio.thump(c);
  }
  // caught
  if (dist < 1.2 && !transitioning) { caughtByLifeform(); return; }
  // it loses interest
  const pcx = Math.floor(player.x / CELL), pcz = Math.floor(player.z / CELL);
  if (dist > 28) lifeform.loseTimer += dt;
  else if (monsterBlockedCell(pcx, pcz) && dist > 3) lifeform.loseTimer += dt * 0.6;  // waiting outside the room
  else lifeform.loseTimer = 0;
  if (lifeform.loseTimer > 7) {
    despawnLifeform();
    lifeform.nextSpawnAt = t + Math.max(25, 55 - state.floor * 5) + Math.random() * 60;
    audio.vanish();
    toast('it lost you. it does not forget.', 3000);
  }
}

/* ---------------- audio ---------------- */
const audio = (() => {
  let ctx = null, master = null, humG = null, humOsc = null, humOsc2 = null, subOsc = null, subG = null, noiseSrc = null,
    musicG = null, musicLP = null, tensG = null, tensLFOG = null;
  // music scenes: the lobby keeps its own song forever; every other level shuffles the collection
  const LOBBY_TRACK = './assets/six-forty-seven.mp3';
  const TRACKS = Array.from({ length: 9 }, (_, i) => `./assets/music/track${i + 1}.mp3`);
  const trackBufs = new Map();
  let curSrc = null, curG = null, musicMode = '', lastIdx = -1, pendingScene = 'lobby';
  function loadBuf(url) {
    if (trackBufs.has(url)) return Promise.resolve(trackBufs.get(url));
    return fetch(url).then(r => r.arrayBuffer()).then(b => ctx.decodeAudioData(b))
      .then(buf => { trackBufs.set(url, buf); return buf; });
  }
  function stopCur(fade = 1.4) {
    if (!curSrc) return;
    const s = curSrc, g = curG, t0 = ctx.currentTime;
    curSrc = null; curG = null;
    try {
      s.onended = null;
      g.gain.setValueAtTime(g.gain.value, t0);
      g.gain.linearRampToValueAtTime(0, t0 + fade);
      s.stop(t0 + fade + 0.05);
    } catch (e) { /* already stopped */ }
  }
  function startBuf(buf, loop) {
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = loop;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(g); g.connect(musicLP);
    src.start();
    g.gain.linearRampToValueAtTime(1, ctx.currentTime + 3);
    curSrc = src; curG = g;
    return src;
  }
  function setScene(scene) {        // 'lobby' | 'random'
    pendingScene = scene;
    if (!ctx) return;
    if (scene === 'lobby' && musicMode === 'lobby') return;   // the lobby song never restarts
    musicMode = scene;
    playScene();   // 'random' re-rolls every call — and it is only called on a floor change
  }
  function playScene() {
    stopCur();
    if (musicMode === 'lobby') {
      loadBuf(LOBBY_TRACK).then(buf => {
        if (musicMode === 'lobby' && !curSrc) startBuf(buf, true);
      }).catch(() => {});
    } else {
      let idx = Math.floor(Math.random() * TRACKS.length);
      if (TRACKS.length > 1 && idx === lastIdx) idx = (idx + 1) % TRACKS.length;
      lastIdx = idx;
      loadBuf(TRACKS[idx]).then(buf => {
        if (musicMode !== 'random' || curSrc) return;
        startBuf(buf, true);   // a floor keeps its song, looping, until you leave it
      }).catch(() => {});
    }
  }
  let noiseBuf = null;
  function noiseBuffer() {   // one shared immutable buffer — bursts fire every footstep
    if (noiseBuf) return noiseBuf;
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }
  function init() {
    if (ctx) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = 0.55; master.connect(ctx.destination);
      // fluorescent hum
      humG = ctx.createGain(); humG.gain.value = 0.016; humG.connect(master);
      humOsc = ctx.createOscillator(); humOsc.type = 'square'; humOsc.frequency.value = 120;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 240; bp.Q.value = 2;
      humOsc.connect(bp); bp.connect(humG); humOsc.start();
      humOsc2 = ctx.createOscillator(); humOsc2.type = 'sawtooth'; humOsc2.frequency.value = 60;
      const lp0 = ctx.createBiquadFilter(); lp0.type = 'lowpass'; lp0.frequency.value = 200;
      const g2 = ctx.createGain(); g2.gain.value = 0.35;
      humOsc2.connect(lp0); lp0.connect(g2); g2.connect(humG); humOsc2.start();
      // air noise
      noiseSrc = ctx.createBufferSource(); noiseSrc.buffer = noiseBuffer(); noiseSrc.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
      const ng = ctx.createGain(); ng.gain.value = 0.012;
      noiseSrc.connect(lp); lp.connect(ng); ng.connect(master); noiseSrc.start();
      // depth drone
      subOsc = ctx.createOscillator(); subOsc.type = 'sine'; subOsc.frequency.value = 38;
      subG = ctx.createGain(); subG.gain.value = 0;
      subOsc.connect(subG); subG.connect(master); subOsc.start();
      // the hunt's own music: a dissonant low cluster with a slow throb, silent until needed
      tensG = ctx.createGain(); tensG.gain.value = 0;
      tensG.connect(master);
      const tlp = ctx.createBiquadFilter(); tlp.type = 'lowpass'; tlp.frequency.value = 520;
      tlp.connect(tensG);
      for (const [f, lv] of [[46, 0.7], [92, 1], [97.5, 0.9], [184.5, 0.4]]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
        const og = ctx.createGain(); og.gain.value = lv;
        o.connect(og); og.connect(tlp); o.start();
      }
      const tlfo = ctx.createOscillator(); tlfo.frequency.value = 1.35;   // the throb
      tensLFOG = ctx.createGain(); tensLFOG.gain.value = 0;
      tlfo.connect(tensLFOG); tensLFOG.connect(tensG.gain); tlfo.start();
      // music bus (per-track sources fade through musicLP → musicG)
      musicG = ctx.createGain(); musicG.gain.value = 0;
      musicLP = ctx.createBiquadFilter(); musicLP.type = 'lowpass'; musicLP.frequency.value = 20000;
      musicLP.connect(musicG); musicG.connect(master);
      musicG.gain.linearRampToValueAtTime(0.16, ctx.currentTime + 4);   // fade the bus in
      musicMode = '';
      setScene(pendingScene);
    } catch (e) { ctx = null; }
  }
  function burst({ dur = 0.08, type = 'lowpass', freq = 600, gain = 0.12, slide = 0 }) {
    if (!ctx) return;
    const s = ctx.createBufferSource(); s.buffer = noiseBuffer(); // short-lived; fine
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    if (slide) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t); s.stop(t + dur + 0.05);
  }
  return {
    init,
    setFloor(f) {
      if (!ctx) return;
      humOsc.frequency.value = 120 / (1 + f * 0.09);
      humOsc2.frequency.value = 60 / (1 + f * 0.09);
      subG.gain.value = Math.min(0.06, f * 0.018);
    },
    setMusicScene: setScene,
    musicInfo: () => ({ mode: musicMode, idx: lastIdx }),
    setMusicMood(mood) {   // 'open' | 'muffled' (pools) | 'duck' (chased)
      if (!ctx || !musicG) return;
      const t0 = ctx.currentTime;
      musicLP.frequency.linearRampToValueAtTime(mood === 'muffled' ? 650 : 20000, t0 + 1.2);
      // when it notices you, the floor's song gets out of the way and the hunt's music rises
      const hunt = mood === 'duck';
      musicG.gain.linearRampToValueAtTime(hunt ? 0.03 : 0.16, t0 + 1.2);
      tensG.gain.cancelScheduledValues(t0);
      tensG.gain.setValueAtTime(tensG.gain.value, t0);
      tensG.gain.linearRampToValueAtTime(hunt ? 0.09 : 0, t0 + (hunt ? 0.7 : 2.4));
      tensLFOG.gain.linearRampToValueAtTime(hunt ? 0.035 : 0, t0 + 1);
    },
    step(run, splash) {
      if (splash) { burst({ dur: 0.22, type: 'bandpass', freq: 1100, gain: 0.18, slide: -700 }); return; }
      burst({ dur: 0.07, freq: run ? 750 : 550, gain: run ? 0.16 : 0.11 });
    },
    drip() { burst({ dur: 0.25, type: 'bandpass', freq: 2600, gain: 0.04, slide: -1800 }); },
    click() { burst({ dur: 0.035, type: 'highpass', freq: 1800, gain: 0.22 }); },
    land() { burst({ dur: 0.2, freq: 300, gain: 0.3 }); },
    zap() { burst({ dur: 0.05, type: 'highpass', freq: 2400, gain: 0.05 }); },
    whoosh() { burst({ dur: 1.1, freq: 1200, gain: 0.2, slide: -1050 }); },
    vanish() { burst({ dur: 0.6, type: 'bandpass', freq: 900, gain: 0.12, slide: -700 }); },
    fall() { burst({ dur: 0.9, freq: 500, gain: 0.25, slide: 1400 }); },
    screech() {
      if (!ctx) return;
      const t0 = ctx.currentTime;
      for (const f of [620, 663, 588]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth';
        o.frequency.setValueAtTime(f, t0);
        o.frequency.exponentialRampToValueAtTime(f * 0.28, t0 + 1.15);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.045, t0 + 0.07);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.25);
        o.connect(g); g.connect(master);
        o.start(t0); o.stop(t0 + 1.3);
      }
    },
    thump(intensity) {
      if (!ctx || intensity <= 0.02) return;
      const t0 = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 46;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, t0);
      g.gain.exponentialRampToValueAtTime(0.05 + 0.2 * intensity, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);
      o.connect(g); g.connect(master);
      o.start(t0); o.stop(t0 + 0.32);
    },
    caught() {
      burst({ dur: 1.5, freq: 2200, gain: 0.5, slide: -2100 });
      this.thump(1.6);
    },
    whisper(text) {
      try {
        if (!('speechSynthesis' in window)) return;
        if (speechSynthesis.speaking) return;
        const u = new SpeechSynthesisUtterance(text);
        u.volume = 0.22; u.rate = 0.66; u.pitch = 0.3;
        speechSynthesis.speak(u);
      } catch (e) { /* fine */ }
    },
  };
})();

/* ---------------- player ---------------- */
const player = { x: (SPAWN_CX + 0.5) * CELL, z: (SPAWN_CZ + 0.5) * CELL, y: 0, vy: 0, grounded: true };
let yaw = 0.6, pitch = 0;
const keys = new Set();
let holeCell = null;
let started = false, locked = false, transitioning = false;
let spawnGraceUntil = 0;

function colliderBlocked(x, z, r) {
  for (const ch of chunks.values()) {
    for (const c of ch.colliders) {
      if (x > c.minX - r && x < c.maxX + r && z > c.minZ - r && z < c.maxZ + r) return true;
    }
  }
  return false;
}
function wallBlocked(x, z, r) {
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    const ax = cx + dx, az = cz + dz;
    if (world.hasWallH(ax, az) &&
        x > ax * CELL - r && x < (ax + 1) * CELL + r && Math.abs(z - az * CELL) < 0.13 + r) return true;
    if (world.hasWallV(ax, az) &&
        z > az * CELL - r && z < (az + 1) * CELL + r && Math.abs(x - ax * CELL) < 0.13 + r) return true;
  }
  return false;
}
function inPit(x, z) {
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  if (!world.isHole(cx, cz)) return false;
  const s = world.holeShape(cx, cz);
  const d = Math.hypot(x - s.hx, z - s.hz);
  return d < world.holeRadiusAt(s, Math.atan2(z - s.hz, x - s.hx)) - 0.12;
}
function groundHeight(x, z) {
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  if (!world.isMound(cx, cz)) return 0;
  const m = world.moundShape(cx, cz);
  const d = Math.hypot(x - m.mx, z - m.mz);
  if (d >= m.r) return 0;
  const f = d / m.r;
  return m.h * Math.pow(1 - f * f, 1.5);
}
function blockedAt(x, z) {
  const r = 0.32;
  for (const dx of [-r, r]) for (const dz of [-r, r]) {
    const cx = Math.floor((x + dx) / CELL), cz = Math.floor((z + dz) / CELL);
    if (player.y < -0.05) {
      if (!holeCell || cx !== holeCell[0] || cz !== holeCell[1]) return true;
    } else if (world.occupied(cx, cz)) return true;
  }
  if (player.y > -0.05 && (colliderBlocked(x, z, 0.3) || wallBlocked(x, z, 0.3))) return true;
  return false;
}
function spawnHazard(cx, cz) {
  if (world.occupied(cx, cz) || world.isHole(cx, cz)) return true;
  if (world.slimColumn(cx, cz) || world.stairsAt(cx, cz) || world.doorUp(cx, cz)) return true;
  if (world.furniturePile(cx, cz)) return true;                 // never wake inside the stock piles
  if (world.doorPlugAt(cx, cz) || world.doorPlugAt(cx, cz + 1) === 1 || world.doorPlugAt(cx + 1, cz) === 2) return true;
  if (world.inPitsRegion(cx, cz)) return true;                  // never wake on a pit bridge
  const tx = Math.floor(cx / 3), tz = Math.floor(cz / 3);
  if (world.setRoomAt(tx, tz) || world.siteAt(tx, tz)) return true;   // furniture & crate colliders
  if (world.exitSpot && world.exitSpot.tx === tx && world.exitSpot.tz === tz) return true;
  return false;
}
function findFreeCellNear(cx, cz) {
  for (let r = 0; r < 32; r++) {
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      if (!spawnHazard(cx + dx, cz + dz)) return [cx + dx, cz + dz];
    }
  }
  return [cx, cz];
}
function unstickPlayer() {
  // chunks (and their colliders) now exist — if we still woke inside something, step out
  if (!colliderBlocked(player.x, player.z, 0.34) && !wallBlocked(player.x, player.z, 0.32)) return;
  for (let r = 1; r < 14; r++) {
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const nx = player.x + dx * 1.1, nz = player.z + dz * 1.1;
      if (spawnHazard(Math.floor(nx / CELL), Math.floor(nz / CELL))) continue;
      if (!colliderBlocked(nx, nz, 0.34) && !wallBlocked(nx, nz, 0.32)) {
        player.x = nx; player.z = nz;
        return;
      }
    }
  }
}

/* ---------------- floor transitions ---------------- */
const fadeEl = document.getElementById('fade');
function doFloorChange(newFloor, x, z, fromAbove, special = null) {
  if (transitioning) return;
  transitioning = true;
  newFloor = Math.max(0, newFloor);
  fadeEl.classList.add('on');
  const P = paletteFor(newFloor, special);
  fadeEl.querySelector('.lvl').textContent = 'LEVEL ' + (P.code || newFloor);
  fadeEl.querySelector('.lvlname').textContent = P.name;
  setTimeout(() => fadeEl.classList.add('label'), 320);
  setTimeout(() => {
    state.floor = newFloor;
    state.special = special;
    rebuildFloor();
    const [cx, cz] = findFreeCellNear(Math.floor(x / CELL), Math.floor(z / CELL));
    player.x = (cx + 0.5) * CELL; player.z = (cz + 0.5) * CELL;
    if (fromAbove) { player.y = 1.9; player.vy = -2; player.grounded = false; }
    else { player.y = 0; player.vy = 0; player.grounded = true; }
    holeCell = null;
    ensureChunks(true);
    unstickPlayer();
    spawnGraceUntil = clock.elapsedTime + 2.5;   // nothing re-triggers while you get your bearings
    setTimeout(() => {
      fadeEl.classList.remove('label');
      setTimeout(() => { fadeEl.classList.remove('on'); transitioning = false; }, 250);
    }, 850);
  }, 480);
}

function rebuildFloor() {
  dropAllChunks();
  disposeMaterials(mats);
  world = makeWorld(state.floor, state.special);
  H = world.P.ceilH || 3.0;
  mats = makeMaterials(world.P);
  if (lifeform.group) lifeform.group.scale.setScalar(Math.min(1, (H - 0.18) / 2.65));   // it stoops down there
  const P = world.P;
  scene.fog = new THREE.Fog(P.fog, P.fogNear, P.fogFar);
  scene.background = new THREE.Color(P.fog);
  baseFogColor = new THREE.Color(P.fog);
  darkK = 0;
  hemi.color.set(P.hemiSky); hemi.groundColor.set(P.hemiGround); hemi.intensity = P.hemiI;
  amb.color.set(P.amb); amb.intensity = P.ambI;
  if (still) { scene.remove(still); still = null; }
  still = makeStill();
  lastExplCell = null;
  despawnLifeform();
  lifeform.nextSpawnAt = clock.elapsedTime + Math.max(20, 50 - state.floor * 6) + Math.random() * 40;
  audio.setFloor(state.floor);
  audio.setMusicScene(state.floor === 0 && !state.special ? 'lobby' : 'random');
  audio.setMusicMood(world.P.style === 'pools' ? 'muffled' : 'open');
  updateHud();
}

/* ---------------- UI ---------------- */
const hudEl = document.getElementById('hud');
const toastEl = document.getElementById('toast');
const subEl = document.getElementById('subtitle');
let toastTimer = 0;
function toast(msg, ms = 3500) {
  toastEl.textContent = msg;
  toastEl.style.opacity = 1;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.style.opacity = 0; }, ms);
}
function updateHud() {
  const P = world.P;
  hudEl.innerHTML =
    `LEVEL ${P.code || state.floor} — ${P.name}<br/>` +
    `absorbed: ${Math.round(state.meters)} m of footsteps · ${state.memories.length} memories` +
    (state.findCount ? ` · found ${state.findCount}` : '') +
    (state.stills ? ` · ${state.stills} still lifes` : '') +
    (state.taken ? ` · ${state.taken} taken` : '') +
    ` · mind: ${state.sanity > 75 ? 'steady' : state.sanity > 50 ? 'uneasy' : state.sanity > 25 ? 'fraying' : 'cracking'}` + '<br/>' +
    (P.style === 'pools' ? 'find the white threshold. the water will let you go.' :
     state.floor > 2 ? 'no doors this deep. climb.' :
     `find the green door — ${3 - state.floor} of 3 between you and home`);
}

const memOverlay = document.getElementById('memory');
const memText = document.getElementById('memory-text');
let memOpen = false;
function openMemory() {
  if (memOpen || transitioning) return;
  memOpen = true;
  memOverlay.classList.add('on');
  if (document.pointerLockElement) document.exitPointerLock();
  setTimeout(() => memText.focus(), 50);
}
function closeMemory(giveIt) {
  memOpen = false;
  memOverlay.classList.remove('on');
  const text = memText.value.trim();
  memText.value = '';
  if (giveIt && text) absorbMemory(text);
  if (started && !QA) lockPointer();
}
function absorbMemory(text) {
  state.memories.push({ id: state.memories.length * 31 + hash(Date.now() & 0xffffff) % 31, text, t: Date.now(), floor: state.floor });
  save();
  world.clearMemCache();
  dropChunksOutside(1);            // the maze quietly rearranges beyond the fog
  flickerPulse = 1.4;
  audio.whoosh();
  toast('the backrooms will remember this');
  updateHud();
}

memText.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); closeMemory(true); }
  if (e.key === 'Escape') { e.preventDefault(); closeMemory(false); }
});

/* ---------------- input ---------------- */
const startEl = document.getElementById('start');
document.getElementById('memo-line').textContent =
  (state.escapes ? `you escaped ${state.escapes} time${state.escapes > 1 ? 's' : ''}. you came back. ` : '') +
  (state.memories.length ? `it already holds ${state.memories.length} of your memories. they are still in there.` : '');
document.getElementById('forget').addEventListener('click', (e) => {
  e.stopPropagation();
  localStorage.removeItem(SAVE_KEY);
  state.memories = []; state.meters = 0; state.stills = 0; state.taken = 0; state.explored = {};
  state.foundKeys = new Set(); state.findCount = 0; state.foundSpots = {}; state.escapes = 0;
  state.kline = 0;
  state.sanity = 100;
  document.getElementById('memo-line').textContent = 'it forgot. for now.';
});

function lockPointer() {
  try {
    const p = document.body.requestPointerLock();
    if (p && p.catch) p.catch(() => {});
  } catch (e) { /* headless */ }
}
function startGame(noLock) {
  if (started) {
    if (!noLock) lockPointer();
    startEl.style.display = 'none';
    return;
  }
  started = true;
  startEl.style.display = 'none';
  document.getElementById('crosshair').style.display = 'block';
  audio.init();
  audio.setFloor(state.floor);
  if (!noLock) lockPointer();
}

startEl.addEventListener('click', () => startGame(false));

document.addEventListener('pointerlockchange', () => {
  locked = !!document.pointerLockElement;
  if (started && !locked && !memOpen && !QA && !endingEl.classList.contains('on')) {
    startEl.style.display = 'flex';   // simple pause screen
  }
});
document.addEventListener('mousemove', (e) => {
  if (!locked) return;
  yaw -= e.movementX * 0.0023;
  pitch -= e.movementY * 0.0023;
  pitch = Math.max(-1.45, Math.min(1.45, pitch));
});
document.addEventListener('keydown', (e) => {
  if (memOpen) return;
  keys.add(e.code);
  if (e.code === 'KeyM' && started) { e.preventDefault(); openMemory(); }
  if (e.code === 'KeyV') {
    const fx = document.getElementById('fx');
    fx.style.display = fx.style.display === 'none' ? 'block' : 'none';
  }
  if (e.code === 'KeyC' && started) {
    flashOn = !flashOn;
    audio.click();
    if (flashOn) flashAim.set(
      player.x - Math.sin(yaw) * 10, player.y + 1.5 + Math.tan(pitch) * 10, player.z - Math.cos(yaw) * 10);
  }
  if (e.code === 'Tab') {
    e.preventDefault();
    if (started) toggleMap();
  }
});
document.addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());   // alt-tab must not leave a key stuck down

/* ---------------- film grain ---------------- */
const grainCanvas = document.getElementById('grain');
const gctx = grainCanvas.getContext('2d');
const fxLayer = document.getElementById('fx');
grainCanvas.width = 160; grainCanvas.height = 90;
let grainFrame = 0;
const grainImg = gctx.createImageData(160, 90);   // reused — this runs in the render loop
function updateGrain() {
  if ((grainFrame++ & 3) !== 0) return;
  if (!started || fxLayer.style.display === 'none') return;   // overlay hidden: skip the raster work
  const d = grainImg.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = (Math.random() * 255) | 0;
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  gctx.putImageData(grainImg, 0, 0);
}

/* ---------------- the map: pen on a legal pad, per floor ---------------- */
const mapCanvas = document.getElementById('map');
let mapOpen = false, mapTimer = null, lastExplCell = null;
function explSet() {
  const key = state.special === 'pools' ? 'pools' : state.floor;
  if (!state.explored) state.explored = {};
  if (!state.explored[key]) state.explored[key] = new Set();
  return state.explored[key];
}
function markExplored() {
  const cx = Math.floor(player.x / CELL), cz = Math.floor(player.z / CELL);
  const k = cx + ',' + cz;
  if (k === lastExplCell) return;
  lastExplCell = k;
  const s = explSet();
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) s.add((cx + dx) + ',' + (cz + dz));
}
const jit = (x, z, salt) => (rand(1234, x, z, salt) - 0.5) * 2.4;
function drawMap() {
  const Wp = Math.floor(Math.min(innerWidth * 0.74, 960));
  const Hp = Math.floor(innerHeight * 0.76);
  mapCanvas.width = Wp; mapCanvas.height = Hp;
  const g = mapCanvas.getContext('2d');
  g.fillStyle = '#eae1b6'; g.fillRect(0, 0, Wp, Hp);
  g.strokeStyle = 'rgba(110,135,190,0.28)'; g.lineWidth = 1;   // ruled paper
  for (let y = 20; y < Hp; y += 24) { g.beginPath(); g.moveTo(0, y); g.lineTo(Wp, y); g.stroke(); }
  const s = 9;
  const pcx = player.x / CELL, pcz = player.z / CELL;
  const X = (cx) => Wp / 2 + (cx - pcx) * s;
  const Z = (cz) => Hp / 2 + (cz - pcz) * s;
  const expl = explSet();
  const ink = '#2b3760';
  const rx = Math.ceil(Wp / 2 / s) + 1, rz = Math.ceil(Hp / 2 / s) + 1;
  for (let cx = Math.floor(pcx - rx); cx <= pcx + rx; cx++) {
    for (let cz = Math.floor(pcz - rz); cz <= pcz + rz; cz++) {
      if (!expl.has(cx + ',' + cz)) continue;
      g.fillStyle = 'rgba(150,125,40,0.10)';                    // walked ground
      g.fillRect(X(cx), Z(cz), s, s);
      if (world.occupied(cx, cz)) {
        g.fillStyle = ink;
        g.fillRect(X(cx) + 1.5, Z(cz) + 1.5, s - 3, s - 3);
        continue;
      }
      if (world.isHole(cx, cz)) {
        g.fillStyle = 'rgba(43,55,96,0.55)';
        g.beginPath(); g.arc(X(cx) + s / 2, Z(cz) + s / 2, s * 0.3, 0, 7); g.fill();
      }
      if (world.isMound(cx, cz)) {
        g.strokeStyle = ink; g.lineWidth = 1.2;
        g.beginPath(); g.arc(X(cx) + s / 2, Z(cz) + s / 2 + 2, s * 0.32, Math.PI, 0); g.stroke();
      }
      g.strokeStyle = ink; g.lineWidth = 1.8; g.lineCap = 'round';
      if (world.hasWallH(cx, cz)) {
        g.beginPath();
        g.moveTo(X(cx) + jit(cx, cz, 1), Z(cz) + jit(cx, cz, 2));
        g.lineTo(X(cx + 1) + jit(cx + 1, cz, 1), Z(cz) + jit(cx + 1, cz, 2));
        g.stroke();
      }
      if (world.hasWallV(cx, cz)) {
        g.beginPath();
        g.moveTo(X(cx) + jit(cx, cz, 1), Z(cz) + jit(cx, cz, 2));
        g.lineTo(X(cx) + jit(cx, cz + 1, 1), Z(cz + 1) + jit(cx, cz + 1, 2));
        g.stroke();
      }
      const ty = world.setRoomAt(Math.floor(cx / 3), Math.floor(cz / 3));
      if (ty && mod(cx, 3) === 1 && mod(cz, 3) === 1) {
        g.font = 'bold 12px "Bradley Hand", cursive';
        g.fillStyle = '#7c2b22';
        g.fillText(ty[0].toUpperCase() + '?', X(cx), Z(cz) + 4);
      }
    }
  }
  // finds you've made, and the site if you've seen it
  const fk = state.special === 'pools' ? 'pools' : state.floor;
  g.fillStyle = '#8c2418';
  for (const [cx, cz] of (state.foundSpots[fk] || [])) {
    g.beginPath();
    g.moveTo(X(cx) + s / 2, Z(cz) - 1);
    g.lineTo(X(cx) + s + 1, Z(cz) + s / 2);
    g.lineTo(X(cx) + s / 2, Z(cz) + s + 1);
    g.lineTo(X(cx) - 1, Z(cz) + s / 2);
    g.closePath(); g.fill();
  }
  if (world.siteA) {
    const scx = world.siteA.tx * 3 + 3, scz = world.siteA.tz * 3 + 3;
    if (expl.has((scx - 3) + ',' + (scz - 3)) || expl.has(scx + ',' + scz)) {
      g.font = 'bold 14px "Bradley Hand", cursive'; g.fillStyle = '#7c2b22';
      g.fillText('⌂ KV31', X(scx), Z(scz));
    }
  }
  if (world.exitSpot) {
    const ecx = world.exitSpot.tx * 3 + 1, ecz = world.exitSpot.tz * 3 + 1;
    if (expl.has(ecx + ',' + ecz) || state.kline >= 3) {   // the Kline tapes give the door away
      g.fillStyle = '#1d7a3c';
      g.fillRect(X(ecx) - 1, Z(ecz) - 1, s + 2, s + 2);
      g.font = 'bold 13px "Bradley Hand", cursive';
      g.fillText('EXIT', X(ecx) + s + 3, Z(ecz) + s);
    }
  }

  g.save();                                                     // you
  g.translate(Wp / 2, Hp / 2);
  g.rotate(-yaw + Math.PI);
  g.fillStyle = '#a02818';
  g.beginPath(); g.moveTo(0, -6.5); g.lineTo(4.6, 5); g.lineTo(-4.6, 5); g.closePath(); g.fill();
  g.restore();
  g.fillStyle = ink;
  g.font = '22px "Bradley Hand", cursive';
  g.fillText(`level ${world.P.code || state.floor} — ${world.P.name.toLowerCase()}`, 20, 36);
  g.font = '13px "Bradley Hand", cursive';
  g.fillText('what you have seen of it. it is bigger.', 20, 58);
}
function toggleMap(force) {
  mapOpen = force !== undefined ? force : !mapOpen;
  mapCanvas.classList.toggle('on', mapOpen);
  clearInterval(mapTimer);
  if (mapOpen) { drawMap(); mapTimer = setInterval(drawMap, 350); }
}

/* ---------------- the way out ---------------- */
const endingEl = document.getElementById('ending');
function exitReached() {
  if (transitioning) return;
  if (state.floor >= 2) { endGame(); return; }
  audio.whoosh();
  doFloorChange(state.floor + 1, player.x, player.z, false);
  const n = state.floor + 1;   // door just used
  setTimeout(() => toast(`green door ${n} of 3. the way out is down. of course it is.`, 4500), 1800);
}
function endGame() {
  transitioning = true;
  state.escapes = (state.escapes || 0) + 1;
  save();
  if (document.pointerLockElement) document.exitPointerLock();
  toggleMap(false);
  const mm = Math.floor(recT / 60), ss = Math.floor(recT % 60);
  document.getElementById('end-stats').innerHTML =
    `${mm}m ${String(ss).padStart(2, '0')}s inside · ${Math.round(state.meters)} m walked<br/>` +
    `${state.memories.length} memories given · ${state.findCount} things found` +
    (state.taken ? ` · taken ${state.taken} times` : '') +
    (state.escapes > 1 ? `<br/>escape #${state.escapes}` : '');
  endingEl.classList.add('on');
  audio.whoosh();
}
document.getElementById('back-in').addEventListener('click', () => {
  endingEl.classList.remove('on');
  transitioning = false;
  doFloorChange(0, (SPAWN_CX + 0.5) * CELL, (SPAWN_CZ + 0.5) * CELL, false);
  if (!QA) lockPointer();
});

/* ---------------- finding what was left behind ---------------- */
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
let subHoldUntil = 0;
function siteHint() {
  if (!world.siteA) return NOTE_LINES[0];
  const dx = world.siteA.tx * 3 * CELL - SPAWN_CX * CELL;
  const dz = world.siteA.tz * 3 * CELL - SPAWN_CZ * CELL;
  const a = Math.atan2(dx, -dz);                       // north is -z
  const dir = COMPASS[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
  return `someone wrote in a hurry: "the machine is ${dir} of where you woke. follow the hum."`;
}
function exitHintFrom(cx, cz) {
  if (!world.exitSpot) return NOTE_LINES[hash(cx, cz, 83) % NOTE_LINES.length];
  const ex = (world.exitSpot.tx * 3 + 1.5) * CELL, ez = (world.exitSpot.tz * 3 + 1.5) * CELL;
  let a = Math.atan2(ex - (cx + 0.5) * CELL, -(ez - (cz + 0.5) * CELL));
  const lie = rand(cx, cz, 84) < 0.3;
  if (lie) a += Math.PI * (0.75 + rand(cx, cz, 85) * 0.5);
  const dir = COMPASS[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
  return lie
    ? `"the green door is ${dir} of this note. trust me." — the handwriting looks wrong.`
    : `"the door with the green light is ${dir} of this note. i saw it. i wasn't brave enough."`;
}
function foundText(f) {
  if (f.type === 'note') {
    const i = hash(f.cx, f.cz, 81) % 10;
    if (i < 4) return NOTE_LINES[i % NOTE_LINES.length];
    if (i < 6) return siteHint();
    return exitHintFrom(f.cx, f.cz);
  }
  if (f.type === 'roomNote' || f.type === 'siteNote') return f.text;
  return {
    tape: "a vhs tape. the label reads: A-SYNC — INFORMATIONAL — 2/29/1990.",
    almond: 'almond water. still cold. you feel a little braver.',
    radio: 'a radio, hissing static. underneath the static: breathing.',
    camera: 'an a-sync camera on a tripod. still recording. you wave at whoever is watching.',
    camp: "someone's camp. the sleeping bag is cold. they left in a hurry, or they didn't leave.",
  }[f.type];
}
function updateFinds() {
  for (const ch of chunks.values()) {
    for (const f of ch.finds) {
      if (state.foundKeys.has(f.key)) continue;
      if (Math.hypot(f.x - player.x, f.z - player.z) > 1.7) continue;
      state.foundKeys.add(f.key);
      state.findCount++;
      if (f.type === 'almond') state.sanity = Math.min(100, state.sanity + 35);
      subHoldUntil = clock.elapsedTime + 6;
      const fk = state.special === 'pools' ? 'pools' : state.floor;
      (state.foundSpots[fk] = state.foundSpots[fk] || []).push([f.cx, f.cz]);
      // tape finds advance the Mary Kline set; the third one marks the way out
      let text = foundText(f);
      if (f.type === 'tape' && state.kline < 3) {
        state.kline++;
        text = `a cassette. handwritten label: "THE WINDOW WITHIN — dr. mary kline, part ${state.kline} of 3."`;
        if (state.kline === 3) {
          state.sanity = 100;
          setTimeout(() => toast('the three tapes overlap into one map. the green door is marked now.', 6000), 2400);
        }
      }
      subEl.textContent = text;
      subEl.style.opacity = 1;
      setTimeout(() => { subEl.style.opacity = 0; }, 6000);
      toast(`found something (${state.findCount} so far). it is marked on your map.`, 3000);
      audio.zap();
      updateHud();
      save();
    }
  }
}

/* ---------------- sanity (the place wears you down) ---------------- */
let camRoll = 0, sanityFxFrame = 0;
function updateSanity(dt, t) {
  let d = 0;
  const ptx = Math.floor(player.x / CELL / 3), ptz = Math.floor(player.z / CELL / 3);
  const inRoom = !!world.setRoomAt(ptx, ptz);
  const inPools = world.P.style === 'pools';
  const rx = Math.floor(player.x / CELL / RG), rz = Math.floor(player.z / CELL / RG);
  const dark = world.blackout(rx, rz);
  if (inPools) d += 2.0;                                  // the water is calm
  else if (inRoom) d += 1.4;                              // "sleep in the rooms"
  else if (state.floor === 0 && !dark) d += 0.4;          // the lobby tolerates you
  if (state.floor >= 1 && !inRoom && !inPools) d -= 0.3 + state.floor * 0.12;
  if (dark) d -= 0.9;                                     // dead-light regions gnaw
  if (lifeform.active) {
    const ld = Math.hypot(lifeform.x - player.x, lifeform.z - player.z);
    d -= Math.max(0, 1.6 * (1 - ld / 24));
  }
  state.sanity = Math.max(0, Math.min(100, state.sanity + d * dt));
  // the world bends as the mind goes
  const k = Math.max(0, (65 - state.sanity) / 65);
  if ((sanityFxFrame++ & 7) === 0) {
    renderer.domElement.style.filter = k > 0.02
      ? `contrast(${(1 + k * 0.25).toFixed(3)}) saturate(${(1 + k * 0.45).toFixed(3)}) ` +
        `hue-rotate(${(Math.sin(t * 0.7) * k * 14).toFixed(1)}deg) blur(${(k * 1.4).toFixed(2)}px)`
      : '';
  }
  camRoll = Math.sin(t * 0.9) * k * 0.045;
  if (k > 0.45 && Math.random() < dt * 0.1) audio.zap();
  if (k > 0.7 && Math.random() < dt * 0.05 && state.memories.length) {
    audio.whisper(state.memories[Math.floor(Math.random() * state.memories.length)].text);
  }
  if (state.sanity <= 0 && !transitioning) {
    state.sanity = 45;
    audio.caught();
    flickerPulse = 1.6;
    doFloorChange(state.floor + 1, player.x + (Math.random() - 0.5) * 24, player.z + (Math.random() - 0.5) * 24, true);
    setTimeout(() => toast('you lost yourself for a while. you woke up deeper.', 5200), 1700);
  }
}

/* ---------------- whispers near memories ---------------- */
const whispered = new Map();
function updateMemoriesNearby(t) {
  let nearest = null, nd = 1e9;
  for (const ch of chunks.values()) {
    for (const fr of ch.frames) {
      const d = Math.hypot(fr.x - player.x, fr.z - player.z);
      if (d < nd) { nd = d; nearest = fr; }
    }
  }
  if (nearest && nd < (nearest.r || 2.6)) {
    if (!nearest.whisperOnly) {
      subEl.textContent = '…' + nearest.text + '…';
      subEl.style.opacity = 1;
    }
    const k = Math.round(nearest.x) + ':' + Math.round(nearest.z);
    if (!whispered.has(k) || t - whispered.get(k) > 45) {
      whispered.set(k, t);
      audio.whisper(nearest.text);
    }
  } else if (t > subHoldUntil) {
    subEl.style.opacity = 0;
  }
}

/* ---------------- main loop ---------------- */
let flickerPulse = 0;
const clock = new THREE.Clock();
const recTime = document.getElementById('rec-time');
let recT = 0;

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  const pausedNow = started && startEl.style.display !== 'none';   // Esc overlay = a real pause
  if (started && !memOpen && !transitioning && !pausedNow) {
    // movement (wading through level 37 is slower)
    const run = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const wade = world.P.style === 'pools' ? 0.7 : 1;
    const speed = (run ? 5.6 : 3.1) * wade;
    let mx = 0, mz = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp') && false) mz += 1;
    if (keys.has('KeyW')) mz = 1;
    if (keys.has('KeyS')) mz -= 1;
    if (keys.has('KeyA')) mx -= 1;
    if (keys.has('KeyD')) mx += 1;
    if (keys.has('ArrowLeft')) yaw += 1.6 * dt;
    if (keys.has('ArrowRight')) yaw -= 1.6 * dt;
    if (keys.has('ArrowUp')) pitch = Math.min(1.45, pitch + 1.2 * dt);
    if (keys.has('ArrowDown')) pitch = Math.max(-1.45, pitch - 1.2 * dt);
    const len = Math.hypot(mx, mz);
    if (len > 0) {
      mx /= len; mz /= len;
      const sin = Math.sin(yaw), cos = Math.cos(yaw);
      const dx = (mx * cos - mz * sin) * speed * dt;
      const dz = (-mx * sin - mz * cos) * speed * dt;
      const nx = player.x + dx, nz2 = player.z + dz;
      if (!blockedAt(nx, player.z)) player.x = nx;
      if (!blockedAt(player.x, nz2)) player.z = nz2;
      if (player.grounded) {
        state.meters += Math.hypot(dx, dz);
        stepAcc += Math.hypot(dx, dz);
        if (stepAcc > (run ? 2.2 : 1.7)) {
          stepAcc = 0;
          audio.step(run, world.P.style === 'pools');
          updateHud();
        }
      }
    }
    // jump / gravity / holes / mounds
    const ccx = Math.floor(player.x / CELL), ccz = Math.floor(player.z / CELL);
    const overHole = inPit(player.x, player.z);
    const ground = groundHeight(player.x, player.z);
    if (player.grounded) player.y = ground;   // walk up and down the mounds
    if (keys.has('Space') && player.grounded && !overHole) { player.vy = 4.2; player.grounded = false; }
    if (player.grounded && overHole) {
      player.grounded = false; holeCell = [ccx, ccz];
      audio.fall();
      toast('down.', 1500);
    }
    if (!player.grounded) {
      player.vy -= 16 * dt;
      player.y += player.vy * dt;
      if (holeCell && player.y < 0) {
        // slide down the ragged shaft, not through its sides
        const s = world.holeShape(holeCell[0], holeCell[1]);
        const d = Math.hypot(player.x - s.hx, player.z - s.hz);
        const maxR = s.rmin - 0.18;
        if (d > maxR && d > 0.001) {
          player.x = s.hx + (player.x - s.hx) * maxR / d;
          player.z = s.hz + (player.z - s.hz) * maxR / d;
        }
      }
      if (player.y <= ground && !overHole) {
        if (player.vy < -5) audio.land();
        player.y = ground; player.vy = 0; player.grounded = true; holeCell = null;
      }
      if (player.y < -2.7) {
        if (state.special === 'pools') {
          doFloorChange(state.floor + 1, player.x, player.z, true);   // the water lets you out below
        } else if (state.floor >= 1 && Math.random() < 0.18) {
          doFloorChange(state.floor, player.x, player.z, true, 'pools');   // sometimes the floor opens onto level 37
        } else {
          doFloorChange(state.floor + 1, player.x, player.z, true);
        }
      }
    }
    // the green doors (with a landing grace so arrivals never chain-trigger)
    const pastGrace = t > spawnGraceUntil;
    for (const ch of chunks.values()) {
      if (!pastGrace) break;
      for (const d of ch.exits) {
        if (Math.hypot(d.x - player.x, d.z - player.z) < 1.0) exitReached();
      }
      // staircases down
      for (const d of ch.stairs) {
        if (Math.hypot(d.x - player.x, d.z - player.z) < 0.95 && !transitioning) {
          audio.fall();
          doFloorChange(state.floor + 1, player.x, player.z, false);
          setTimeout(() => toast('the stairs went down further than they should.', 3600), 1800);
        }
      }
    }
    // ascend doors
    for (const ch of chunks.values()) {
      if (!pastGrace) break;
      for (const d of ch.doors) {
        if (Math.hypot(d.x - player.x, d.z - player.z) < 0.95) {
          if (state.special === 'pools') {
            toast('the water let you go.');
            doFloorChange(state.floor, player.x, player.z, false);
          } else {
            toast('it let you climb back up. this time.');
            doFloorChange(state.floor - 1, player.x, player.z, false);
          }
        }
      }
    }
    updateStill(t);
    updateLifeform(t, dt);
    updateMemoriesNearby(t);
    updateFinds();
    updateSanity(dt, t);
    markExplored();
    recT += dt;
  }

  // camera
  const bob = (player.grounded && started) ? Math.sin(t * 9) * 0.028 * Math.min(1, keys.size) : 0;
  camera.position.set(player.x, player.y + 1.62 + bob, player.z);
  camera.rotation.set(pitch, yaw, camRoll);
  playerLight.position.set(player.x, player.y + 2.1, player.z);

  // flashlight follows the view with a lagging aim — reads like a hand, not a turret
  flashlight.intensity += ((flashOn ? 165 : 0) - flashlight.intensity) * Math.min(1, dt * 18);
  if (flashlight.intensity > 0.5) {
    const eyeY = player.y + 1.52 + bob;
    flashlight.position.set(
      player.x - Math.sin(yaw + 0.5) * 0.22, eyeY - 0.12, player.z - Math.cos(yaw + 0.5) * 0.22);
    const ideal = {
      x: player.x - Math.sin(yaw) * Math.cos(pitch) * 10,
      y: eyeY + Math.sin(pitch) * 10,
      z: player.z - Math.cos(yaw) * Math.cos(pitch) * 10,
    };
    const k = Math.min(1, dt * 9);
    flashAim.x += (ideal.x - flashAim.x) * k;
    flashAim.y += (ideal.y - flashAim.y) * k;
    flashAim.z += (ideal.z - flashAim.z) * k;
    flashlight.target.position.copy(flashAim);
  }

  // water shimmer & drips on level 37
  if (mats && world && world.P.style === 'pools') {
    mats.water.map.offset.set(t * 0.012, t * 0.008);
    if (t > nextDripAt) {
      nextDripAt = t + 3 + Math.random() * 6;
      audio.drip();
    }
  }

  // the dark regions are actually dark: fog and light sink toward black around you.
  // linear fog applies after lighting, so no lamp can punch through it — while the
  // flashlight is on, the black murk itself pulls back; ambience stays dead.
  if (world) {
    const prx = Math.floor(player.x / CELL / RG), prz = Math.floor(player.z / CELL / RG);
    const target = world.blackout(prx, prz) ? 1 : 0;
    darkK += (target - darkK) * Math.min(1, dt * 1.4);
    flashK += ((flashOn ? 1 : 0) - flashK) * Math.min(1, dt * 6);
    const fogK = darkK * (1 - flashK * 0.78);
    if (scene.fog) {
      // the beam also pushes back the short baseline fog of the dark floors
      // (deep sections / tunnels), capped well inside the chunk-load radius
      const reach = flashK * Math.min(24, Math.max(0, 70 - world.P.fogFar));
      scene.fog.color.copy(baseFogColor).lerp(DARK_FOG, fogK);
      scene.fog.near = world.P.fogNear * (1 - fogK * 0.6) * (1 + flashK * 0.8);
      scene.fog.far = world.P.fogFar * (1 - fogK * 0.62) + reach;
      scene.background.copy(baseFogColor).lerp(DARK_FOG, darkK);
    }
  }

  // flicker
  flickerPulse = Math.max(0, flickerPulse - dt);
  const mains = 1 + (flickerPulse > 0 ? (Math.random() - 0.5) * flickerPulse * 0.7 : 0);
  if (world) {
    hemi.intensity = world.P.hemiI * mains * (1 - darkK * 0.8);
    amb.intensity = world.P.ambI * (1 - darkK * 0.7);
    for (const ch of chunks.values()) {
      for (const fl of ch.flickers) {
        const s = Math.sin(t * 23 + fl.phase) * Math.sin(t * 7.3 + fl.phase * 2);
        const on = s > -0.62 ? 1 : 0.12;
        const j = 0.85 + 0.15 * Math.sin(t * 61 + fl.phase);
        const fb = 1.35 * on * j * mains, ft = fl.tint || [1, 1, 1];
        fl.mat.color.setRGB(fb * ft[0], fb * ft[1], fb * ft[2]);
        if (fl.halo) fl.halo.opacity = fl.haloBase * on * j;
        if (on < 1 && Math.random() < 0.02) {
          const d = Math.hypot(fl.cx * CELL - player.x, fl.cz * CELL - player.z);
          if (d < 14) audio.zap();
        }
      }
      for (const st of ch.statics) {                  // the static room cuts to solid blue now and then
        if (!st.nextAt) st.nextAt = t + 6 + Math.random() * 10;
        if (t >= st.nextAt) { st.until = t + 3 + Math.random() * 2; st.nextAt = t + 16 + Math.random() * 16; }
        const flashing = t < st.until;
        if (st.blue) st.blue.visible = flashing;
        st.light.color.setHex(flashing ? 0x3346e8 : 0x6a5ad8);
        st.light.intensity = flashing ? 12 : 7;
      }
      for (const wr of ch.watchRooms) {               // congregation chairs remember where you stood
        const inside = Math.abs(player.x - wr.cx) < 4.2 && Math.abs(player.z - wr.cz) < 4.2;
        let rec = roomGaze.get(wr.key);
        if (!rec) { rec = { inside: false, visits: 0 }; roomGaze.set(wr.key, rec); }
        if (inside && !rec.inside) {
          rec.visits++;
          if (rec.visits >= 2) {
            for (const c of wr.chairs) c.g.rotation.y = Math.atan2(player.x - c.x, player.z - c.z);
          }
        }
        rec.inside = inside;
      }
    }
  }

  if (started && !transitioning) ensureChunks(false);
  updateGrain();
  const mm = String(Math.floor(recT / 60)).padStart(2, '0');
  const ss = String(Math.floor(recT % 60)).padStart(2, '0');
  recTime.textContent = mm + ':' + ss;

  renderer.render(scene, camera);
}
let stepAcc = 0;
let nextDripAt = 0;
let darkK = 0;
let flashK = 0;   // smoothed flashlight-on factor: the beam pushes the black fog back
const roomGaze = new Map();   // congregation rooms: entry tracking for the chair re-aim
const DARK_FOG = new THREE.Color(0x070604);
let baseFogColor = new THREE.Color(0xbfa75c);

/* ---------------- boot ---------------- */
makeLifeform();
rebuildFloor();
ensureChunks(true);
updateHud();
setInterval(save, 10000);
addEventListener('beforeunload', save);
tick();

/* ---------------- QA hooks ---------------- */
if (QA) window.__qa = {
  start: () => startGame(true),
  music: () => audio.musicInfo(),
  findPlug: (range = 120) => {
    const c0x = Math.floor(player.x / CELL), c0z = Math.floor(player.z / CELL);
    for (let r = 1; r < range; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const a = world.doorPlugAt(c0x + dx, c0z + dz);
      if (a) return { x: (c0x + dx + 0.5) * CELL, z: (c0z + dz + (a === 1 ? 0 : 0.5)) * CELL, axis: a };
    }
    return null;
  },
  findPile: (range = 80) => {
    const c0x = Math.floor(player.x / CELL), c0z = Math.floor(player.z / CELL);
    for (let r = 1; r < range; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      if (world.furniturePile(c0x + dx, c0z + dz)) return { x: (c0x + dx + 0.5) * CELL, z: (c0z + dz + 0.5) * CELL };
    }
    return null;
  },
  state: () => ({ floor: state.floor, x: player.x, z: player.z, y: player.y, memories: state.memories.length, chunks: chunks.size }),
  give: (text) => absorbMemory(text),
  teleport: (x, z) => { player.x = x; player.z = z; ensureChunks(true); },
  look: (y, p) => { yaw = y; pitch = p; },
  setFloor: (n) => doFloorChange(n, player.x, player.z, false),
  forward: (m) => {
    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    window.__qa.teleport(player.x - sin * m, player.z - cos * m);
  },
  findMemoryTile: (range = 60) => {
    const t0x = Math.floor(player.x / CELL / 3), t0z = Math.floor(player.z / CELL / 3);
    for (let r = 1; r < range; r++) {
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        if (world.memoryTile(t0x + dx, t0z + dz)) {
          return { x: ((t0x + dx) * 3 + 1) * CELL, z: ((t0z + dz) * 3 + 1) * CELL };
        }
      }
    }
    return null;
  },
  frames: () => [...chunks.values()].flatMap(c => c.frames),
  findRooms: (range = 40) => {
    const t0x = Math.floor(player.x / CELL / 3), t0z = Math.floor(player.z / CELL / 3);
    const out = [];
    for (let dx = -range; dx <= range; dx++) for (let dz = -range; dz <= range; dz++) {
      const ty = world.setRoomAt(t0x + dx, t0z + dz);
      if (ty) out.push({ type: ty, x: ((t0x + dx) * 3 + 1) * CELL, z: ((t0z + dz) * 3 + 1) * CELL });
    }
    return out;
  },
  spawnLifeform: (d = 8) => {
    spawnLifeform(player.x - Math.sin(yaw) * d, player.z - Math.cos(yaw) * d);
  },
  lifeform: () => ({
    active: lifeform.active,
    x: lifeform.x, z: lifeform.z,
    dist: Math.hypot(lifeform.x - player.x, lifeform.z - player.z),
    path: lifeform.path.length,
  }),
  findHole: (range = 60) => {
    const c0x = Math.floor(player.x / CELL), c0z = Math.floor(player.z / CELL);
    for (let r = 1; r < range; r++) {
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        if (world.isHole(c0x + dx, c0z + dz)) {
          const s = world.holeShape(c0x + dx, c0z + dz);   // the pit's true centre, not the cell's
          return { x: s.hx, z: s.hz };
        }
      }
    }
    return null;
  },
  findMound: (range = 120) => {
    const c0x = Math.floor(player.x / CELL), c0z = Math.floor(player.z / CELL);
    for (let r = 1; r < range; r++) {
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        if (world.isMound(c0x + dx, c0z + dz)) {
          const m = world.moundShape(c0x + dx, c0z + dz);
          return { x: m.mx, z: m.mz, chair: m.chair };
        }
      }
    }
    return null;
  },
  map: (open) => toggleMap(open),
  pools: () => doFloorChange(Math.max(1, state.floor), player.x, player.z, false, 'pools'),
  site: () => world.siteA ? { x: world.siteA.tx * 3 * CELL + 10, z: world.siteA.tz * 3 * CELL + 10 } : null,
  exit: () => world.exitSpot
    ? { x: (world.exitSpot.tx * 3 + 1.5) * CELL, z: (world.exitSpot.tz * 3 + 1.5) * CELL }
    : null,
  escapes: () => state.escapes || 0,
  sanity: (v) => { if (v !== undefined) state.sanity = v; return state.sanity; },
  flash: (on) => { flashOn = on === undefined ? !flashOn : !!on; return flashOn; },
  endingOpen: () => endingEl.classList.contains('on'),
  goBackIn: () => document.getElementById('back-in').click(),
  findItem: (range = 80) => {
    const c0x = Math.floor(player.x / CELL), c0z = Math.floor(player.z / CELL);
    for (let r = 1; r < range; r++) {
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const ty = world.findAt(c0x + dx, c0z + dz);
        if (ty) return { type: ty, x: (c0x + dx + 0.5) * CELL, z: (c0z + dz + 0.5) * CELL };
      }
    }
    return null;
  },
  finds: () => ({ count: state.findCount, keys: state.foundKeys.size }),
  findRegion: (type, range = 30) => {
    const r0x = Math.floor(player.x / CELL / RG), r0z = Math.floor(player.z / CELL / RG);
    for (let r = 0; r < range; r++) {
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        if (world.regionType(r0x + dx, r0z + dz) === type &&
            (type !== 'lobbyGreen')) {
          return { x: ((r0x + dx) * RG + RG / 2) * CELL, z: ((r0z + dz) * RG + RG / 2) * CELL };
        }
      }
    }
    return null;
  },
  findGreenZone: (range = 40) => {
    const r0x = Math.floor(player.x / CELL / RG), r0z = Math.floor(player.z / CELL / RG);
    for (let r = 0; r < range; r++) {
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        if (world.lightTint(r0x + dx, r0z + dz)) {
          return { x: ((r0x + dx) * RG + RG / 2) * CELL, z: ((r0z + dz) * RG + RG / 2) * CELL };
        }
      }
    }
    return null;
  },
  findStairs: (range = 120) => {
    const c0x = Math.floor(player.x / CELL), c0z = Math.floor(player.z / CELL);
    for (let r = 1; r < range; r++) {
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        if (world.stairsAt(c0x + dx, c0z + dz)) {
          return { x: (c0x + dx + 0.5) * CELL, z: (c0z + dz + 0.5) * CELL };
        }
      }
    }
    return null;
  },
  findBlackout: (range = 30) => {
    const r0x = Math.floor(player.x / CELL / RG), r0z = Math.floor(player.z / CELL / RG);
    for (let r = 0; r < range; r++) {
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        if (world.blackout(r0x + dx, r0z + dz)) {
          return { x: ((r0x + dx) * RG + RG / 2) * CELL, z: ((r0z + dz) * RG + RG / 2) * CELL };
        }
      }
    }
    return null;
  },
  explore: (r = 30) => {   // reveal a patch for map QA
    const s = explSet();
    const c0x = Math.floor(player.x / CELL), c0z = Math.floor(player.z / CELL);
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) s.add((c0x + dx) + ',' + (c0z + dz));
  },
};
if (QA) startGame(true);
