import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioKit } from '../game/core/audio';
import { GameLoop } from '../game/core/loop';
import { PerfMonitor, type PerfSnapshot } from '../game/core/perf';
import { SPEED_OPTIONS, type SpeedOption } from '../game/core/speed';
import { loadHighScore, loadMuted, saveHighScore, saveMuted } from '../game/core/storage';
import { TOWER_DEFS } from '../game/data/towers';
import type {
  EngineMode,
  GameEngine,
  GameStateSnapshot,
  RenderStats,
  StressRequest,
} from '../game/engine';
import { FastEngine } from '../game/fast/fastEngine';
import { NaiveEngine } from '../game/naive/naiveEngine';
import { CanvasViewport } from '../game/render/viewport';
import { ControlBar } from './ControlBar';
import { EngineToggle } from './EngineToggle';
import { GameModal } from './GameModal';
import { Hud } from './Hud';
import { PerfOverlay } from './PerfOverlay';
import { StartScreen } from './StartScreen';
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
 *
 * Two canvases are stacked: the WebGL surface underneath, and a transparent 2D
 * canvas above it for text. The naive engine draws its whole world onto the 2D
 * layer instead, which is why swapping implementations needs no DOM changes.
 */
const HUD_REFRESH_MS = 120;
const BANNER_MS = 1700;
const ZOOM_WHEEL_SENSITIVITY = 0.0016;
const KEYBOARD_PAN_PX = 64;

interface Contexts {
  gl: WebGL2RenderingContext | null;
  overlay: CanvasRenderingContext2D;
}

