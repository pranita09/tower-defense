import { describe, expect, it } from 'vitest';
import { NaiveSim } from './naiveSim';

/**
 * Headless cost of the naive simulation, with no rendering involved.
 *
 * Run with `npm run bench`. It is skipped in the normal test run because it
 * deliberately takes seconds, not milliseconds.
 *
 * Isolating the simulation matters: in the browser the naive renderer and the
 * naive simulation both blow the frame budget, and without a measurement like
 * this it is impossible to say which one to fix first.
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
];

function measure(scenario: Scenario): number {
  const sim = new NaiveSim();
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

/**
 * Read through `globalThis` so the browser-targeted tsconfig does not need
 * Node's type definitions just to gate a benchmark.
 */
const benchEnabled = Boolean(
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.BENCH
);

describe.skipIf(!benchEnabled)('naive simulation cost', () => {
  it('reports milliseconds per tick across load levels', () => {
    const rows: string[] = [];
    rows.push('  scenario          enemies  towers  shots   ms/tick   % of 60Hz frame');

    for (const scenario of SCENARIOS) {
      const msPerTick = measure(scenario);
      const budgetShare = (msPerTick / FRAME_BUDGET_MS) * 100;
      rows.push(
        `  ${scenario.label.padEnd(17)} ${String(scenario.enemies).padStart(6)}  ` +
          `${String(scenario.towers).padStart(6)}  ${String(scenario.projectiles).padStart(5)}   ` +
          `${msPerTick.toFixed(2).padStart(7)}   ${budgetShare.toFixed(0).padStart(6)}%`
      );
    }

    console.log(`\n${rows.join('\n')}\n`);
    expect(rows.length).toBe(SCENARIOS.length + 1);
  });
});
