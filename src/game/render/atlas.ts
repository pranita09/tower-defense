/**
 * The sprite atlas, generated at startup rather than shipped as an image.
 *
 * Every sprite lives in one texture so the whole frame can be drawn in a single
 * instanced draw call — switching textures would force a separate call per
 * sprite type and undo the batching entirely.
 *
 * Shapes are drawn in white with a mid-grey rim. The shader multiplies by a
 * per-instance colour, so one circle serves every enemy type and the rim comes
 * out as a darker shade of whatever tint is applied.
 */

export const ATLAS_SIZE = 256;
const CELL = 64;
const CELLS_PER_ROW = ATLAS_SIZE / CELL;
/** Content radius inside a cell, leaving room so filtering cannot bleed. */
const CONTENT_RADIUS = 30;
/** Quad half-extent needed to display a shape at a given logical radius. */
export const SHAPE_QUAD_SCALE = CELL / 2 / CONTENT_RADIUS;

export const SPRITE_PIXEL = 0;
export const SPRITE_CIRCLE = 1;
export const SPRITE_SQUARE = 2;
export const SPRITE_TRIANGLE = 3;
export const SPRITE_DIAMOND = 4;
export const SPRITE_HEX = 5;
export const SPRITE_GLOW = 6;
export const SPRITE_TOWER_BASE = 7;
export const SPRITE_BARREL = 8;
export const SPRITE_RING = 9;
export const SPRITE_SHADOW = 10;
export const SPRITE_COUNT = 11;

/** UV rectangles as [u0, v0, u1, v1], indexed by sprite id. */
export const SPRITE_UVS: Float32Array = new Float32Array(SPRITE_COUNT * 4);

const TAU = Math.PI * 2;

function cellOrigin(id: number): { x: number; y: number } {
  return { x: (id % CELLS_PER_ROW) * CELL, y: Math.floor(id / CELLS_PER_ROW) * CELL };
}

function setUvs(id: number, inset: number): void {
  const { x, y } = cellOrigin(id);
  const base = id * 4;
  SPRITE_UVS[base] = (x + inset) / ATLAS_SIZE;
  SPRITE_UVS[base + 1] = (y + inset) / ATLAS_SIZE;
  SPRITE_UVS[base + 2] = (x + CELL - inset) / ATLAS_SIZE;
  SPRITE_UVS[base + 3] = (y + CELL - inset) / ATLAS_SIZE;
}

function polygon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  sides: number,
  rotation: number
): void {
  ctx.beginPath();
  for (let i = 0; i < sides; i += 1) {
    const angle = rotation + (i / sides) * TAU;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function paintShape(ctx: CanvasRenderingContext2D, id: number, draw: () => void): void {
  const { x, y } = cellOrigin(id);
  ctx.save();
  ctx.translate(x + CELL / 2, y + CELL / 2);
  ctx.fillStyle = '#ffffff';
  // The rim is grey, so tinting turns it into a darker edge of the same hue.
  ctx.strokeStyle = '#8c8c8c';
  ctx.lineWidth = 3;
  draw();
  ctx.restore();
  setUvs(id, 1);
}

export function createAtlasCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_SIZE;
  canvas.height = ATLAS_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create the sprite atlas: no 2D context.');

  ctx.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);

  // A solid block, sampled from the middle so health bars and beams have clean
  // edges no matter how they are stretched.
  const pixelOrigin = cellOrigin(SPRITE_PIXEL);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(pixelOrigin.x, pixelOrigin.y, CELL, CELL);
  setUvs(SPRITE_PIXEL, CELL / 4);

  paintShape(ctx, SPRITE_CIRCLE, () => {
    ctx.beginPath();
    ctx.arc(0, 0, CONTENT_RADIUS - 1.5, 0, TAU);
    ctx.fill();
    ctx.stroke();
  });

  paintShape(ctx, SPRITE_SQUARE, () => {
    const size = (CONTENT_RADIUS - 1.5) * 1.72;
    ctx.beginPath();
    ctx.roundRect(-size / 2, -size / 2, size, size, 6);
    ctx.fill();
    ctx.stroke();
  });

  paintShape(ctx, SPRITE_TRIANGLE, () => {
    polygon(ctx, 0, 0, CONTENT_RADIUS - 1.5, 3, -Math.PI / 2);
    ctx.fill();
    ctx.stroke();
  });

  paintShape(ctx, SPRITE_DIAMOND, () => {
    polygon(ctx, 0, 0, CONTENT_RADIUS - 1.5, 4, -Math.PI / 2);
    ctx.fill();
    ctx.stroke();
  });

  paintShape(ctx, SPRITE_HEX, () => {
    polygon(ctx, 0, 0, CONTENT_RADIUS - 1.5, 6, 0);
    ctx.fill();
    ctx.stroke();
  });

  paintShape(ctx, SPRITE_TOWER_BASE, () => {
    const size = CONTENT_RADIUS * 1.6;
    ctx.beginPath();
    ctx.roundRect(-size / 2, -size / 2, size, size, 7);
    ctx.fillStyle = '#b4b4b4';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  });

  paintShape(ctx, SPRITE_BARREL, () => {
    ctx.beginPath();
    ctx.roundRect(
      -CONTENT_RADIUS * 0.35,
      -CONTENT_RADIUS * 0.28,
      CONTENT_RADIUS * 1.3,
      CONTENT_RADIUS * 0.56,
      5
    );
    ctx.fill();
  });

  paintShape(ctx, SPRITE_RING, () => {
    ctx.beginPath();
    ctx.arc(0, 0, CONTENT_RADIUS - 3, 0, TAU);
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  });

  // Soft radial falloffs for glows and shadows.
  paintShape(ctx, SPRITE_GLOW, () => {
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, CONTENT_RADIUS);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.35, 'rgba(255,255,255,0.75)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, CONTENT_RADIUS, 0, TAU);
    ctx.fill();
  });

  paintShape(ctx, SPRITE_SHADOW, () => {
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, CONTENT_RADIUS);
    gradient.addColorStop(0, 'rgba(255,255,255,0.85)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.ellipse(0, 0, CONTENT_RADIUS, CONTENT_RADIUS * 0.45, 0, 0, TAU);
    ctx.fill();
  });

  return canvas;
}
