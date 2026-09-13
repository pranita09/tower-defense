/**
 * The battlefield: a fixed-size tile grid with a hand-authored path from the
 * spawn point to the base.
 *
 * World coordinates are always these logical pixels, never screen pixels. The
 * camera scales them to fit the window, so gameplay is identical on every
 * display size and a saved click position means the same thing everywhere.
 */

export const TILE_SIZE = 32;
export const GRID_COLS = 40;
export const GRID_ROWS = 22;
export const WORLD_WIDTH = GRID_COLS * TILE_SIZE;
export const WORLD_HEIGHT = GRID_ROWS * TILE_SIZE;

/**
 * Path corners in tile coordinates. The first point sits outside the grid so
 * enemies walk in from off-screen; the last is the base.
 *
 * The route deliberately doubles back several times: corners are where enemies
 * linger inside a tower's range, so they are the interesting places to build.
 */
const WAYPOINT_TILES: readonly (readonly [number, number])[] = [
  [-1, 2],
  [6, 2],
  [6, 8],
  [14, 8],
  [14, 3],
  [22, 3],
  [22, 12],
  [10, 12],
  [10, 17],
  [28, 17],
  [28, 7],
  [34, 7],
  [34, 19],
  [40, 19],
];

export interface Waypoint {
  x: number;
  y: number;
}

/** Path corners in world pixels, at tile centres. */
export const PATH: readonly Waypoint[] = WAYPOINT_TILES.map(([col, row]) => ({
  x: col * TILE_SIZE + TILE_SIZE / 2,
  y: row * TILE_SIZE + TILE_SIZE / 2,
}));

/** Cumulative distance to the start of each segment, plus the total at the end. */
export const SEGMENT_OFFSETS: readonly number[] = (() => {
  const offsets: number[] = [0];
  for (let i = 1; i < PATH.length; i += 1) {
    const dx = PATH[i].x - PATH[i - 1].x;
    const dy = PATH[i].y - PATH[i - 1].y;
    offsets.push(offsets[i - 1] + Math.hypot(dx, dy));
  }
  return offsets;
})();

/** Total walking distance from spawn to base, in world pixels. */
export const PATH_LENGTH = SEGMENT_OFFSETS[SEGMENT_OFFSETS.length - 1];

export const BASE_POSITION: Waypoint = PATH[PATH.length - 1];

/**
 * Flying enemies ignore the road and take the straight line from the spawn
 * point to the base, so their position is also a function of one distance
 * scalar — just along a different route.
 */
export const AIR_START: Waypoint = PATH[0];
export const AIR_LENGTH = Math.hypot(BASE_POSITION.x - AIR_START.x, BASE_POSITION.y - AIR_START.y);
export const AIR_DIR_X = (BASE_POSITION.x - AIR_START.x) / AIR_LENGTH;
export const AIR_DIR_Y = (BASE_POSITION.y - AIR_START.y) / AIR_LENGTH;

export function airPathX(distance: number): number {
  return AIR_START.x + AIR_DIR_X * distance;
}

export function airPathY(distance: number): number {
  return AIR_START.y + AIR_DIR_Y * distance;
}

/**
 * Tiles covered by the path, which cannot be built on.
 *
 * Built by walking the polyline and marking every tile the centre line passes
 * through, plus its perpendicular neighbours, so the road reads as a corridor
 * roughly two tiles wide rather than a one-tile line.
 */
export const BLOCKED_TILES: Uint8Array = (() => {
  const blocked = new Uint8Array(GRID_COLS * GRID_ROWS);
  const mark = (col: number, row: number) => {
    if (col < 0 || row < 0 || col >= GRID_COLS || row >= GRID_ROWS) return;
    blocked[row * GRID_COLS + col] = 1;
  };

  const step = TILE_SIZE / 4;
  for (let distance = 0; distance <= PATH_LENGTH; distance += step) {
    const point = samplePath(distance);
    const col = Math.floor(point.x / TILE_SIZE);
    const row = Math.floor(point.y / TILE_SIZE);
    mark(col, row);
    mark(col, row - 1);
    mark(col, row + 1);
    mark(col - 1, row);
    mark(col + 1, row);
  }
  return blocked;
})();

export function isBuildable(col: number, row: number): boolean {
  if (col < 0 || row < 0 || col >= GRID_COLS || row >= GRID_ROWS) return false;
  return BLOCKED_TILES[row * GRID_COLS + col] === 0;
}

export function tileCentreX(col: number): number {
  return col * TILE_SIZE + TILE_SIZE / 2;
}

export function tileCentreY(row: number): number {
  return row * TILE_SIZE + TILE_SIZE / 2;
}

export interface PathPoint {
  x: number;
  y: number;
  /** Index of the waypoint being walked towards. */
  segment: number;
}

/**
 * Position at a given distance along the path.
 *
 * This walks the segment list, which is fine for the handful of calls made
 * during setup. The per-enemy movement in the simulation does *not* use it.
 */
export function samplePath(
  distance: number,
  out: PathPoint = { x: 0, y: 0, segment: 0 }
): PathPoint {
  const clamped = distance < 0 ? 0 : distance > PATH_LENGTH ? PATH_LENGTH : distance;

  let segment = 1;
  while (segment < SEGMENT_OFFSETS.length - 1 && SEGMENT_OFFSETS[segment] < clamped) {
    segment += 1;
  }

  const from = PATH[segment - 1];
  const to = PATH[segment];
  const segmentStart = SEGMENT_OFFSETS[segment - 1];
  const segmentLength = SEGMENT_OFFSETS[segment] - segmentStart;
  const t = segmentLength > 0 ? (clamped - segmentStart) / segmentLength : 0;

  out.x = from.x + (to.x - from.x) * t;
  out.y = from.y + (to.y - from.y) * t;
  out.segment = segment;
  return out;
}