export function GameView() {
  const glCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const engineRef = useRef<GameEngine | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  const viewportRef = useRef<CanvasViewport | null>(null);
  const contextsRef = useRef<Contexts | null>(null);
  const audioRef = useRef<AudioKit>(new AudioKit(loadMuted()));
  const autoPausedRef = useRef(false);
  /** Read by pointer handlers, which must not be re-created as it changes. */
  const buildTypeRef = useRef<number | null>(null);
  const panPointerRef = useRef<number | null>(null);
  const panOriginRef = useRef({ x: 0, y: 0 });
  /** Previous values, so the HUD tick can notice events worth a sound. */
  const previousRef = useRef({ wave: 0, leaks: 0, phase: 'ready' as GameStateSnapshot['phase'] });
  const bannerTimerRef = useRef(0);

  const [monitor, setMonitor] = useState<PerfMonitor | null>(null);
  const [perf, setPerf] = useState<PerfSnapshot | null>(null);
  const [renderStats, setRenderStats] = useState<RenderStats | null>(null);
  const [state, setState] = useState<GameStateSnapshot | null>(null);
  const [mode, setMode] = useState<EngineMode>('fast');
  const [rendererLabel, setRendererLabel] = useState('WebGL2 instanced');
  const [webglMissing, setWebglMissing] = useState(false);
  const [started, setStarted] = useState(false);
  const [highScore, setHighScore] = useState(loadHighScore);
  const [muted, setMuted] = useState(loadMuted);
  const [buildType, setBuildType] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState<SpeedOption>(1);
  const [showPerf, setShowPerf] = useState(true);
  const [showStress, setShowStress] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [banner, setBanner] = useState<string | null>(null);

  /** Pulls fresh game state immediately, for actions that must feel instant. */
  const refresh = useCallback(() => {
    const engine = engineRef.current;
    if (engine) setState(engine.getState());
  }, []);

  const showBanner = useCallback((text: string) => {
    setBanner(text);
    window.clearTimeout(bannerTimerRef.current);
    bannerTimerRef.current = window.setTimeout(() => setBanner(null), BANNER_MS);
  }, []);

  // ── Boot: canvases, viewport, loop ─────────────────────────────────────────

  useEffect(() => {
    const glCanvas = glCanvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    if (!glCanvas || !overlayCanvas) return;

    const overlay = overlayCanvas.getContext('2d');
    if (!overlay) throw new Error('This browser does not support a 2D canvas context.');

    const gl = glCanvas.getContext('webgl2', {
      alpha: false,
      antialias: true,
      depth: false,
      powerPreference: 'high-performance',
    });
    if (!gl) {
      // No WebGL2 means the optimized renderer cannot run; the game still works
      // on the Canvas 2D path, just slower.
      setWebglMissing(true);
      setMode('naive');
    }

    contextsRef.current = { gl, overlay };

    const viewport = new CanvasViewport(glCanvas, { mirrors: [overlayCanvas] });
    viewport.observe();
    viewport.sync();
    viewportRef.current = viewport;

    const perfMonitor = new PerfMonitor();
    setMonitor(perfMonitor);

    const loop = new GameLoop(
      {
        step: (delta) => engineRef.current?.step(delta),
        render: (alpha) => {
          const engine = engineRef.current;
          if (!engine) return;
          if (viewport.sync()) engine.resize(viewport);
          engine.render(alpha);
        },
      },
      { perf: perfMonitor }
    );
    loopRef.current = loop;
    // Runs immediately but paused, so the board is visible behind the title
    // screen without the wave timer ticking down.
    loop.pause();
    loop.start();

    const hudTimer = window.setInterval(() => {
      const engine = engineRef.current;
      if (!engine) return;
      setPerf(perfMonitor.snapshot());
      setRenderStats({ ...engine.getRenderStats() });

      const next = engine.getState();
      setState(next);
      setZoom(engine.getZoom());

      const previous = previousRef.current;
      const audio = audioRef.current;
      if (next.wave > previous.wave) {
        audio.waveStart();
        showBanner(`Wave ${next.wave}`);
      }
      if (next.leaks > previous.leaks) audio.leak();
      if (next.phase !== previous.phase) {
        if (next.phase === 'victory') audio.victory();
        if (next.phase === 'defeat') audio.defeat();
        if (next.phase === 'victory' || next.phase === 'defeat') {
          setHighScore(saveHighScore(next.score));
        }
      }
      previousRef.current = { wave: next.wave, leaks: next.leaks, phase: next.phase };
    }, HUD_REFRESH_MS);

    return () => {
      window.clearInterval(hudTimer);
      window.clearTimeout(bannerTimerRef.current);
      loop.stop();
      viewport.dispose();
      viewportRef.current = null;
      loopRef.current = null;
    };
  }, [showBanner]);

  // ── The engine itself, rebuilt when the implementation changes ─────────────

  useEffect(() => {
    const contexts = contextsRef.current;
    const viewport = viewportRef.current;
    if (!contexts || !viewport) return;

    const engine =
      mode === 'fast' && contexts.gl
        ? new FastEngine(contexts.gl, contexts.overlay, viewport)
        : new NaiveEngine(contexts.overlay, viewport);

    engineRef.current = engine;
    setRendererLabel(engine.rendererLabel);
    previousRef.current = { wave: 0, leaks: 0, phase: 'ready' };
    setState(engine.getState());

    if (engine.mode === 'naive' && contexts.gl) {
      // The naive renderer paints the 2D layer opaquely on top, but leaving a
      // stale WebGL frame underneath is asking for confusion.
      contexts.gl.clearColor(0, 0, 0, 1);
      contexts.gl.clear(contexts.gl.COLOR_BUFFER_BIT);
    }

    return () => {
      engineRef.current = null;
      engine.dispose();
    };
  }, [mode]);

  // ── Controls ───────────────────────────────────────────────────────────────

  const togglePause = useCallback(() => {
    const loop = loopRef.current;
    if (loop) setPaused(loop.togglePause());
  }, []);

  const changeSpeed = useCallback((next: SpeedOption) => {
    loopRef.current?.setSpeed(next);
    setSpeed(next);
  }, []);

  const beginPlaying = useCallback(() => {
    audioRef.current.unlock();
    setStarted(true);
    loopRef.current?.resume();
    setPaused(false);
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((current) => {
      const next = !current;
      audioRef.current.setMuted(next);
      saveMuted(next);
      return next;
    });
  }, []);

  const selectBuildType = useCallback((typeId: number | null) => {
    buildTypeRef.current = typeId;
    setBuildType(typeId);
    if (typeId === null) engineRef.current?.setHover(null, null, null);
  }, []);

  const startWave = useCallback(() => {
    if (engineRef.current?.startWave()) audioRef.current.waveStart();
    refresh();
  }, [refresh]);

  const upgrade = useCallback(() => {
    const done = engineRef.current?.upgradeSelected();
    if (done) audioRef.current.upgrade();
    else audioRef.current.denied();
    refresh();
  }, [refresh]);

  const sell = useCallback(() => {
    if (engineRef.current?.sellSelected()) audioRef.current.sell();
    refresh();
  }, [refresh]);

  const restart = useCallback(() => {
    engineRef.current?.restart();
    selectBuildType(null);
    monitor?.reset();
    previousRef.current = { wave: 0, leaks: 0, phase: 'ready' };
    setZoom(1);
    refresh();
  }, [monitor, refresh, selectBuildType]);

  const changeMode = useCallback(
    (next: EngineMode) => {
      if (next === mode) return;
      setMode(next);
      selectBuildType(null);
      monitor?.reset();
      setZoom(1);
    },
    [mode, monitor, selectBuildType]
  );

  const resetView = useCallback(() => {
    engineRef.current?.resetView();
    setZoom(1);
  }, []);

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
    if (!engine) return;

    if (panPointerRef.current === event.pointerId) {
      engine.panBy(event.clientX - panOriginRef.current.x, event.clientY - panOriginRef.current.y);
      panOriginRef.current = { x: event.clientX, y: event.clientY };
      return;
    }

    const typeId = buildTypeRef.current;
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
      audioRef.current.unlock();

      // Middle or right button drags the view; left button plays the game.
      if (event.button === 1 || event.button === 2) {
        panPointerRef.current = event.pointerId;
        panOriginRef.current = { x: event.clientX, y: event.clientY };
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
      if (event.button !== 0) return;

      const bounds = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - bounds.left;
      const y = event.clientY - bounds.top;
      const typeId = buildTypeRef.current;

      if (typeId !== null) {
        const { col, row } = engine.tileAt(x, y);
        // Keep the build type selected on success so several towers can be
        // placed in a row; fall back to inspecting whatever was clicked.
        if (engine.placeTower(col, row, typeId)) {
          audioRef.current.place();
        } else {
          audioRef.current.denied();
          engine.selectAt(x, y);
        }
      } else {
        engine.selectAt(x, y);
      }
      refresh();
    },
    [refresh]
  );

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (panPointerRef.current !== event.pointerId) return;
    panPointerRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setZoom(engineRef.current?.getZoom() ?? 1);
  }, []);

  /**
   * Wheel zoom needs a non-passive listener to cancel the page scroll, which
   * React's `onWheel` cannot guarantee.
   */
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const onWheel = (event: WheelEvent) => {
      const engine = engineRef.current;
      if (!engine) return;
      event.preventDefault();
      const bounds = stage.getBoundingClientRect();
      engine.zoomAt(
        Math.exp(-event.deltaY * ZOOM_WHEEL_SENSITIVITY),
        event.clientX - bounds.left,
        event.clientY - bounds.top
      );
      setZoom(engine.getZoom());
    };

    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, []);

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
        case 'Digit4': {
          const option = SPEED_OPTIONS[Number(event.code.slice(-1)) - 1];
          if (option !== undefined) changeSpeed(option);
          break;
        }
        case 'Digit0':
          resetView();
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
        case 'KeyM':
          toggleMute();
          break;
        case 'Escape':
          selectBuildType(null);
          engineRef.current?.clearSelection();
          refresh();
          break;
        case 'KeyP':
          setShowPerf((visible) => !visible);
          break;
        case 'ArrowLeft':
        case 'ArrowRight':
        case 'ArrowUp':
        case 'ArrowDown': {
          event.preventDefault();
          const dx =
            event.code === 'ArrowLeft'
              ? KEYBOARD_PAN_PX
              : event.code === 'ArrowRight'
                ? -KEYBOARD_PAN_PX
                : 0;
          const dy =
            event.code === 'ArrowUp'
              ? KEYBOARD_PAN_PX
              : event.code === 'ArrowDown'
                ? -KEYBOARD_PAN_PX
                : 0;
          engineRef.current?.panBy(dx, dy);
          break;
        }
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    changeSpeed,
    refresh,
    resetView,
    selectBuildType,
    sell,
    startWave,
    toggleMute,
    togglePause,
    upgrade,
  ]);

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
    <div className="game" ref={stageRef}>
      <canvas className="game__canvas game__canvas--gl" ref={glCanvasRef} aria-hidden="true" />
      <canvas
        className="game__canvas game__canvas--overlay"
        ref={overlayCanvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerLeave}
        onContextMenu={(event) => event.preventDefault()}
        aria-label="Battlefield"
      />

      <div className="game__top">
        <Hud state={state} highScore={highScore} />
      </div>

      <div className="game__side">
        {showPerf && (
          <PerfOverlay
            snapshot={perf}
            monitor={monitor}
            render={renderStats}
            onReset={() => monitor?.reset()}
          />
        )}
        {showStress && (
          <>
            <EngineToggle mode={mode} rendererLabel={rendererLabel} onChange={changeMode} />
            <StressPanel onStress={runStress} onClear={clearStress} />
          </>
        )}
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
            muted={muted}
            zoom={zoom}
            onTogglePause={togglePause}
            onSpeedChange={changeSpeed}
            onTogglePerf={() => setShowPerf((visible) => !visible)}
            onToggleMute={toggleMute}
            onResetView={resetView}
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

      {mode === 'naive' && (
        <div className="game__mode-badge" role="status">
          Baseline engine{webglMissing ? ' · WebGL2 unavailable' : ''}
        </div>
      )}

      {banner && (
        <div className="game__banner" key={banner}>
          {banner}
        </div>
      )}

      {started && paused && !finished && <div className="game__paused">Paused</div>}
      {!started && <StartScreen highScore={highScore} onStart={beginPlaying} />}
      {finished && state && <GameModal state={state} highScore={highScore} onRestart={restart} />}
    </div>
  );
}
