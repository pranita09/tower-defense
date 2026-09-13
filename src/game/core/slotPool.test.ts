import { describe, expect, it } from 'vitest';
import { SlotPool } from './slotPool';

describe('SlotPool', () => {
  it('hands out every slot and refuses to overflow', () => {
    const pool = new SlotPool(3);
    expect([pool.alloc(), pool.alloc(), pool.alloc()]).toEqual([0, 1, 2]);
    expect(pool.alloc()).toBe(-1);
    expect(pool.activeCount).toBe(3);
    expect(pool.freeSlots).toBe(0);
  });

  it('keeps the active list dense after a release from the middle', () => {
    const pool = new SlotPool(4);
    for (let i = 0; i < 4; i += 1) pool.alloc();

    pool.release(1);

    expect(pool.activeCount).toBe(3);
    const live = Array.from(pool.active.subarray(0, pool.activeCount)).sort();
    expect(live).toEqual([0, 2, 3]);
    expect(pool.isLive(1)).toBe(false);
  });

  it('survives releasing every slot while iterating backwards', () => {
    const pool = new SlotPool(64);
    for (let i = 0; i < 64; i += 1) pool.alloc();

    // This is exactly the pattern the simulation's compaction pass uses.
    for (let i = pool.activeCount - 1; i >= 0; i -= 1) pool.release(pool.active[i]);

    expect(pool.activeCount).toBe(0);
    expect(pool.freeSlots).toBe(64);
  });

  it('reuses freed slots', () => {
    const pool = new SlotPool(2);
    const first = pool.alloc();
    pool.release(first);
    expect(pool.alloc()).toBe(first);
  });

  it('invalidates references to a recycled slot', () => {
    const pool = new SlotPool(1);
    const slot = pool.alloc();
    const generation = pool.generation[slot];
    expect(pool.matches(slot, generation)).toBe(true);

    pool.release(slot);
    const reused = pool.alloc();

    // Same slot, different entity: the stale reference must not match.
    expect(reused).toBe(slot);
    expect(pool.matches(slot, generation)).toBe(false);
    expect(pool.matches(slot, pool.generation[slot])).toBe(true);
  });

  it('ignores a double release', () => {
    const pool = new SlotPool(2);
    const slot = pool.alloc();
    pool.release(slot);
    pool.release(slot);
    expect(pool.freeSlots).toBe(2);
  });

  it('clears everything on reset', () => {
    const pool = new SlotPool(8);
    for (let i = 0; i < 5; i += 1) pool.alloc();
    pool.reset();
    expect(pool.activeCount).toBe(0);
    expect(pool.freeSlots).toBe(8);
    expect(pool.alloc()).toBe(0);
  });
});
