import { ENEMY_ARMORED, ENEMY_FLYER, ENEMY_GRUNT, ENEMY_RUNNER, ENEMY_SPLITTER } from './enemies';

/**
 * The 50-wave curve, generated from the wave number so it stays a few readable
 * formulas and a pure function. Health, armor, composition and spawn density ramp
 * independently, so difficulty is not just one number going up.
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
  healthScale: number;
  speedScale: number;
  /** Added to every enemy's armor. */
  armorBonus: number;
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
    // Tuned by playing the curve out headlessly: steep enough that wave 50 is
    // ~60x wave 1, shallow enough that a strong board can still out-damage it.
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
