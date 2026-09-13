import { lerp } from '../core/math';
import type { Camera } from '../core/camera';
import { ENEMY_ARMORED, ENEMY_DEFS, ENEMY_RUNNER } from '../data/enemies';
import {
  BASE_POSITION,
  GRID_COLS,
  GRID_ROWS,
  isBuildable,
  PATH,
  TILE_SIZE,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '../data/map';
import { TOWER_DEFS } from '../data/towers';
import type { CanvasViewport } from '../render/viewport';
import type { NaiveSim } from './naiveSim';

/**
 * The naive renderer — the project's rendering baseline.
 *
 * Everything here is per-entity immediate-mode Canvas 2D work, which is how a
 * first implementation always looks:
 *
 * - the terrain, grid and path are re-drawn from scratch every single frame;
 * - each entity does its own `save`/`translate`/`beginPath`/`fill`/`restore`,
 *   so the context is reconfigured thousands of times per frame;
 * - projectiles set `shadowBlur` individually, which forces the rasteriser down
 *   a slow path for every one of them;
 * - health bars are drawn for every enemy regardless of size or damage;
 * - nothing is culled, so entities outside the visible area cost full price.
 */

const TAU = Math.PI * 2;

export interface HoverState {
  col: number;
  row: number;
  typeId: number;
  valid: boolean;
}

export class NaiveRenderer {
  draw(
    sim: NaiveSim,
    ctx: CanvasRenderingContext2D,
    viewport: CanvasViewport,
    camera: Camera,
    alpha: number,
    hover: HoverState | null
  ): void {
    const dpr = viewport.dpr;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#080b12';
    ctx.fillRect(0, 0, viewport.cssWidth, viewport.cssHeight);

    const shakeX = sim.shake > 0 ? (Math.random() - 0.5) * sim.shake * 9 : 0;
    const shakeY = sim.shake > 0 ? (Math.random() - 0.5) * sim.shake * 9 : 0;
    const scale = dpr * camera.scale;
    ctx.setTransform(
      scale,
      0,
      0,
      scale,
      dpr * (camera.offsetX + shakeX),
      dpr * (camera.offsetY + shakeY)
    );

    this.drawTerrain(ctx);
    this.drawPath(ctx);
    this.drawBase(ctx, sim);
    if (hover) this.drawHover(ctx, hover);
    this.drawTowers(ctx, sim);
    this.drawEnemies(ctx, sim, alpha);
    this.drawProjectiles(ctx, sim, alpha);
    this.drawParticles(ctx, sim);
    this.drawDamageNumbers(ctx, sim);
  }

  /** Redrawn every frame, tile by tile. */
  private drawTerrain(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#111a27';
    ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    for (let row = 0; row < GRID_ROWS; row += 1) {
      for (let col = 0; col < GRID_COLS; col += 1) {
        if (!isBuildable(col, row)) continue;
        const x = col * TILE_SIZE;
        const y = row * TILE_SIZE;
        ctx.fillStyle = (col + row) % 2 === 0 ? '#16202f' : '#141d2b';
        ctx.fillRect(x, y, TILE_SIZE - 1, TILE_SIZE - 1);
      }
    }
  }

  private drawPath(ctx: CanvasRenderingContext2D): void {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    ctx.beginPath();
    ctx.moveTo(PATH[0].x, PATH[0].y);
    for (let i = 1; i < PATH.length; i += 1) ctx.lineTo(PATH[i].x, PATH[i].y);

    ctx.strokeStyle = '#2a2016';
    ctx.lineWidth = TILE_SIZE * 1.75;
    ctx.stroke();

    ctx.strokeStyle = '#3d2f20';
    ctx.lineWidth = TILE_SIZE * 1.45;
    ctx.stroke();

    ctx.setLineDash([9, 13]);
    ctx.strokeStyle = 'rgba(255, 201, 77, 0.16)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawBase(ctx: CanvasRenderingContext2D, sim: NaiveSim): void {
    const { x, y } = BASE_POSITION;
    const healthFraction = Math.max(0, sim.health / sim.maxHealth);

    ctx.save();
    ctx.translate(x, y);

    ctx.beginPath();
    ctx.arc(0, 0, 26, 0, TAU);
    ctx.fillStyle = 'rgba(76, 201, 240, 0.08)';
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(0, -18);
    ctx.lineTo(16, 0);
    ctx.lineTo(0, 18);
    ctx.lineTo(-16, 0);
    ctx.closePath();
    ctx.fillStyle = '#1d3448';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = healthFraction > 0.35 ? '#4cc9f0' : '#ff5d5d';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, 7, 0, TAU);
    ctx.fillStyle = healthFraction > 0.35 ? '#4cc9f0' : '#ff5d5d';
    ctx.fill();
    ctx.restore();
  }

  private drawHover(ctx: CanvasRenderingContext2D, hover: HoverState): void {
    const def = TOWER_DEFS[hover.typeId];
    const stats = def.levels[0];
    const x = hover.col * TILE_SIZE + TILE_SIZE / 2;
    const y = hover.row * TILE_SIZE + TILE_SIZE / 2;

    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, stats.range, 0, TAU);
    ctx.fillStyle = hover.valid ? 'rgba(93, 223, 143, 0.08)' : 'rgba(255, 93, 93, 0.08)';
    ctx.fill();
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = hover.valid ? 'rgba(93, 223, 143, 0.55)' : 'rgba(255, 93, 93, 0.6)';
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.globalAlpha = 0.55;
    ctx.fillStyle = hover.valid ? def.color : '#ff5d5d';
    ctx.fillRect(x - 11, y - 11, 22, 22);
    ctx.restore();
  }

  private drawTowers(ctx: CanvasRenderingContext2D, sim: NaiveSim): void {
    const selected = sim.selectedTower();

    if (selected) {
      const stats = sim.towerLevelStats(selected);
      ctx.save();
      ctx.beginPath();
      ctx.arc(selected.x, selected.y, stats.range, 0, TAU);
      ctx.fillStyle = 'rgba(76, 201, 240, 0.07)';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(76, 201, 240, 0.6)';
      ctx.stroke();
      ctx.restore();
    }

    for (let i = 0; i < sim.towers.length; i += 1) {
      const tower = sim.towers[i];
      const def = TOWER_DEFS[tower.typeId];

      ctx.save();
      ctx.translate(tower.x, tower.y);

      ctx.beginPath();
      ctx.roundRect(-12, -12, 24, 24, 5);
      ctx.fillStyle = '#1b2536';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = tower === selected ? '#ffffff' : def.color;
      ctx.stroke();

      ctx.rotate(tower.rotation);
      const recoil = tower.recoil * 3;
      ctx.beginPath();
      ctx.roundRect(2 - recoil, -3.5, 15, 7, 3);
      ctx.fillStyle = def.color;
      ctx.fill();

      ctx.restore();

      // Level pips
      for (let level = 0; level < tower.level; level += 1) {
        ctx.fillStyle = def.accent;
        ctx.fillRect(tower.x - 9 + level * 7, tower.y + 14, 5, 3);
      }
    }
  }

  private drawEnemies(ctx: CanvasRenderingContext2D, sim: NaiveSim, alpha: number): void {
    for (let i = 0; i < sim.enemies.length; i += 1) {
      const enemy = sim.enemies[i];
      const def = ENEMY_DEFS[enemy.typeId];
      const x = lerp(enemy.prevX, enemy.x, alpha);
      const y = lerp(enemy.prevY, enemy.y, alpha);
      const radius = enemy.radius;

      ctx.save();
      ctx.translate(x, y);

      ctx.beginPath();
      if (enemy.typeId === ENEMY_RUNNER) {
        ctx.moveTo(0, -radius);
        ctx.lineTo(radius, radius * 0.85);
        ctx.lineTo(-radius, radius * 0.85);
        ctx.closePath();
      } else if (enemy.typeId === ENEMY_ARMORED) {
        ctx.roundRect(-radius, -radius, radius * 2, radius * 2, 3);
      } else {
        ctx.arc(0, 0, radius, 0, TAU);
      }
      ctx.fillStyle = enemy.slowTimer > 0 ? '#7ad7ff' : def.color;
      ctx.fill();
      ctx.lineWidth = enemy.boss ? 3 : 1.5;
      ctx.strokeStyle = enemy.boss ? '#ffc94d' : 'rgba(8, 12, 20, 0.8)';
      ctx.stroke();
      ctx.restore();

      // A health bar for every enemy, every frame, at any size.
      const barWidth = radius * 2.4;
      const fraction = Math.max(0, enemy.hp / enemy.maxHp);
      ctx.fillStyle = 'rgba(8, 12, 20, 0.85)';
      ctx.fillRect(x - barWidth / 2, y - radius - 8, barWidth, 3.5);
      ctx.fillStyle = fraction > 0.5 ? '#5ddf8f' : fraction > 0.25 ? '#ffa94d' : '#ff5d5d';
      ctx.fillRect(x - barWidth / 2, y - radius - 8, barWidth * fraction, 3.5);
    }
  }

  private drawProjectiles(ctx: CanvasRenderingContext2D, sim: NaiveSim, alpha: number): void {
    for (let i = 0; i < sim.projectiles.length; i += 1) {
      const projectile = sim.projectiles[i];
      const def = TOWER_DEFS[projectile.kind];
      const x = lerp(projectile.prevX, projectile.x, alpha);
      const y = lerp(projectile.prevY, projectile.y, alpha);
      const radius = projectile.splashRadius > 0 ? 5 : 3;

      // Per-projectile shadow state: pretty, and pathologically slow.
      ctx.save();
      ctx.shadowBlur = 10;
      ctx.shadowColor = def.color;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, TAU);
      ctx.fillStyle = def.accent;
      ctx.fill();
      ctx.restore();
    }
  }

  private drawParticles(ctx: CanvasRenderingContext2D, sim: NaiveSim): void {
    for (let i = 0; i < sim.particles.length; i += 1) {
      const particle = sim.particles[i];
      ctx.save();
      ctx.globalAlpha = Math.max(0, particle.life / particle.maxLife);
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawDamageNumbers(ctx: CanvasRenderingContext2D, sim: NaiveSim): void {
    ctx.font = '700 12px ui-monospace, monospace';
    ctx.textAlign = 'center';
    for (let i = 0; i < sim.damageNumbers.length; i += 1) {
      const label = sim.damageNumbers[i];
      ctx.save();
      ctx.globalAlpha = Math.min(1, label.life * 2);
      ctx.fillStyle = label.color;
      ctx.fillText(label.text, label.x, label.y);
      ctx.restore();
    }
  }
}
