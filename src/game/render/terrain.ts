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
 * Terrain tiles and the road. Nothing here ever changes: the naive renderer
 * repaints it every frame, the optimized one bakes it into a texture once. Both
 * share this function so the two modes look identical.
 */
export function paintTerrain(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#0d1520';
  ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      if (!isBuildable(col, row)) continue;
      const x = col * TILE_SIZE;
      const y = row * TILE_SIZE;
      ctx.fillStyle = (col + row) % 2 === 0 ? '#1a2838' : '#162230';
      ctx.fillRect(x, y, TILE_SIZE - 1, TILE_SIZE - 1);
      ctx.fillStyle = 'rgba(93, 223, 143, 0.05)';
      ctx.fillRect(x + 2, y + 2, 4, 4);
    }
  }

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  ctx.beginPath();
  ctx.moveTo(PATH[0].x, PATH[0].y);
  for (let i = 1; i < PATH.length; i += 1) ctx.lineTo(PATH[i].x, PATH[i].y);

  ctx.strokeStyle = '#1a140e';
  ctx.lineWidth = TILE_SIZE * 1.9;
  ctx.stroke();

  ctx.strokeStyle = '#3a2a1c';
  ctx.lineWidth = TILE_SIZE * 1.55;
  ctx.stroke();

  ctx.strokeStyle = '#5a4330';
  ctx.lineWidth = TILE_SIZE * 1.15;
  ctx.stroke();

  ctx.setLineDash([10, 14]);
  ctx.strokeStyle = 'rgba(255, 201, 77, 0.28)';
  ctx.lineWidth = 2.2;
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
