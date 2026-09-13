# SiegeBound — Tower Defense

A browser tower defense game: 50 waves, 5 tower types, 5 enemy types plus bosses, and a
hand-written WebGL2 renderer. No server, no assets to download — the sprite atlas is
generated at runtime and the whole thing is a static bundle.

It ships with **two complete implementations of the same game**: the straightforward one
you write first, and the optimized one. You can switch between them at runtime from the
Stress panel, under the same load, and watch the performance overlay disagree.

## Getting started

```bash
npm install
npm run dev          # http://localhost:5173
```

| Script            | What it does                                                      |
| ----------------- | ----------------------------------------------------------------- |
| `npm run dev`     | Dev server with hot reload                                        |
| `npm run build`   | Type-check, then build a static bundle into `dist/`               |
| `npm run preview` | Serve the production build at http://localhost:4173               |
| `npm run test`    | Unit tests (Vitest, ~80 tests)                                    |
| `npm run bench`   | Headless simulation benchmarks and a full 50-wave run             |
| `npm run smoke`   | Drives the built game in real Chrome and asserts on what it finds |
| `npm run lint`    | ESLint                                                            |
| `npm run format`  | Prettier                                                          |

## How to play

Enemies walk a fixed road from the left edge to your core on the right. You never attack
directly: you spend gold on towers beside the road, and they acquire and fire on their
own. Anything that reaches the core costs health, and at zero health the run ends. Clear
all 50 waves to win.

Pick a tower from the shop, click a dark tile to build, and click an existing tower to
inspect, upgrade or sell it. Waves send themselves after a breather, and sending one early
pays a gold bonus, so there is a reason to press your luck.

The towers are meant to cover each other's weaknesses rather than rank against each other:

| Tower           | Role                | Why you need it                                                     |
| --------------- | ------------------- | ------------------------------------------------------------------- |
| **Gun Turret**  | Rapid single target | Cheap and relentless, but flat armor eats most of each small hit    |
| **Mortar**      | Splash damage       | The answer to packed groups. Cannot elevate, so it ignores flyers   |
| **Frost Tower** | Slow support        | Almost no damage — it buys everything else more time in range       |
| **Tesla Coil**  | Anti-armor chain    | Ignores armor entirely and arcs to nearby targets, but short ranged |
| **Railgun**     | Long-range burst    | Hits instantly at half the map away; slow enough to punish misuse   |

And the enemies exist to punish a one-dimensional defence:

| Enemy          | Trait                                                                   |
| -------------- | ----------------------------------------------------------------------- |
| **Grunt**      | Baseline infantry, in every wave                                        |
| **Runner**     | Fragile but fast, so gaps in coverage leak                              |
| **Juggernaut** | Heavy armor makes rapid weak hits nearly useless                        |
| **Wisp**       | Flies straight over the terrain to the core; mortars cannot touch it    |
| **Splitter**   | Bursts into three runners when it dies, so killing it late is a mistake |

A boss arrives every tenth wave with a huge health pool, extra armor and a much heavier
leak penalty.

### Controls

| Key                          | Action                                        |
| ---------------------------- | --------------------------------------------- |
| `Q` `W` `E` `R` `T`          | Select gun / mortar / frost / tesla / railgun |
| `Enter`                      | Send the next wave early                      |
| `U` / `X`                    | Upgrade / sell the selected tower             |
| `Escape`                     | Clear the selection                           |
| `Space`                      | Pause / resume                                |
| `1` `2` `3`                  | Game speed 1x / 2x / 4x                       |
| `M`                          | Mute                                          |
| `P`                          | Toggle the performance overlay                |
| Scroll / right-drag / arrows | Zoom / pan                                    |
| `0`                          | Reset the view                                |

## Architecture

```
src/
  game/
    core/      loop, perf instrumentation, camera, spatial grid, slot pool,
               path lookup table, seeded RNG, audio, storage
    data/      map and path, tower / enemy / wave tuning tables, colour palette
    naive/     baseline simulation + Canvas 2D renderer
    fast/      optimized simulation + WebGL2 renderer
    render/    viewport, generated sprite atlas, instanced sprite batch,
               background quad, shared terrain painting
    bench/     headless benchmarks
    engine.ts  the interface both implementations satisfy
  ui/          React HUD, shop, panels, overlays, title screen
scripts/       browser smoke test
```

Three rules hold the whole thing together.

**One loop, no per-entity timers.** There is exactly one `requestAnimationFrame` callback
in the app. Tower cooldowns, spawn timing, slow effects and particle lifetimes are all
counters advanced inside the simulation step. Nothing owns a `setTimeout`.

**Simulation time is decoupled from display time.** `step(delta)` always receives the same
1/60s delta; real elapsed time is banked in an accumulator and spent in whole ticks.
`render(alpha)` gets the leftover fraction of a tick and interpolates between the last two
positions, so motion stays smooth even when the tick rate and the refresh rate disagree.
Long stalls are clamped rather than fast-forwarded, and catch-up ticks are capped per frame
so one slow frame cannot cascade. Higher game speeds run _more_ ticks per second, never
larger ones, so 4x behaves identically to 1x. `src/game/core/loop.test.ts` feeds the loop
60Hz, 144Hz and 30Hz cadences and asserts they simulate the same amount of time.

