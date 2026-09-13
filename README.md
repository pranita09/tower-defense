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

| Concern       | Choice                                | Why                                                                                      |
| ------------- | ------------------------------------- | ---------------------------------------------------------------------------------------- |
| Language      | TypeScript                            | The simulation leans on typed arrays and numeric entity IDs, where types prevent real bugs |
| Build         | Vite                                  | Fast dev server, single-command static build, no server needed to play                    |
| UI            | React                                 | HUD, shop and menus only — the game loop lives outside React and never triggers renders   |
| Rendering     | Hand-written WebGL2 instanced renderer | Draws thousands of sprites in one call; a Canvas 2D path is kept as the naive baseline    |
| Tests         | Vitest                                | Unit tests for the pure simulation maths                                                  |

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
