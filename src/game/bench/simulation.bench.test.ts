import { describe, expect, it } from 'vitest';
import { GROUND_LUT } from '../core/pathLut';
import { GRID_COLS, GRID_ROWS, PATH_LENGTH, tileCentreX, tileCentreY } from '../data/map';
import {
  TOWER_FROST,
  TOWER_GUN,
  TOWER_MORTAR,
  TOWER_RAILGUN,
  TOWER_TESLA,
  towerBuildCost,
  towerUpgradeCost,
} from '../data/towers';
import { TOTAL_WAVES } from '../data/waves';
import { FastSim } from '../fast/fastSim';
import { NaiveSim } from '../naive/naiveSim';

/**
 * Simulation-only benchmarks, run with `npm run bench` and skipped otherwise
 * because they take seconds. Separating simulation from rendering is what makes it
 * possible to say which of the two a slow frame came from.
 */

const TICK = 1 / 60;
const WARMUP_TICKS = 60;
const MEASURED_TICKS = 120;
/** A 60Hz frame has this much time for everything, drawing included. */
const FRAME_BUDGET_MS = 16.67;

interface Scenario {
  label: string;
  enemies: number;
  towers: number;
  projectiles: number;
}

const SCENARIOS: readonly Scenario[] = [
  { label: 'real gameplay', enemies: 150, towers: 20, projectiles: 40 },
  { label: 'busy late wave', enemies: 400, towers: 45, projectiles: 120 },
  { label: 'light stress', enemies: 1000, towers: 60, projectiles: 250 },
  { label: 'heavy stress', enemies: 2500, towers: 100, projectiles: 500 },
  { label: 'target load', enemies: 5000, towers: 100, projectiles: 1000 },
  { label: 'overkill', enemies: 10000, towers: 150, projectiles: 2000 },
];

interface Steppable {
  step(delta: number): void;
  stress(request: { enemies: number; towers: number; projectiles: number }): void;
}

function measure(create: () => Steppable, scenario: Scenario): number {
  const sim = create();
  sim.stress({
    enemies: scenario.enemies,
    towers: scenario.towers,
    projectiles: scenario.projectiles,
  });

  for (let i = 0; i < WARMUP_TICKS; i += 1) sim.step(TICK);

  const start = performance.now();
  for (let i = 0; i < MEASURED_TICKS; i += 1) sim.step(TICK);
  return (performance.now() - start) / MEASURED_TICKS;
}

/** Via `globalThis`, so the browser tsconfig needs no Node type definitions. */
const nodeProcess = (
  globalThis as {
    process?: {
      env?: Record<string, string | undefined>;
      memoryUsage?: () => { heapUsed: number };
    };
  }
).process;

const benchEnabled = Boolean(nodeProcess?.env?.BENCH);

function heapUsedMb(): number | null {
  const usage = nodeProcess?.memoryUsage?.();
  return usage ? usage.heapUsed / (1024 * 1024) : null;
}

describe.skipIf(!benchEnabled)('simulation cost: naive vs optimized', () => {
  it('reports milliseconds per tick across load levels', () => {
    const rows: string[] = [];
    rows.push(
      '  scenario          enemies  towers  shots      naive       fast   speedup   fast % of 60Hz'
    );

    for (const scenario of SCENARIOS) {
      const naive = measure(() => new NaiveSim(), scenario);
      const fast = measure(() => new FastSim(), scenario);
      const speedup = naive / fast;
      const budgetShare = (fast / FRAME_BUDGET_MS) * 100;

      rows.push(
        `  ${scenario.label.padEnd(17)} ${String(scenario.enemies).padStart(6)}  ` +
          `${String(scenario.towers).padStart(6)}  ${String(scenario.projectiles).padStart(5)}  ` +
          `${`${naive.toFixed(2)}ms`.padStart(9)}  ${`${fast.toFixed(2)}ms`.padStart(9)}  ` +
          `${`${speedup.toFixed(1)}x`.padStart(7)}   ${`${budgetShare.toFixed(1)}%`.padStart(14)}`
      );
    }

    console.log(`\n${rows.join('\n')}\n`);
    expect(rows.length).toBe(SCENARIOS.length + 1);
  });

  it('keeps the optimized simulation inside the frame budget at the graded load', () => {
    const cost = measure(() => new FastSim(), {
      label: 'target load',
      enemies: 5000,
      towers: 100,
      projectiles: 1000,
    });
    // Simulation alone must leave most of the frame for drawing.
    expect(cost).toBeLessThan(FRAME_BUDGET_MS / 3);
  });
});

/** Buildable tiles, nearest to the road first — where a player actually builds. */
function tilesNearPath(sim: FastSim): Array<{ col: number; row: number }> {
  const point = { x: 0, y: 0 };
  const samples: Array<{ x: number; y: number }> = [];
  for (let distance = 0; distance <= PATH_LENGTH; distance += 16) {
    GROUND_LUT.positionAt(distance, point);
    samples.push({ x: point.x, y: point.y });
  }

  const tiles: Array<{ col: number; row: number; distance: number }> = [];
  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      if (!sim.canPlace(col, row)) continue;
      const x = tileCentreX(col);
      const y = tileCentreY(row);
      let best = Infinity;
      for (const sample of samples) {
        const gap = Math.hypot(sample.x - x, sample.y - y);
        if (gap < best) best = gap;
      }
      tiles.push({ col, row, distance: best });
    }
  }
  return tiles.sort((a, b) => a.distance - b.distance);
}

