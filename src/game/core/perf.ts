/**
 * Frame timing instrumentation.
 *
 * The number that matters is the *frame interval* — wall-clock time between
 * consecutive animation frames — because that is what the player actually
 * perceives, and it includes browser work (compositing, GC) that happens
 * outside our own callbacks. CPU time spent inside `step` and `render` is
 * tracked separately as a diagnostic: it tells us *why* an interval was long.
 *
 * Percentiles come from a fixed-size histogram rather than a list of samples.
 * That keeps the cost O(1) per frame with zero allocation, and means a
 * measurement window can run for an entire 50-wave game without growing.
 */

/** Below this, we are under 45 FPS. */
export const FRAME_BUDGET_45FPS_MS = 1000 / 45;
/** The assignment's hard ceiling: fewer than 5% of frames may exceed this. */
export const FRAME_BUDGET_LIMIT_MS = 33;

/**
 * An interval this long is not a slow frame — the tab was hidden, the machine
 * slept, or a debugger was attached. Counting it would poison the window
 * average for minutes, so it is tallied separately instead of silently kept.
 */
export const STALL_THRESHOLD_MS = 500;

const BUCKET_MS = 0.5;
const BUCKET_COUNT = 256; // covers 0..128ms, with a final overflow bucket
const RECENT_SAMPLES = 180;
const EMA_WEIGHT = 0.08;

export interface PerfSnapshot {
  /** Average FPS across the whole measurement window. */
  fps: number;
  /** Smoothed instantaneous FPS, for a readout that reacts quickly. */
  fpsInstant: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  worstMs: number;
  /** Percentage of frames slower than 45 FPS. */
  over45Pct: number;
  /** Percentage of frames slower than 33ms. */
  over33Pct: number;
  /** Smoothed CPU cost of the simulation, in ms per frame. */
  simMs: number;
  /** Smoothed CPU cost of rendering, in ms per frame. */
  renderMs: number;
  /**
   * Smoothed total CPU time we spend inside the frame callback. Well below the
   * frame interval means we are waiting on vsync rather than on our own work.
   */
  cpuMs: number;
  /** Smoothed number of simulation ticks executed per frame. */
  ticksPerFrame: number;
  /** Intervals excluded as stalls rather than counted as slow frames. */
  stalls: number;
  frames: number;
  windowSeconds: number;
}

export class PerfMonitor {
  /** Ring buffer of recent frame intervals, for the live graph. */
  readonly recent = new Float32Array(RECENT_SAMPLES);
  recentCursor = 0;

  private readonly histogram = new Uint32Array(BUCKET_COUNT + 1);
  private readonly now: () => number;

  private frames = 0;
  private intervalSum = 0;
  private worst = 0;
  private over45 = 0;
  private over33 = 0;
  private stalls = 0;

  private lastTimestamp = 0;
  private hasLastTimestamp = false;

  private frameStartCpu = 0;
  private simEma = 0;
  private renderEma = 0;
  private cpuEma = 0;
  private ticksEma = 0;
  private intervalEma = 1000 / 60;

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? (() => performance.now());
  }

  /** `timestamp` is the animation-frame timestamp, not `performance.now()`. */
  beginFrame(timestamp: number): void {
    if (this.hasLastTimestamp) {
      const interval = timestamp - this.lastTimestamp;
      if (interval > STALL_THRESHOLD_MS) this.stalls += 1;
      else if (interval > 0) this.record(interval);
    } else {
      this.hasLastTimestamp = true;
    }
    this.lastTimestamp = timestamp;
    this.frameStartCpu = this.now();
  }

  recordSim(ms: number, ticks: number): void {
    this.simEma += (ms - this.simEma) * EMA_WEIGHT;
    this.ticksEma += (ticks - this.ticksEma) * EMA_WEIGHT;
  }

  recordRender(ms: number): void {
    this.renderEma += (ms - this.renderEma) * EMA_WEIGHT;
  }

  endFrame(): void {
    const cpu = this.now() - this.frameStartCpu;
    this.cpuEma += (cpu - this.cpuEma) * EMA_WEIGHT;
  }

  /** Starts a fresh measurement window. Call this before a benchmark run. */
  reset(): void {
    this.histogram.fill(0);
    this.recent.fill(0);
    this.recentCursor = 0;
    this.frames = 0;
    this.intervalSum = 0;
    this.worst = 0;
    this.over45 = 0;
    this.over33 = 0;
    this.stalls = 0;
    this.hasLastTimestamp = false;
  }

  snapshot(): PerfSnapshot {
    const frames = this.frames;
    // Window length is the sum of measured intervals, not elapsed wall-clock
    // time, so excluded stalls do not drag the average down.
    const windowSeconds = this.intervalSum / 1000;
    return {
      fps: windowSeconds > 0 ? frames / windowSeconds : 0,
      fpsInstant: this.intervalEma > 0 ? 1000 / this.intervalEma : 0,
      avgMs: frames > 0 ? this.intervalSum / frames : 0,
      p50Ms: this.percentile(0.5),
      p95Ms: this.percentile(0.95),
      p99Ms: this.percentile(0.99),
      worstMs: this.worst,
      over45Pct: frames > 0 ? (this.over45 / frames) * 100 : 0,
      over33Pct: frames > 0 ? (this.over33 / frames) * 100 : 0,
      simMs: this.simEma,
      renderMs: this.renderEma,
      cpuMs: this.cpuEma,
      ticksPerFrame: this.ticksEma,
      stalls: this.stalls,
      frames,
      windowSeconds,
    };
  }

  private record(interval: number): void {
    this.frames += 1;
    this.intervalSum += interval;
    if (interval > this.worst) this.worst = interval;
    if (interval > FRAME_BUDGET_45FPS_MS) this.over45 += 1;
    if (interval > FRAME_BUDGET_LIMIT_MS) this.over33 += 1;

    const bucket = Math.min(BUCKET_COUNT, (interval / BUCKET_MS) | 0);
    this.histogram[bucket] += 1;

    this.recent[this.recentCursor] = interval;
    this.recentCursor = (this.recentCursor + 1) % RECENT_SAMPLES;

    this.intervalEma += (interval - this.intervalEma) * EMA_WEIGHT;
  }

  /** Upper edge of the bucket containing the requested percentile. */
  private percentile(fraction: number): number {
    if (this.frames === 0) return 0;
    const target = Math.ceil(fraction * this.frames);
    let seen = 0;
    for (let i = 0; i <= BUCKET_COUNT; i += 1) {
      seen += this.histogram[i];
      if (seen >= target) {
        return i === BUCKET_COUNT ? this.worst : (i + 1) * BUCKET_MS;
      }
    }
    return this.worst;
  }
}
