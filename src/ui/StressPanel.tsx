import type { StressRequest } from '../game/engine';
import './panels.css';

// Benchmark presets. Counts are held while a preset is active, so a measurement
// window stays comparable between runs instead of decaying as towers clear.

interface StressPreset {
  label: string;
  request: StressRequest;
}

const PRESETS: readonly StressPreset[] = [
  { label: 'Warm-up', request: { enemies: 1000, towers: 40, projectiles: 250 } },
  { label: 'Target load', request: { enemies: 5000, towers: 100, projectiles: 1000 } },
  { label: 'Overkill', request: { enemies: 10000, towers: 150, projectiles: 2000 } },
  { label: 'Breaking point', request: { enemies: 16000, towers: 250, projectiles: 4000 } },
];

interface StressPanelProps {
  onStress: (request: StressRequest) => void;
  onClear: () => void;
}

export function StressPanel({ onStress, onClear }: StressPanelProps) {
  return (
    <section className="panel stress" aria-label="Stress test">
      <span className="panel__title">Stress test</span>
      <p className="stress__note">
        Holds a synthetic load so frame statistics stay comparable. Leaks are recycled instead of
        damaging the base.
      </p>

      <div className="stress__buttons">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            className="action stress__preset"
            type="button"
            onClick={() => onStress(preset.request)}
          >
            {preset.label}
            <span className="stress__preset-detail">
              {preset.request.enemies.toLocaleString()} / {preset.request.towers} /{' '}
              {preset.request.projectiles.toLocaleString()}
            </span>
          </button>
        ))}
        <button className="action action--danger" type="button" onClick={onClear}>
          Clear and restart
        </button>
      </div>
    </section>
  );
}
