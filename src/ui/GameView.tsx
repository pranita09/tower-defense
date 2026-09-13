import { useCallback, useEffect, useRef, useState } from 'react';
import { GameLoop } from '../game/core/loop';
import { PerfMonitor, type PerfSnapshot } from '../game/core/perf';
import { SPEED_OPTIONS, type SpeedOption } from '../game/core/speed';
import { CanvasViewport } from '../game/render/viewport';
import { LoopProbe } from '../game/loopProbe';
import { ControlBar } from './ControlBar';
import { PerfOverlay } from './PerfOverlay';
import './GameView.css';

/** How often the HUD reads simulation state. Deliberately not every frame. */
const HUD_REFRESH_MS = 200;

const LOAD_STEPS = [600, 5_000, 20_000, 50_000, 100_000, 200_000] as const;

export function GameView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const probeRef = useRef<LoopProbe | null>(null);
  const autoPausedRef = useRef(false);
  const [monitor, setMonitor] = useState<PerfMonitor | null>(null);

  const [snapshot, setSnapshot] = useState<PerfSnapshot | null>(null);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState<SpeedOption>(1);
  const [showPerf, setShowPerf] = useState(true);
  const [load, setLoad] = useState<number>(LOAD_STEPS[0]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // An opaque context skips per-pixel blending against the page behind it.
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('This browser does not support a 2D canvas context.');

    const viewport = new CanvasViewport(canvas);
    viewport.observe();

    const probe = new LoopProbe();
    probeRef.current = probe;

    const perf = new PerfMonitor();
    setMonitor(perf);

    const loop = new GameLoop(
      {
        step: (delta) => probe.step(delta),
        render: (alpha) => {
          if (viewport.sync()) probe.resize(viewport.cssWidth, viewport.cssHeight);
          probe.render(ctx, viewport, alpha);
        },
      },
      { perf }
    );
    loopRef.current = loop;

    // First sync happens before the first step so the world has real bounds.
    viewport.sync();
    probe.resize(viewport.cssWidth, viewport.cssHeight);
    loop.start();

    const hudTimer = window.setInterval(() => setSnapshot(perf.snapshot()), HUD_REFRESH_MS);

    return () => {
      window.clearInterval(hudTimer);
      loop.stop();
      viewport.dispose();
      loopRef.current = null;
      probeRef.current = null;
    };
  }, []);

  useEffect(() => {
    probeRef.current?.setCount(load);
  }, [load]);

  const togglePause = useCallback(() => {
    const loop = loopRef.current;
    if (!loop) return;
    setPaused(loop.togglePause());
  }, []);

  const changeSpeed = useCallback((next: SpeedOption) => {
    loopRef.current?.setSpeed(next);
    setSpeed(next);
  }, []);

  const resetPerfWindow = useCallback(() => monitor?.reset(), [monitor]);

  /**
   * A hidden tab gets no animation frames, so resuming would either
   * fast-forward or register as one enormous frame. Pausing is also just what
   * players expect. A manual pause is remembered so it is not undone here.
   */
  useEffect(() => {
    const onVisibilityChange = () => {
      const loop = loopRef.current;
      if (!loop) return;
      if (document.hidden) {
        autoPausedRef.current = !loop.isPaused;
        if (autoPausedRef.current) {
          loop.pause();
          setPaused(true);
        }
      } else if (autoPausedRef.current) {
        autoPausedRef.current = false;
        loop.resume();
        setPaused(false);
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      switch (event.code) {
        case 'Space':
          event.preventDefault();
          togglePause();
          break;
        case 'Digit1':
        case 'Digit2':
        case 'Digit3': {
          const index = Number(event.code.slice(-1)) - 1;
          changeSpeed(SPEED_OPTIONS[index]);
          break;
        }
        case 'KeyP':
          setShowPerf((visible) => !visible);
          break;
        case 'KeyR':
          resetPerfWindow();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [changeSpeed, resetPerfWindow, togglePause]);

  return (
    <div className="game">
      <canvas className="game__canvas" ref={canvasRef} />

      <div className="game__hud game__hud--top-left">
        <div className="game__brand">
          <span className="game__brand-mark">Bastion</span>
          <span className="game__brand-note">loop &amp; instrumentation harness</span>
        </div>
      </div>

      <div className="game__hud game__hud--top-right">
        {showPerf && (
          <PerfOverlay snapshot={snapshot} monitor={monitor} onReset={resetPerfWindow} />
        )}
      </div>

      <div className="game__hud game__hud--bottom">
        <ControlBar
          paused={paused}
          speed={speed}
          showPerf={showPerf}
          onTogglePause={togglePause}
          onSpeedChange={changeSpeed}
          onTogglePerf={() => setShowPerf((visible) => !visible)}
        />

        <div className="game__load" role="group" aria-label="Probe entity count">
          <span className="game__load-label">Entities</span>
          {LOAD_STEPS.map((step) => (
            <button
              key={step}
              className={`game__load-button${load === step ? ' is-active' : ''}`}
              type="button"
              onClick={() => setLoad(step)}
              aria-pressed={load === step}
            >
              {step.toLocaleString()}
            </button>
          ))}
        </div>
      </div>

      {paused && <div className="game__paused">Paused</div>}
    </div>
  );
}
