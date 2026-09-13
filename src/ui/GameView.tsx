import { useCallback, useEffect, useRef, useState } from 'react';
import { GameLoop } from '../game/core/loop';
import { PerfMonitor, type PerfSnapshot } from '../game/core/perf';
import { SPEED_OPTIONS, type SpeedOption } from '../game/core/speed';
import { TOWER_DEFS } from '../game/data/towers';
import type { GameEngine, GameStateSnapshot, StressRequest } from '../game/engine';
import { NaiveEngine } from '../game/naive/naiveEngine';
import { CanvasViewport } from '../game/render/viewport';
import { ControlBar } from './ControlBar';
import { GameModal } from './GameModal';
import { Hud } from './Hud';
import { PerfOverlay } from './PerfOverlay';
import { StressPanel } from './StressPanel';
import { TowerPanel } from './TowerPanel';
import { TowerShop } from './TowerShop';
import './GameView.css';

/**
 * The React shell.
 *
 * React owns the HUD and nothing else. It reads game state on a timer rather
 * than per frame, and the engine never calls into React, so no amount of
 * on-screen entities can cause a re-render.
 */
const HUD_REFRESH_MS = 120;

export function GameView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const autoPausedRef = useRef(false);
  /** Read by pointer handlers, which must not be re-created as it changes. */
  const buildTypeRef = useRef<number | null>(null);

  const [monitor, setMonitor] = useState<PerfMonitor | null>(null);
  const [perf, setPerf] = useState<PerfSnapshot | null>(null);
  const [state, setState] = useState<GameStateSnapshot | null>(null);
  const [buildType, setBuildType] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState<SpeedOption>(1);
  const [showPerf, setShowPerf] = useState(true);
  const [showStress, setShowStress] = useState(false);

  /** Pulls fresh game state immediately, for actions that must feel instant. */
  const refresh = useCallback(() => {
    const engine = engineRef.current;
    if (engine) setState(engine.getState());
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('This browser does not support a 2D canvas context.');

    const viewport = new CanvasViewport(canvas);
    viewport.observe();
    viewport.sync();

    const engine = new NaiveEngine(ctx, viewport);
    engineRef.current = engine;

    const perfMonitor = new PerfMonitor();
    setMonitor(perfMonitor);

    const loop = new GameLoop(
      {
        step: (delta) => engine.step(delta),
        render: (alpha) => {
          if (viewport.sync()) engine.resize(viewport);
          engine.render(alpha);
        },
      },
      { perf: perfMonitor }
    );
    loopRef.current = loop;
    loop.start();

    const hudTimer = window.setInterval(() => {
      setPerf(perfMonitor.snapshot());
      setState(engine.getState());
    }, HUD_REFRESH_MS);

    return () => {
      window.clearInterval(hudTimer);
      loop.stop();
      viewport.dispose();
      engine.dispose();
      engineRef.current = null;
      loopRef.current = null;
    };
  }, []);

  // ── Controls ───────────────────────────────────────────────────────────────

  const togglePause = useCallback(() => {
    const loop = loopRef.current;
    if (loop) setPaused(loop.togglePause());
  }, []);

  const changeSpeed = useCallback((next: SpeedOption) => {
    loopRef.current?.setSpeed(next);
    setSpeed(next);
  }, []);

  const selectBuildType = useCallback((typeId: number | null) => {
    buildTypeRef.current = typeId;
    setBuildType(typeId);
    if (typeId === null) engineRef.current?.setHover(null, null, null);
  }, []);

  const startWave = useCallback(() => {
    engineRef.current?.startWave();
    refresh();
  }, [refresh]);

  const upgrade = useCallback(() => {
    engineRef.current?.upgradeSelected();
    refresh();
  }, [refresh]);

  const sell = useCallback(() => {
    engineRef.current?.sellSelected();
    refresh();
  }, [refresh]);

  const restart = useCallback(() => {
    engineRef.current?.restart();
    selectBuildType(null);
    monitor?.reset();
    refresh();
  }, [monitor, refresh, selectBuildType]);

  const runStress = useCallback(
    (request: StressRequest) => {
      engineRef.current?.stress(request);
      monitor?.reset();
      refresh();
    },
    [monitor, refresh]
  );

  const clearStress = useCallback(() => {
    engineRef.current?.restart();
    monitor?.reset();
    refresh();
  }, [monitor, refresh]);

  // ── Pointer input ──────────────────────────────────────────────────────────

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const engine = engineRef.current;
    const typeId = buildTypeRef.current;
    if (!engine) return;
    if (typeId === null) {
      engine.setHover(null, null, null);
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    engine.setHover(event.clientX - bounds.left, event.clientY - bounds.top, typeId);
  }, []);

  const onPointerLeave = useCallback(() => {
    engineRef.current?.setHover(null, null, null);
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const engine = engineRef.current;
      if (!engine) return;

      const bounds = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - bounds.left;
      const y = event.clientY - bounds.top;
      const typeId = buildTypeRef.current;

      if (typeId !== null) {
        const { col, row } = engine.tileAt(x, y);
        // Keep the build type selected on success so several towers can be
        // placed in a row; fall back to inspecting whatever was clicked.
        if (!engine.placeTower(col, row, typeId)) engine.selectAt(x, y);
      } else {
        engine.selectAt(x, y);
      }
      refresh();
    },
    [refresh]
  );

  // ── Keyboard ───────────────────────────────────────────────────────────────

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;

      const hotkeyIndex = TOWER_DEFS.findIndex(
        (def) => def.hotkey.toLowerCase() === event.key.toLowerCase()
      );
      if (hotkeyIndex >= 0) {
        selectBuildType(buildTypeRef.current === hotkeyIndex ? null : hotkeyIndex);
        return;
      }

      switch (event.code) {
        case 'Space':
          event.preventDefault();
          togglePause();
          break;
        case 'Digit1':
        case 'Digit2':
        case 'Digit3':
          changeSpeed(SPEED_OPTIONS[Number(event.code.slice(-1)) - 1]);
          break;
        case 'Enter':
          startWave();
          break;
        case 'KeyU':
          upgrade();
          break;
        case 'KeyX':
          sell();
          break;
        case 'Escape':
          selectBuildType(null);
          engineRef.current?.clearSelection();
          refresh();
          break;
        case 'KeyP':
          setShowPerf((visible) => !visible);
          break;
        case 'KeyR':
          monitor?.reset();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [changeSpeed, monitor, refresh, selectBuildType, sell, startWave, togglePause, upgrade]);

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

  const finished = state?.phase === 'victory' || state?.phase === 'defeat';

  return (
    <div className="game">
      <canvas
        className="game__canvas"
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
      />

      <div className="game__top">
        <Hud state={state} />
      </div>

      <div className="game__side">
        {showPerf && (
          <PerfOverlay snapshot={perf} monitor={monitor} onReset={() => monitor?.reset()} />
        )}
        {showStress && <StressPanel onStress={runStress} onClear={clearStress} />}
      </div>

      {state?.selected && (
        <div className="game__inspector">
          <TowerPanel
            selected={state.selected}
            gold={state.gold}
            onUpgrade={upgrade}
            onSell={sell}
          />
        </div>
      )}

      <div className="game__bottom">
        <TowerShop gold={state?.gold ?? 0} selectedType={buildType} onSelect={selectBuildType} />

        <div className="game__bottom-right">
          <button
            className="action action--primary game__start"
            type="button"
            disabled={state?.phase !== 'ready'}
            onClick={startWave}
            aria-keyshortcuts="Enter"
          >
            {state?.phase === 'ready'
              ? `Start wave ${Math.ceil(state.restSeconds)}s`
              : 'Wave in progress'}
          </button>

          <ControlBar
            paused={paused}
            speed={speed}
            showPerf={showPerf}
            onTogglePause={togglePause}
            onSpeedChange={changeSpeed}
            onTogglePerf={() => setShowPerf((visible) => !visible)}
          />

          <button
            className={`action game__stress-toggle${showStress ? ' is-active' : ''}`}
            type="button"
            onClick={() => setShowStress((visible) => !visible)}
            aria-pressed={showStress}
          >
            Stress
          </button>
        </div>
      </div>

      {paused && !finished && <div className="game__paused">Paused</div>}
      {finished && state && <GameModal state={state} onRestart={restart} />}
    </div>
  );
}
