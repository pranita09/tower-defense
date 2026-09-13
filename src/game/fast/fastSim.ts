import {
  AIR_ORIGIN_X,
  AIR_ORIGIN_Y,
  AIR_ROUTE_LENGTH,
  AIR_STEP_X,
  AIR_STEP_Y,
  GROUND_LUT,
} from '../core/pathLut';
import { Rng } from '../core/rng';
import { SlotPool } from '../core/slotPool';
import { SpatialGrid } from '../core/spatialGrid';
import {
  applyArmor,
  BOSS_ARMOR_BONUS,
  BOSS_BOUNTY_MULTIPLIER,
  BOSS_DAMAGE,
  BOSS_HEALTH_MULTIPLIER,
  BOSS_RADIUS,
  BOSS_SCORE_MULTIPLIER,
  BOSS_SPEED_FACTOR,
  ENEMY_DEFS,
} from '../data/enemies';
import {
  BASE_POSITION,
  GRID_COLS,
  GRID_ROWS,
  isBuildable,
  PATH_LENGTH,
  tileCentreX,
  tileCentreY,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '../data/map';
import { COLOR_DANGER, ENEMY_ACCENTS, TOWER_ACCENTS } from '../data/palette';
import {
  MAX_TOWER_LEVEL,
  SELL_REFUND_RATE,
  TOWER_DEFS,
  towerBuildCost,
  towerUpgradeCost,
} from '../data/towers';
import { getWave, STARTING_GOLD, STARTING_HEALTH, TOTAL_WAVES } from '../data/waves';
import type { GamePhase, StressRequest } from '../engine';

/**
 * The optimized simulation.
 *
 * Same game, same rules, same numbers as the naive version — different
 * mechanics underneath:
 *
 * - **Structure of arrays.** Every entity field is a slot in a flat typed array
 *   allocated once at startup. Iterating 5,000 enemies walks contiguous memory
 *   instead of chasing 5,000 pointers, and nothing is allocated per frame, so
 *   the heap stays flat for a full run and the collector has no reason to pause.
 * - **Slot pools with generation counters.** Deaths are O(1) and never `splice`.
 *   Projectiles refer to a target by slot plus generation, so a recycled slot
 *   cannot be mistaken for the enemy that used to live there.
 * - **Position from one scalar.** Movement is `distance += speed * dt`; the
 *   position comes from a precomputed path table, so there is no per-enemy
 *   direction vector and no square root.
 * - **Spatial grid.** Target acquisition and splash damage query only the cells
 *   they overlap, turning the O(towers x enemies) scan into something close to
 *   O(towers).
 * - **Staggered retargeting.** A tower re-scans every few ticks rather than
 *   every tick, spreading the remaining cost across frames.
 * - **Ring-buffered effects.** Particles, damage numbers and arcs live in
 *   fixed-size buffers where the oldest entry is overwritten, so a hundred
 *   simultaneous deaths cannot grow memory or the frame time.
 */

export const MAX_ENEMIES = 16_384;
export const MAX_PROJECTILES = 8192;
export const MAX_TOWERS = 256;
export const MAX_PARTICLES = 4096;
export const MAX_LABELS = 96;
export const MAX_ARCS = 192;

const FLAG_ALIVE = 1;
const FLAG_BOSS = 2;
const FLAG_FLYING = 4;
const FLAG_PIERCING = 1;

const GRID_CELL_SIZE = 64;
/** Ticks between target re-acquisitions, staggered across towers. */
const RETARGET_INTERVAL = 5;
const PROJECTILE_LIFETIME = 2.5;
const PROJECTILE_HIT_RADIUS = 9;
const CHAIN_JUMP_RANGE = 74;
const MAX_CHAIN_LINKS = 8;
const PARTICLES_PER_KILL = 5;
const SHAKE_DECAY = 3.4;

const OPENING_REST_SECONDS = 20;
const REST_SECONDS = 9;
const EARLY_SEND_BONUS_RATE = 2;

interface SpawnGroupState {
  enemyId: number;
  remaining: number;
  interval: number;
  timer: number;
  boss: boolean;
}

export class FastSim {
  // ── Enemies ────────────────────────────────────────────────────────────────
  readonly enemies = new SlotPool(MAX_ENEMIES);
  readonly eDistance = new Float32Array(MAX_ENEMIES);
  readonly eX = new Float32Array(MAX_ENEMIES);
  readonly eY = new Float32Array(MAX_ENEMIES);
  readonly ePrevX = new Float32Array(MAX_ENEMIES);
  readonly ePrevY = new Float32Array(MAX_ENEMIES);
  readonly eHp = new Float32Array(MAX_ENEMIES);
  readonly eMaxHp = new Float32Array(MAX_ENEMIES);
  readonly eSpeed = new Float32Array(MAX_ENEMIES);
  readonly eArmor = new Float32Array(MAX_ENEMIES);
  readonly eBounty = new Float32Array(MAX_ENEMIES);
  readonly eScore = new Float32Array(MAX_ENEMIES);
  readonly eSlowTimer = new Float32Array(MAX_ENEMIES);
  readonly eSlowFactor = new Float32Array(MAX_ENEMIES);
  readonly eRadius = new Float32Array(MAX_ENEMIES);
  readonly eType = new Uint8Array(MAX_ENEMIES);
  readonly eFlags = new Uint8Array(MAX_ENEMIES);
  readonly eLeakDamage = new Uint8Array(MAX_ENEMIES);

  // ── Projectiles ────────────────────────────────────────────────────────────
  readonly projectiles = new SlotPool(MAX_PROJECTILES);
  readonly pX = new Float32Array(MAX_PROJECTILES);
  readonly pY = new Float32Array(MAX_PROJECTILES);
  readonly pPrevX = new Float32Array(MAX_PROJECTILES);
  readonly pPrevY = new Float32Array(MAX_PROJECTILES);
  readonly pVx = new Float32Array(MAX_PROJECTILES);
  readonly pVy = new Float32Array(MAX_PROJECTILES);
  readonly pSpeed = new Float32Array(MAX_PROJECTILES);
  readonly pDamage = new Float32Array(MAX_PROJECTILES);
  readonly pSplash = new Float32Array(MAX_PROJECTILES);
  readonly pSlowFactor = new Float32Array(MAX_PROJECTILES);
  readonly pSlowDuration = new Float32Array(MAX_PROJECTILES);
  readonly pAge = new Float32Array(MAX_PROJECTILES);
  readonly pTargetSlot = new Int32Array(MAX_PROJECTILES);
  readonly pTargetGen = new Uint16Array(MAX_PROJECTILES);
  readonly pKind = new Uint8Array(MAX_PROJECTILES);
  readonly pFlags = new Uint8Array(MAX_PROJECTILES);

  // ── Towers (dense, order is not meaningful) ────────────────────────────────
  towerCount = 0;
  readonly tId = new Int32Array(MAX_TOWERS);
  readonly tCol = new Int32Array(MAX_TOWERS);
  readonly tRow = new Int32Array(MAX_TOWERS);
  readonly tX = new Float32Array(MAX_TOWERS);
  readonly tY = new Float32Array(MAX_TOWERS);
  readonly tType = new Uint8Array(MAX_TOWERS);
  readonly tLevel = new Uint8Array(MAX_TOWERS);
  readonly tCooldown = new Float32Array(MAX_TOWERS);
  readonly tInvested = new Int32Array(MAX_TOWERS);
  readonly tKills = new Int32Array(MAX_TOWERS);
  readonly tRotation = new Float32Array(MAX_TOWERS);
  readonly tRecoil = new Float32Array(MAX_TOWERS);
  readonly tTargetSlot = new Int32Array(MAX_TOWERS).fill(-1);
  readonly tTargetGen = new Uint16Array(MAX_TOWERS);

  // ── Effects (ring buffers; oldest entry is overwritten) ────────────────────
  readonly cX = new Float32Array(MAX_PARTICLES);
  readonly cY = new Float32Array(MAX_PARTICLES);
  readonly cVx = new Float32Array(MAX_PARTICLES);
  readonly cVy = new Float32Array(MAX_PARTICLES);
  readonly cLife = new Float32Array(MAX_PARTICLES);
  readonly cMaxLife = new Float32Array(MAX_PARTICLES);
  readonly cSize = new Float32Array(MAX_PARTICLES);
  readonly cColor = new Uint32Array(MAX_PARTICLES);
  private particleCursor = 0;

  readonly lX = new Float32Array(MAX_LABELS);
  readonly lY = new Float32Array(MAX_LABELS);
  readonly lLife = new Float32Array(MAX_LABELS);
  readonly lValue = new Float32Array(MAX_LABELS);
  readonly lColor = new Uint32Array(MAX_LABELS);
  private labelCursor = 0;

  readonly aX1 = new Float32Array(MAX_ARCS);
  readonly aY1 = new Float32Array(MAX_ARCS);
  readonly aX2 = new Float32Array(MAX_ARCS);
  readonly aY2 = new Float32Array(MAX_ARCS);
  readonly aLife = new Float32Array(MAX_ARCS);
  readonly aColor = new Uint32Array(MAX_ARCS);
  private arcCursor = 0;

  // ── Game state ─────────────────────────────────────────────────────────────
  readonly maxHealth = STARTING_HEALTH;
  phase: GamePhase = 'ready';
  health = STARTING_HEALTH;
  gold = STARTING_GOLD;
  score = 0;
  wave = 0;
  leaks = 0;
  kills = 0;
  shotsFired = 0;
  waveSpawned = 0;
  waveTotal = 0;
  restTimer = OPENING_REST_SECONDS;
  selectedTowerId: number | null = null;
  shake = 0;

  private readonly grid = new SpatialGrid(
    WORLD_WIDTH,
    WORLD_HEIGHT,
    GRID_CELL_SIZE,
    MAX_ENEMIES,
    128
  );
  private readonly occupied = new Int32Array(GRID_COLS * GRID_ROWS).fill(-1);
  private readonly rng = new Rng(0x1234abcd);
  /** Scratch list of slots already hit by the current chain. */
  private readonly chainHits = new Int32Array(MAX_CHAIN_LINKS);
  private spawnGroups: SpawnGroupState[] = [];
  private nextTowerId = 1;
  private tick = 0;
  private stressTargets: StressRequest | null = null;

  get enemyCount(): number {
    return this.enemies.activeCount;
  }

  get projectileCount(): number {
    return this.projectiles.activeCount;
  }

  get inStressMode(): boolean {
    return this.stressTargets !== null;
  }

  reset(): void {
    this.enemies.reset();
    this.projectiles.reset();
    this.towerCount = 0;
    this.tTargetSlot.fill(-1);
    this.occupied.fill(-1);
    this.cLife.fill(0);
    this.lLife.fill(0);
    this.aLife.fill(0);
    this.grid.clear();
    this.spawnGroups = [];
    this.phase = 'ready';
    this.health = STARTING_HEALTH;
    this.gold = STARTING_GOLD;
    this.score = 0;
    this.wave = 0;
    this.leaks = 0;
    this.kills = 0;
    this.shotsFired = 0;
    this.waveSpawned = 0;
    this.waveTotal = 0;
    this.restTimer = OPENING_REST_SECONDS;
    this.selectedTowerId = null;
    this.shake = 0;
    this.stressTargets = null;
    this.nextTowerId = 1;
    this.tick = 0;
  }

  // ── Player commands ────────────────────────────────────────────────────────

  startWave(): boolean {
    if (this.phase !== 'ready' || this.wave >= TOTAL_WAVES) return false;

    if (this.restTimer > 0) {
      this.gold += Math.ceil(this.restTimer * EARLY_SEND_BONUS_RATE);
      this.restTimer = 0;
    }

    this.wave += 1;
    this.phase = 'wave';
    const wave = getWave(this.wave);
    this.spawnGroups = wave.groups.map((group) => ({
      enemyId: group.enemyId,
      remaining: group.count,
      interval: group.interval,
      timer: group.delay,
      boss: group.boss,
    }));
    this.waveSpawned = 0;
    this.waveTotal = wave.totalEnemies;
    return true;
  }

  canPlace(col: number, row: number): boolean {
    return isBuildable(col, row) && this.occupied[row * GRID_COLS + col] < 0;
  }

  placeTower(col: number, row: number, typeId: number, free = false): boolean {
    if (!this.canPlace(col, row) || this.towerCount >= MAX_TOWERS) return false;
    const cost = towerBuildCost(typeId);
    if (!free && this.gold < cost) return false;

    const index = this.towerCount;
    this.towerCount += 1;
    const id = this.nextTowerId++;

    this.tId[index] = id;
    this.tCol[index] = col;
    this.tRow[index] = row;
    this.tX[index] = tileCentreX(col);
    this.tY[index] = tileCentreY(row);
    this.tType[index] = typeId;
    this.tLevel[index] = 1;
    this.tCooldown[index] = 0;
    this.tInvested[index] = free ? 0 : cost;
    this.tKills[index] = 0;
    this.tRotation[index] = -Math.PI / 2;
    this.tRecoil[index] = 0;
    this.tTargetSlot[index] = -1;

    this.occupied[row * GRID_COLS + col] = index;
    if (!free) this.gold -= cost;
    this.selectedTowerId = id;
    return true;
  }

  towerIndexById(id: number | null): number {
    if (id === null) return -1;
    for (let i = 0; i < this.towerCount; i += 1) {
      if (this.tId[i] === id) return i;
    }
    return -1;
  }

  towerIndexAtTile(col: number, row: number): number {
    if (col < 0 || row < 0 || col >= GRID_COLS || row >= GRID_ROWS) return -1;
    return this.occupied[row * GRID_COLS + col];
  }

  upgradeSelected(): boolean {
    const index = this.towerIndexById(this.selectedTowerId);
    if (index < 0) return false;
    const cost = towerUpgradeCost(this.tType[index], this.tLevel[index]);
    if (cost === null || this.gold < cost) return false;

    this.gold -= cost;
    this.tInvested[index] += cost;
    this.tLevel[index] += 1;
    return true;
  }

  sellSelected(): boolean {
    const index = this.towerIndexById(this.selectedTowerId);
    if (index < 0) return false;

    this.gold += Math.floor(this.tInvested[index] * SELL_REFUND_RATE);
    this.occupied[this.tRow[index] * GRID_COLS + this.tCol[index]] = -1;
    this.removeTower(index);
    this.selectedTowerId = null;
    return true;
  }

  /** Swap-removes a tower and repairs the occupancy index of the moved one. */
  private removeTower(index: number): void {
    const last = this.towerCount - 1;
    if (index !== last) {
      this.tId[index] = this.tId[last];
      this.tCol[index] = this.tCol[last];
      this.tRow[index] = this.tRow[last];
      this.tX[index] = this.tX[last];
      this.tY[index] = this.tY[last];
      this.tType[index] = this.tType[last];
      this.tLevel[index] = this.tLevel[last];
      this.tCooldown[index] = this.tCooldown[last];
      this.tInvested[index] = this.tInvested[last];
      this.tKills[index] = this.tKills[last];
      this.tRotation[index] = this.tRotation[last];
      this.tRecoil[index] = this.tRecoil[last];
      this.tTargetSlot[index] = this.tTargetSlot[last];
      this.tTargetGen[index] = this.tTargetGen[last];
      this.occupied[this.tRow[index] * GRID_COLS + this.tCol[index]] = index;
    }
    this.towerCount = last;
  }

  // ── Simulation ─────────────────────────────────────────────────────────────

  step(delta: number): void {
    if (this.phase === 'victory' || this.phase === 'defeat') {
      this.updateEffects(delta);
      return;
    }

    this.tick += 1;

    if (this.stressTargets) this.topUpStress();

    if (this.phase === 'ready' && !this.stressTargets) {
      this.restTimer -= delta;
      if (this.restTimer <= 0) this.startWave();
    }

    if (this.phase === 'wave') this.updateSpawns(delta);

    this.moveEnemies(delta);
    this.grid.build(this.enemies.active, this.enemies.activeCount, this.eX, this.eY);
    this.updateTowers(delta);
    this.updateProjectiles(delta);
    this.updateEffects(delta);
    this.compact();
    this.checkWaveComplete();
  }

  private updateSpawns(delta: number): void {
    for (let i = this.spawnGroups.length - 1; i >= 0; i -= 1) {
      const group = this.spawnGroups[i];
      group.timer -= delta;
      while (group.timer <= 0 && group.remaining > 0) {
        this.spawnEnemy(group.enemyId, group.boss, 0, 0);
        group.remaining -= 1;
        group.timer += group.interval;
        this.waveSpawned += 1;
      }
      if (group.remaining <= 0) this.spawnGroups.splice(i, 1);
    }
  }

  private spawnEnemy(
    typeId: number,
    boss: boolean,
    startDistance: number,
    healthOverride: number
  ): number {
    const slot = this.enemies.alloc();
    if (slot < 0) return -1;

    const def = ENEMY_DEFS[typeId];
    const wave = getWave(Math.max(1, this.wave));

    let flags = FLAG_ALIVE;
    if (boss) flags |= FLAG_BOSS;
    if (def.flying) flags |= FLAG_FLYING;

    this.eType[slot] = typeId;
    this.eFlags[slot] = flags;
    this.eMaxHp[slot] =
      healthOverride > 0
        ? healthOverride
        : def.health * wave.healthScale * (boss ? BOSS_HEALTH_MULTIPLIER : 1);
    this.eHp[slot] = this.eMaxHp[slot];
    this.eSpeed[slot] = def.speed * wave.speedScale * (boss ? BOSS_SPEED_FACTOR : 1);
    this.eArmor[slot] = def.armor + wave.armorBonus + (boss ? BOSS_ARMOR_BONUS : 0);
    this.eBounty[slot] = Math.round(
      def.bounty * wave.bountyScale * (boss ? BOSS_BOUNTY_MULTIPLIER : 1)
    );
    this.eScore[slot] = Math.round(def.score * (boss ? BOSS_SCORE_MULTIPLIER : 1));
    this.eLeakDamage[slot] = boss ? BOSS_DAMAGE : def.damage;
    this.eRadius[slot] = boss ? BOSS_RADIUS : def.radius;
    this.eDistance[slot] = startDistance;
    this.eSlowTimer[slot] = 0;
    this.eSlowFactor[slot] = 0;

    this.writePosition(slot);
    this.ePrevX[slot] = this.eX[slot];
    this.ePrevY[slot] = this.eY[slot];
    return slot;
  }

  /** Position from the single distance scalar: two array reads and a lerp. */
  private writePosition(slot: number): void {
    const distance = this.eDistance[slot];
    if ((this.eFlags[slot] & FLAG_FLYING) !== 0) {
      this.eX[slot] = AIR_ORIGIN_X + AIR_STEP_X * distance;
      this.eY[slot] = AIR_ORIGIN_Y + AIR_STEP_Y * distance;
      return;
    }

    const xs = GROUND_LUT.xs;
    const ys = GROUND_LUT.ys;
    let t = distance * GROUND_LUT.invStep;
    if (t < 0) t = 0;
    else if (t > GROUND_LUT.maxIndex) t = GROUND_LUT.maxIndex;
    const index = t | 0;
    const fraction = t - index;
    this.eX[slot] = xs[index] + (xs[index + 1] - xs[index]) * fraction;
    this.eY[slot] = ys[index] + (ys[index + 1] - ys[index]) * fraction;
  }

  private moveEnemies(delta: number): void {
    const active = this.enemies.active;
    const count = this.enemies.activeCount;

    for (let i = 0; i < count; i += 1) {
      const slot = active[i];

      this.ePrevX[slot] = this.eX[slot];
      this.ePrevY[slot] = this.eY[slot];

      if (this.eSlowTimer[slot] > 0) {
        this.eSlowTimer[slot] -= delta;
        if (this.eSlowTimer[slot] <= 0) this.eSlowFactor[slot] = 0;
      }

      const distance =
        this.eDistance[slot] + this.eSpeed[slot] * (1 - this.eSlowFactor[slot]) * delta;
      this.eDistance[slot] = distance;
      this.writePosition(slot);

      const routeLength = (this.eFlags[slot] & FLAG_FLYING) !== 0 ? AIR_ROUTE_LENGTH : PATH_LENGTH;
      if (distance >= routeLength) this.leak(slot);
    }
  }

  private leak(slot: number): void {
    if (this.stressTargets) {
      // Recycle so a benchmark keeps a stable population.
      this.eDistance[slot] = 0;
      this.writePosition(slot);
      this.ePrevX[slot] = this.eX[slot];
      this.ePrevY[slot] = this.eY[slot];
      return;
    }

    this.eFlags[slot] &= ~FLAG_ALIVE;
    this.leaks += 1;
    this.health -= this.eLeakDamage[slot];
    this.shake = Math.min(1, this.shake + ((this.eFlags[slot] & FLAG_BOSS) !== 0 ? 1 : 0.45));
    this.spawnParticles(BASE_POSITION.x, BASE_POSITION.y, 9, COLOR_DANGER);

    if (this.health <= 0) {
      this.health = 0;
      this.phase = 'defeat';
    }
  }

  private updateTowers(delta: number): void {
    for (let i = 0; i < this.towerCount; i += 1) {
      const def = TOWER_DEFS[this.tType[i]];
      const stats = def.levels[this.tLevel[i] - 1];

      if (this.tRecoil[i] > 0) {
        this.tRecoil[i] -= delta * 5;
        if (this.tRecoil[i] < 0) this.tRecoil[i] = 0;
      }
      this.tCooldown[i] -= delta;

      let slot = this.tTargetSlot[i];
      const stale =
        slot < 0 ||
        !this.enemies.matches(slot, this.tTargetGen[i]) ||
        !this.inRange(i, slot, stats.range) ||
        (!def.targetsAir && (this.eFlags[slot] & FLAG_FLYING) !== 0);

      // Re-acquire when the current target is unusable, and otherwise only
      // every few ticks, staggered so the cost is spread across frames.
      if (stale || (this.tick + i) % RETARGET_INTERVAL === 0) {
        slot = this.acquireTarget(i, stats.range, def.targetsAir);
        this.tTargetSlot[i] = slot;
        if (slot >= 0) this.tTargetGen[i] = this.enemies.generation[slot];
      }

      if (slot < 0) continue;

      this.tRotation[i] = Math.atan2(this.eY[slot] - this.tY[i], this.eX[slot] - this.tX[i]);
      if (this.tCooldown[i] > 0) continue;

      this.tCooldown[i] = stats.cooldown;
      this.tRecoil[i] = 1;
      this.shotsFired += 1;

      if (def.hitscan) this.fireChain(i, slot, stats.damage, stats.chainTargets, def.ignoresArmor);
      else this.fireProjectile(i, slot, stats, def.ignoresArmor);
    }
  }

  private inRange(towerIndex: number, slot: number, range: number): boolean {
    const dx = this.eX[slot] - this.tX[towerIndex];
    const dy = this.eY[slot] - this.tY[towerIndex];
    return dx * dx + dy * dy <= range * range;
  }

  /**
   * Finds the enemy furthest along its route within range, visiting only the
   * grid cells the range circle overlaps.
   */
  private acquireTarget(towerIndex: number, range: number, targetsAir: boolean): number {
    const grid = this.grid;
    const x = this.tX[towerIndex];
    const y = this.tY[towerIndex];
    const rangeSquared = range * range;

    const colStart = grid.colOf(x - range);
    const colEnd = grid.colOf(x + range);
    const rowStart = grid.rowOf(y - range);
    const rowEnd = grid.rowOf(y + range);

    let best = -1;
    let bestProgress = -1;

    for (let row = rowStart; row <= rowEnd; row += 1) {
      const rowBase = row * grid.cols;
      for (let col = colStart; col <= colEnd; col += 1) {
        const cell = rowBase + col;
        const end = grid.offsets[cell + 1];
        for (let k = grid.offsets[cell]; k < end; k += 1) {
          const slot = grid.items[k];
          if ((this.eFlags[slot] & FLAG_ALIVE) === 0) continue;
          if (!targetsAir && (this.eFlags[slot] & FLAG_FLYING) !== 0) continue;
          const dx = this.eX[slot] - x;
          const dy = this.eY[slot] - y;
          if (dx * dx + dy * dy > rangeSquared) continue;
          if (this.eDistance[slot] <= bestProgress) continue;
          bestProgress = this.eDistance[slot];
          best = slot;
        }
      }
    }
    return best;
  }

  private fireProjectile(
    towerIndex: number,
    targetSlot: number,
    stats: (typeof TOWER_DEFS)[number]['levels'][number],
    ignoresArmor: boolean
  ): void {
    const slot = this.projectiles.alloc();
    if (slot < 0) return;

    const x = this.tX[towerIndex];
    const y = this.tY[towerIndex];
    const angle = this.tRotation[towerIndex];

    this.pX[slot] = x;
    this.pY[slot] = y;
    this.pPrevX[slot] = x;
    this.pPrevY[slot] = y;
    this.pVx[slot] = Math.cos(angle) * stats.projectileSpeed;
    this.pVy[slot] = Math.sin(angle) * stats.projectileSpeed;
    this.pSpeed[slot] = stats.projectileSpeed;
    this.pDamage[slot] = stats.damage;
    this.pSplash[slot] = stats.splashRadius;
    this.pSlowFactor[slot] = stats.slowFactor;
    this.pSlowDuration[slot] = stats.slowDuration;
    this.pAge[slot] = 0;
    this.pTargetSlot[slot] = targetSlot;
    this.pTargetGen[slot] = this.enemies.generation[targetSlot];
    this.pKind[slot] = this.tType[towerIndex];
    this.pFlags[slot] = ignoresArmor ? FLAG_PIERCING : 0;
  }

  /** Instant chain damage, hopping to the nearest unhit enemy each link. */
  private fireChain(
    towerIndex: number,
    firstSlot: number,
    damage: number,
    extraLinks: number,
    ignoresArmor: boolean
  ): void {
    const color = TOWER_ACCENTS[this.tType[towerIndex]];
    const links = Math.min(extraLinks + 1, MAX_CHAIN_LINKS);

    let fromX = this.tX[towerIndex];
    let fromY = this.tY[towerIndex];
    let slot = firstSlot;
    let hitCount = 0;

    while (slot >= 0 && hitCount < links) {
      this.pushArc(fromX, fromY, this.eX[slot], this.eY[slot], color);
      fromX = this.eX[slot];
      fromY = this.eY[slot];
      this.chainHits[hitCount] = slot;
      hitCount += 1;
      this.damageEnemy(slot, damage, ignoresArmor, 0, 0, towerIndex);

      slot = hitCount < links ? this.nextChainTarget(fromX, fromY, hitCount) : -1;
    }
  }

  private nextChainTarget(x: number, y: number, hitCount: number): number {
    const grid = this.grid;
    const range = CHAIN_JUMP_RANGE;
    const rangeSquared = range * range;

    const colStart = grid.colOf(x - range);
    const colEnd = grid.colOf(x + range);
    const rowStart = grid.rowOf(y - range);
    const rowEnd = grid.rowOf(y + range);

    let best = -1;
    let bestDistance = Infinity;

    for (let row = rowStart; row <= rowEnd; row += 1) {
      const rowBase = row * grid.cols;
      for (let col = colStart; col <= colEnd; col += 1) {
        const cell = rowBase + col;
        const end = grid.offsets[cell + 1];
        for (let k = grid.offsets[cell]; k < end; k += 1) {
          const slot = grid.items[k];
          if ((this.eFlags[slot] & FLAG_ALIVE) === 0) continue;
          const dx = this.eX[slot] - x;
          const dy = this.eY[slot] - y;
          const distanceSquared = dx * dx + dy * dy;
          if (distanceSquared > rangeSquared || distanceSquared >= bestDistance) continue;

          let alreadyHit = false;
          for (let h = 0; h < hitCount; h += 1) {
            if (this.chainHits[h] === slot) {
              alreadyHit = true;
              break;
            }
          }
          if (alreadyHit) continue;

          bestDistance = distanceSquared;
          best = slot;
        }
      }
    }
    return best;
  }

  private updateProjectiles(delta: number): void {
    const active = this.projectiles.active;
    const count = this.projectiles.activeCount;

    for (let i = 0; i < count; i += 1) {
      const slot = active[i];

      this.pAge[slot] += delta;
      if (this.pAge[slot] > PROJECTILE_LIFETIME) {
        this.pSpeed[slot] = -1; // marked for collection
        continue;
      }

      this.pPrevX[slot] = this.pX[slot];
      this.pPrevY[slot] = this.pY[slot];

      const target = this.pTargetSlot[slot];
      if (target >= 0 && this.enemies.matches(target, this.pTargetGen[slot])) {
        const dx = this.eX[target] - this.pX[slot];
        const dy = this.eY[target] - this.pY[slot];
        const hitRadius = Math.max(PROJECTILE_HIT_RADIUS, this.eRadius[target]);
        const distanceSquared = dx * dx + dy * dy;

        if (distanceSquared <= hitRadius * hitRadius) {
          this.impact(slot, target);
          continue;
        }
        // One square root per projectile per tick is unavoidable for homing,
        // but it is the only one left in the hot path.
        const inverse = this.pSpeed[slot] / Math.sqrt(distanceSquared);
        this.pVx[slot] = dx * inverse;
        this.pVy[slot] = dy * inverse;
      }

      this.pX[slot] += this.pVx[slot] * delta;
      this.pY[slot] += this.pVy[slot] * delta;
    }
  }

  private impact(slot: number, targetSlot: number): void {
    const ignoresArmor = (this.pFlags[slot] & FLAG_PIERCING) !== 0;
    const splash = this.pSplash[slot];

    if (splash > 0) {
      const grid = this.grid;
      const x = this.pX[slot];
      const y = this.pY[slot];
      const splashSquared = splash * splash;

      const colStart = grid.colOf(x - splash);
      const colEnd = grid.colOf(x + splash);
      const rowStart = grid.rowOf(y - splash);
      const rowEnd = grid.rowOf(y + splash);

      for (let row = rowStart; row <= rowEnd; row += 1) {
        const rowBase = row * grid.cols;
        for (let col = colStart; col <= colEnd; col += 1) {
          const cell = rowBase + col;
          const end = grid.offsets[cell + 1];
          for (let k = grid.offsets[cell]; k < end; k += 1) {
            const victim = grid.items[k];
            if ((this.eFlags[victim] & FLAG_ALIVE) === 0) continue;
            const dx = this.eX[victim] - x;
            const dy = this.eY[victim] - y;
            if (dx * dx + dy * dy > splashSquared) continue;
            this.damageEnemy(
              victim,
              this.pDamage[slot],
              ignoresArmor,
              this.pSlowFactor[slot],
              this.pSlowDuration[slot],
              -1
            );
          }
        }
      }
    } else {
      this.damageEnemy(
        targetSlot,
        this.pDamage[slot],
        ignoresArmor,
        this.pSlowFactor[slot],
        this.pSlowDuration[slot],
        -1
      );
    }

    this.spawnParticles(
      this.pX[slot],
      this.pY[slot],
      splash > 0 ? 6 : 3,
      TOWER_ACCENTS[this.pKind[slot]]
    );
    this.pSpeed[slot] = -1;
  }

  private damageEnemy(
    slot: number,
    amount: number,
    ignoresArmor: boolean,
    slowFactor: number,
    slowDuration: number,
    towerIndex: number
  ): void {
    this.eHp[slot] -= ignoresArmor ? amount : applyArmor(amount, this.eArmor[slot]);

    if (slowFactor > 0) {
      if (slowFactor > this.eSlowFactor[slot]) this.eSlowFactor[slot] = slowFactor;
      if (slowDuration > this.eSlowTimer[slot]) this.eSlowTimer[slot] = slowDuration;
    }

    if (this.eHp[slot] > 0) return;

    this.eFlags[slot] &= ~FLAG_ALIVE;
    this.kills += 1;
    if (towerIndex >= 0) this.tKills[towerIndex] += 1;

    if (!this.stressTargets) {
      this.gold += this.eBounty[slot];
      this.score += this.eScore[slot];
      this.pushLabel(this.eX[slot], this.eY[slot], this.eBounty[slot]);
    }

    this.spawnParticles(
      this.eX[slot],
      this.eY[slot],
      (this.eFlags[slot] & FLAG_BOSS) !== 0 ? 20 : PARTICLES_PER_KILL,
      ENEMY_ACCENTS[this.eType[slot]]
    );
    this.splitOnDeath(slot);
  }

  private splitOnDeath(slot: number): void {
    const def = ENEMY_DEFS[this.eType[slot]];
    if (def.splitInto < 0 || def.splitCount <= 0) return;

    const childHealth = Math.max(1, this.eMaxHp[slot] * def.splitHealthFactor);
    const distance = this.eDistance[slot];
    for (let i = 0; i < def.splitCount; i += 1) {
      const offset = (i - (def.splitCount - 1) / 2) * 14;
      const child = this.spawnEnemy(
        def.splitInto,
        false,
        Math.max(0, distance + offset),
        childHealth
      );
      if (child < 0) return;
      this.eSlowFactor[child] = this.eSlowFactor[slot];
      this.eSlowTimer[child] = this.eSlowTimer[slot];
    }
  }

  // ── Effects ────────────────────────────────────────────────────────────────

  private spawnParticles(x: number, y: number, count: number, color: number): void {
    for (let i = 0; i < count; i += 1) {
      const slot = this.particleCursor;
      this.particleCursor = (slot + 1) % MAX_PARTICLES;

      const angle = this.rng.next() * Math.PI * 2;
      const speed = this.rng.range(30, 150);
      this.cX[slot] = x;
      this.cY[slot] = y;
      this.cVx[slot] = Math.cos(angle) * speed;
      this.cVy[slot] = Math.sin(angle) * speed;
      this.cMaxLife[slot] = this.rng.range(0.25, 0.6);
      this.cLife[slot] = this.cMaxLife[slot];
      this.cSize[slot] = this.rng.range(1.5, 3.5);
      this.cColor[slot] = color;
    }
  }

  private pushLabel(x: number, y: number, value: number): void {
    const slot = this.labelCursor;
    this.labelCursor = (slot + 1) % MAX_LABELS;
    this.lX[slot] = x;
    this.lY[slot] = y;
    this.lLife[slot] = 0.75;
    this.lValue[slot] = value;
    this.lColor[slot] = 0xffc94d;
  }

  private pushArc(x1: number, y1: number, x2: number, y2: number, color: number): void {
    const slot = this.arcCursor;
    this.arcCursor = (slot + 1) % MAX_ARCS;
    this.aX1[slot] = x1;
    this.aY1[slot] = y1;
    this.aX2[slot] = x2;
    this.aY2[slot] = y2;
    this.aLife[slot] = 0.14;
    this.aColor[slot] = color;
  }

  private updateEffects(delta: number): void {
    if (this.shake > 0) {
      this.shake -= delta * SHAKE_DECAY;
      if (this.shake < 0) this.shake = 0;
    }

    for (let i = 0; i < MAX_PARTICLES; i += 1) {
      if (this.cLife[i] <= 0) continue;
      this.cLife[i] -= delta;
      this.cX[i] += this.cVx[i] * delta;
      this.cY[i] += this.cVy[i] * delta;
      this.cVx[i] *= 0.94;
      this.cVy[i] *= 0.94;
    }

    for (let i = 0; i < MAX_LABELS; i += 1) {
      if (this.lLife[i] <= 0) continue;
      this.lLife[i] -= delta;
      this.lY[i] -= delta * 26;
    }

    for (let i = 0; i < MAX_ARCS; i += 1) {
      if (this.aLife[i] > 0) this.aLife[i] -= delta;
    }
  }

  /** Releases dead slots. Iterating backwards makes the swap-remove safe. */
  private compact(): void {
    const enemyActive = this.enemies.active;
    for (let i = this.enemies.activeCount - 1; i >= 0; i -= 1) {
      const slot = enemyActive[i];
      if ((this.eFlags[slot] & FLAG_ALIVE) === 0) this.enemies.release(slot);
    }

    const projectileActive = this.projectiles.active;
    for (let i = this.projectiles.activeCount - 1; i >= 0; i -= 1) {
      const slot = projectileActive[i];
      if (this.pSpeed[slot] < 0) this.projectiles.release(slot);
    }
  }

  private checkWaveComplete(): void {
    if (this.phase !== 'wave' || this.stressTargets) return;
    if (this.spawnGroups.length > 0 || this.enemies.activeCount > 0) return;

    const wave = getWave(this.wave);
    this.gold += wave.reward;
    this.score += wave.reward * 2;
    this.phase = this.wave >= TOTAL_WAVES ? 'victory' : 'ready';
    this.restTimer = REST_SECONDS;
  }

  // ── Benchmarking ───────────────────────────────────────────────────────────

  stress(request: StressRequest): void {
    if (request.enemies <= 0 && request.towers <= 0 && request.projectiles <= 0) {
      this.stressTargets = null;
      return;
    }

    this.stressTargets = request;
    this.phase = 'wave';
    if (this.wave === 0) this.wave = 1;

    this.fillTowers(request.towers);
    this.topUpStress();
  }

  private fillTowers(target: number): void {
    const limit = Math.min(target, MAX_TOWERS);
    for (let stride = 3; stride >= 1 && this.towerCount < limit; stride -= 1) {
      for (let row = 0; row < GRID_ROWS && this.towerCount < limit; row += stride) {
        for (let col = 0; col < GRID_COLS && this.towerCount < limit; col += stride) {
          if (!this.canPlace(col, row)) continue;
          this.placeTower(col, row, this.towerCount % TOWER_DEFS.length, true);
        }
      }
    }
    this.selectedTowerId = null;
  }

  private topUpStress(): void {
    const targets = this.stressTargets;
    if (!targets) return;

    const enemyTarget = Math.min(targets.enemies, MAX_ENEMIES - 64);
    while (this.enemies.activeCount < enemyTarget) {
      const typeId = this.rng.int(ENEMY_DEFS.length);
      const slot = this.spawnEnemy(typeId, false, this.rng.next() * PATH_LENGTH, 0);
      if (slot < 0) break;
      // Tough on purpose: the point is to measure a full field, not to watch it
      // evaporate before the measurement window closes.
      this.eMaxHp[slot] *= 40;
      this.eHp[slot] = this.eMaxHp[slot];
    }

    if (this.towerCount === 0) return;
    const projectileTarget = Math.min(targets.projectiles, MAX_PROJECTILES - 64);
    let guard = projectileTarget * 4;
    while (this.projectiles.activeCount < projectileTarget && this.enemies.activeCount > 0) {
      if (guard-- <= 0) break;
      const towerIndex = this.rng.int(this.towerCount);
      const def = TOWER_DEFS[this.tType[towerIndex]];
      if (def.hitscan) continue;

      const targetSlot = this.enemies.active[this.rng.int(this.enemies.activeCount)];
      const stats = def.levels[this.tLevel[towerIndex] - 1];
      this.fireProjectile(towerIndex, targetSlot, stats, def.ignoresArmor);
      const created = this.projectiles.active[this.projectiles.activeCount - 1];
      this.pAge[created] = this.rng.next() * PROJECTILE_LIFETIME * 0.5;
    }
  }

  maxTowerLevel(): number {
    return MAX_TOWER_LEVEL;
  }

  isAlive(slot: number): boolean {
    return (this.eFlags[slot] & FLAG_ALIVE) !== 0;
  }

  isBoss(slot: number): boolean {
    return (this.eFlags[slot] & FLAG_BOSS) !== 0;
  }

  isFlying(slot: number): boolean {
    return (this.eFlags[slot] & FLAG_FLYING) !== 0;
  }
}