**React never sees the game.** The UI reads a state snapshot on a 120ms timer, and the
engine never calls into React. Entity count has no influence on how often React renders —
5,000 enemies produce exactly as many re-renders as 5.

Both implementations satisfy one interface (`src/game/engine.ts`), so the UI, the input
handling, the camera and the stress presets are shared. That is what makes the runtime
toggle a fair comparison rather than a demo of two different games.

## Rendering approach

The optimized renderer is hand-written WebGL2 with **instanced rendering**. Every dynamic
thing on screen — enemies, health bars, projectiles, particles, tower bases, barrels,
level pips, arcs — is a textured quad appended to one interleaved buffer, then issued as a
single `drawArraysInstanced` call. Per-sprite CPU cost is a handful of array writes.

- **The sprite atlas is generated at runtime** (`render/atlas.ts`) into a 256×256 canvas:
  circle, square, triangle, diamond, hex, glow, ring, tower base, barrel, shadow and a
  plain white pixel, all drawn in greyscale so the shader can tint them. No image files, no
  loading state, no CORS.
- **Static terrain is baked once.** The ground, tile grid, road and its markings are
  pre-rendered to an offscreen canvas and drawn as one textured quad. A frame that draws
  9,000 sprites costs **two draw calls** in total.
- **Culling happens before the buffer write**, not in the GPU. Anything outside the visible
  rectangle (plus a margin) never becomes instance data at all, so zooming in genuinely
  reduces work rather than just magnifying it. Zoom to 6x at the target load and the batch
  drops from ~9,000 sprites to ~1,200 with ~7,500 culled.
- **Detail degrades automatically.** Past a threshold of on-screen enemies, health bars,
  facing rotation and flyer shadows drop out. Health bars are also skipped whenever an
  enemy is smaller than a few pixels, where they would be illegible anyway.
- **Text lives on a separate 2D canvas.** WebGL is bad at text, so damage numbers, range
  circles and chain lightning are drawn on a thin transparent 2D layer above the WebGL
  canvas. That layer only ever handles a bounded number of items, so it cannot scale with
  the enemy count.

The naive renderer draws to the same 2D canvas instead, which is why swapping engines
requires no DOM changes.

## The baseline, and where it breaks

The baseline (`src/game/naive/`) is deliberately written the way a tower defense is _first_
written:

- one heap object per enemy, tower, projectile, particle and damage number, in plain arrays
  that are `splice`d as entities die;
- every tower rescans every enemy every tick to pick a target, with a real `Math.sqrt` per
  candidate; splash damage rescans the list again;
- terrain, grid and road are redrawn from scratch every frame;
- each entity issues its own `save` / `translate` / `beginPath` / `fill` / `restore`, and
  every projectile sets `shadowBlur` individually;
- a health bar is drawn for every enemy regardless of size, and nothing is culled.

### First surprise: the simulation was not the bottleneck

`npm run bench` runs both simulations with no renderer attached, which is the only way to
tell whether the logic or the drawing is the problem. Milliseconds per tick, on an M-series
laptop:

| Scenario        |   Enemies |  Towers |     Shots |    Baseline |   Optimized |  Speedup | Optimized share of a 60Hz frame |
| --------------- | --------: | ------: | --------: | ----------: | ----------: | -------: | ------------------------------: |
| Real gameplay   |       150 |      20 |        40 |     0.03 ms |     0.03 ms |     1.0x |                            0.2% |
| Busy late wave  |       400 |      45 |       120 |     0.06 ms |     0.04 ms |     1.4x |                            0.2% |
| Light stress    |     1 000 |      60 |       250 |     0.24 ms |     0.08 ms |     2.9x |                            0.5% |
| Heavy stress    |     2 500 |     100 |       500 |     0.89 ms |     0.17 ms |     5.1x |                            1.0% |
| **Target load** | **5 000** | **100** | **1 000** | **2.08 ms** | **0.38 ms** | **5.4x** |                        **2.3%** |
| Overkill        |    10 000 |     150 |     2 000 |     6.35 ms |     0.95 ms |     6.7x |                            5.7% |

The O(towers × enemies) target scan is 500,000 distance checks per tick at the target load,
and I assumed it would dominate. A modern JIT chews through that in about 2ms — an eighth
of a 60Hz frame. So the naive _simulation_ is not what breaks the game.

### What actually breaks: draw calls

The naive renderer issues roughly **17,500 draw calls per frame** at the target load, each
with its own canvas state changes, path construction and (for projectiles) a `shadowBlur`
that forces a blur pass. The optimized renderer issues **2**. Those numbers are read
straight out of the running browser by `npm run smoke`.

That is the delta the demo video shows: switch the engine toggle to _Baseline_ at the same
stress preset and the frame graph goes solid red; switch back and it flattens out.

## Optimizations

