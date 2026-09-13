# SiegeBound — Tower Defense

A browser tower defense game: 50 waves, 5 tower types, 5 enemy types plus bosses, and a
hand-written WebGL2 renderer. No server, no assets to download — the sprite atlas is
generated at runtime and the whole thing is a static bundle.

It ships with **two complete implementations of the same game**: the straightforward one you
write first, and the optimized one. Switch between them at runtime from the Stress panel,
under identical load, and watch the performance overlay disagree.

```bash
npm install
npm run dev          # http://localhost:5173
```

`npm run build` type-checks and bundles into `dist/`, `npm run preview` serves it.
`npm run test` runs the unit tests, `npm run bench` the headless benchmarks, and
`npm run smoke` drives the built game through real Chrome.

## How to play

Enemies walk a fixed road from the left edge to your core on the right. You never attack
directly: you spend gold on towers beside the road, and they acquire and fire on their own.
Anything that reaches the core costs health, and at zero health the run ends. Clear all 50
waves to win. Sending a wave early pays a gold bonus, so there is a reason to press your
luck.

The towers cover each other's weaknesses rather than ranking against each other. The **gun
turret** is cheap and relentless but armor eats most of each small hit; the **mortar**
answers packed groups but cannot elevate to reach flyers; the **frost tower** does almost no
damage and instead buys everything else more time in range; the **tesla coil** ignores armor
and arcs between targets but is short ranged; the **railgun** hits instantly from half a map
away, slowly enough to punish misuse.

The enemies punish a one-dimensional defence. **Grunts** are the baseline, **runners** are
fast enough to slip through gaps, **juggernauts** shrug off rapid weak hits, **wisps** fly
straight over the terrain where mortars cannot touch them, and **splitters** burst into three
runners when killed. A boss arrives every tenth wave.

| Key                        | Action                                        |
| -------------------------- | --------------------------------------------- |
| `Q` `W` `E` `R` `T`        | Select gun / mortar / frost / tesla / railgun |
| `Enter`                    | Send the next wave early                      |
| `U` / `X`                  | Upgrade / sell the selected tower             |
| `Space` / `1` `2` `3`      | Pause / game speed                            |
| `P` / `R`                  | Performance overlay / reset its window        |
| Scroll, right-drag, arrows | Zoom and pan (`0` resets)                     |

## Architecture

```
src/
  game/
    core/      loop, perf instrumentation, camera, spatial grid, slot pool,
               path lookup table, seeded RNG, audio, storage
    data/      map and path, tower / enemy / wave tuning, colour palette
    naive/     baseline simulation + Canvas 2D renderer
    fast/      optimized simulation + WebGL2 renderer
    render/    viewport, generated atlas, instanced batch, background quad
    bench/     headless benchmarks
    engine.ts  the interface both implementations satisfy
  ui/          React HUD, shop, panels, overlays, title screen
scripts/       browser smoke test
```

Three rules hold it together.

**One loop, no per-entity timers.** There is exactly one `requestAnimationFrame` callback in
the app. Tower cooldowns, spawn timing, slow effects and particle lifetimes are counters
advanced inside the simulation step. Nothing owns a `setTimeout`.

**Simulation time is decoupled from display time.** `step(delta)` always receives the same
1/60s delta; real elapsed time is banked in an accumulator and spent in whole ticks.
`render(alpha)` gets the leftover fraction and interpolates, so motion stays smooth when tick
rate and refresh rate disagree. Long stalls are clamped rather than fast-forwarded, and
catch-up ticks are capped so one slow frame cannot cascade. Higher game speeds run _more_
ticks per second, never larger ones. `core/loop.test.ts` feeds 60Hz, 144Hz and 30Hz cadences
and asserts they simulate the same amount of time.

**React never sees the game.** The UI reads a snapshot on a 120ms timer and the engine never
calls into React, so 5,000 enemies produce exactly as many re-renders as 5.

Both implementations satisfy one interface (`game/engine.ts`), so the UI, input, camera and
stress presets are shared — which is what makes the runtime toggle a fair comparison.

## Rendering approach

The optimized renderer is hand-written WebGL2 with instanced rendering. Every dynamic thing
on screen — enemies, health bars, projectiles, particles, tower bases, barrels, level pips —
is a textured quad appended to one interleaved buffer and issued as a single
`drawArraysInstanced` call, so per-sprite CPU cost is a handful of array writes.

- **The atlas is generated at runtime** into a 256×256 canvas, in greyscale so the shader can
  tint it. No image files, no loading state, no CORS.
- **Static terrain is baked once** into an offscreen canvas and drawn as one quad. A frame
  with 9,000 sprites costs two draw calls in total.
- **Culling happens before the buffer write.** Anything outside the visible rectangle never
  becomes instance data, so zooming in genuinely reduces work: at 6x zoom under target load
  the batch drops from ~9,000 sprites to ~1,200.
- **Detail degrades automatically.** Past a threshold of on-screen enemies, health bars,
  facing rotation and flyer shadows drop out — as do health bars on anything a few pixels
  wide, where they would be illegible anyway.
- **Text lives on a separate 2D canvas**, since WebGL is bad at text. That layer handles a
  bounded number of items, so it cannot scale with the enemy count.

The naive renderer draws to the same 2D canvas instead, which is why swapping engines needs
no DOM changes.

## The baseline, and where it breaks

The baseline (`game/naive/`) is written the way a tower defense is _first_ written: one heap
object per entity in arrays that get `splice`d, a full enemy rescan per tower per tick with a
real `Math.sqrt` per candidate, another rescan for splash, terrain redrawn from scratch every
frame, a `save`/`beginPath`/`restore` per entity, a `shadowBlur` per projectile, health bars
for everything, and no culling.

