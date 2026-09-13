import { ENEMY_ARMORED, ENEMY_FLYER, ENEMY_GRUNT, ENEMY_RUNNER, ENEMY_SPLITTER } from './enemies';

/**
 * The 50-wave difficulty curve.
 *
 * Waves are generated from the wave number rather than hand-written, so the
 * curve is a handful of readable formulas instead of a thousand-line table, and
 * it stays a pure function of the wave number, which keeps runs reproducible.
 *
 * Four pressures ramp independently, which is what stops the curve feeling like
 * a single number going up:
 *
 * - **Health** rises geometrically, so raw damage output must keep pace.
 * - **Armor** rises in steps, which retires low-damage towers and forces
 *   upgrades rather than more of the same.
 * - **Composition** widens as new enemy types unlock, so a defence that only
 *   answers one threat starts leaking.
 * - **Density** rises as the spawn interval shortens, which is what eventually
 *   makes splash and slow towers mandatory rather than optional.
 */

export const TOTAL_WAVES = 50;
export const STARTING_HEALTH = 20;
export const STARTING_GOLD = 260;

/** Waves that unlock each enemy type. */
const RUNNER_UNLOCK_WAVE = 4;
const FLYER_UNLOCK_WAVE = 6;
const ARMORED_UNLOCK_WAVE = 7;
const SPLITTER_UNLOCK_WAVE = 11;
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
    count: 5 + Math.floor(number * 1.15),
    interval,
    delay: 0,
    boss: false,
  });

  if (number >= RUNNER_UNLOCK_WAVE) {
    groups.push({
      enemyId: ENEMY_RUNNER,
      count: 4 + Math.floor(number - RUNNER_UNLOCK_WAVE),
      interval: interval * 0.62,
      delay: 3.2,
      boss: false,
    });
  }

  if (number >= FLYER_UNLOCK_WAVE) {
    groups.push({
      enemyId: ENEMY_FLYER,
      count: 3 + Math.floor((number - FLYER_UNLOCK_WAVE) * 0.75),
      interval: interval * 0.8,
      delay: 6.5,
      boss: false,
    });
  }

  if (number >= ARMORED_UNLOCK_WAVE) {
    groups.push({
      enemyId: ENEMY_ARMORED,
      count: 2 + Math.floor((number - ARMORED_UNLOCK_WAVE) * 0.55),
      interval: interval * 1.7,
      delay: 5.5,
      boss: false,
    });
  }

  if (number >= SPLITTER_UNLOCK_WAVE) {
    groups.push({
      enemyId: ENEMY_SPLITTER,
      count: 2 + Math.floor((number - SPLITTER_UNLOCK_WAVE) * 0.45),
      interval: interval * 1.4,
      delay: 9,
      boss: false,
    });
  }

  if (number % BOSS_INTERVAL === 0) {
    groups.push({
      enemyId: ENEMY_ARMORED,
      count: Math.floor(number / BOSS_INTERVAL),
      interval: 3.5,
      delay: 11,
      boss: true,
    });
  }

  let totalEnemies = 0;
  for (const group of groups) totalEnemies += group.count;

  return {
    number,
    groups,
    totalEnemies,
    // Chosen by playing the curve out headlessly (see the bench): steep enough
    // that wave 50 is roughly sixty times wave 1, shallow enough that a strong
    // board can still out-damage it. Total pressure grows far faster than this,
    // because head count and armor climb alongside health.
    healthScale: Math.pow(1.09, number - 1),
    speedScale: 1 + Math.min(0.45, (number - 1) * 0.007),
    armorBonus: Math.floor(number / 9),
    bountyScale: 1 + (number - 1) * 0.06,
    reward: 22 + number * 4,
  };
}

export const WAVES: readonly WaveDef[] = Array.from({ length: TOTAL_WAVES }, (_, index) =>
  buildWave(index + 1)
);

export function getWave(number: number): WaveDef {
  return WAVES[Math.min(Math.max(number, 1), TOTAL_WAVES) - 1];
}
