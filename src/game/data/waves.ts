import { ENEMY_ARMORED, ENEMY_GRUNT, ENEMY_RUNNER } from './enemies';

/**
 * The 50-wave difficulty curve.
 *
 * Waves are generated from the wave number rather than hand-written, so the
 * curve is one set of readable formulas instead of a thousand-line table. It is
 * a pure function of the wave number, which keeps runs reproducible.
 *
 * Three pressures ramp independently, which is what stops the curve feeling
 * like a single number going up:
 *
 * - **Health** rises geometrically, so raw damage output must keep pace.
 * - **Armor** rises in steps, which retires low-damage towers and forces
 *   upgrades rather than more of the same.
 * - **Composition** widens: new enemy types unlock, and the mix shifts toward
 *   the types that punish a one-dimensional defence.
 */

export const TOTAL_WAVES = 50;
export const STARTING_HEALTH = 20;
export const STARTING_GOLD = 260;

/** Waves that unlock each enemy type. */
const RUNNER_UNLOCK_WAVE = 4;
const ARMORED_UNLOCK_WAVE = 7;
const BOSS_INTERVAL = 10;

export interface WaveGroup {
  enemyId: number;
  count: number;
  /** Seconds between spawns within this group. */
  interval: number;
  /** Seconds to wait after the wave starts before this group begins. */
  delay: number;
  boss: boolean;
}

export interface WaveDef {
  number: number;
  groups: readonly WaveGroup[];
  totalEnemies: number;
  /** Multiplier applied to every enemy's base health. */
  healthScale: number;
  /** Multiplier applied to every enemy's base speed. */
  speedScale: number;
  /** Added to every enemy's armor. */
  armorBonus: number;
  /** Multiplier applied to kill bounties, so late waves stay fundable. */
  bountyScale: number;
  /** Gold granted for clearing the wave. */
  reward: number;
}

function buildWave(number: number): WaveDef {
  const groups: WaveGroup[] = [];
  const interval = Math.max(0.26, 0.82 - number * 0.011);

  groups.push({
    enemyId: ENEMY_GRUNT,
    count: 5 + Math.floor(number * 1.35),
    interval,
    delay: 0,
    boss: false,
  });

  if (number >= RUNNER_UNLOCK_WAVE) {
    groups.push({
      enemyId: ENEMY_RUNNER,
      count: 4 + Math.floor((number - RUNNER_UNLOCK_WAVE) * 1.15),
      interval: interval * 0.62,
      delay: 3.2,
      boss: false,
    });
  }

  if (number >= ARMORED_UNLOCK_WAVE) {
    groups.push({
      enemyId: ENEMY_ARMORED,
      count: 2 + Math.floor((number - ARMORED_UNLOCK_WAVE) * 0.62),
      interval: interval * 1.7,
      delay: 5.5,
      boss: false,
    });
  }

  if (number % BOSS_INTERVAL === 0) {
    groups.push({
      enemyId: ENEMY_ARMORED,
      count: Math.floor(number / BOSS_INTERVAL),
      interval: 3.5,
      delay: 8,
      boss: true,
    });
  }

  let totalEnemies = 0;
  for (const group of groups) totalEnemies += group.count;

  return {
    number,
    groups,
    totalEnemies,
    healthScale: Math.pow(1.128, number - 1),
    speedScale: 1 + Math.min(0.45, (number - 1) * 0.007),
    armorBonus: Math.floor(number / 9),
    bountyScale: 1 + (number - 1) * 0.055,
    reward: 22 + number * 4,
  };
}

export const WAVES: readonly WaveDef[] = Array.from({ length: TOTAL_WAVES }, (_, index) =>
  buildWave(index + 1)
);

export function getWave(number: number): WaveDef {
  return WAVES[Math.min(Math.max(number, 1), TOTAL_WAVES) - 1];
}
