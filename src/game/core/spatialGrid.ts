/**
 * Uniform grid over the battlefield, rebuilt every tick.
 *
 * Naive target acquisition asks "which enemies are near this tower?" by looking
 * at all of them: 100 towers times 5,000 enemies is half a million checks per
 * tick, and splash damage repeats the scan. This bins every enemy into a cell
 * once, in O(n), so a query only visits the cells its radius overlaps.
 *
 * The build is a counting sort into two flat typed arrays rather than an array
 * of per-cell arrays, so rebuilding it every tick allocates nothing.
 *
 * Queries expose `offsets` and `items` instead of taking a callback, because a
 * callback would mean either a closure allocation or a megamorphic call in the
 * hottest loop in the game.
 */
export class SpatialGrid {
  readonly cols: number;
  readonly rows: number;
  readonly cellSize: number;
  readonly invCellSize: number;
  /** Start index of each cell in `items`; length is cols * rows + 1. */
  readonly offsets: Int32Array;
  /** Entity slots, grouped by cell. */
  readonly items: Int32Array;

  private readonly cursor: Int32Array;
  private readonly originX: number;
  private readonly originY: number;

  constructor(
    width: number,
    height: number,
    cellSize: number,
    capacity: number,
    /** World padding, so entities spawning just off-map still land in a cell. */
    margin = 64
  ) {
    this.cellSize = cellSize;
    this.invCellSize = 1 / cellSize;
    this.originX = -margin;
    this.originY = -margin;
    this.cols = Math.ceil((width + margin * 2) / cellSize);
    this.rows = Math.ceil((height + margin * 2) / cellSize);
    this.offsets = new Int32Array(this.cols * this.rows + 1);
    this.cursor = new Int32Array(this.cols * this.rows);
    this.items = new Int32Array(capacity);
  }

  colOf(x: number): number {
    const col = ((x - this.originX) * this.invCellSize) | 0;
    return col < 0 ? 0 : col >= this.cols ? this.cols - 1 : col;
  }

  rowOf(y: number): number {
    const row = ((y - this.originY) * this.invCellSize) | 0;
    return row < 0 ? 0 : row >= this.rows ? this.rows - 1 : row;
  }

  /**
   * Bins `count` entities, read from `active` (a dense list of slots) plus the
   * position arrays.
   */
  build(active: Int32Array, count: number, xs: Float32Array, ys: Float32Array): void {
    const cellCount = this.cols * this.rows;
    const offsets = this.offsets;
    offsets.fill(0);

    // Pass 1: count per cell, offset by one so the prefix sum lands in place.
    for (let i = 0; i < count; i += 1) {
      const slot = active[i];
      const cell = this.rowOf(ys[slot]) * this.cols + this.colOf(xs[slot]);
      offsets[cell + 1] += 1;
    }

    // Pass 2: prefix sum turns counts into start indices.
    for (let cell = 0; cell < cellCount; cell += 1) {
      offsets[cell + 1] += offsets[cell];
      this.cursor[cell] = offsets[cell];
    }

    // Pass 3: scatter.
    for (let i = 0; i < count; i += 1) {
      const slot = active[i];
      const cell = this.rowOf(ys[slot]) * this.cols + this.colOf(xs[slot]);
      this.items[this.cursor[cell]] = slot;
      this.cursor[cell] += 1;
    }
  }

  clear(): void {
    this.offsets.fill(0);
  }
}
