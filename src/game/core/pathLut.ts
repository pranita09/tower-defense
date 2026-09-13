import {
  AIR_DIR_X,
  AIR_DIR_Y,
  AIR_LENGTH,
  AIR_START,
  PATH_LENGTH,
  samplePath,
  type PathPoint,
} from '../data/map';

/**
 * Precomputed path positions.
 *
 * An enemy's position is fully determined by one number: how far it has walked.
 * The naive simulation recovers a position by stepping through waypoints with a
 * square root per step; this table turns the same question into two array reads
 * and a lerp, with no branching on segment boundaries.
 *
 * It also shrinks the per-enemy state. Movement becomes `distance += speed * dt`,
 * so there is no direction vector to store or renormalise, and a corner is
 * handled by the table rather than by per-enemy bookkeeping.
 */

const SAMPLE_STEP = 4;

export class PathLut {
  /** Sampled x positions, one every `step` world pixels. */
  readonly xs: Float32Array;
  readonly ys: Float32Array;
  readonly step: number;
  readonly invStep: number;
  readonly length: number;
  /** Highest safe index for `i` when reading `i` and `i + 1`. */
  readonly maxIndex: number;

  constructor(
    length: number,
    step: number,
    sample: (distance: number, out: PathPoint) => PathPoint
  ) {
    this.length = length;
    this.step = step;
    this.invStep = 1 / step;

    const count = Math.floor(length / step) + 2;
    this.xs = new Float32Array(count);
    this.ys = new Float32Array(count);
    this.maxIndex = count - 2;

    const out: PathPoint = { x: 0, y: 0, segment: 0 };
    for (let i = 0; i < count; i += 1) {
      sample(Math.min(i * step, length), out);
      this.xs[i] = out.x;
      this.ys[i] = out.y;
    }
  }

  /**
   * Convenience lookup for callers outside the hot loop. The simulation reads
   * `xs`/`ys` directly so it can share the index arithmetic between both axes.
   */
  positionAt(distance: number, out: { x: number; y: number }): void {
    let t = distance * this.invStep;
    if (t < 0) t = 0;
    else if (t > this.maxIndex) t = this.maxIndex;
    const index = t | 0;
    const fraction = t - index;
    out.x = this.xs[index] + (this.xs[index + 1] - this.xs[index]) * fraction;
    out.y = this.ys[index] + (this.ys[index + 1] - this.ys[index]) * fraction;
  }
}

/** The road that ground enemies walk. */
export const GROUND_LUT = new PathLut(PATH_LENGTH, SAMPLE_STEP, samplePath);

/**
 * Flyers take a straight line, so their positions need no table at all — the
 * same distance scalar drives a plain linear equation.
 */
export const AIR_ORIGIN_X = AIR_START.x;
export const AIR_ORIGIN_Y = AIR_START.y;
export const AIR_STEP_X = AIR_DIR_X;
export const AIR_STEP_Y = AIR_DIR_Y;
export const AIR_ROUTE_LENGTH = AIR_LENGTH;
