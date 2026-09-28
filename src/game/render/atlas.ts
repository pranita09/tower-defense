/**
 * Sprite atlas, generated at startup. One texture for everything so the whole
 * frame stays a single instanced draw. Shapes are white with a grey rim so the
 * shader can tint them; silhouettes carry the character.
 */

export const ATLAS_SIZE = 512;
const CELL = 64;
const CELLS_PER_ROW = ATLAS_SIZE / CELL;
const CONTENT_RADIUS = 30;
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
export const SPRITE_GRUNT = 11;
export const SPRITE_RUNNER = 12;
export const SPRITE_JUGGERNAUT = 13;
export const SPRITE_WISP = 14;
export const SPRITE_SPLITTER = 15;
export const SPRITE_GUN = 16;
export const SPRITE_MORTAR = 17;
export const SPRITE_FROST = 18;
export const SPRITE_TESLA = 19;
export const SPRITE_RAIL = 20;
export const SPRITE_CORE = 21;
export const SPRITE_COUNT = 22;

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
  ctx.strokeStyle = '#8c8c8c';
  ctx.lineWidth = 2.4;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  draw();
  ctx.restore();
  setUvs(id, 1);
}

function fillStroke(ctx: CanvasRenderingContext2D): void {
  ctx.fill();
  ctx.stroke();
}

