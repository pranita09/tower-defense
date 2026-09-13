import { Rng } from '../core/rng';
import {
  applyArmor,
  BOSS_BOUNTY_MULTIPLIER,
  BOSS_DAMAGE,
  BOSS_HEALTH_MULTIPLIER,
  BOSS_RADIUS,
  BOSS_SCORE_MULTIPLIER,
  ENEMY_DEFS,
} from '../data/enemies';
import {
  BASE_POSITION,
  GRID_COLS,
  GRID_ROWS,
  isBuildable,
  PATH,
  PATH_LENGTH,
  samplePath,
  tileCentreX,
  tileCentreY,
  TILE_SIZE,
} from '../data/map';
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
 * The naive simulation — the project's performance baseline.
 *
 * This is written the way a tower defense is *first* written, and every choice
 * here is one we later undo:
 *
 * - one heap object per enemy, tower, projectile, particle and damage number,
 *   held in plain arrays that are `splice`d as entities die;
 * - every tower rescans every enemy on every tick to pick a target, using a
 *   real square root per candidate;
 * - splash damage rescans every enemy again;
 * - a fresh object is allocated for every shot, spark and damage number.
 *
 * It plays correctly and it is pleasant at real wave sizes. It falls over long
 * before the required stress load, and measuring exactly where is the point.
 */

const PROJECTILE_LIFETIME = 2.5;
const PROJECTILE_HIT_RADIUS = 9;
const PARTICLES_PER_KILL = 6;
const SHAKE_DECAY = 3.4;

/** Build time before the first wave, and between waves. */
const OPENING_REST_SECONDS = 20;
const REST_SECONDS = 9;
/** Gold per second saved by sending a wave early. */
const EARLY_SEND_BONUS_RATE = 2;

class NaiveEnemy {
  x = 0;
  y = 0;
  prevX = 0;
  prevY = 0;
  hp = 1;
  maxHp = 1;
  baseSpeed = 60;
  armor = 0;
  bounty = 0;
  scoreValue = 0;
  leakDamage = 1;
  radius = 8;
  /** Index of the waypoint being walked towards. */
  segment = 1;
  /** Distance covered along the path; drives "target the leader" logic. */
  traveled = 0;
  slowTimer = 0;
  slowFactor = 0;
  boss = false;
  alive = true;
  typeId = 0;
}

class NaiveTower {
  id = 0;
  col = 0;
  row = 0;
  x = 0;
  y = 0;
  typeId = 0;
  level = 1;
  cooldownRemaining = 0;
  invested = 0;
  kills = 0;
  rotation = -Math.PI / 2;
  /** Visual recoil, decays to zero. */
  recoil = 0;
}

class NaiveProjectile {
  x = 0;
  y = 0;
  prevX = 0;
  prevY = 0;
  vx = 0;
  vy = 0;
  speed = 300;
  damage = 0;
  splashRadius = 0;
  slowFactor = 0;
  slowDuration = 0;
  age = 0;
  kind = 0;
  target: NaiveEnemy | null = null;
  alive = true;
}

class NaiveParticle {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  life = 0;
  maxLife = 1;
  size = 2;
  color = '#fff';
}

class NaiveDamageNumber {
  x = 0;
  y = 0;
  life = 0;
  text = '';
  color = '#fff';
}

interface SpawnGroupState {
  enemyId: number;
  remaining: number;
  interval: number;
  timer: number;
  boss: boolean;
}

export class NaiveSim {
  readonly enemies: NaiveEnemy[] = [];
  readonly towers: NaiveTower[] = [];
  readonly projectiles: NaiveProjectile[] = [];
  readonly particles: NaiveParticle[] = [];
  readonly damageNumbers: NaiveDamageNumber[] = [];

  readonly maxHealth = STARTING_HEALTH;

  phase: GamePhase = 'ready';
  health = STARTING_HEALTH;
  gold = STARTING_GOLD;
  score = 0;
  wave = 0;
  leaks = 0;
  waveSpawned = 0;
  waveTotal = 0;
  selectedTowerId: number | null = null;
  /** Seconds until the next wave sends itself. */
  restTimer = OPENING_REST_SECONDS;
  /** Run totals, for the HUD and end-of-run summary. */
  kills = 0;
  shotsFired = 0;

  /** Decaying impact shake, read by the renderer. */
  shake = 0;

  private readonly rng = new Rng(0x1234abcd);
  private readonly occupied = new Int32Array(GRID_COLS * GRID_ROWS).fill(-1);
  private spawnGroups: SpawnGroupState[] = [];
  private nextTowerId = 1;
  private stressTargets: StressRequest | null = null;

