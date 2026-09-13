import type { PerfMonitor } from './perf';

/**
 * The one animation loop in the app. `step` always gets the same fixed delta so
 * the game plays identically at any refresh rate; `render` gets the leftover
 * fraction of a tick to interpolate with.
 */

export interface GameLoopHandlers {
  step: (delta: number, tick: number) => void;
  /** `alpha` is progress (0..1) from the previous tick to the latest. */
  render: (alpha: number) => void;
}

export interface GameLoopOptions {
  tickRate?: number;
  /** Caps catch-up work, so one slow frame cannot cascade into a spiral. */
  maxTicksPerFrame?: number;
  /** Longest real delta we will simulate. Hidden tabs report huge gaps. */
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

  /** Ticks abandoned because the loop could not keep up. */
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

  /** Runs more ticks per second, never larger ones. */
  setSpeed(multiplier: number): void {
    this.speed = multiplier > 0 ? multiplier : 1;
  }

  /** For tests, which supply their own clock. */
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