export function createAtlasCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_SIZE;
  canvas.height = ATLAS_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create the sprite atlas: no 2D context.');

  ctx.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);

  const pixelOrigin = cellOrigin(SPRITE_PIXEL);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(pixelOrigin.x, pixelOrigin.y, CELL, CELL);
  setUvs(SPRITE_PIXEL, CELL / 4);

  paintShape(ctx, SPRITE_CIRCLE, () => {
    ctx.beginPath();
    ctx.arc(0, 0, CONTENT_RADIUS - 1.5, 0, TAU);
    fillStroke(ctx);
  });

  paintShape(ctx, SPRITE_SQUARE, () => {
    const size = (CONTENT_RADIUS - 1.5) * 1.72;
    ctx.beginPath();
    ctx.roundRect(-size / 2, -size / 2, size, size, 6);
    fillStroke(ctx);
  });

  paintShape(ctx, SPRITE_TRIANGLE, () => {
    polygon(ctx, 0, 0, CONTENT_RADIUS - 1.5, 3, -Math.PI / 2);
    fillStroke(ctx);
  });

  paintShape(ctx, SPRITE_DIAMOND, () => {
    polygon(ctx, 0, 0, CONTENT_RADIUS - 1.5, 4, -Math.PI / 2);
    fillStroke(ctx);
  });

  paintShape(ctx, SPRITE_HEX, () => {
    polygon(ctx, 0, 0, CONTENT_RADIUS - 1.5, 6, 0);
    fillStroke(ctx);
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

  paintShape(ctx, SPRITE_GRUNT, () => {
    ctx.beginPath();
    ctx.arc(0, 3, 16, 0, TAU);
    fillStroke(ctx);
    ctx.beginPath();
    ctx.roundRect(-14, -18, 28, 16, 5);
    fillStroke(ctx);
    ctx.fillStyle = '#7a7a7a';
    ctx.fillRect(-10, -12, 20, 5);
    ctx.beginPath();
    ctx.arc(-11, 10, 5, 0, TAU);
    ctx.arc(11, 10, 5, 0, TAU);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.stroke();
  });

  paintShape(ctx, SPRITE_RUNNER, () => {
    ctx.beginPath();
    ctx.moveTo(0, -22);
    ctx.lineTo(12, 4);
    ctx.lineTo(7, 20);
    ctx.lineTo(0, 12);
    ctx.lineTo(-7, 20);
    ctx.lineTo(-12, 4);
    ctx.closePath();
    fillStroke(ctx);
    ctx.beginPath();
    ctx.moveTo(-8, 2);
    ctx.lineTo(-18, 16);
    ctx.moveTo(8, 2);
    ctx.lineTo(18, 16);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -8, 4, 0, TAU);
    ctx.fillStyle = '#7a7a7a';
    ctx.fill();
  });

  paintShape(ctx, SPRITE_JUGGERNAUT, () => {
    ctx.beginPath();
    ctx.roundRect(-18, -16, 36, 34, 4);
    fillStroke(ctx);
    ctx.beginPath();
    ctx.roundRect(-22, -10, 10, 18, 3);
    ctx.roundRect(12, -10, 10, 18, 3);
    fillStroke(ctx);
    ctx.fillStyle = '#6e6e6e';
    ctx.fillRect(-10, -8, 20, 6);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-6, 8, 12, 8);
  });

  paintShape(ctx, SPRITE_WISP, () => {
    ctx.beginPath();
    ctx.ellipse(-16, 2, 10, 16, -0.5, 0, TAU);
    ctx.ellipse(16, 2, 10, 16, 0.5, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, TAU);
    ctx.fillStyle = '#ffffff';
    fillStroke(ctx);
    ctx.beginPath();
    ctx.arc(0, 0, 6, 0, TAU);
    ctx.fillStyle = '#9a9a9a';
    ctx.fill();
  });

  paintShape(ctx, SPRITE_SPLITTER, () => {
    polygon(ctx, 0, 2, 16, 6, 0);
    fillStroke(ctx);
    for (const [x, y] of [
      [0, -18],
      [-16, 12],
      [16, 12],
    ] as const) {
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, TAU);
      fillStroke(ctx);
    }
  });

  paintShape(ctx, SPRITE_GUN, () => {
    ctx.beginPath();
    ctx.arc(0, 4, 16, 0, TAU);
    fillStroke(ctx);
    ctx.beginPath();
    ctx.roundRect(-6, -22, 12, 20, 4);
    fillStroke(ctx);
    ctx.beginPath();
    ctx.arc(0, 4, 6, 0, TAU);
    ctx.fillStyle = '#7a7a7a';
    ctx.fill();
  });

  paintShape(ctx, SPRITE_MORTAR, () => {
    ctx.beginPath();
    ctx.roundRect(-16, 2, 32, 16, 6);
    fillStroke(ctx);
    ctx.save();
    ctx.rotate(-0.55);
    ctx.beginPath();
    ctx.roundRect(-6, -24, 12, 28, 5);
    fillStroke(ctx);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(0, 8, 5, 0, TAU);
    ctx.fillStyle = '#7a7a7a';
    ctx.fill();
  });

  paintShape(ctx, SPRITE_FROST, () => {
    for (let i = 0; i < 6; i += 1) {
      const angle = (i / 6) * TAU;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(angle) * 22, Math.sin(angle) * 22);
      ctx.lineWidth = 3.2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * 12, Math.sin(angle) * 12);
      ctx.lineTo(
        Math.cos(angle) * 12 + Math.cos(angle + 0.9) * 7,
        Math.sin(angle) * 12 + Math.sin(angle + 0.9) * 7
      );
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, 0, 7, 0, TAU);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#8c8c8c';
    ctx.lineWidth = 2.4;
    fillStroke(ctx);
  });

  paintShape(ctx, SPRITE_TESLA, () => {
    ctx.beginPath();
    ctx.roundRect(-10, 8, 20, 12, 3);
    fillStroke(ctx);
    ctx.beginPath();
    ctx.moveTo(-8, 8);
    ctx.lineTo(-4, -6);
    ctx.lineTo(4, -6);
    ctx.lineTo(8, 8);
    ctx.closePath();
    fillStroke(ctx);
    ctx.beginPath();
    ctx.arc(0, -12, 9, 0, TAU);
    fillStroke(ctx);
    ctx.beginPath();
    ctx.arc(0, -12, 3.5, 0, TAU);
    ctx.fillStyle = '#7a7a7a';
    ctx.fill();
  });

  paintShape(ctx, SPRITE_RAIL, () => {
    ctx.beginPath();
    ctx.roundRect(-8, 6, 16, 14, 3);
    fillStroke(ctx);
    ctx.beginPath();
    ctx.roundRect(-4, -24, 8, 34, 3);
    fillStroke(ctx);
    ctx.beginPath();
    ctx.roundRect(-7, -26, 14, 8, 2);
    fillStroke(ctx);
  });

  paintShape(ctx, SPRITE_CORE, () => {
    polygon(ctx, 0, 0, 22, 4, -Math.PI / 2);
    fillStroke(ctx);
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, TAU);
    ctx.fillStyle = '#ffffff';
    fillStroke(ctx);
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, TAU);
    ctx.fillStyle = '#7a7a7a';
    ctx.fill();
  });

  return canvas;
}
