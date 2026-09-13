/**
 * Enemy tuning. Types are their index, so the optimized simulation stores one
 * byte per enemy. The set is picked so no single tower answers everything.
 */

export const ENEMY_GRUNT = 0;
export const ENEMY_RUNNER = 1;
export const ENEMY_ARMORED = 2;
export const ENEMY_FLYER = 3;
export const ENEMY_SPLITTER = 4;

export interface EnemyDef {
  id: string;
  name: string;
  /** Base health at wave 1, before per-wave scaling. */
  health: number;
  /** World pixels per second. */
  speed: number;
  /** Flat reduction applied to every hit. */
  armor: number;
  bounty: number;
  score: number;
  /** Base health lost when this enemy reaches the base. */
  damage: number;
  radius: number;
  flying: boolean;
  /** Type spawned on death, or -1 for none. */
  splitInto: number;
  splitCount: number;
  /** Child health, as a fraction of this enemy's maximum. */
  splitHealthFactor: number;
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
    flying: false,
    splitInto: -1,
    splitCount: 0,
    splitHealthFactor: 0,
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
    flying: false,
    splitInto: -1,
    splitCount: 0,
    splitHealthFactor: 0,
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
    flying: false,
    splitInto: -1,
    splitCount: 0,
    splitHealthFactor: 0,
    color: '#c76b52',
    accent: '#ffb59b',
    description: 'Heavy plating shrugs off rapid weak hits. Bring big guns.',
  },
  {
    id: 'flyer',
    // Low health on purpose: the straight line is a third of the road, so a wisp
    // gets a third of the exposure to fire.
    name: 'Wisp',
    health: 16,
    speed: 108,
    armor: 1,
    bounty: 8,
    score: 18,
    damage: 1,
    radius: 8,
    flying: true,
    splitInto: -1,
    splitCount: 0,
    splitHealthFactor: 0,
    color: '#ffd166',
    accent: '#fff2c9',
    description: 'Flies straight over the terrain. Mortars cannot touch it.',
  },
  {
    id: 'splitter',
    name: 'Splitter',
    health: 84,
    speed: 82,
    armor: 3,
    bounty: 11,
    score: 22,
    damage: 1,
    radius: 11,
    flying: false,
    splitInto: ENEMY_RUNNER,
    splitCount: 3,
    splitHealthFactor: 0.3,
    color: '#e56ba6',
    accent: '#ffc4de',
    description: 'Bursts into three runners when killed. Kill it early.',
  },
];

export const BOSS_HEALTH_MULTIPLIER = 10;
export const BOSS_BOUNTY_MULTIPLIER = 10;
export const BOSS_SCORE_MULTIPLIER = 12;
export const BOSS_ARMOR_BONUS = 6;
export const BOSS_DAMAGE = 8;
export const BOSS_RADIUS = 20;
export const BOSS_SPEED_FACTOR = 0.55;

/** A hit always does at least something. */
export function applyArmor(damage: number, armor: number): number {
  const reduced = damage - armor;
  return reduced > 1 ? reduced : 1;
}
