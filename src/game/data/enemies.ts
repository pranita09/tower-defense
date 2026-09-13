/**
 * Enemy tuning table.
 *
 * Types are identified by their index so the optimized simulation can store a
 * type as one byte per enemy later on.
 */

export const ENEMY_GRUNT = 0;
export const ENEMY_RUNNER = 1;
export const ENEMY_ARMORED = 2;

export interface EnemyDef {
  id: string;
  name: string;
  /** Base health at wave 1, before per-wave scaling. */
  health: number;
  /** World pixels per second. */
  speed: number;
  /**
   * Flat reduction applied to every hit. This is what makes a fast, weak tower
   * useless against heavy enemies and forces a mixed defence.
   */
  armor: number;
  /** Gold awarded on kill. */
  bounty: number;
  /** Score awarded on kill. */
  score: number;
  /** Base health lost when this enemy reaches the base. */
  damage: number;
  /** Drawn radius in world pixels. */
  radius: number;
  color: string;
  accent: string;
  description: string;
}

export const ENEMY_DEFS: readonly EnemyDef[] = [
  {
    id: 'grunt',
    name: 'Grunt',
    health: 58,
    speed: 92,
    armor: 1,
    bounty: 7,
    score: 12,
    damage: 1,
    radius: 9,
    color: '#8f7fd8',
    accent: '#cdc2ff',
    description: 'Baseline infantry. Shows up in every wave.',
  },
  {
    id: 'runner',
    name: 'Runner',
    health: 30,
    speed: 168,
    armor: 0,
    bounty: 6,
    score: 14,
    damage: 1,
    radius: 7,
    color: '#5ddf8f',
    accent: '#c6ffdd',
    description: 'Fragile but fast. Punishes gaps in your coverage.',
  },
  {
    id: 'armored',
    name: 'Juggernaut',
    health: 155,
    speed: 60,
    armor: 7,
    bounty: 16,
    score: 30,
    damage: 2,
    radius: 12,
    color: '#c76b52',
    accent: '#ffb59b',
    description: 'Heavy plating shrugs off rapid weak hits. Bring big guns.',
  },
];

export const BOSS_HEALTH_MULTIPLIER = 16;
export const BOSS_BOUNTY_MULTIPLIER = 10;
export const BOSS_SCORE_MULTIPLIER = 12;
export const BOSS_DAMAGE = 8;
export const BOSS_RADIUS = 20;

/** Damage actually taken after armor. A hit always does at least something. */
export function applyArmor(damage: number, armor: number): number {
  const reduced = damage - armor;
  return reduced > 1 ? reduced : 1;
}