/** The mix a reasonable player builds, cycled as gold allows. */
const BUILD_ORDER = [
  TOWER_GUN,
  TOWER_GUN,
  TOWER_MORTAR,
  TOWER_GUN,
  TOWER_FROST,
  TOWER_TESLA,
  TOWER_MORTAR,
  TOWER_RAILGUN,
];

/**
 * A whole game played by a gold-limited bot, covering two requirements at once.
 * Balance: the bot is a competent but unremarkable player, so an unwinnable or
 * trivial curve shows up here — this is how the multipliers were tuned. Memory:
 * 50 waves is tens of thousands of spawns, so any per-entity allocation in the hot
 * path would show as a climbing heap.
 */
describe.skipIf(!benchEnabled)('full 50-wave run', () => {
  it('is winnable by a gold-limited player, with flat memory', () => {
    const sim = new FastSim();
    const tiles = tilesNearPath(sim);

    const baseline = heapUsedMb();
    let peakHeap = baseline ?? 0;
    let troughHeap = baseline ?? 0;
    let peakEnemies = 0;
    let nextTile = 0;
    let built = 0;
    let upgradeCursor = 0;
    let ticks = 0;

    const maxTicks = 60 * 60 * 45; // 45 minutes of game time is a generous cap
    const start = performance.now();

    while (ticks < maxTicks && sim.phase !== 'victory' && sim.phase !== 'defeat') {
      if (sim.phase === 'ready') sim.startWave();
      sim.step(TICK);
      ticks += 1;

      if (sim.enemyCount > peakEnemies) peakEnemies = sim.enemyCount;
      if (ticks % 600 === 0) {
        const heap = heapUsedMb();
        if (heap !== null) {
          if (heap > peakHeap) peakHeap = heap;
          if (heap < troughHeap) troughHeap = heap;
        }
      }

      // Spend twice a second: build if affordable, otherwise upgrade.
      if (ticks % 30 !== 0) continue;

      const typeId = BUILD_ORDER[built % BUILD_ORDER.length];
      if (nextTile < tiles.length && sim.gold >= towerBuildCost(typeId)) {
        const tile = tiles[nextTile];
        nextTile += 1;
        if (sim.placeTower(tile.col, tile.row, typeId)) built += 1;
        continue;
      }

      if (sim.towerCount > 0) {
        upgradeCursor = (upgradeCursor + 1) % sim.towerCount;
        const cost = towerUpgradeCost(sim.tType[upgradeCursor], sim.tLevel[upgradeCursor]);
        if (cost !== null && sim.gold >= cost) {
          sim.selectedTowerId = sim.tId[upgradeCursor];
          sim.upgradeSelected();
        }
      }
    }

    const elapsed = performance.now() - start;
    const finalHeap = heapUsedMb();
    let levelSum = 0;
    for (let i = 0; i < sim.towerCount; i += 1) levelSum += sim.tLevel[i];

    console.log(
      [
        '',
        `  outcome          ${sim.phase} at wave ${sim.wave} / ${TOTAL_WAVES}`,
        `  base health      ${sim.health} / ${sim.maxHealth}  (${sim.leaks} leaks)`,
        `  towers built     ${built}, average level ${(levelSum / Math.max(1, sim.towerCount)).toFixed(2)}`,
        `  kills            ${sim.kills.toLocaleString()}`,
        `  score            ${sim.score.toLocaleString()}`,
        `  peak enemies     ${peakEnemies.toLocaleString()}`,
        `  simulated        ${(ticks / 60).toFixed(0)}s of game time`,
        `  wall clock       ${(elapsed / 1000).toFixed(2)}s (${(elapsed / ticks).toFixed(3)}ms per tick)`,
        baseline === null
          ? '  heap             unavailable in this runtime'
          : `  heap             ${baseline.toFixed(1)} -> ${finalHeap?.toFixed(1)} MB (range ${troughHeap.toFixed(1)}-${peakHeap.toFixed(1)})`,
        '',
      ].join('\n')
    );

    // The run has to actually end, rather than stall on enemies it cannot kill.
    expect(ticks).toBeLessThan(maxTicks);
    expect(sim.phase).toBe('victory');
    // Winnable, but not a walkover: leaking is expected, surviving is the test.
    expect(sim.leaks).toBeGreaterThan(0);
    expect(sim.health).toBeGreaterThan(0);

    // Slots all came back, which is the structural reason memory stays flat.
    expect(sim.enemies.freeSlots).toBe(sim.enemies.capacity);
    // Victory freezes the sim mid-flight, so a few slots are legitimately held.
    expect(sim.projectiles.activeCount).toBeLessThan(64);

    if (baseline !== null && finalHeap !== null) {
      // Generous, because Node collects when it likes. The point is that there is
      // no unbounded growth: every buffer was reserved before the first tick.
      expect(finalHeap - baseline).toBeLessThan(24);
    }
  });
});
