// Fixed-capacity slot allocator. A slot index is the entity's index in every
// parallel data array. Capacity is reserved once, removal is an O(1) swap rather
// than a `splice`, and each release bumps a generation counter so a projectile
// holding a stale slot is detected instead of hitting whatever moved in.
export class SlotPool {
  readonly capacity: number;
  // Dense list of live slots. Only the first `activeCount` entries are valid.
  readonly active: Int32Array;
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

  // Returns a slot index, or -1 when the pool is full.
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

  // True when the slot still holds the entity the caller remembered.
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
    // Reversed, so the first allocations hand out low slots and stay contiguous.
    for (let i = 0; i < this.capacity; i += 1) {
      this.free[i] = this.capacity - 1 - i;
    }
  }
}
