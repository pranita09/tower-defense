/**
 * Tower tuning table.
 *
 * Five towers, each with three levels. Costs are cumulative investment, and
 * selling refunds a fraction of everything spent on the tile, so upgrading is
 * never a trap.
 *
 * The roster is built around trade-offs rather than a power ranking: the cheap
 * turret is defeated by armor, the mortar cannot hit flyers, the frost tower
 * barely damages anything, the tesla coil ignores armor but has a short reach,
 * and the railgun out-ranges everything while firing far too slowly to handle a
 * crowd.
 */

export const TOWER_GUN = 0;
export const TOWER_MORTAR = 1;
export const TOWER_FROST = 2;
export const TOWER_TESLA = 3;
export const TOWER_RAILGUN = 4;

export type ProjectileKind = 'bullet' | 'shell' | 'frost' | 'arc' | 'slug';

export interface TowerLevel {
  /** Cost to reach this level from the previous one. */
  cost: number;
  damage: number;
  /** World pixels. */
  range: number;
  /** Seconds between shots. */
  cooldown: number;
  /** World pixels per second. Ignored by hitscan towers. */
  projectileSpeed: number;
  /** Splash radius in world pixels. Zero means single target. */
  splashRadius: number;
  /** Fraction of speed removed on hit, 0..1. */
  slowFactor: number;
  /** Seconds the slow lasts. */
  slowDuration: number;
  /** Extra enemies a chain hit jumps to. */
  chainTargets: number;
}

export interface TowerDef {
  id: string;
  name: string;
  role: string;
  description: string;
  /** Keyboard shortcut for the shop. */
  hotkey: string;
  kind: ProjectileKind;
  /** Can it shoot flying enemies? */
  targetsAir: boolean;
  /** Damage bypasses enemy armor entirely. */
  ignoresArmor: boolean;
  /** Damage lands instantly instead of spawning a projectile. */
  hitscan: boolean;
  color: string;
  accent: string;
  levels: readonly TowerLevel[];
}

function level(
  cost: number,
  damage: number,
  range: number,
  cooldown: number,
  projectileSpeed: number,
  options: Partial<
    Pick<TowerLevel, 'splashRadius' | 'slowFactor' | 'slowDuration' | 'chainTargets'>
  > = {}
): TowerLevel {
  return {
    cost,
    damage,
    range,
    cooldown,
    projectileSpeed,
    splashRadius: options.splashRadius ?? 0,
    slowFactor: options.slowFactor ?? 0,
    slowDuration: options.slowDuration ?? 0,
    chainTargets: options.chainTargets ?? 0,
  };
}

export const TOWER_DEFS: readonly TowerDef[] = [
  {
    id: 'gun',
    name: 'Gun Turret',
    role: 'Rapid single target',
    description: 'Cheap and relentless. Great against runners, poor against armor.',
    hotkey: 'Q',
    kind: 'bullet',
    targetsAir: true,
    ignoresArmor: false,
    hitscan: false,
    color: '#4cc9f0',
    accent: '#b9ecff',
    levels: [
      level(50, 9, 112, 0.36, 520),
      level(45, 15, 124, 0.3, 560),
      level(90, 24, 138, 0.24, 620),
    ],
  },
  {
    id: 'mortar',
    name: 'Mortar',
    role: 'Splash damage',
    description: 'Heavy shells that damage everything near the impact. Ground only.',
    hotkey: 'W',
    kind: 'shell',
    targetsAir: false,
    ignoresArmor: false,
    hitscan: false,
    color: '#ffa94d',
    accent: '#ffd9ab',
    levels: [
      level(115, 28, 168, 1.55, 250, { splashRadius: 46 }),
      level(105, 44, 182, 1.4, 270, { splashRadius: 54 }),
      level(200, 72, 200, 1.25, 300, { splashRadius: 64 }),
    ],
  },
  {
    id: 'frost',
    name: 'Frost Tower',
    role: 'Slow support',
    description: 'Barely scratches anything, but chills everything nearby to a crawl.',
    hotkey: 'E',
    kind: 'frost',
    targetsAir: true,
    ignoresArmor: false,
    hitscan: false,
    color: '#7ad7ff',
    accent: '#e2f7ff',
    levels: [
      level(80, 4, 124, 0.85, 420, { splashRadius: 34, slowFactor: 0.4, slowDuration: 1.6 }),
      level(70, 7, 136, 0.75, 450, { splashRadius: 40, slowFactor: 0.52, slowDuration: 1.9 }),
      level(140, 11, 150, 0.65, 480, { splashRadius: 48, slowFactor: 0.64, slowDuration: 2.2 }),
    ],
  },
  {
    id: 'tesla',
    name: 'Tesla Coil',
    role: 'Anti-armor chain',
    description: 'Arcs to several enemies at once and ignores armor. Short reach.',
    hotkey: 'R',
    kind: 'arc',
    targetsAir: true,
    ignoresArmor: true,
    hitscan: true,
    color: '#b98cff',
    accent: '#e6d6ff',
    levels: [
      level(140, 13, 104, 0.62, 0, { chainTargets: 2 }),
      level(130, 21, 114, 0.55, 0, { chainTargets: 3 }),
      level(240, 34, 124, 0.48, 0, { chainTargets: 4 }),
    ],
  },
  {
    id: 'railgun',
    name: 'Railgun',
    role: 'Long-range burst',
    description: 'Enormous single-target damage across the map. Hopeless against crowds.',
    hotkey: 'T',
    kind: 'slug',
    targetsAir: true,
    ignoresArmor: false,
    hitscan: false,
    color: '#ff7b8a',
    accent: '#ffd0d6',
    levels: [
      level(220, 95, 268, 2.3, 1400),
      level(210, 165, 292, 2.1, 1500),
      level(360, 280, 320, 1.9, 1650),
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
  const def = TOWER_DEFS[typeId];
  const stats = def.levels[level - 1];
  const targetsPerShot = 1 + stats.chainTargets;
  return (stats.damage * targetsPerShot) / stats.cooldown;
}
