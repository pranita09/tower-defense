// Mulberry32. The simulation never calls `Math.random`, so a stress run can be
// repeated exactly — the difference between a benchmark and an anecdote.
export class Rng {
  private state: number;

  constructor(seed = 0x9e3779b9) {
    this.state = seed >>> 0;
  }

  // Uniform in [0, 1).
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Uniform in [min, max).
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  // Uniform integer in [0, max).
  int(max: number): number {
    return Math.floor(this.next() * max);
  }
}
