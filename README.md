# Bastion — Tower Defense

A browser tower defense game built with TypeScript, React and a hand-written WebGL2
renderer. Survive 50 waves of increasingly nasty enemies by placing, upgrading and
selling towers around a fixed path.

> **Status:** in development. This README grows with the project; the full
> architecture, performance and measurement write-up lands with the optimization work.

## Getting started

```bash
npm install
npm run dev      # dev server at http://localhost:5173
```

Other scripts:

```bash
npm run build    # type-check + production build into dist/
npm run preview  # serve the production build locally
npm run test     # unit tests (Vitest)
npm run lint     # ESLint
npm run format   # Prettier
```

## Tech stack

| Concern   | Choice                                 | Why                                                                                        |
| --------- | -------------------------------------- | ------------------------------------------------------------------------------------------ |
| Language  | TypeScript                             | The simulation leans on typed arrays and numeric entity IDs, where types prevent real bugs |
| Build     | Vite                                   | Fast dev server, single-command static build, no server needed to play                     |
| UI        | React                                  | HUD, shop and menus only — the game loop lives outside React and never triggers renders    |
| Rendering | Hand-written WebGL2 instanced renderer | Draws thousands of sprites in one call; a Canvas 2D path is kept as the naive baseline     |
| Tests     | Vitest                                 | Unit tests for the pure simulation maths                                                   |

## The game loop

There is exactly **one** `requestAnimationFrame` callback in the whole app. No entity
owns a timer or its own loop; tower cooldowns, spawn timing and effect lifetimes are all
counters advanced inside the simulation step.

Simulation time is decoupled from display time using a fixed timestep with an
accumulator:

- `step(delta)` is always called with the **same** delta (1/60s). Real elapsed time is
  banked in an accumulator and spent in whole ticks.
- `render(alpha)` receives the leftover fraction of a tick so it can draw a smooth
  in-between of the last two simulation states instead of snapping to the latest one.
- Long stalls (a backgrounded tab) are clamped rather than fast-forwarded, and catch-up
  ticks are capped per frame so one slow frame cannot cascade into a death spiral.
- Higher game speeds run **more** ticks per second, never larger ticks, so behaviour at
  4x is identical to 1x.

The upshot is that the game plays the same on a 60Hz laptop and a 144Hz monitor, which
is verified in `src/game/core/loop.test.ts` by feeding the loop both frame cadences and
asserting they simulate the same amount of time.

## Reading the performance overlay

The overlay (top right, toggle with `P`) measures the **frame interval** — wall-clock
time between consecutive animation frames — because that is what the player perceives
and it includes browser work such as compositing and garbage collection that happens
outside our own callbacks.

| Readout                  | Meaning                                                            |
| ------------------------ | ------------------------------------------------------------------ |
| `FPS`                    | Smoothed instantaneous rate, with the window average beside it     |
| `frame p50/p95/p99`      | Percentile frame intervals — the honest measure of smoothness      |
| `over 22ms`              | Share of frames below 45 FPS                                       |
| `over 33ms`              | Share of frames breaching the 33ms ceiling; the target is under 5% |
| `sim` / `render` / `cpu` | Where the time goes inside our own code                            |
| `ticks/frame`            | Simulation ticks executed per frame; rises with game speed         |

Percentiles come from a fixed-size histogram, so a measurement window costs O(1) per
frame with no allocation and can run for an entire 50-wave game without growing. `Reset
window` (or `R`) starts a fresh window, which is how each benchmark run is isolated.

Intervals longer than 500ms are counted as **stalls** and excluded from the statistics,
because at that length the cause is a hidden tab, a sleeping machine or an attached
debugger rather than a slow frame — keeping one would drag the window average down for
minutes. Excluded stalls are shown in the overlay footer rather than hidden, and the game
auto-pauses when the tab loses visibility so they should be rare. Anything below that
threshold is reported in full, including genuine multi-hundred-millisecond GC pauses.

## How to play

Enemies walk a fixed road from the top-left spawn to your base at the bottom-right. You
cannot fight them directly — you spend gold on towers beside the road, and towers acquire
and shoot targets on their own. Anything that reaches the base costs you health; at zero
health the run is over. Clear all 50 waves to win.

