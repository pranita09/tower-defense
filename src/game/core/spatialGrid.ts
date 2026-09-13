// Uniform grid rebuilt every tick, so targeting visits only the cells a radius
// overlaps instead of all 5,000 enemies. The build is a counting sort into flat
// typed arrays, so it allocates nothing.
//
// Callers read `offsets` and `items` directly rather than passing a callback,
// which would cost a closure or a megamorphic call in the hottest loop here.

export class SpatialGrid {
  readonly cols: number;
  readonly rows: number;
  readonly cellSize: number;
  readonly invCellSize: number;
  // Start index of each cell in `items`; length is cols * rows + 1.
  readonly offsets: Int32Array;
  // Entity slots, grouped by cell.
  readonly items: Int32Array;

  private readonly cursor: Int32Array;
  private readonly originX: number;
  private readonly originY: number;

  constructor(
    width: number,
    height: number,
    cellSize: number,
    capacity: number,
    // World padding, so entities spawning just off-map still land in a cell.
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

  build(active: Int32Array, count: number, xs: Float32Array, ys: Float32Array): void {
    const cellCount = this.cols * this.rows;
    const offsets = this.offsets;
    offsets.fill(0);

    // Count per cell, offset by one so the prefix sum lands in place.
    for (let i = 0; i < count; i += 1) {
      const slot = active[i];
      const cell = this.rowOf(ys[slot]) * this.cols + this.colOf(xs[slot]);
      offsets[cell + 1] += 1;
    }

    // Prefix sum turns counts into start indices.
    for (let cell = 0; cell < cellCount; cell += 1) {
      offsets[cell + 1] += offsets[cell];
      this.cursor[cell] = offsets[cell];
    }

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
