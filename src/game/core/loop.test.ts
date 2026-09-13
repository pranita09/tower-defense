import { describe, expect, it } from 'vitest';
import { GameLoop, type GameLoopOptions } from './loop';

/**
 * The loop is driven by an injected clock and scheduler, so a "second of
 * gameplay at 144Hz" is just a list of timestamps. No real frames involved.
 */
function harness(options: Partial<GameLoopOptions> = {}) {
  const stepDeltas: number[] = [];
  const alphas: number[] = [];
  let clock = 0;

  const loop = new GameLoop(
    {
      step: (delta) => stepDeltas.push(delta),
      render: (alpha) => alphas.push(alpha),
    },
    {
      now: () => clock,
      scheduleFrame: () => 0,
      cancelFrame: () => {},
      ...options,
    }
  );

  // The first frame establishes the baseline timestamp and simulates nothing.
  loop.runFrame(0);

  return {
    loop,
    stepDeltas,
    alphas,
    /** Feeds `frames` animation frames spaced `intervalMs` apart. */
    advance(frames: number, intervalMs: number) {
      for (let i = 0; i < frames; i += 1) {
        clock += intervalMs;
        loop.runFrame(clock);
      }
    },
  };
}

describe('GameLoop fixed timestep', () => {
  it('simulates the same amount of time on 60Hz and 144Hz displays', () => {
    const at60 = harness();
    at60.advance(60, 1000 / 60);

    const at144 = harness();
    at144.advance(144, 1000 / 144);

    // A second of real time is a second of simulated time either way. Both may
    // land one tick short because the leftover sits in the accumulator, which
    // is exactly what the render interpolation factor is for.
    expect(at60.loop.tickCount).toBeGreaterThanOrEqual(59);
    expect(at60.loop.tickCount).toBeLessThanOrEqual(60);
    expect(Math.abs(at60.loop.tickCount - at144.loop.tickCount)).toBeLessThanOrEqual(1);
  });

  it('always steps with an identical delta', () => {
    const { advance, stepDeltas, loop } = harness();
    advance(40, 7);
    advance(20, 25);

    expect(stepDeltas.length).toBeGreaterThan(0);
    for (const delta of stepDeltas) {
      expect(delta).toBeCloseTo(loop.fixedDelta, 12);
    }
  });

  it('runs proportionally more ticks at higher speed without changing tick size', () => {
    const { loop, advance, stepDeltas } = harness();
    loop.setSpeed(4);
    advance(60, 1000 / 60);

    expect(loop.tickCount).toBeGreaterThanOrEqual(239);
    expect(loop.tickCount).toBeLessThanOrEqual(240);
    expect(stepDeltas.every((delta) => delta === loop.fixedDelta)).toBe(true);
  });

  it('never renders an interpolation factor outside 0..1', () => {
    const { advance, alphas } = harness();
    advance(200, 11.3);

    for (const alpha of alphas) {
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThan(1);
    }
  });
});

describe('GameLoop catch-up safety', () => {
  it('clamps a long stall instead of fast-forwarding it', () => {
    const { loop, advance } = harness({ maxFrameDelta: 0.25, maxTicksPerFrame: 12 });
    advance(1, 10_000); // ten seconds in a backgrounded tab

    // 0.25s of clamped time is 15 ticks, of which only 12 may run in one frame.
    expect(loop.tickCount).toBe(12);
    expect(loop.droppedTicks).toBe(3);
  });

  it('does not accumulate a backlog when frames are slower than the tick rate', () => {
    const { loop, advance } = harness({ maxTicksPerFrame: 2 });
    advance(30, 100); // 10 FPS, i.e. six ticks owed per frame

    // Each frame runs its two ticks and discards the rest, so the loop stays
    // responsive rather than spiralling.
    expect(loop.tickCount).toBe(60);
    expect(loop.droppedTicks).toBeGreaterThan(0);
  });
});

describe('GameLoop pause', () => {
  it('stops stepping but keeps rendering', () => {
    const { loop, advance, stepDeltas, alphas } = harness();
    advance(10, 1000 / 60);
    const ticksBeforePause = stepDeltas.length;
    const framesBeforePause = alphas.length;

    loop.pause();
    advance(10, 1000 / 60);

    expect(stepDeltas.length).toBe(ticksBeforePause);
    expect(alphas.length).toBe(framesBeforePause + 10);
    expect(loop.isPaused).toBe(true);
  });

  it('does not owe the simulation the time spent paused', () => {
    const { loop, advance } = harness();
    loop.pause();
    advance(1, 5000);
    loop.resume();
    advance(1, 1000 / 60);

    expect(loop.tickCount).toBe(1);
  });
});
