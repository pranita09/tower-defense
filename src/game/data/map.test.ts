import { describe, expect, it } from 'vitest';
import {
  BASE_POSITION,
  GRID_COLS,
  GRID_ROWS,
  isBuildable,
  PATH,
  PATH_LENGTH,
  samplePath,
  TILE_SIZE,
} from './map';

describe('path geometry', () => {
  it('walks the whole route from spawn to base', () => {
    expect(PATH.length).toBeGreaterThan(6);
    expect(PATH_LENGTH).toBeGreaterThan(2000);

    const start = samplePath(0);
    expect(start.x).toBeCloseTo(PATH[0].x, 5);
    expect(start.y).toBeCloseTo(PATH[0].y, 5);

    const end = samplePath(PATH_LENGTH);
    expect(end.x).toBeCloseTo(BASE_POSITION.x, 5);
    expect(end.y).toBeCloseTo(BASE_POSITION.y, 5);
  });

  it('clamps distances outside the route', () => {
    expect(samplePath(-500).x).toBeCloseTo(PATH[0].x, 5);
    expect(samplePath(PATH_LENGTH * 3).x).toBeCloseTo(BASE_POSITION.x, 5);
  });

  it('advances monotonically along the route', () => {
    let previous = samplePath(0);
    let travelled = 0;
    for (let distance = 25; distance <= PATH_LENGTH; distance += 25) {
      const point = samplePath(distance);
      travelled += Math.hypot(point.x - previous.x, point.y - previous.y);
      previous = { ...point };
    }
    // Sampling in straight-line hops can only under-measure a polyline.
    expect(travelled).toBeGreaterThan(PATH_LENGTH * 0.97);
    expect(travelled).toBeLessThanOrEqual(PATH_LENGTH + 1);
  });
});

describe('buildable tiles', () => {
  it('never allows building on the road itself', () => {
    for (let distance = 0; distance <= PATH_LENGTH; distance += TILE_SIZE / 2) {
      const point = samplePath(distance);
      const col = Math.floor(point.x / TILE_SIZE);
      const row = Math.floor(point.y / TILE_SIZE);
      expect(isBuildable(col, row)).toBe(false);
    }
  });

  it('rejects tiles outside the grid', () => {
    expect(isBuildable(-1, 4)).toBe(false);
    expect(isBuildable(4, -1)).toBe(false);
    expect(isBuildable(GRID_COLS, 4)).toBe(false);
    expect(isBuildable(4, GRID_ROWS)).toBe(false);
  });

  it('leaves plenty of room to build', () => {
    let buildable = 0;
    for (let row = 0; row < GRID_ROWS; row += 1) {
      for (let col = 0; col < GRID_COLS; col += 1) {
        if (isBuildable(col, row)) buildable += 1;
      }
    }
    const total = GRID_COLS * GRID_ROWS;
    expect(buildable).toBeGreaterThan(total * 0.5);
    // The stress scenario needs somewhere to put 100 towers.
    expect(buildable).toBeGreaterThan(100);
  });
});