**Simulation**

| Technique                       | What it replaces                                                                                                                             |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Typed-array structure-of-arrays | One object per entity. Entity fields live in parallel `Float32Array`s, so a hot loop walks contiguous memory instead of chasing pointers     |
| Slot pool with free list        | `push` / `splice`. Allocation and release are O(1) index swaps; generation counters make stale references detectable instead of dangerous    |
| Spatial hash grid               | The full O(towers × enemies) scan. Targeting and splash only visit the cells a radius overlaps                                               |
| Squared-distance comparisons    | `Math.sqrt` per candidate. Square roots only happen when an actual distance is needed                                                        |
| Precomputed path lookup table   | Walking the waypoint list per enemy per tick. Position is one table read plus a lerp, verified against the exact path to within half a pixel |
| Fixed-capacity effect pools     | Growing arrays of particles and damage numbers. Oldest entries are overwritten, so cost is bounded                                           |

**Rendering**

Instanced batching, a runtime-generated atlas, a pre-baked static background, culling
before the buffer write, and level-of-detail — all described above.

**Memory**

Every buffer the simulation needs is allocated before the first tick, so a 50-wave run
performs no per-entity allocation at all. The headless 50-wave run samples the heap every
ten seconds of game time: it wobbles inside a ~15MB band from garbage the _test harness_
creates and ends lower than it started. Every entity slot returns to its pool.

## How performance was measured

**In the browser: the overlay** (`P` to toggle). It measures the **frame interval** —
wall-clock time between consecutive animation frames — because that is what a player
perceives, and unlike timing our own callbacks it includes browser compositing and GC.

| Readout                             | Meaning                                                            |
| ----------------------------------- | ------------------------------------------------------------------ |
| `FPS`                               | Smoothed instantaneous rate, with the window average beside it     |
| `frame p50/p95/p99`                 | Percentile frame intervals — the honest measure of smoothness      |
| `over 22ms`                         | Share of frames below 45 FPS                                       |
| `over 33ms`                         | Share of frames breaching the 33ms ceiling; the target is under 5% |
| `sim` / `render` / `cpu`            | Where time goes inside our own code, per frame                     |
| `ticks/frame`                       | Simulation ticks executed per frame; rises with game speed         |
| `draw calls` / `sprites` / `culled` | How the frame was drawn, and how much was skipped                  |

Percentiles come from a fixed-size histogram, so the measurement window costs O(1) per
frame with no allocation and can run for an entire game without growing. `Reset window`
(or `R`) isolates a run.

Intervals over 500ms are counted as **stalls** and excluded, because at that length the
cause is a hidden tab, a sleeping machine or an attached debugger rather than a slow frame,
and keeping one would drag the average down for minutes. Stalls are reported in the footer
rather than hidden, and the game auto-pauses when the tab loses visibility so they stay
rare. Everything below that threshold is counted in full, including genuine GC pauses.

**Headlessly: `npm run bench`.** Both simulations, no renderer, fixed tick counts after a
warm-up — the table above. Plus a complete 50-wave run played by a gold-limited bot, which
reports the outcome, the heap range and per-tick cost.

**In a real browser: `npm run smoke`.** Unit tests run in Node, where there is no WebGL, no
canvas and no layout. That gap is not academic — it hid a CSS stacking bug where the
transparent overlay canvas sat above the HUD and silently swallowed every click. So this
script drives the built game through Chrome the way a player does (buy, place, upgrade, run
a wave, load the stress preset, zoom in) and asserts on what the DOM reports: that towers
can be placed, that the stress scenario really reaches 5,000 / 100 / 1,000, that the
optimized path still issues two draw calls while the baseline issues thousands, that
culling engages when zoomed, and that nothing logged an error.

It runs on software GL, so it deliberately never asserts on frame rate — only on behaviour
and on the counters that reveal _how_ a frame was drawn. Frame-rate numbers belong to the
machine you run on; read them off the overlay.

To reproduce the stress scenario yourself: press `Stress`, choose **Target load**
(5,000 / 100 / 1,000), then `Reset window` and let it settle. Stress mode holds the
population steady and recycles leaks instead of damaging the base, so the numbers stay
comparable for as long as you watch them. **Breaking point** (16,000 / 250 / 4,000) is
there to find the ceiling.

## Balance

Difficulty is not hand-authored wave by wave; the 50 waves are generated from health,
speed, armor and bounty curves, with new enemy types unlocking as the run progresses. That
makes the curve easy to state and hard to eyeball, so it was tuned empirically: the bot in
`npm run bench` plays all 50 waves spending only the gold it earns, and the test asserts it
**wins with health left but not untouched**. Wave 50 puts over 500× more total enemy health
on the field than wave 1.

That loop caught two real problems. Flyers take the straight line to the core, roughly a
third of the road's length, so they were getting a third of the exposure to fire while
scaling in health like everything else — no amount of anti-air could hold wave 45. And the
health curve as a whole outran the damage a fully built board can produce, which the
diagnostic exposed as _every single leak being the same enemy type_.

