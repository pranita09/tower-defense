import type { Camera } from '../core/camera';
import {
  ENEMY_ARMORED,
  ENEMY_DEFS,
  ENEMY_FLYER,
  ENEMY_GRUNT,
  ENEMY_RUNNER,
  ENEMY_SPLITTER,
} from '../data/enemies';
import { BASE_POSITION, TILE_SIZE, WORLD_HEIGHT, WORLD_WIDTH } from '../data/map';
import {
  COLOR_DANGER,
  COLOR_FROST,
  COLOR_GOOD,
  COLOR_WARN,
  COLOR_WHITE,
  ENEMY_COLORS,
  TOWER_ACCENTS,
  TOWER_COLORS,
  unpackBlue,
  unpackGreen,
  unpackRed,
} from '../data/palette';
import { TOWER_DEFS } from '../data/towers';
import {
  createAtlasCanvas,
  SHAPE_QUAD_SCALE,
  SPRITE_CIRCLE,
  SPRITE_DIAMOND,
  SPRITE_GLOW,
  SPRITE_HEX,
  SPRITE_PIXEL,
  SPRITE_RING,
  SPRITE_SHADOW,
  SPRITE_SQUARE,
  SPRITE_TOWER_BASE,
  SPRITE_TRIANGLE,
  SPRITE_BARREL,
} from '../render/atlas';
import { BackgroundQuad } from '../render/backgroundQuad';
import { SpriteBatch } from '../render/spriteBatch';
import { createTerrainCanvas } from '../render/terrain';
import type { CanvasViewport } from '../render/viewport';
import { MAX_ARCS, MAX_LABELS, MAX_PARTICLES, type FastSim } from './fastSim';

/**
 * The optimized renderer. Everything dynamic is appended to one instance buffer
 * and issued as a single draw call; everything static is baked into a texture and
 * drawn as one quad. Off-screen sprites never reach the buffer, and detail work
 * drops out on its own once the field gets crowded.
 *
 * Text is the one thing WebGL is bad at, so damage numbers and a few vector
 * flourishes go on a transparent 2D canvas on top. That layer only ever handles a
 * bounded number of items, so it cannot scale with the enemy count.
 */

const SPRITE_CAPACITY = 32_768;

/** Above this many enemies, per-enemy detail is dropped to protect frame time. */
const DETAIL_ENEMY_LIMIT = 1400;
/** Health bars are pointless below this on-screen radius. */
const MIN_BAR_RADIUS_PX = 5;

function spriteForEnemy(typeId: number): number {
  switch (typeId) {
    case ENEMY_RUNNER:
      return SPRITE_TRIANGLE;
    case ENEMY_ARMORED:
      return SPRITE_SQUARE;
    case ENEMY_FLYER:
      return SPRITE_DIAMOND;
    case ENEMY_SPLITTER:
      return SPRITE_HEX;
    case ENEMY_GRUNT:
    default:
      return SPRITE_CIRCLE;
  }
}

/** Sprite id per enemy type, resolved once instead of per entity per frame. */
const ENEMY_SPRITES: readonly number[] = ENEMY_DEFS.map((_, index) => spriteForEnemy(index));

/** Small-integer strings, cached so damage labels allocate nothing per frame. */
const SMALL_NUMBERS: readonly string[] = Array.from({ length: 1000 }, (_, i) => String(i));

function formatValue(value: number): string {
  const rounded = value | 0;
  return rounded >= 0 && rounded < SMALL_NUMBERS.length ? SMALL_NUMBERS[rounded] : String(rounded);
}

function cssColor(packed: number, alpha: number): string {
  const r = (unpackRed(packed) * 255) | 0;
  const g = (unpackGreen(packed) * 255) | 0;
  const b = (unpackBlue(packed) * 255) | 0;
  return `rgba(${r},${g},${b},${alpha})`;
}

export interface HoverState {
  col: number;
  row: number;
  typeId: number;
  valid: boolean;
}

export interface RenderStats {
  sprites: number;
  culled: number;
  drawCalls: number;
}

export class FastRenderer {
  readonly stats: RenderStats = { sprites: 0, culled: 0, drawCalls: 0 };

