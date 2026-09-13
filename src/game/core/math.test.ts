import { describe, expect, it } from 'vitest';
import { clamp, distanceSquared, lerp } from './math';

describe('clamp', () => {
  it('keeps values inside the range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(42, 0, 10)).toBe(10);
  });
});

describe('lerp', () => {
  it('interpolates between the endpoints', () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
    expect(lerp(0, 10, 0.25)).toBe(2.5);
  });
});

describe('distanceSquared', () => {
  it('returns the squared euclidean distance', () => {
    expect(distanceSquared(0, 0, 3, 4)).toBe(25);
    expect(distanceSquared(1, 1, 1, 1)).toBe(0);
  });
});
