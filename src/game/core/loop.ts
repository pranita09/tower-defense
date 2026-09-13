import type { PerfMonitor } from './perf';

/**
 * The single animation loop for the entire game.
 *
 * Two rules drive the design:
 *
 * 1. There is exactly one `requestAnimationFrame` in the app. No entity ever
 *    owns a timer; towers, spawners and effects are all counters advanced
 *    inside `step`.
 *
 * 2. Simulation time is decoupled from display time. `step` is always handed
 *    the same fixed delta, no matter how often the browser decides to paint,
 *    so the game plays identically on a 60Hz laptop and a 144Hz monitor.
 *    `render` receives an interpolation factor and is responsible for drawing
 *    a smooth in-between of the last two simulation states.
 */

export interface GameLoopHandlers {
  /** Advance the simulation by exactly `delta` seconds. */
  step: (delta: number, tick: number) => void;
  /** Draw the world. `alpha` is progress (0..1) from the previous tick to the latest. */
  render: (alpha: number) => void;
}

export interface GameLoopOptions {
  /** Logical simulation ticks per second. */
  tickRate?: number;
  /**
   * Upper bound on catch-up ticks in a single frame. Without this, one slow
   * frame makes the next frame do more work, which makes it slower still.
   */
  maxTicksPerFrame?: number;
  /**
   * Longest real delta we are willing to simulate, in seconds. Backgrounded
   * tabs report huge gaps; we treat them as a short pause instead of
   * fast-forwarding minutes of gameplay.
   */
  maxFrameDelta?: number;
  perf?: PerfMonitor;
  now?: () => number;
  scheduleFrame?: (callback: (time: number) => void) => number;
  cancelFrame?: (handle: number) => void;
}

export const DEFAULT_TICK_RATE = 60;

export class GameLoop {
  /** Seconds of simulated time per tick. Never varies. */
  readonly fixedDelta: number;

  private readonly handlers: GameLoopHandlers;
  private readonly maxTicksPerFrame: number;
  private readonly maxFrameDelta: number;
  private readonly perf?: PerfMonitor;
  private readonly now: () => number;
  private readonly scheduleFrame: (callback: (time: number) => void) => number;
  private readonly cancelFrame: (handle: number) => void;

  private accumulator = 0;
  private alpha = 0;
  private tick = 0;
  private speed = 1;
  private paused = false;
  private running = false;
  private frameHandle = 0;
  private lastTime = 0;
  private hasLastTime = false;

  /** Ticks abandoned because the loop could not keep up. Useful as a health signal. */
  droppedTicks = 0;

  constructor(handlers: GameLoopHandlers, options: GameLoopOptions = {}) {
    this.handlers = handlers;
    this.fixedDelta = 1 / (options.tickRate ?? DEFAULT_TICK_RATE);
    this.maxTicksPerFrame = options.maxTicksPerFrame ?? 12;
    this.maxFrameDelta = options.maxFrameDelta ?? 0.25;
    this.perf = options.perf;
    this.now = options.now ?? (() => performance.now());
    this.scheduleFrame = options.scheduleFrame ?? ((callback) => requestAnimationFrame(callback));
    this.cancelFrame = options.cancelFrame ?? ((handle) => cancelAnimationFrame(handle));
  }

  get isRunning(): boolean {
    return this.running;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get tickCount(): number {
    return this.tick;
  }

  get speedMultiplier(): number {
    return this.speed;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.hasLastTime = false;
    this.frameHandle = this.scheduleFrame(this.onFrame);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.cancelFrame(this.frameHandle);
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    // Drop the backlog: time spent paused is not owed to the simulation.
    this.accumulator = 0;
  }

  togglePause(): boolean {
    if (this.paused) this.resume();
    else this.pause();
    return this.paused;
  }

  /**
   * Fast-forward by running more ticks per second. Tick size is untouched, so
   * 4x speed is genuinely four times the simulation, not four times as coarse.
   */
  setSpeed(multiplier: number): void {
    this.speed = multiplier > 0 ? multiplier : 1;
  }

  /** Runs a frame by hand. Only used by tests, which supply their own clock. */
  runFrame(time: number): void {
    this.advance(time);
  }

  private onFrame = (time: number): void => {
    if (!this.running) return;
    // Re-arm first so a throw in game code cannot kill the loop permanently.
    this.frameHandle = this.scheduleFrame(this.onFrame);
    this.advance(time);
  };

  private advance(time: number): void {
    const perf = this.perf;
    perf?.beginFrame(time);

    let delta = this.hasLastTime ? (time - this.lastTime) / 1000 : 0;
    this.lastTime = time;
    this.hasLastTime = true;
    if (delta < 0) delta = 0;
    else if (delta > this.maxFrameDelta) delta = this.maxFrameDelta;

    if (!this.paused) {
      this.accumulator += delta * this.speed;

      const start = this.now();
      let ticks = 0;
      while (this.accumulator >= this.fixedDelta && ticks < this.maxTicksPerFrame) {
        this.handlers.step(this.fixedDelta, this.tick);
        this.accumulator -= this.fixedDelta;
        this.tick += 1;
        ticks += 1;
      }
      if (this.accumulator >= this.fixedDelta) {
        this.droppedTicks += Math.floor(this.accumulator / this.fixedDelta);
        this.accumulator %= this.fixedDelta;
      }
      perf?.recordSim(this.now() - start, ticks);

      this.alpha = this.accumulator / this.fixedDelta;
    }

    const renderStart = this.now();
    this.handlers.render(this.alpha);
    perf?.recordRender(this.now() - renderStart);

    perf?.endFrame();
  }
}
