import { lerp } from './core/math';
import type { CanvasViewport } from './render/viewport';

/**
 * A stand-in scene used to validate the loop before the real simulation exists.
 *
 * It exercises the three things that are easy to get wrong and hard to notice
 * later: that movement is tied to simulated time rather than frame count, that
 * rendering interpolates between ticks instead of snapping, and that pause and
 * speed controls affect the simulation without freezing the renderer.
 *
 * The pace marker crosses the field in exactly four simulated seconds, which
 * makes the speed multipliers verifiable with a stopwatch.
 *
 * Replaced by the real simulation in the next step.
 */

const PACE_SECONDS = 4;

export class LoopProbe {
  private capacity: number;
  private count: number;

  private prevX: Float32Array;
  private prevY: Float32Array;
  private posX: Float32Array;
  private posY: Float32Array;
  private velX: Float32Array;
  private velY: Float32Array;
  private size: Float32Array;
  private tint: Uint8Array;

  private width = 1;
  private height = 1;
  private simTime = 0;
  private pacePrev = 0;
  private pace = 0;

  constructor(count = 600, capacity = 200_000) {
    this.capacity = Math.max(count, capacity);
    this.count = count;
    this.prevX = new Float32Array(this.capacity);
    this.prevY = new Float32Array(this.capacity);
    this.posX = new Float32Array(this.capacity);
    this.posY = new Float32Array(this.capacity);
    this.velX = new Float32Array(this.capacity);
    this.velY = new Float32Array(this.capacity);
    this.size = new Float32Array(this.capacity);
    this.tint = new Uint8Array(this.capacity);
    for (let i = 0; i < this.capacity; i += 1) this.seed(i);
  }

  get activeCount(): number {
    return this.count;
  }

  get simulatedSeconds(): number {
    return this.simTime;
  }

  setCount(count: number): void {
    this.count = Math.max(0, Math.min(this.capacity, count));
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    for (let i = 0; i < this.capacity; i += 1) {
      if (this.posX[i] === 0 && this.posY[i] === 0) {
        this.posX[i] = Math.random() * this.width;
        this.posY[i] = Math.random() * this.height;
      } else {
        this.posX[i] = Math.min(this.posX[i], this.width);
        this.posY[i] = Math.min(this.posY[i], this.height);
      }
      this.prevX[i] = this.posX[i];
      this.prevY[i] = this.posY[i];
    }
  }

  step(delta: number): void {
    this.simTime += delta;
    const width = this.width;
    const height = this.height;
    const count = this.count;

    for (let i = 0; i < count; i += 1) {
      const x = this.posX[i] + this.velX[i] * delta;
      const y = this.posY[i] + this.velY[i] * delta;
      this.prevX[i] = this.posX[i];
      this.prevY[i] = this.posY[i];

      if (x < 0 || x > width) this.velX[i] = -this.velX[i];
      if (y < 0 || y > height) this.velY[i] = -this.velY[i];

      this.posX[i] = x < 0 ? 0 : x > width ? width : x;
      this.posY[i] = y < 0 ? 0 : y > height ? height : y;
    }

    this.pacePrev = this.pace;
    this.pace = (this.pace + delta / PACE_SECONDS) % 1;
    // Keep interpolation sane across the wrap-around.
    if (this.pace < this.pacePrev) this.pacePrev = this.pace;
  }

  render(ctx: CanvasRenderingContext2D, viewport: CanvasViewport, alpha: number): void {
    const { cssWidth: width, cssHeight: height, dpr } = viewport;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // The context is opaque, so the background is painted rather than cleared.
    ctx.fillStyle = '#0b0f17';
    ctx.fillRect(0, 0, width, height);

    this.drawGrid(ctx, width, height);

    const count = this.count;
    // One fill colour per pass so the 2D context is not restyled per entity.
    for (let bucket = 0; bucket < TINTS.length; bucket += 1) {
      ctx.fillStyle = TINTS[bucket];
      for (let i = 0; i < count; i += 1) {
        if (this.tint[i] !== bucket) continue;
        const x = lerp(this.prevX[i], this.posX[i], alpha);
        const y = lerp(this.prevY[i], this.posY[i], alpha);
        const s = this.size[i];
        ctx.fillRect(x - s * 0.5, y - s * 0.5, s, s);
      }
    }

    this.drawPaceMarker(ctx, width, height, alpha);
  }

  private drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.strokeStyle = 'rgba(76, 201, 240, 0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= width; x += 32) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, height);
    }
    for (let y = 0; y <= height; y += 32) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(width, y + 0.5);
    }
    ctx.stroke();
  }

  private drawPaceMarker(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    alpha: number
  ): void {
    const t = lerp(this.pacePrev, this.pace, alpha);
    const y = height - 40;

    ctx.strokeStyle = 'rgba(230, 236, 245, 0.15)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();

    ctx.fillStyle = '#ffc94d';
    ctx.beginPath();
    ctx.arc(t * width, y, 7, 0, Math.PI * 2);
    ctx.fill();
  }

  private seed(i: number): void {
    const speed = 40 + Math.random() * 120;
    const angle = Math.random() * Math.PI * 2;
    this.velX[i] = Math.cos(angle) * speed;
    this.velY[i] = Math.sin(angle) * speed;
    this.size[i] = 3 + Math.random() * 4;
    this.tint[i] = Math.floor(Math.random() * TINTS.length);
  }
}

const TINTS = ['#4cc9f0', '#5ddf8f', '#ffa94d', '#ff5d5d'] as const;
