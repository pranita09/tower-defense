# SiegeBound - Tower Defense Game

A tower defense game that runs in the browser. 50 waves, 5 towers, 5 enemy types, and a boss every tenth wave.

Nothing to install and nothing to download at runtime.

It ships with **two versions of the same game**: the one I wrote first, and the one I wrote after measuring it. You can switch between them mid-game and watch the frame counter react.

```bash
npm install
npm run dev        # localhost:5173
```

| Command         | What it does                        |
| --------------- | ----------------------------------- |
| `npm run build` | Type-check and bundle into `dist/`  |
| `npm run test`  | 80 unit tests                       |
| `npm run bench` | Speed benchmarks, no graphics       |
| `npm run smoke` | Plays the built game in real Chrome |

## How to play

Enemies walk a road from the left to your core on the right. You never shoot yourself. You buy towers, and they fire on their own.

Anything that reaches the core costs health. At zero, you lose. Clear all 50 waves to win.

Pick a tower from the shop, click a dark tile to build, click a tower you own to upgrade or sell. Sending a wave early pays extra gold.

| Tower       | Good at                       | Weakness                 |
| ----------- | ----------------------------- | ------------------------ |
| Gun Turret  | Cheap and fast                | Weak against armor       |
| Mortar      | Crowds                        | Can't hit flying enemies |
| Frost Tower | Slowing enemies               | Almost no damage         |
| Tesla Coil  | Armor, chains between targets | Very short range         |
| Railgun     | Huge damage from far away     | Too slow for crowds      |

Grunts are the baseline. Runners slip through gaps. Juggernauts shrug off small hits. Wisps fly over the road, so mortars can't touch them. Splitters burst into three runners when they die.

## Controls

| Key                  | Action                                      |
| -------------------- | ------------------------------------------- |
| `Q` `W` `E` `R` `T`  | Pick gun / mortar / frost / tesla / railgun |
| `Enter`              | Send the next wave early                    |
| `U` / `X`            | Upgrade / sell the selected tower           |
| `Escape`             | Clear the selection                         |
| `Space`              | Pause and resume                            |
| `1` `2` `3`          | Game speed 1x / 2x / 4x                     |
| `M`                  | Mute                                        |
| `P`                  | Show the performance overlay                |
| `R` (in overlay)     | Reset the measurement window                |
| Scroll wheel         | Zoom                                        |
| Right-drag or arrows | Pan                                         |
| `0`                  | Reset the view                              |

## Stack

Vite, TypeScript, React 19, Vitest. No game engine.

React only draws the menus and HUD(Heads-Up Display). The game itself runs outside React.

## Architecture

```
src/
  game/
    core/      loop, camera, grid, memory pools, audio
    data/      map, towers, enemies, waves
    naive/     first version: game logic + Canvas 2D drawing
    fast/      faster version: game logic + WebGL2 drawing
    render/    shared drawing helpers
    bench/     speed tests
    engine.ts  the shared interface both versions use
  ui/          React HUD
scripts/       browser smoke test
```

**One loop.** The whole game uses one animation callback. 5,000 enemies still cost one callback, not 5,000 timers.

**Fixed timestep.** The game always moves in 1/60-second steps, even on a 144Hz screen. Drawing then smooths the leftover time. So it plays the same on every monitor.

Backgrounded tabs get clamped instead of fast-forwarding. Fast-forward runs more steps, not bigger ones.

**React never sees the game.** The HUD asks for an update every 120ms. More enemies on screen does not mean more interface redraws.

Both versions share the same interface, so the HUD, camera, and stress presets stay the same. That keeps the comparison fair.

## Rendering

A **frame** is one picture. About 60 per second feels smooth.

A **draw call** is one instruction sent to the graphics card. Lots of them make the game stutter.

The faster renderer packs every moving thing into one list and sends it in **one** draw call.

The background never changes, so it is painted once and reused.

A busy frame with 9,000 objects costs **two draw calls**. That number does not grow as the field fills up.

Off-screen objects are skipped before they are drawn. Zoom in and the work actually drops: ~9,000 objects become ~1,200.

Past 1,400 enemies, small details like health bars switch off. Text sits on a thin layer on top, because graphics cards are bad at text.

The artwork is drawn in code when the game starts. No image files, no loading screen.

## Where it actually broke

The first version is the simple one:

- one object per enemy, tower, and bullet
- every tower checks every enemy, every step
- the background is redrawn from scratch each frame
- every bullet has its own blur
- nothing off-screen is skipped

I thought the distance checks were the problem. At the target load that is 500,000 checks per step.

So I timed both versions with graphics off:

| Scenario        |   Enemies |  Towers |   Bullets | 1st version |      Faster |  Speedup |
| --------------- | --------: | ------: | --------: | ----------: | ----------: | -------: |
| Real gameplay   |       150 |      20 |        40 |     0.03 ms |     0.03 ms |     1.0x |
| Busy late wave  |       400 |      45 |       120 |     0.06 ms |     0.04 ms |     1.4x |
| Light stress    |     1 000 |      60 |       250 |     0.24 ms |     0.08 ms |     2.9x |
| Heavy stress    |     2 500 |     100 |       500 |     0.89 ms |     0.17 ms |     5.1x |
| **Target load** | **5 000** | **100** | **1 000** | **2.08 ms** | **0.38 ms** | **5.4x** |
| Overkill        |    10 000 |     150 |     2 000 |     6.35 ms |     0.95 ms |     6.7x |

2ms out of a 16ms budget. I was wrong. The checks were cheap.

**Drawing was the real problem.** The first version does about **17,500 draw calls** per frame at the target load. The faster one does **2**.

Same stress preset, flip the toggle, watch the graph go red.

## Optimisations

| Change                   | What it replaces                           |
| ------------------------ | ------------------------------------------ |
| Flat number arrays       | One object per enemy                       |
| Reusable slots           | Growing and shrinking lists                |
| Neighbour grid           | Checking every enemy on the map            |
| Squared distances        | Slow square-root checks                    |
| Pre-computed path table  | Recalculating each enemy's walk every step |
| Re-aim every 5 steps     | Re-aiming every step                       |
| Fixed-size spark buffers | Lists that grow forever                    |

On the drawing side: batching, generated art, a pre-painted background, skipping off-screen objects, and dropping detail under load.

Memory stays flat because the buffers are reserved up front (16,384 enemies, 8,192 bullets, 4,096 sparks, 256 towers). A 50-wave run does not grow with each spawn.

## How I measured

Press `P` for the overlay. It times the gap between frames, not just my own code. That gap is what you feel.

It shows FPS, slow-frame share, and how many things were drawn or skipped.

Gaps over 500ms are treated as stalls (hidden tab, sleeping laptop) and left out of the average. The game also pauses when you switch tabs.

`npm run bench` produces the table above, plus a full 50-wave run played by a bot that can only spend gold it earned.

`npm run smoke` plays the real game in Chrome. Unit tests cannot see clicks, layout, or WebGL. That gap once hid a bug where an invisible layer ate every click.

To reproduce the stress numbers: press `Stress`, pick **Target load**, then `Reset window`. **Breaking point** (16,000 / 250 / 4,000) is there to find the ceiling.

## Other decisions

- Waves are generated from a few formulas, then checked by the bot so the curve is hard but winnable.
- Sound is made in code, so nothing is downloaded.
- Randomness is seeded, so a stress run can be repeated.
- Sharpness is capped at 2x. A 4K screen does not need 4x the work.
- Zoom stops at 6x, which also makes off-screen skipping easy to see.