**The simulation was not the bottleneck.** `npm run bench` runs both simulations with no
renderer attached, in ms per tick on an M-series laptop:

| Scenario        |   Enemies |  Towers |     Shots |    Baseline |   Optimized |  Speedup |
| --------------- | --------: | ------: | --------: | ----------: | ----------: | -------: |
| Real gameplay   |       150 |      20 |        40 |     0.03 ms |     0.03 ms |     1.0x |
| Busy late wave  |       400 |      45 |       120 |     0.06 ms |     0.04 ms |     1.4x |
| Light stress    |     1 000 |      60 |       250 |     0.24 ms |     0.08 ms |     2.9x |
| Heavy stress    |     2 500 |     100 |       500 |     0.89 ms |     0.17 ms |     5.1x |
| **Target load** | **5 000** | **100** | **1 000** | **2.08 ms** | **0.38 ms** | **5.4x** |
| Overkill        |    10 000 |     150 |     2 000 |     6.35 ms |     0.95 ms |     6.7x |

The O(towers × enemies) target scan is 500,000 distance checks per tick at target load, and I
assumed it would dominate. A modern JIT chews through that in about 2ms — an eighth of a 60Hz
frame.

**Draw calls are what break it.** The naive renderer issues roughly 17,500 per frame at
target load, each with its own state changes, path construction and, for projectiles, a blur
pass. The optimized renderer issues 2. Both numbers are read out of the running browser by
`npm run smoke`. That is the delta the demo video shows: flip the toggle to _Baseline_ at the
same preset and the frame graph goes solid red.

## Optimizations

| Technique                       | What it replaces                                                                                    |
| ------------------------------- | --------------------------------------------------------------------------------------------------- |
| Typed-array structure-of-arrays | One object per entity. Fields live in parallel `Float32Array`s, so hot loops walk contiguous memory |
| Slot pool with free list        | `push`/`splice`. O(1) index swaps, with generation counters making stale references detectable      |
| Spatial hash grid               | The full O(towers × enemies) scan. Targeting and splash visit only the cells a radius overlaps      |
| Squared-distance comparisons    | `Math.sqrt` per candidate — square roots only when an actual distance is needed                     |
| Precomputed path lookup table   | Walking the waypoint list per enemy per tick. Now one table read plus a lerp                        |
| Fixed-capacity effect pools     | Growing particle and damage-number arrays. Oldest entries are overwritten, so cost is bounded       |

On the rendering side: instanced batching, a runtime atlas, a baked background, culling before
the buffer write, and level-of-detail, all described above.

Every buffer the simulation needs is allocated before the first tick, so a 50-wave run
performs no per-entity allocation. The headless 50-wave run samples the heap every ten
seconds of game time: it wobbles inside a ~15MB band from garbage the _test harness_ creates
and ends lower than it started, with every entity slot back in its pool.

## How performance was measured

**In the browser: the overlay** (`P`). It measures the frame _interval_ — wall-clock time
between animation frames — because that is what a player perceives and, unlike timing our own
callbacks, it includes browser compositing and GC. It reports percentile frame times, the
share of frames below 45 FPS and above the 33ms ceiling, sim/render/CPU cost, ticks per frame,
and draw calls, sprites and culled counts. Percentiles come from a fixed-size histogram, so
the window costs O(1) per frame and can run for a whole game without growing.

Intervals over 500ms are counted as stalls and excluded, since at that length the cause is a
hidden tab or a sleeping machine rather than a slow frame. They are reported in the footer
rather than hidden, and the game auto-pauses when the tab loses visibility so they stay rare.
Everything below that threshold is counted in full, including genuine GC pauses.

**Headlessly: `npm run bench`** — both simulations, no renderer, fixed tick counts after a
warm-up, plus a full 50-wave run played by a gold-limited bot that reports outcome, heap range
and per-tick cost.

**In a real browser: `npm run smoke`.** Unit tests run in Node, where there is no WebGL, no
canvas and no layout. That gap hid a CSS stacking bug where the transparent overlay canvas sat
above the HUD and silently swallowed every click. So this script drives the built game through
Chrome the way a player does and asserts on what the DOM reports: that towers can be placed,
that the stress scenario really reaches 5,000 / 100 / 1,000, that the optimized path still
issues two draw calls while the baseline issues thousands, that culling engages when zoomed,
and that nothing logged an error. It runs on software GL, so it never asserts on frame rate —
only on behaviour and on the counters that reveal _how_ a frame was drawn.

To reproduce the stress scenario: press `Stress`, choose **Target load**, then `Reset window`
and let it settle. Stress mode holds the population steady and recycles leaks instead of
damaging the base, so the numbers stay comparable for as long as you watch.
**Breaking point** (16,000 / 250 / 4,000) is there to find the ceiling.

## Balance

The 50 waves are generated from health, speed, armor and bounty curves, with enemy types
unlocking as the run progresses. That makes the curve easy to state and hard to eyeball, so it
was tuned empirically: the bot in `npm run bench` plays all 50 waves spending only the gold it
earns, and the test asserts it wins with health left but not untouched. Wave 50 puts over 500x
more total enemy health on the field than wave 1.

That loop caught two real problems. Flyers take the straight line to the core, about a third
of the road's length, so they got a third of the exposure to fire while scaling in health like
everything else — no amount of anti-air could hold wave 45. And the health curve as a whole
outran what a fully built board can produce, which the diagnostic exposed as every single leak
being the same enemy type.
