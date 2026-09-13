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

## Keyboard shortcuts

| Key         | Action                       |
| ----------- | ---------------------------- |
| `Space`     | Pause / resume               |
| `1` `2` `3` | Game speed 1x / 2x / 4x      |
| `P`         | Toggle performance overlay   |
| `R`         | Reset the measurement window |

## Planned structure

```
src/
  game/
    core/        # framerate-independent loop, math, RNG, pooling primitives
    sim/         # the simulation: entities in typed arrays, waves, towers, combat
    render/      # renderer interface + WebGL2 and Canvas 2D implementations
    data/        # tower, enemy and wave tuning tables
  ui/            # React HUD, shop, panels, overlays
```

## License

Unlicensed course/assignment project.
