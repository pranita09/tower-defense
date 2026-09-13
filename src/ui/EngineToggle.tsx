import type { EngineMode } from '../game/engine';
import './panels.css';

interface EngineToggleProps {
  mode: EngineMode;
  rendererLabel: string;
  onChange: (mode: EngineMode) => void;
}

const OPTIONS: ReadonlyArray<{ mode: EngineMode; label: string; detail: string }> = [
  { mode: 'fast', label: 'Optimized', detail: 'WebGL2 · typed arrays · spatial grid' },
  { mode: 'naive', label: 'Baseline', detail: 'Canvas 2D · objects · full scans' },
];

export function EngineToggle({ mode, rendererLabel, onChange }: EngineToggleProps) {
  return (
    <section className="panel engine" aria-label="Engine implementation">
      <span className="panel__title">Engine</span>
      <div className="engine__options">
        {OPTIONS.map((option) => (
          <button
            key={option.mode}
            className={`action engine__option${mode === option.mode ? ' is-active' : ''}`}
            type="button"
            aria-pressed={mode === option.mode}
            onClick={() => onChange(option.mode)}
          >
            {option.label}
            <span className="engine__detail">{option.detail}</span>
          </button>
        ))}
      </div>
      <p className="engine__note">Renderer: {rendererLabel}. Switching restarts the run.</p>
    </section>
  );
}
