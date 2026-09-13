/**
 * Fixed-capacity slot allocator for entities stored in parallel typed arrays.
 *
 * Entities are identified by a slot index, which is also their index in every
 * data array. Three problems get solved here:
 *
 * - **No allocation.** Capacity is reserved once at startup, so a wave of 200
 *   deaths creates no garbage and the heap stays flat for a whole run.
 * - **O(1) removal.** Nothing is `splice`d. A freed slot goes onto a stack for
 *   reuse, and the dense `active` list is compacted by swapping in its tail.
 * - **Safe references.** Projectiles point at a target by slot, and a slot gets
 *   reused. Each release bumps a generation counter, so a stale reference is
 *   detected instead of silently hitting whatever moved in.
 */
export class SlotPool {
  readonly capacity: number;
  /** Dense list of live slots. Only the first `activeCount` entries are valid. */
  readonly active: Int32Array;
  /** Bumped whenever a slot is released, to invalidate old references. */
  readonly generation: Uint16Array;

  activeCount = 0;

  private readonly free: Int32Array;
  private readonly activeIndex: Int32Array;
  private readonly live: Uint8Array;
  private freeCount: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.active = new Int32Array(capacity);
    this.generation = new Uint16Array(capacity);
    this.free = new Int32Array(capacity);
    this.activeIndex = new Int32Array(capacity);
    this.live = new Uint8Array(capacity);
    this.freeCount = capacity;
    this.fillFreeStack();
  }

  get freeSlots(): number {
    return this.freeCount;
  }

  /** Returns a slot index, or -1 when the pool is full. */
  alloc(): number {
    if (this.freeCount === 0) return -1;
    this.freeCount -= 1;
    const slot = this.free[this.freeCount];
    this.live[slot] = 1;
    this.activeIndex[slot] = this.activeCount;
    this.active[this.activeCount] = slot;
    this.activeCount += 1;
    return slot;
  }

  release(slot: number): void {
    if (this.live[slot] === 0) return;
    this.live[slot] = 0;
    this.generation[slot] = (this.generation[slot] + 1) & 0xffff;

    // Swap the tail of the active list into the hole.
    const index = this.activeIndex[slot];
    const last = this.activeCount - 1;
    const moved = this.active[last];
    this.active[index] = moved;
    this.activeIndex[moved] = index;
    this.activeCount = last;

    this.free[this.freeCount] = slot;
    this.freeCount += 1;
  }

  isLive(slot: number): boolean {
    return slot >= 0 && slot < this.capacity && this.live[slot] === 1;
  }

  /** True when the slot is still occupied by the entity the caller remembered. */
  matches(slot: number, generation: number): boolean {
    return this.isLive(slot) && this.generation[slot] === generation;
  }

  reset(): void {
    this.live.fill(0);
    this.activeCount = 0;
    this.freeCount = this.capacity;
    this.fillFreeStack();
  }

  private fillFreeStack(): void {
    // Reverse order so the first allocations hand out low slots, which keeps
    // early iteration contiguous and cache-friendly.
    for (let i = 0; i < this.capacity; i += 1) {
      this.free[i] = this.capacity - 1 - i;
    }
  }
}