  get inStressMode(): boolean {
    return this.stressTargets !== null;
  }

  reset(): void {
    this.enemies.length = 0;
    this.towers.length = 0;
    this.projectiles.length = 0;
    this.particles.length = 0;
    this.damageNumbers.length = 0;
    this.occupied.fill(-1);
    this.spawnGroups = [];
    this.phase = 'ready';
    this.health = STARTING_HEALTH;
    this.gold = STARTING_GOLD;
    this.score = 0;
    this.wave = 0;
    this.leaks = 0;
    this.waveSpawned = 0;
    this.waveTotal = 0;
    this.selectedTowerId = null;
    this.restTimer = OPENING_REST_SECONDS;
    this.kills = 0;
    this.shotsFired = 0;
    this.shake = 0;
    this.stressTargets = null;
    this.nextTowerId = 1;
  }

  // ── Player commands ────────────────────────────────────────────────────────

  startWave(): boolean {
    if (this.phase !== 'ready') return false;
    if (this.wave >= TOTAL_WAVES) return false;

    // Sending early is rewarded, so a confident player is paid for the risk
    // instead of just waiting out every countdown.
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

  towerAtTile(col: number, row: number): NaiveTower | null {
    if (col < 0 || row < 0 || col >= GRID_COLS || row >= GRID_ROWS) return null;
    const id = this.occupied[row * GRID_COLS + col];
    if (id < 0) return null;
    return this.towers.find((tower) => tower.id === id) ?? null;
  }

  canPlace(col: number, row: number): boolean {
    return isBuildable(col, row) && this.occupied[row * GRID_COLS + col] < 0;
  }

  placeTower(col: number, row: number, typeId: number, free = false): boolean {
    if (!this.canPlace(col, row)) return false;
    const cost = towerBuildCost(typeId);
    if (!free && this.gold < cost) return false;

    const tower = new NaiveTower();
    tower.id = this.nextTowerId++;
    tower.col = col;
    tower.row = row;
    tower.x = tileCentreX(col);
    tower.y = tileCentreY(row);
    tower.typeId = typeId;
    tower.level = 1;
    tower.invested = free ? 0 : cost;

    this.towers.push(tower);
    this.occupied[row * GRID_COLS + col] = tower.id;
    if (!free) this.gold -= cost;
    this.selectedTowerId = tower.id;
    return true;
  }

  upgradeSelected(): boolean {
    const tower = this.selectedTower();
    if (!tower) return false;
    const cost = towerUpgradeCost(tower.typeId, tower.level);
    if (cost === null || this.gold < cost) return false;

    this.gold -= cost;
    tower.invested += cost;
    tower.level += 1;
    return true;
  }

  sellSelected(): boolean {
    const tower = this.selectedTower();
    if (!tower) return false;

    this.gold += Math.floor(tower.invested * SELL_REFUND_RATE);
    this.occupied[tower.row * GRID_COLS + tower.col] = -1;
    this.towers.splice(this.towers.indexOf(tower), 1);
    this.selectedTowerId = null;
    return true;
  }

  selectedTower(): NaiveTower | null {
    if (this.selectedTowerId === null) return null;
    return this.towers.find((tower) => tower.id === this.selectedTowerId) ?? null;
  }

  towerAtPoint(worldX: number, worldY: number): NaiveTower | null {
    const col = Math.floor(worldX / TILE_SIZE);
    const row = Math.floor(worldY / TILE_SIZE);
    return this.towerAtTile(col, row);
  }

  // ── Simulation ─────────────────────────────────────────────────────────────

  step(delta: number): void {
    if (this.phase === 'victory' || this.phase === 'defeat') {
      this.updateEffects(delta);
      return;
    }

    if (this.stressTargets) this.topUpStress();

    if (this.phase === 'ready' && !this.stressTargets) {
      this.restTimer -= delta;
      if (this.restTimer <= 0) this.startWave();
    }

    if (this.phase === 'wave') this.updateSpawns(delta);

    this.updateEnemies(delta);
    this.updateTowers(delta);
    this.updateProjectiles(delta);
    this.updateEffects(delta);
    this.removeDead();
    this.checkWaveComplete();
  }

  private updateSpawns(delta: number): void {
    for (let i = this.spawnGroups.length - 1; i >= 0; i -= 1) {
      const group = this.spawnGroups[i];
      group.timer -= delta;
      while (group.timer <= 0 && group.remaining > 0) {
        this.spawnEnemy(group.enemyId, group.boss, 0);
        group.remaining -= 1;
        group.timer += group.interval;
        this.waveSpawned += 1;
      }
      if (group.remaining <= 0) this.spawnGroups.splice(i, 1);
    }
  }

  private spawnEnemy(typeId: number, boss: boolean, startDistance: number): NaiveEnemy {
    const def = ENEMY_DEFS[typeId];
    const wave = getWave(Math.max(1, this.wave));

    const enemy = new NaiveEnemy();
    enemy.typeId = typeId;
    enemy.boss = boss;
    enemy.maxHp = def.health * wave.healthScale * (boss ? BOSS_HEALTH_MULTIPLIER : 1);
    enemy.hp = enemy.maxHp;
    enemy.baseSpeed = def.speed * wave.speedScale * (boss ? 0.55 : 1);
    enemy.armor = def.armor + wave.armorBonus + (boss ? 6 : 0);
    enemy.bounty = Math.round(def.bounty * wave.bountyScale * (boss ? BOSS_BOUNTY_MULTIPLIER : 1));
    enemy.scoreValue = Math.round(def.score * (boss ? BOSS_SCORE_MULTIPLIER : 1));
    enemy.leakDamage = boss ? BOSS_DAMAGE : def.damage;
    enemy.radius = boss ? BOSS_RADIUS : def.radius;

    const point = samplePath(startDistance);
    enemy.x = point.x;
    enemy.y = point.y;
    enemy.prevX = point.x;
    enemy.prevY = point.y;
    enemy.segment = point.segment;
    enemy.traveled = startDistance;

    this.enemies.push(enemy);
    return enemy;
  }

  private updateEnemies(delta: number): void {
    for (let i = 0; i < this.enemies.length; i += 1) {
      const enemy = this.enemies[i];
      if (!enemy.alive) continue;

      enemy.prevX = enemy.x;
      enemy.prevY = enemy.y;

      if (enemy.slowTimer > 0) {
        enemy.slowTimer -= delta;
        if (enemy.slowTimer <= 0) enemy.slowFactor = 0;
      }

      const speed = enemy.baseSpeed * (1 - enemy.slowFactor);
      let remaining = speed * delta;

      // Walk waypoint to waypoint, with a square root per step.
      while (remaining > 0 && enemy.segment < PATH.length) {
        const target = PATH[enemy.segment];
        const dx = target.x - enemy.x;
        const dy = target.y - enemy.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance <= remaining) {
          enemy.x = target.x;
          enemy.y = target.y;
          enemy.traveled += distance;
          remaining -= distance;
          enemy.segment += 1;
        } else {
          const scale = remaining / distance;
          enemy.x += dx * scale;
          enemy.y += dy * scale;
          enemy.traveled += remaining;
          remaining = 0;
        }
      }

      if (enemy.segment >= PATH.length) this.leak(enemy);
    }
  }

