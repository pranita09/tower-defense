import type { GameStateSnapshot } from '../game/engine';
import './Hud.css';

interface HudProps {
  state: GameStateSnapshot | null;
}

export function Hud({ state }: HudProps) {
  if (!state) return null;

  const healthFraction = Math.max(0, state.health / state.maxHealth);
  const waveFraction = state.waveTotal > 0 ? state.waveSpawned / state.waveTotal : 0;

  return (
    <div className="hud">
      <div className="hud__group">
        <span className="hud__brand">Bastion</span>
      </div>

      <div className="hud__group hud__group--stats">
        <div className={`hud__stat${healthFraction <= 0.3 ? ' hud__stat--critical' : ''}`}>
          <span className="hud__label">Base</span>
          <span className="hud__value">
            {state.health}
            <em>/{state.maxHealth}</em>
          </span>
          <div className="hud__bar">
            <div
              className="hud__bar-fill hud__bar-fill--health"
              style={{ scale: `${healthFraction} 1` }}
            />
          </div>
        </div>

        <div className="hud__stat hud__stat--gold">
          <span className="hud__label">Gold</span>
          <span className="hud__value">{state.gold.toLocaleString()}</span>
        </div>

        <div className="hud__stat">
          <span className="hud__label">Score</span>
          <span className="hud__value">{state.score.toLocaleString()}</span>
        </div>

        <div className="hud__stat hud__stat--wave">
          <span className="hud__label">Wave</span>
          <span className="hud__value">
            {Math.max(1, state.wave)}
            <em>/{state.totalWaves}</em>
          </span>
          <div className="hud__bar">
            <div className="hud__bar-fill" style={{ scale: `${waveFraction} 1` }} />
          </div>
        </div>
      </div>

      <div className="hud__group hud__counters">
        <Counter label="enemies" value={state.enemyCount} />
        <Counter label="towers" value={state.towerCount} />
        <Counter label="shots" value={state.projectileCount} />
        <Counter label="leaks" value={state.leaks} />
      </div>
    </div>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="hud__counter">
      <span className="hud__counter-value">{value.toLocaleString()}</span>
      <span className="hud__counter-label">{label}</span>
    </div>
  );
}
