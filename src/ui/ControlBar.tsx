import { SPEED_OPTIONS, type SpeedOption } from '../game/core/speed';
import './ControlBar.css';

interface ControlBarProps {
  paused: boolean;
  speed: number;
  showPerf: boolean;
  muted: boolean;
  zoom: number;
  onTogglePause: () => void;
  onSpeedChange: (speed: SpeedOption) => void;
  onTogglePerf: () => void;
  onToggleMute: () => void;
  onResetView: () => void;
}

export function ControlBar({
  paused,
  speed,
  showPerf,
  muted,
  zoom,
  onTogglePause,
  onSpeedChange,
  onTogglePerf,
  onToggleMute,
  onResetView,
}: ControlBarProps) {
  return (
    <div className="controls">
      <button
        className="controls__button controls__button--primary"
        type="button"
        onClick={onTogglePause}
        aria-keyshortcuts="Space"
        title="Pause / resume (Space)"
      >
        {paused ? 'Resume' : 'Pause'}
      </button>

      <div className="controls__group" role="group" aria-label="Game speed">
        {SPEED_OPTIONS.map((option, index) => (
          <button
            key={option}
            className={`controls__button${speed === option ? ' is-active' : ''}`}
            type="button"
            onClick={() => onSpeedChange(option)}
            aria-pressed={speed === option}
            aria-keyshortcuts={String(index + 1)}
            title={`${option}x speed (${index + 1})`}
          >
            {option}x
          </button>
        ))}
      </div>

      <button
        className={`controls__button${zoom > 1.01 ? ' is-active' : ''}`}
        type="button"
        onClick={onResetView}
        aria-keyshortcuts="0"
        title="Reset zoom and pan (0). Scroll to zoom, right-drag to pan."
      >
        {zoom > 1.01 ? `${zoom.toFixed(1)}x view` : 'Fit'}
      </button>

      <button
        className={`controls__button${muted ? '' : ' is-active'}`}
        type="button"
        onClick={onToggleMute}
        aria-pressed={!muted}
        aria-keyshortcuts="M"
        title="Toggle sound (M)"
      >
        {muted ? 'Muted' : 'Sound'}
      </button>

      <button
        className={`controls__button${showPerf ? ' is-active' : ''}`}
        type="button"
        onClick={onTogglePerf}
        aria-pressed={showPerf}
        aria-keyshortcuts="P"
        title="Toggle performance overlay (P)"
      >
        Stats
      </button>
    </div>
  );
}