  private leak(enemy: NaiveEnemy): void {
    if (this.stressTargets) {
      // A benchmark needs a stable population, so stress enemies loop the
      // course instead of ending the run.
      enemy.segment = 1;
      enemy.traveled = 0;
      enemy.x = PATH[0].x;
      enemy.y = PATH[0].y;
      enemy.prevX = enemy.x;
      enemy.prevY = enemy.y;
      return;
    }

    enemy.alive = false;
    this.leaks += 1;
    this.health -= enemy.leakDamage;
    this.shake = Math.min(1, this.shake + (enemy.boss ? 1 : 0.45));
    this.spawnParticles(BASE_POSITION.x, BASE_POSITION.y, 10, '#ff5d5d');

    if (this.health <= 0) {
      this.health = 0;
      this.phase = 'defeat';
    }
  }

  private updateTowers(delta: number): void {
    for (let t = 0; t < this.towers.length; t += 1) {
      const tower = this.towers[t];
      const stats = TOWER_DEFS[tower.typeId].levels[tower.level - 1];

      if (tower.recoil > 0) tower.recoil = Math.max(0, tower.recoil - delta * 5);
      tower.cooldownRemaining -= delta;

      // Naive target acquisition: a full scan of every enemy, every tick, for
      // every tower. This is the O(towers x enemies) term that dominates later.
      let best: NaiveEnemy | null = null;
      let bestProgress = -1;
      for (let e = 0; e < this.enemies.length; e += 1) {
        const enemy = this.enemies[e];
        if (!enemy.alive) continue;
        const dx = enemy.x - tower.x;
        const dy = enemy.y - tower.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > stats.range) continue;
        if (enemy.traveled > bestProgress) {
          bestProgress = enemy.traveled;
          best = enemy;
        }
      }

      if (!best) continue;
      tower.rotation = Math.atan2(best.y - tower.y, best.x - tower.x);
      if (tower.cooldownRemaining > 0) continue;

      tower.cooldownRemaining = stats.cooldown;
      tower.recoil = 1;

      const projectile = new NaiveProjectile();
      projectile.x = tower.x;
      projectile.y = tower.y;
      projectile.prevX = tower.x;
      projectile.prevY = tower.y;
      projectile.speed = stats.projectileSpeed;
      projectile.damage = stats.damage;
      projectile.splashRadius = stats.splashRadius;
      projectile.slowFactor = stats.slowFactor;
      projectile.slowDuration = stats.slowDuration;
      projectile.kind = tower.typeId;
      projectile.target = best;
      const angle = tower.rotation;
      projectile.vx = Math.cos(angle) * stats.projectileSpeed;
      projectile.vy = Math.sin(angle) * stats.projectileSpeed;
      this.projectiles.push(projectile);
      this.shotsFired += 1;
    }
  }

  private updateProjectiles(delta: number): void {
    for (let i = 0; i < this.projectiles.length; i += 1) {
      const projectile = this.projectiles[i];
      if (!projectile.alive) continue;

      projectile.age += delta;
      if (projectile.age > PROJECTILE_LIFETIME) {
        projectile.alive = false;
        continue;
      }

      projectile.prevX = projectile.x;
      projectile.prevY = projectile.y;

      const target = projectile.target;
      if (target && target.alive) {
        // Home in: another square root, per projectile, per tick.
        const dx = target.x - projectile.x;
        const dy = target.y - projectile.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance <= Math.max(PROJECTILE_HIT_RADIUS, target.radius)) {
          this.impact(projectile, target);
          continue;
        }
        projectile.vx = (dx / distance) * projectile.speed;
        projectile.vy = (dy / distance) * projectile.speed;
      }

      projectile.x += projectile.vx * delta;
      projectile.y += projectile.vy * delta;
    }
  }

  private impact(projectile: NaiveProjectile, target: NaiveEnemy): void {
    projectile.alive = false;

    if (projectile.splashRadius > 0) {
      // Splash rescans the entire enemy list.
      const radiusSquared = projectile.splashRadius * projectile.splashRadius;
      for (let i = 0; i < this.enemies.length; i += 1) {
        const enemy = this.enemies[i];
        if (!enemy.alive) continue;
        const dx = enemy.x - projectile.x;
        const dy = enemy.y - projectile.y;
        if (dx * dx + dy * dy > radiusSquared) continue;
        this.damage(enemy, projectile.damage, projectile);
      }
    } else {
      this.damage(target, projectile.damage, projectile);
    }

    const color = TOWER_DEFS[projectile.kind].accent;
    this.spawnParticles(projectile.x, projectile.y, projectile.splashRadius > 0 ? 7 : 3, color);
  }

  private damage(enemy: NaiveEnemy, amount: number, projectile: NaiveProjectile): void {
    enemy.hp -= applyArmor(amount, enemy.armor);

    if (projectile.slowFactor > 0) {
      enemy.slowFactor = Math.max(enemy.slowFactor, projectile.slowFactor);
      enemy.slowTimer = Math.max(enemy.slowTimer, projectile.slowDuration);
    }

    if (enemy.hp > 0) return;

    enemy.alive = false;
    this.kills += 1;
    if (!this.stressTargets) {
      this.gold += enemy.bounty;
      this.score += enemy.scoreValue;
    }

    const label = new NaiveDamageNumber();
    label.x = enemy.x;
    label.y = enemy.y;
    label.life = 0.75;
    label.text = `+${enemy.bounty}`;
    label.color = '#ffc94d';
    this.damageNumbers.push(label);

    this.spawnParticles(
      enemy.x,
      enemy.y,
      enemy.boss ? 24 : PARTICLES_PER_KILL,
      ENEMY_DEFS[enemy.typeId].accent
    );
  }

  private spawnParticles(x: number, y: number, count: number, color: string): void {
    for (let i = 0; i < count; i += 1) {
      const particle = new NaiveParticle();
      const angle = this.rng.next() * Math.PI * 2;
      const speed = this.rng.range(30, 150);
      particle.x = x;
      particle.y = y;
      particle.vx = Math.cos(angle) * speed;
      particle.vy = Math.sin(angle) * speed;
      particle.maxLife = this.rng.range(0.25, 0.6);
      particle.life = particle.maxLife;
      particle.size = this.rng.range(1.5, 3.5);
      particle.color = color;
      this.particles.push(particle);
    }
  }

  private updateEffects(delta: number): void {
    if (this.shake > 0) this.shake = Math.max(0, this.shake - delta * SHAKE_DECAY);

    for (let i = this.particles.length - 1; i >= 0; i -= 1) {
      const particle = this.particles[i];
      particle.life -= delta;
      if (particle.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      particle.x += particle.vx * delta;
      particle.y += particle.vy * delta;
      particle.vx *= 0.94;
      particle.vy *= 0.94;
    }

    for (let i = this.damageNumbers.length - 1; i >= 0; i -= 1) {
      const label = this.damageNumbers[i];
      label.life -= delta;
      if (label.life <= 0) {
        this.damageNumbers.splice(i, 1);
        continue;
      }
      label.y -= delta * 26;
    }
  }

  /** Naive compaction: splice dead entities out one at a time. */
  private removeDead(): void {
    for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
      if (!this.enemies[i].alive) this.enemies.splice(i, 1);
    }
    for (let i = this.projectiles.length - 1; i >= 0; i -= 1) {
      if (!this.projectiles[i].alive) this.projectiles.splice(i, 1);
    }
  }

  private checkWaveComplete(): void {
    if (this.phase !== 'wave') return;
    if (this.stressTargets) return;
    if (this.spawnGroups.length > 0 || this.enemies.length > 0) return;

    const wave = getWave(this.wave);
    this.gold += wave.reward;
    this.score += wave.reward * 2;
    this.phase = this.wave >= TOTAL_WAVES ? 'victory' : 'ready';
    this.restTimer = REST_SECONDS;
  }

  // ── Benchmarking ───────────────────────────────────────────────────────────

  /**
   * Injects a synthetic load and then holds it: counts are topped up every tick
   * so the scenario is sustained for the whole measurement window rather than
   * decaying as soon as the towers start killing things.
   */
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
    if (this.towers.length >= target) return;

    // Walk buildable tiles in a coarse stride first so towers spread over the
    // whole map instead of clumping in one corner.
    for (let stride = 3; stride >= 1 && this.towers.length < target; stride -= 1) {
      for (let row = 0; row < GRID_ROWS && this.towers.length < target; row += stride) {
        for (let col = 0; col < GRID_COLS && this.towers.length < target; col += stride) {
          if (!this.canPlace(col, row)) continue;
          this.placeTower(col, row, this.towers.length % TOWER_DEFS.length, true);
        }
      }
    }
    this.selectedTowerId = null;
  }

  private topUpStress(): void {
    const targets = this.stressTargets;
    if (!targets) return;

    while (this.enemies.length < targets.enemies) {
      const typeId = this.rng.int(ENEMY_DEFS.length);
      const enemy = this.spawnEnemy(typeId, false, this.rng.next() * PATH_LENGTH);
      // Stress enemies are tough on purpose: the point is to measure a full
      // field, not to watch it evaporate.
      enemy.maxHp *= 40;
      enemy.hp = enemy.maxHp;
    }

    if (this.towers.length === 0) return;
    while (this.projectiles.length < targets.projectiles && this.enemies.length > 0) {
      const tower = this.towers[this.rng.int(this.towers.length)];
      const enemy = this.enemies[this.rng.int(this.enemies.length)];
      const stats = TOWER_DEFS[tower.typeId].levels[tower.level - 1];

      const projectile = new NaiveProjectile();
      projectile.x = tower.x;
      projectile.y = tower.y;
      projectile.prevX = tower.x;
      projectile.prevY = tower.y;
      projectile.speed = stats.projectileSpeed;
      projectile.damage = stats.damage;
      projectile.splashRadius = stats.splashRadius;
      projectile.slowFactor = stats.slowFactor;
      projectile.slowDuration = stats.slowDuration;
      projectile.kind = tower.typeId;
      projectile.target = enemy;
      projectile.age = this.rng.next() * PROJECTILE_LIFETIME * 0.5;
      this.projectiles.push(projectile);
    }
  }

  towerLevelStats(tower: NaiveTower) {
    return TOWER_DEFS[tower.typeId].levels[tower.level - 1];
  }

  maxTowerLevel(): number {
    return MAX_TOWER_LEVEL;
  }
}

export type { NaiveEnemy, NaiveTower, NaiveProjectile, NaiveParticle, NaiveDamageNumber };