Pick a tower from the shop, then click a buildable tile. Click an existing tower to
inspect it and upgrade or sell it. Waves send themselves after a countdown, and sending
one early pays a gold bonus, so there is a reason to press your luck.

The three towers are meant to cover each other's weaknesses rather than rank against each
other:

| Tower           | Role                | Why you need it                                              |
| --------------- | ------------------- | ------------------------------------------------------------ |
| **Gun Turret**  | Rapid single target | Cheap and relentless, but flat armor eats most of each hit   |
| **Mortar**      | Splash damage       | The answer to packed groups; too slow to track a lone runner |
| **Frost Tower** | Slow support        | Almost no damage — it buys the other two more time in range  |

The three enemies exist to punish a one-dimensional defence:

| Enemy          | Trait                                                   |
| -------------- | ------------------------------------------------------- |
| **Grunt**      | Baseline; shows up in every wave                        |
| **Runner**     | Fragile but very fast, so gaps in coverage leak         |
| **Juggernaut** | Heavy armor, which makes rapid weak hits nearly useless |

A boss arrives every tenth wave with a large health pool and a much heavier leak penalty.

## Keyboard shortcuts

| Key         | Action                       |
| ----------- | ---------------------------- |
| `Q` `W` `E` | Select gun / mortar / frost  |
| `Enter`     | Send the next wave early     |
| `U` / `X`   | Upgrade / sell the selection |
| `Escape`    | Clear the selection          |
| `Space`     | Pause / resume               |
| `1` `2` `3` | Game speed 1x / 2x / 4x      |
| `P`         | Toggle performance overlay   |
| `R`         | Reset the measurement window |

## Baseline: the naive implementation

The first implementation is deliberately written the way a tower defense is _first_
written, and it is kept in the repository as the performance baseline the optimized
version is measured against:

- one heap object per enemy, tower, projectile, particle and damage number, in plain
  arrays that are `splice`d as entities die;
- every tower rescans every enemy on every tick to choose a target, with a real square
  root per candidate, and splash damage rescans the list again;
- the terrain, grid and path are redrawn from scratch every frame;
- each entity issues its own `save`/`translate`/`beginPath`/`fill`/`restore`, and every
  projectile sets `shadowBlur` individually;
- a health bar is drawn for every enemy regardless of size, and nothing is culled.

### Simulation cost, measured headlessly

`npm run bench` runs the simulation with no renderer attached, which is the only way to
tell whether the simulation or the drawing is the real problem:

| Scenario        |   Enemies |  Towers | Projectiles | ms / tick | Share of a 60Hz frame |
| --------------- | --------: | ------: | ----------: | --------: | --------------------: |
| Real gameplay   |       150 |      20 |          40 |      0.03 |                    0% |
| Busy late wave  |       400 |      45 |         120 |      0.05 |                    0% |
| Light stress    |     1 000 |      60 |         250 |      0.20 |                    1% |
| Heavy stress    |     2 500 |     100 |         500 |      0.80 |                    5% |
| **Target load** | **5 000** | **100** |   **1 000** |  **1.68** |               **10%** |

The result was not what I expected. The O(towers x enemies) target scan is 500 000
distance checks per tick at the target load, and I assumed it would dominate — but a
modern JIT chews through that in under 2ms, roughly a tenth of the frame budget. So the
naive **simulation** is not what breaks; the naive **renderer**, which issues thousands of
individual canvas state changes per frame, is. Measuring first meant not spending the
optimization effort on the wrong half.

Browser-side numbers for the full picture, including rendering, are collected with the
in-game stress presets and are recorded with the optimization work.

## Project structure

```
src/
  game/
    core/        # loop, perf instrumentation, camera, math, seeded RNG
    data/        # map and path, tower / enemy / wave tuning tables
    naive/       # the baseline simulation and Canvas 2D renderer
    render/      # canvas viewport and (later) the WebGL2 renderer
    engine.ts    # the interface both implementations satisfy
  ui/            # React HUD, shop, panels, overlays
```

## License

Unlicensed course/assignment project.
