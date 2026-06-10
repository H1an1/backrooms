# THE BACKROOMS

A first-person, absorbing, growing Backrooms you can walk through. Built to match
the classic Level 0 reference (yellow ogee wallpaper, damp carpet, humming
fluorescent grid) and the memory mechanics of the 2026 A24 film: the place
absorbs what you give it and rebuilds it, badly.

## Run it

Double-click `start.command` (or run `python3 -m http.server 4790` in this
folder and open http://127.0.0.1:4790/). Needs a local server because the app
uses ES modules. Desktop browser with mouse recommended.

If macOS blocks the downloaded `start.command` (unidentified developer),
right-click it and choose Open once, or run `sh start.command` in Terminal.

## The goal

**Three green doors stand between you and home.** Each of Levels 0, 1 and 2
hides one EXIT door (green sign, light leaking around it) far out in the maze.
Find it, walk through, descend, repeat — door three lets you out, with an
ending screen and your run's stats. Survivor notes hint at the door's compass
direction, but ~30% of them lie. The Lifeform guards each door's approach.
Falling through holes skips levels — a risky shortcut. Escapes are counted;
the title screen remembers you came back.

**Your mind wears down.** Below Level 0, in blacked-out regions, and near the
Lifeform, sanity drains: the image warps, color bleeds, the camera sways, and
it starts whispering your own memories back at you. At zero you black out and
wake a floor deeper. Copied rooms and the pools restore you ("sleep in the
rooms"); almond water is a big swig of courage. The HUD shows your mind:
steady → uneasy → fraying → cracking.

## What it does

- **Infinite Level 0, laid out like the film** — long continuous walls forming
  irregular rooms and corridors (recursive-division floor plans), vast halls
  split by freestanding wall slabs, and classic pillar-field zones, all
  stitched seamlessly forever in every direction.
- **Your map (Tab)** — a pen-on-legal-pad map of everywhere you've been, drawn
  by hand like the one in the movie. One map per floor, walls in wavering ink,
  pillars as dots, holes as blots, copied rooms marked with a letter and a
  question mark. It persists between visits.
- **Holes & floors** — square-ish torn floor panels like the film (ragged
  charred edges, jittered shapes — no two alike) drop you to deeper levels.
  Each level follows the wiki lore:
  - **Level 0 "The Lobby"** — yellow wallpaper (ogee *and* chevron patterns by
    region), damp carpet, fluorescent grid.
  - **Level 1 "Habitable Zone"** — the parking garage: concrete pillars,
    ceiling pipes, bare tube lights, standing water on the floor.
  - **Level 2 "The Pit Stops"** — hot dark pipe warrens lit only by flickering
    tubes.
  - **Level 37 "Sublimity"** — sometimes the floor opens onto the pools: white
    tile, slender columns, soft skylights, calm green water you wade through
    (slower!), drips echoing. No entities. Falling again leads back down;
    a white threshold lets the water release you.
  - **Deep Sections** — the red dark below.
  Rare glowing thresholds let you climb back up.
- **Graffiti** — the ones who came before left messages: "EXIT UP ↑",
  "KEEP MOVING", "they hear you". More of them the deeper you go.
- **Surprise areas, from the reference footage**: **the Pitfalls** — whole
  regions where the floor is a machine-cut
  lattice of square pits with carpet bridges; **green-lit zones** — dark areas
  pooled in sickly green fluorescent light; **blacked-out regions** that go
  truly dark around you (fog closes in, debris and overturned chairs in the
  gloom); and **staircases** — wallpapered stairwells whose steps descend into
  black and take you a floor down.
- **Each floor is a different *place*, not a different color** — the Lobby is a
  3m office grid; the garage soars to 3.8m with slender concrete columns and
  vast open spans; the Pit Stops crush down to 2.35m of tight warren (the
  Lifeform stoops to fit); whole regions of the maze are blacked out, lit only
  by your presence.
- **Things to discover** — scattered through the maze, waiting to be walked up
  to: VHS tapes labeled *A-SYNC — INFORMATIONAL — 2/29/1990*, bottles of almond
  water, handwritten survivor notes (some hint where the site is), hissing
  radios, abandoned camps, and A-Sync cameras on tripods, still recording.
  Every copied room hides a note that comments on that room. Finds are counted
  on the HUD and marked as red diamonds on your map.
- **The A-Sync site (Project KV31)** — once per floor, far from spawn, the maze
  opens into a research installation from the web series: a humming threshold
  machine flanked by floodlights, crates, a desk with a monitor still mapping,
  cable runs, and an AUTHORIZED PERSONNEL ONLY sign. The machine is a working
  threshold — walk into the light. Survivor notes sometimes point you toward
  it ("follow the hum"), and it's marked ⌂ KV31 on your map once you've seen it.
- **Carpet mounds** — sometimes the floor swells up into a soft mound you can
  walk over. Some of them have a white plastic chair on top, facing nothing.
- **It absorbs you** — press `M` and give it a memory. It will:
  - scrawl your words across distant walls in handwriting that isn't yours,
  - grow cold, wrongly-copied *memory rooms* deeper in the maze, each with a
    framed copy of what you said and a light the wrong color,
  - whisper your memories back when you walk close,
  - and once it holds enough of you, a frozen **Still Life** of you starts
    appearing in the distance. Walk up to it. It won't be there.
- **Copied rooms, like in the film** — rarely, the maze contains a *room that
  shouldn't be here*: a furniture showroom (everything must go), a therapist's
  office (the clock is wrong), an interrogation room (someone is still
  answering), a motel room, an Async office floor. Each is a poor copy — one
  piece of furniture always floats. The Lifeform cannot enter them.
- **The Lifeform hunts you** — a tall, spindly, antlered figure (as in the
  movie) that pathfinds through the maze toward you. You'll hear your heartbeat
  quicken as it closes in. Sprint to outrun it, hide in a copied room, or drop
  through a hole. If it catches you, it drags you a floor deeper — and
  **corrupts one of your memories** (its wall scrawls get scribbled out, its
  framed copy now reads "this one is ours now"). It only starts hunting once
  you're below Level 0, or once it holds 3 of your memories.
- **Music** — the game looks for mp3s you supply (none ship with the repo;
  see *Bring your own assets* below). The lobby keeps one song forever; every
  other level deals a random track from your collection when you arrive and
  loops it until you leave. When the Lifeform notices you, your music gets out
  of the way and a dissonant hunt theme rises; in the pools everything turns
  muffled-underwater. No files? The game runs fine in silence over the hum.
- **It remembers between visits** — memories, footsteps absorbed, still-life
  encounters, and what the Lifeform has taken persist in your browser. The
  title screen tells you what it already holds. There's a button to make it
  forget.

## Controls

| Key | Action |
| --- | --- |
| WASD / mouse | walk / look |
| Shift | run |
| Space | jump |
| M | give it a memory |
| Tab | your hand-drawn map |
| C | flashlight |
| V | toggle camcorder overlay |
| Esc | pause |

## Bring your own assets

The repo ships **code only** — no music, no third-party models. Two optional
asset slots, both gracefully skipped when empty:

- `assets/six-forty-seven.mp3` — the lobby's eternal song.
- `assets/music/track1.mp3` … `track9.mp3` — the shuffle pool for every other
  level.

Use audio you have the rights to. Everything else — textures, furniture,
rooms, the creature — is generated procedurally at boot from code in this repo.

## Debug / QA

Open with `?qa=1` to auto-start without pointer lock. `window.__qa` exposes
`state() / give(text) / teleport(x,z) / setFloor(n) / look(yaw,pitch) / forward(m) /
findRooms(range) / findHole(range) / findPile(range) / findPlug(range) / findBlackout(range) /
spawnLifeform(dist) / lifeform() / music() / flash(on) / map(open) / pools()`.

The Playwright suites in `qa/` expect `npm i playwright` in the repo root
(or set `QA_DEPS` to a node_modules path), plus the game served on
port 4790: `node qa/escape.mjs`, `qa/rooms-monster.mjs`, `qa/fall-stress.mjs`.

## License

MIT — see `LICENSE`. This is a fan project inspired by the Backrooms
creepypasta and its film adaptations; it is affiliated with none of them.