  private readonly gl: WebGL2RenderingContext;
  private readonly overlay: CanvasRenderingContext2D;
  private readonly batch: SpriteBatch;
  private readonly background: BackgroundQuad;

  constructor(gl: WebGL2RenderingContext, overlay: CanvasRenderingContext2D) {
    this.gl = gl;
    this.overlay = overlay;

    this.batch = new SpriteBatch(gl, createAtlasCanvas(), SPRITE_CAPACITY);
    this.background = new BackgroundQuad(gl, createTerrainCanvas(), WORLD_WIDTH, WORLD_HEIGHT);

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0.031, 0.043, 0.071, 1);
  }

  resize(viewport: CanvasViewport): void {
    this.gl.viewport(0, 0, viewport.pixelWidth, viewport.pixelHeight);
  }

  draw(
    sim: FastSim,
    viewport: CanvasViewport,
    camera: Camera,
    alpha: number,
    hover: HoverState | null,
    selectedTowerIndex: number
  ): void {
    const gl = this.gl;
    gl.clear(gl.COLOR_BUFFER_BIT);

    const shakeX = sim.shake > 0 ? (Math.random() - 0.5) * sim.shake * 9 : 0;
    const shakeY = sim.shake > 0 ? (Math.random() - 0.5) * sim.shake * 9 : 0;

    const scaleX = (2 * camera.scale) / viewport.cssWidth;
    const scaleY = (-2 * camera.scale) / viewport.cssHeight;
    const offsetX = (2 * (camera.offsetX + shakeX)) / viewport.cssWidth - 1;
    const offsetY = 1 - (2 * (camera.offsetY + shakeY)) / viewport.cssHeight;

    this.background.draw(scaleX, scaleY, offsetX, offsetY);

    const margin = 48;
    this.batch.setCullBounds(
      camera.minX - margin,
      camera.minY - margin,
      camera.maxX + margin,
      camera.maxY + margin
    );
    this.batch.begin();

    this.pushBase(sim);
    if (hover) this.pushHover(hover);
    this.pushTowers(sim, selectedTowerIndex);
    this.pushEnemies(sim, camera, alpha);
    this.pushProjectiles(sim, alpha);
    this.pushParticles(sim);

    this.batch.flush(scaleX, scaleY, offsetX, offsetY);

    this.stats.sprites = this.batch.count;
    this.stats.culled = this.batch.culled;
    // One quad for the static layer, one instanced call for everything else.
    this.stats.drawCalls = 2;

    this.drawOverlay(sim, viewport, camera, shakeX, shakeY, hover, selectedTowerIndex);
  }

  private pushBase(sim: FastSim): void {
    const fraction = Math.max(0, sim.health / sim.maxHealth);
    const color = fraction > 0.35 ? 0x4cc9f0 : COLOR_DANGER;
    this.batch.push(SPRITE_GLOW, BASE_POSITION.x, BASE_POSITION.y, 34, 34, 0, color, 0.16);
    this.batch.push(SPRITE_DIAMOND, BASE_POSITION.x, BASE_POSITION.y, 19, 21, 0, color, 1);
    this.batch.push(SPRITE_RING, BASE_POSITION.x, BASE_POSITION.y, 27, 27, 0, color, 0.5);
  }

  private pushHover(hover: HoverState): void {
    const x = hover.col * TILE_SIZE + TILE_SIZE / 2;
    const y = hover.row * TILE_SIZE + TILE_SIZE / 2;
    const color = hover.valid ? TOWER_COLORS[hover.typeId] : COLOR_DANGER;
    this.batch.push(SPRITE_TOWER_BASE, x, y, TILE_SIZE * 0.44, TILE_SIZE * 0.44, 0, color, 0.4);
  }

  private pushTowers(sim: FastSim, selectedIndex: number): void {
    for (let i = 0; i < sim.towerCount; i += 1) {
      const typeId = sim.tType[i];
      const x = sim.tX[i];
      const y = sim.tY[i];
      const color = TOWER_COLORS[typeId];

      this.batch.push(SPRITE_TOWER_BASE, x, y, TILE_SIZE * 0.42, TILE_SIZE * 0.42, 0, color, 1);

      // Recoil pushes the barrel back along its own facing.
      const recoil = sim.tRecoil[i] * 3;
      const rotation = sim.tRotation[i];
      const barrelX = x - Math.cos(rotation) * recoil;
      const barrelY = y - Math.sin(rotation) * recoil;
      const length = 11 + sim.tLevel[i] * 2.5;
      this.batch.push(
        SPRITE_BARREL,
        barrelX,
        barrelY,
        length,
        7,
        rotation,
        TOWER_ACCENTS[typeId],
        1
      );

      // Level pips, so upgrades are visible on the board itself.
      for (let pip = 0; pip < sim.tLevel[i]; pip += 1) {
        this.batch.push(
          SPRITE_PIXEL,
          x - 6 + pip * 6,
          y + TILE_SIZE * 0.36,
          2,
          2,
          0,
          TOWER_ACCENTS[typeId],
          0.95
        );
      }

      if (i === selectedIndex) {
        this.batch.push(SPRITE_RING, x, y, TILE_SIZE * 0.5, TILE_SIZE * 0.5, 0, COLOR_WHITE, 0.85);
      }
    }
  }

  private pushEnemies(sim: FastSim, camera: Camera, alpha: number): void {
    const active = sim.enemies.active;
    const count = sim.enemies.activeCount;
    const detailed = count <= DETAIL_ENEMY_LIMIT;

    for (let i = 0; i < count; i += 1) {
      const slot = active[i];
      const x = sim.ePrevX[slot] + (sim.eX[slot] - sim.ePrevX[slot]) * alpha;
      const y = sim.ePrevY[slot] + (sim.eY[slot] - sim.ePrevY[slot]) * alpha;
      const radius = sim.eRadius[slot];
      const typeId = sim.eType[slot];
      const slowed = sim.eSlowTimer[slot] > 0;
      const boss = sim.isBoss(slot);

      if (detailed && sim.isFlying(slot)) {
        this.batch.push(
          SPRITE_SHADOW,
          x + 2,
          y + radius + 8,
          radius * 1.1,
          radius * 0.6,
          0,
          0,
          0.4
        );
      }

      // Facing is a nicety, so it is the first thing dropped under load.
      const rotation =
        detailed && (typeId === ENEMY_RUNNER || typeId === ENEMY_FLYER)
          ? Math.atan2(sim.eY[slot] - sim.ePrevY[slot], sim.eX[slot] - sim.ePrevX[slot]) +
            Math.PI / 2
          : 0;

      const quad = radius * SHAPE_QUAD_SCALE;
      this.batch.push(
        ENEMY_SPRITES[typeId],
        x,
        y,
        quad,
        quad,
        rotation,
        slowed ? COLOR_FROST : ENEMY_COLORS[typeId],
        1
      );

      if (boss) {
        this.batch.push(SPRITE_RING, x, y, radius * 1.45, radius * 1.45, 0, COLOR_WARN, 0.8);
      }

      const screenRadius = radius * camera.scale;
      if (!detailed || screenRadius < MIN_BAR_RADIUS_PX) continue;

      const fraction = sim.eHp[slot] / sim.eMaxHp[slot];
      if (fraction >= 0.999 && !boss) continue;

      const barWidth = radius * 2.2;
      const barY = y - radius - 6;
      this.batch.push(SPRITE_PIXEL, x, barY, barWidth / 2, 2, 0, 0x101820, 0.85);
      const fillWidth = barWidth * Math.max(0, fraction);
      this.batch.push(
        SPRITE_PIXEL,
        x - barWidth / 2 + fillWidth / 2,
        barY,
        fillWidth / 2,
        1.4,
        0,
        fraction > 0.5 ? COLOR_GOOD : fraction > 0.25 ? COLOR_WARN : COLOR_DANGER,
        1
      );
    }
  }

  private pushProjectiles(sim: FastSim, alpha: number): void {
    const active = sim.projectiles.active;
    const count = sim.projectiles.activeCount;

    for (let i = 0; i < count; i += 1) {
      const slot = active[i];
      const x = sim.pPrevX[slot] + (sim.pX[slot] - sim.pPrevX[slot]) * alpha;
      const y = sim.pPrevY[slot] + (sim.pY[slot] - sim.pPrevY[slot]) * alpha;
      const kind = sim.pKind[slot];
      const size = sim.pSplash[slot] > 0 ? 5.5 : 3.2;

      // A texture read, not a `shadowBlur`, which is what the naive renderer does.
      this.batch.push(SPRITE_GLOW, x, y, size * 2.6, size * 2.6, 0, TOWER_ACCENTS[kind], 0.4);
      this.batch.push(SPRITE_CIRCLE, x, y, size, size, 0, TOWER_ACCENTS[kind], 1);
    }
  }

  private pushParticles(sim: FastSim): void {
    for (let i = 0; i < MAX_PARTICLES; i += 1) {
      const life = sim.cLife[i];
      if (life <= 0) continue;
      const fade = life / sim.cMaxLife[i];
      const size = sim.cSize[i] * fade;
      this.batch.push(SPRITE_CIRCLE, sim.cX[i], sim.cY[i], size, size, 0, sim.cColor[i], fade);
    }
  }

  /** The 2D layer. Bounded by buffer size or selection, never by entity count. */
  private drawOverlay(
    sim: FastSim,
    viewport: CanvasViewport,
    camera: Camera,
    shakeX: number,
    shakeY: number,
    hover: HoverState | null,
    selectedTowerIndex: number
  ): void {
    const ctx = this.overlay;
    const dpr = viewport.dpr;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, viewport.cssWidth, viewport.cssHeight);

    const scale = dpr * camera.scale;
    ctx.setTransform(
      scale,
      0,
      0,
      scale,
      dpr * (camera.offsetX + shakeX),
      dpr * (camera.offsetY + shakeY)
    );

    if (selectedTowerIndex >= 0) {
      const def = TOWER_DEFS[sim.tType[selectedTowerIndex]];
      const stats = def.levels[sim.tLevel[selectedTowerIndex] - 1];
      ctx.beginPath();
      ctx.arc(sim.tX[selectedTowerIndex], sim.tY[selectedTowerIndex], stats.range, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
      ctx.lineWidth = 1.5 / camera.scale;
      ctx.stroke();
    }

    if (hover) {
      const def = TOWER_DEFS[hover.typeId];
      const x = hover.col * TILE_SIZE + TILE_SIZE / 2;
      const y = hover.row * TILE_SIZE + TILE_SIZE / 2;
      ctx.beginPath();
      ctx.arc(x, y, def.levels[0].range, 0, Math.PI * 2);
      ctx.strokeStyle = hover.valid ? 'rgba(76, 201, 240, 0.35)' : 'rgba(255, 93, 93, 0.35)';
      ctx.lineWidth = 1.5 / camera.scale;
      ctx.stroke();
    }

    for (let i = 0; i < MAX_ARCS; i += 1) {
      const life = sim.aLife[i];
      if (life <= 0) continue;
      ctx.globalAlpha = Math.min(1, life * 7);
      ctx.strokeStyle = cssColor(sim.aColor[i], 1);
      ctx.lineWidth = 2.4 / camera.scale;
      ctx.beginPath();
      const x1 = sim.aX1[i];
      const y1 = sim.aY1[i];
      const x2 = sim.aX2[i];
      const y2 = sim.aY2[i];
      ctx.moveTo(x1, y1);
      ctx.lineTo((x1 + x2) / 2 + (y2 - y1) * 0.12, (y1 + y2) / 2 - (x2 - x1) * 0.12);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    const fontSize = Math.max(9, 11 / camera.scale);
    ctx.font = `600 ${fontSize}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    for (let i = 0; i < MAX_LABELS; i += 1) {
      const life = sim.lLife[i];
      if (life <= 0) continue;
      ctx.globalAlpha = Math.min(1, life * 2.2);
      ctx.fillStyle = cssColor(sim.lColor[i], 1);
      ctx.fillText(`+${formatValue(sim.lValue[i])}`, sim.lX[i], sim.lY[i]);
    }
    ctx.globalAlpha = 1;
  }

  dispose(): void {
    this.batch.dispose();
    this.background.dispose();
  }
}
