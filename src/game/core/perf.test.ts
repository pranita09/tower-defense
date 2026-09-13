import { describe, expect, it } from 'vitest';
import { PerfMonitor } from './perf';

/** Feeds a list of frame intervals (ms) through the monitor. */
function feed(monitor: PerfMonitor, intervals: number[]): void {
  let timestamp = 0;
  monitor.beginFrame(timestamp);
  monitor.endFrame();
  for (const interval of intervals) {
    timestamp += interval;
    monitor.beginFrame(timestamp);
    monitor.endFrame();
  }
}

function repeat(value: number, times: number): number[] {
  return new Array<number>(times).fill(value);
}

describe('PerfMonitor', () => {
  it('reports average FPS from the measurement window', () => {
    const monitor = new PerfMonitor({ now: () => 0 });
    feed(monitor, repeat(1000 / 60, 60));

    const snapshot = monitor.snapshot();
    expect(snapshot.frames).toBe(60);
    expect(snapshot.windowSeconds).toBeCloseTo(1, 3);
    expect(snapshot.fps).toBeCloseTo(60, 1);
    expect(snapshot.avgMs).toBeCloseTo(16.67, 1);
  });

  it('places percentiles above the bulk of the samples', () => {
    const monitor = new PerfMonitor({ now: () => 0 });
    // 96 fast frames and 4 slow ones: p95 must land in the slow tail.
    feed(monitor, [...repeat(10, 96), ...repeat(80, 4)]);

    const snapshot = monitor.snapshot();
    expect(snapshot.p50Ms).toBeLessThanOrEqual(11);
    expect(snapshot.p99Ms).toBeGreaterThan(33);
    expect(snapshot.worstMs).toBe(80);
  });

  it('counts the share of frames breaching the 45 FPS and 33ms thresholds', () => {
    const monitor = new PerfMonitor({ now: () => 0 });
    feed(monitor, [...repeat(16, 90), ...repeat(25, 5), ...repeat(40, 5)]);

    const snapshot = monitor.snapshot();
    // 25ms is under 45 FPS but under the 33ms ceiling; 40ms breaches both.
    expect(snapshot.over45Pct).toBeCloseTo(10, 5);
    expect(snapshot.over33Pct).toBeCloseTo(5, 5);
  });

  it('keeps percentiles bounded when frames exceed the histogram range', () => {
    const monitor = new PerfMonitor({ now: () => 0 });
    // Overflows the 128ms histogram, but is a real frame rather than a stall.
    feed(monitor, [...repeat(16, 10), 400]);

    const snapshot = monitor.snapshot();
    expect(snapshot.worstMs).toBe(400);
    expect(snapshot.p99Ms).toBe(400);
    expect(snapshot.stalls).toBe(0);
  });

  it('excludes tab stalls instead of counting them as slow frames', () => {
    const monitor = new PerfMonitor({ now: () => 0 });
    // 60 good frames with a minute-long gap, as when the tab is backgrounded.
    feed(monitor, [...repeat(1000 / 60, 30), 60_000, ...repeat(1000 / 60, 30)]);

    const snapshot = monitor.snapshot();
    expect(snapshot.stalls).toBe(1);
    expect(snapshot.frames).toBe(60);
    expect(snapshot.fps).toBeCloseTo(60, 1);
    expect(snapshot.worstMs).toBeLessThan(20);
    expect(snapshot.over33Pct).toBe(0);
    expect(snapshot.windowSeconds).toBeCloseTo(1, 2);
  });

  it('clears the window on reset', () => {
    const monitor = new PerfMonitor({ now: () => 0 });
    feed(monitor, repeat(50, 20));
    monitor.reset();

    const snapshot = monitor.snapshot();
    expect(snapshot.frames).toBe(0);
    expect(snapshot.over33Pct).toBe(0);
    expect(snapshot.worstMs).toBe(0);
    expect(snapshot.stalls).toBe(0);
  });

  it('tracks simulation and render cost separately', () => {
    const monitor = new PerfMonitor({ now: () => 0 });
    for (let i = 0; i < 400; i += 1) {
      monitor.beginFrame(i * 16);
      monitor.recordSim(4, 1);
      monitor.recordRender(6);
      monitor.endFrame();
    }

    const snapshot = monitor.snapshot();
    expect(snapshot.simMs).toBeCloseTo(4, 1);
    expect(snapshot.renderMs).toBeCloseTo(6, 1);
    expect(snapshot.ticksPerFrame).toBeCloseTo(1, 1);
  });
});
