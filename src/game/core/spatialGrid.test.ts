import { describe, expect, it } from 'vitest';
import { SpatialGrid } from './spatialGrid';

// Collects everything the grid reports inside a circle.
function queryCircle(
  grid: SpatialGrid,
  x: number,
  y: number,
  radius: number,
  xs: Float32Array,
  ys: Float32Array
): number[] {
  const found: number[] = [];
  const colStart = grid.colOf(x - radius);
  const colEnd = grid.colOf(x + radius);
  const rowStart = grid.rowOf(y - radius);
  const rowEnd = grid.rowOf(y + radius);

  for (let row = rowStart; row <= rowEnd; row += 1) {
    for (let col = colStart; col <= colEnd; col += 1) {
      const cell = row * grid.cols + col;
      const end = grid.offsets[cell + 1];
      for (let k = grid.offsets[cell]; k < end; k += 1) {
        const slot = grid.items[k];
        const dx = xs[slot] - x;
        const dy = ys[slot] - y;
        if (dx * dx + dy * dy <= radius * radius) found.push(slot);
      }
    }
  }
  return found.sort((a, b) => a - b);
}

// The scan the naive simulation performs, used as the reference answer.
function bruteForce(
  count: number,
  x: number,
  y: number,
  radius: number,
  xs: Float32Array,
  ys: Float32Array
): number[] {
  const found: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const dx = xs[i] - x;
    const dy = ys[i] - y;
    if (dx * dx + dy * dy <= radius * radius) found.push(i);
  }
  return found;
}

describe('SpatialGrid', () => {
  it('bins every entity exactly once', () => {
    const grid = new SpatialGrid(256, 256, 64, 16, 0);
    const xs = new Float32Array([10, 70, 200, 250]);
    const ys = new Float32Array([10, 70, 30, 250]);
    const active = new Int32Array([0, 1, 2, 3]);

    grid.build(active, 4, xs, ys);

    const total = grid.offsets[grid.cols * grid.rows];
    expect(total).toBe(4);
    expect(Array.from(grid.items.subarray(0, 4)).sort()).toEqual([0, 1, 2, 3]);
  });

  it('returns the same answers as a full scan, for many random layouts', () => {
    const count = 400;
    const xs = new Float32Array(count);
    const ys = new Float32Array(count);
    const active = new Int32Array(count);

    // Deterministic spread, including off-world points so edge clamping is covered.
    let seed = 12345;
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    for (let i = 0; i < count; i += 1) {
      xs[i] = random() * 1400 - 60;
      ys[i] = random() * 800 - 60;
      active[i] = i;
    }

    const grid = new SpatialGrid(1280, 704, 64, count, 128);
    grid.build(active, count, xs, ys);

    for (let probe = 0; probe < 40; probe += 1) {
      const x = random() * 1280;
      const y = random() * 704;
      const radius = 40 + random() * 260;
      expect(queryCircle(grid, x, y, radius, xs, ys)).toEqual(
        bruteForce(count, x, y, radius, xs, ys)
      );
    }
  });

  it('visits far fewer candidates than a full scan', () => {
    const count = 5000;
    const xs = new Float32Array(count);
    const ys = new Float32Array(count);
    const active = new Int32Array(count);
    for (let i = 0; i < count; i += 1) {
      xs[i] = (i * 37) % 1280;
      ys[i] = (i * 53) % 704;
      active[i] = i;
    }

    const grid = new SpatialGrid(1280, 704, 64, count, 128);
    grid.build(active, count, xs, ys);

    // Count everything the query touches, not just what it accepts.
    const radius = 112;
    let visited = 0;
    const colStart = grid.colOf(640 - radius);
    const colEnd = grid.colOf(640 + radius);
    const rowStart = grid.rowOf(352 - radius);
    const rowEnd = grid.rowOf(352 + radius);
    for (let row = rowStart; row <= rowEnd; row += 1) {
      for (let col = colStart; col <= colEnd; col += 1) {
        const cell = row * grid.cols + col;
        visited += grid.offsets[cell + 1] - grid.offsets[cell];
      }
    }

    expect(visited).toBeGreaterThan(0);
    expect(visited).toBeLessThan(count / 8);
  });

  it('rebuilds cleanly, without carrying stale entries', () => {
    const grid = new SpatialGrid(256, 256, 64, 8, 0);
    const xs = new Float32Array([10, 70, 200]);
    const ys = new Float32Array([10, 70, 30]);

    grid.build(new Int32Array([0, 1, 2]), 3, xs, ys);
    grid.build(new Int32Array([0]), 1, xs, ys);

    expect(grid.offsets[grid.cols * grid.rows]).toBe(1);
  });
});
