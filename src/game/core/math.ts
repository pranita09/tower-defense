/**
 * Small numeric helpers used by the simulation.
 *
 * These are deliberately allocation-free and take plain numbers rather than
 * vector objects: everything in the hot loop reads from flat typed arrays, so
 * there is nothing to wrap.
 */

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Squared distance, so range checks never need a square root. */
export function distanceSquared(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}
