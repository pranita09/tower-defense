/**
 * Tower tuning table.
 *
 * Each tower has three levels. Costs are cumulative investment: selling refunds
 * a fraction of everything spent on that tile, so upgrading is never a trap.
 */

export const TOWER_GUN = 0;
export const TOWER_MORTAR = 1;
export const TOWER_FROST = 2;

export type ProjectileKind = 'bullet' | 'shell' | 'frost';

export interface TowerLevel {
  /** Cost to reach this level from the previous one. */
  cost: number;
  damage: number;
  /** World pixels. */
  range: number;
  /** Seconds between shots. */
  cooldown: number;
  /** World pixels per second. */
  projectileSpeed: number;
  /** Splash radius in world pixels. Zero means single target. */
  splashRadius: number;
  /** Fraction of speed removed on hit, 0..1. */
  slowFactor: number;
  /** Seconds the slow lasts. */
  slowDuration: number;
}

export interface TowerDef {
  id: string;
  name: string;
  role: string;
  description: string;
  /** Keyboard shortcut for the shop. */
  hotkey: string;
  kind: ProjectileKind;
  color: string;
  accent: string;
  levels: readonly TowerLevel[];
}

export const TOWER_DEFS: readonly TowerDef[] = [
  {
    id: 'gun',
    name: 'Gun Turret',
    role: 'Rapid single target',
    description: 'Cheap and fast. Great against runners, poor against armor.',
    hotkey: 'Q',
    kind: 'bullet',
    color: '#4cc9f0',
    accent: '#b9ecff',
    levels: [
      {
        cost: 50,
        damage: 9,
        range: 112,
        cooldown: 0.36,
        projectileSpeed: 520,
        splashRadius: 0,
        slowFactor: 0,
        slowDuration: 0,
      },
      {
        cost: 45,
        damage: 15,
        range: 124,
        cooldown: 0.3,
        projectileSpeed: 560,
        splashRadius: 0,
        slowFactor: 0,
        slowDuration: 0,
      },
      {
        cost: 90,
        damage: 24,
        range: 138,
        cooldown: 0.24,
        projectileSpeed: 620,
        splashRadius: 0,
        slowFactor: 0,
        slowDuration: 0,
      },
    ],
  },
  {
    id: 'mortar',
    name: 'Mortar',
    role: 'Splash damage',
    description: 'Slow, heavy shells that damage everything near the impact.',
    hotkey: 'W',
    kind: 'shell',
    color: '#ffa94d',
    accent: '#ffd9ab',
    levels: [
      {
        cost: 115,
        damage: 28,
        range: 168,
        cooldown: 1.55,
        projectileSpeed: 250,
        splashRadius: 46,
        slowFactor: 0,
        slowDuration: 0,
      },
      {
        cost: 105,
        damage: 44,
        range: 182,
        cooldown: 1.4,
        projectileSpeed: 270,
        splashRadius: 54,
        slowFactor: 0,
        slowDuration: 0,
      },
      {
        cost: 200,
        damage: 72,
        range: 200,
        cooldown: 1.25,
        projectileSpeed: 300,
        splashRadius: 64,
        slowFactor: 0,
        slowDuration: 0,
      },
    ],
  },
  {
    id: 'frost',
    name: 'Frost Tower',
    role: 'Slow support',
    description: 'Barely scratches anything, but chills enemies to a crawl.',
    hotkey: 'E',
    kind: 'frost',
    color: '#7ad7ff',
    accent: '#e2f7ff',
    levels: [
      {
        cost: 80,
        damage: 4,
        range: 124,
        cooldown: 0.85,
        projectileSpeed: 420,
        splashRadius: 34,
        slowFactor: 0.4,
        slowDuration: 1.6,
      },
      {
        cost: 70,
        damage: 7,
        range: 136,
        cooldown: 0.75,
        projectileSpeed: 450,
        splashRadius: 40,
        slowFactor: 0.52,
        slowDuration: 1.9,
      },
      {
        cost: 140,
        damage: 11,
        range: 150,
        cooldown: 0.65,
        projectileSpeed: 480,
        splashRadius: 48,
        slowFactor: 0.64,
        slowDuration: 2.2,
      },
    ],
  },
];

/** Fraction of total investment returned when selling. */
export const SELL_REFUND_RATE = 0.6;

export const MAX_TOWER_LEVEL = 3;

export function towerBuildCost(typeId: number): number {
  return TOWER_DEFS[typeId].levels[0].cost;
}

/** Cost to go from `level` to `level + 1`, or null when already maxed. */
export function towerUpgradeCost(typeId: number, level: number): number | null {
  const levels = TOWER_DEFS[typeId].levels;
  if (level >= levels.length) return null;
  return levels[level].cost;
}

/** Nominal damage per second, ignoring armor. Used for the info panel. */
export function towerDps(typeId: number, level: number): number {
  const stats = TOWER_DEFS[typeId].levels[level - 1];
  return stats.damage / stats.cooldown;
}
