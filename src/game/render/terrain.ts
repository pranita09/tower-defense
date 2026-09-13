import {
  GRID_COLS,
  GRID_ROWS,
  isBuildable,
  PATH,
  TILE_SIZE,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '../data/map';

/**
 * The static layer: terrain tiles and the road.
 *
 * Nothing in here ever changes, which makes it a clean illustration of the
 * difference between the two renderers. The naive one calls this every frame,
 * paying for roughly 250 tile fills and four wide stroked polylines 60 times a
 * second. The optimized one calls it once into an offscreen canvas, uploads the
 * result as a texture, and then redraws the whole battlefield as a single quad.
 *
 * Both share this function so the two modes look identical and the video is
 * comparing performance rather than art.
 */
export function paintTerrain(ctx: CanvasRenderingContext2D): void {
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

/** Renders the static layer once, at world resolution, ready to be uploaded. */
export function createTerrainCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = WORLD_WIDTH;
  canvas.height = WORLD_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not pre-render the terrain: no 2D context.');
  paintTerrain(ctx);
  return canvas;
}
