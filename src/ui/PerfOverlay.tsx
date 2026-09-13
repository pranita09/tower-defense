import { useEffect, useRef } from 'react';
import {
  FRAME_BUDGET_45FPS_MS,
  FRAME_BUDGET_LIMIT_MS,
  type PerfMonitor,
  type PerfSnapshot,
} from '../game/core/perf';
import type { RenderStats } from '../game/engine';
import './PerfOverlay.css';

const GRAPH_WIDTH = 260;
const GRAPH_HEIGHT = 46;
/** Top of the graph, in ms. Frames slower than this are clipped flat. */
const GRAPH_CEILING_MS = 50;

interface PerfOverlayProps {
  snapshot: PerfSnapshot | null;
  monitor: PerfMonitor | null;
  render: RenderStats | null;
  onReset: () => void;
}

export function PerfOverlay({ snapshot, monitor, render, onReset }: PerfOverlayProps) {
  const graphRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = graphRef.current;
    if (!canvas || !monitor) return;
    drawFrameGraph(canvas, monitor);
  }, [snapshot, monitor]);

  const over33 = snapshot?.over33Pct ?? 0;
  const over45 = snapshot?.over45Pct ?? 0;
  const stalls = snapshot?.stalls ?? 0;

  return (
    <section className="perf" aria-label="Performance statistics">
      <header className="perf__header">
        <span className="perf__title">Performance</span>
        <button className="perf__reset" type="button" onClick={onReset}>
          Reset window
        </button>
      </header>

      <div className="perf__fps">
        <strong>{formatNumber(snapshot?.fpsInstant, 0)}</strong>
        <span>FPS</span>
        <em>avg {formatNumber(snapshot?.fps, 1)}</em>
      </div>

      <canvas
        className="perf__graph"
        ref={graphRef}
        width={GRAPH_WIDTH}
        height={GRAPH_HEIGHT}
        aria-hidden="true"
      />

      <dl className="perf__stats">
        <Stat label="frame p50" value={`${formatNumber(snapshot?.p50Ms, 1)} ms`} />
        <Stat
          label="frame p95"
          value={`${formatNumber(snapshot?.p95Ms, 1)} ms`}
          bad={(snapshot?.p95Ms ?? 0) > FRAME_BUDGET_45FPS_MS}
        />
        <Stat
          label="frame p99"
          value={`${formatNumber(snapshot?.p99Ms, 1)} ms`}
          bad={(snapshot?.p99Ms ?? 0) > FRAME_BUDGET_LIMIT_MS}
        />
        <Stat label="worst" value={`${formatNumber(snapshot?.worstMs, 1)} ms`} />
        <Stat
          label="over 22ms"
          value={`${formatNumber(over45, 1)} %`}
          bad={over45 >= 5}
          hint="Share of frames below 45 FPS"
        />
        <Stat
          label="over 33ms"
          value={`${formatNumber(over33, 1)} %`}
          bad={over33 >= 5}
          hint="Target: under 5%"
        />
        <Stat label="sim" value={`${formatNumber(snapshot?.simMs, 2)} ms`} />
        <Stat label="render" value={`${formatNumber(snapshot?.renderMs, 2)} ms`} />
        <Stat label="cpu" value={`${formatNumber(snapshot?.cpuMs, 2)} ms`} />
        <Stat label="ticks/frame" value={formatNumber(snapshot?.ticksPerFrame, 2)} />
        <Stat
          label="draw calls"
          value={formatNumber(render?.drawCalls, 0)}
          hint="Two for the optimized renderer, regardless of entity count"
        />
        <Stat
          label="sprites"
          value={formatNumber(render?.sprites, 0)}
          hint="Instances uploaded in the single batched draw call"
        />
        <Stat
          label="culled"
          value={formatNumber(render?.culled, 0)}
          hint="Sprites skipped for being outside the visible area — zoom in to see this rise"
        />
      </dl>

      <footer className="perf__window">
        {formatNumber(snapshot?.frames, 0)} frames over {formatNumber(snapshot?.windowSeconds, 1)}s
        {stalls > 0 && (
          <span className="perf__stalls" title="Intervals over 500ms, excluded as tab stalls">
            {' '}
            · {stalls} stall{stalls === 1 ? '' : 's'} ignored
          </span>
        )}
      </footer>
    </section>
  );
}

function Stat({
  label,
  value,
  bad,
  hint,
}: {
  label: string;
  value: string;
  bad?: boolean;
  hint?: string;
}) {
  return (
    <div className={`perf__stat${bad ? ' perf__stat--bad' : ''}`} title={hint}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function formatNumber(value: number | undefined, digits: number): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

/**
 * Draws the recent frame intervals as a bar chart, with reference lines at the
 * 45 FPS and 33ms thresholds so a spike is instantly readable as a violation.
 */
function drawFrameGraph(canvas: HTMLCanvasElement, monitor: PerfMonitor): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);

  const samples = monitor.recent;
  const cursor = monitor.recentCursor;
  const count = samples.length;
  const barWidth = width / count;

  for (let i = 0; i < count; i += 1) {
    const value = samples[(cursor + i) % count];
    if (value <= 0) continue;
    const clamped = Math.min(value, GRAPH_CEILING_MS);
    const barHeight = Math.max(1, (clamped / GRAPH_CEILING_MS) * height);
    ctx.fillStyle =
      value > FRAME_BUDGET_LIMIT_MS
        ? '#ff5d5d'
        : value > FRAME_BUDGET_45FPS_MS
          ? '#ffa94d'
          : '#4cc9f0';
    ctx.fillRect(i * barWidth, height - barHeight, Math.max(1, barWidth - 0.5), barHeight);
  }

  ctx.setLineDash([3, 3]);
  ctx.lineWidth = 1;
  for (const [ms, color] of [
    [FRAME_BUDGET_45FPS_MS, 'rgba(255, 169, 77, 0.5)'],
    [FRAME_BUDGET_LIMIT_MS, 'rgba(255, 93, 93, 0.55)'],
  ] as const) {
    const y = height - (ms / GRAPH_CEILING_MS) * height;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(width, y + 0.5);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}
