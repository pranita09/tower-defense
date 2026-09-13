import { lerp } from '../core/math';
import type { Camera } from '../core/camera';
import {
  ENEMY_ARMORED,
  ENEMY_DEFS,
  ENEMY_FLYER,
  ENEMY_RUNNER,
  ENEMY_SPLITTER,
} from '../data/enemies';
import { BASE_POSITION, TILE_SIZE } from '../data/map';
import { TOWER_DEFS } from '../data/towers';
import { paintTerrain } from '../render/terrain';
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

    // Rebuilt from scratch every frame: ~250 tile fills plus four wide stroked
    // polylines, for a layer that never changes.
    paintTerrain(ctx);
    this.drawBase(ctx, sim);
    if (hover) this.drawHover(ctx, hover);
    this.drawTowers(ctx, sim);
    this.drawEnemies(ctx, sim, alpha);
    this.drawProjectiles(ctx, sim, alpha);
    this.drawArcs(ctx, sim);
    this.drawParticles(ctx, sim);
    this.drawDamageNumbers(ctx, sim);
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

      if (enemy.flying) {
        // A shadow below sells the fact that it is above the terrain.
        ctx.beginPath();
        ctx.ellipse(2, radius + 7, radius * 0.75, radius * 0.32, 0, 0, TAU);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.fill();
      }

      ctx.beginPath();
      if (enemy.typeId === ENEMY_RUNNER) {
        ctx.moveTo(0, -radius);
        ctx.lineTo(radius, radius * 0.85);
        ctx.lineTo(-radius, radius * 0.85);
        ctx.closePath();
      } else if (enemy.typeId === ENEMY_ARMORED) {
        ctx.roundRect(-radius, -radius, radius * 2, radius * 2, 3);
      } else if (enemy.typeId === ENEMY_FLYER) {
        ctx.moveTo(0, -radius);
        ctx.lineTo(radius, 0);
        ctx.lineTo(0, radius);
        ctx.lineTo(-radius, 0);
        ctx.closePath();
      } else if (enemy.typeId === ENEMY_SPLITTER) {
        for (let corner = 0; corner < 6; corner += 1) {
          const angle = (corner / 6) * TAU;
          const px = Math.cos(angle) * radius;
          const py = Math.sin(angle) * radius;
          if (corner === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
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

  private drawArcs(ctx: CanvasRenderingContext2D, sim: NaiveSim): void {
    for (let i = 0; i < sim.arcs.length; i += 1) {
      const arc = sim.arcs[i];
      ctx.save();
      ctx.globalAlpha = Math.min(1, arc.life * 7);
      ctx.strokeStyle = arc.color;
      ctx.lineWidth = 2.5;
      ctx.shadowBlur = 8;
      ctx.shadowColor = arc.color;
      ctx.beginPath();
      ctx.moveTo(arc.x1, arc.y1);
      // A single mid-point kink is enough to read as lightning.
      ctx.lineTo(
        (arc.x1 + arc.x2) / 2 + (arc.y2 - arc.y1) * 0.12,
        (arc.y1 + arc.y2) / 2 - (arc.x2 - arc.x1) * 0.12
      );
      ctx.lineTo(arc.x2, arc.y2);
      ctx.stroke();
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
