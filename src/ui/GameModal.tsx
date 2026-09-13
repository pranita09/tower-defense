import type { GameStateSnapshot } from '../game/engine';
import './panels.css';

interface GameModalProps {
  state: GameStateSnapshot;
  highScore: number;
  onRestart: () => void;
}

export function GameModal({ state, highScore, onRestart }: GameModalProps) {
  const victory = state.phase === 'victory';
  const isBest = state.score > 0 && state.score >= highScore;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="panel modal">
        <p className="modal__eyebrow">{victory ? 'The base holds' : 'The base has fallen'}</p>
        <h2 className={`modal__title modal__title--${victory ? 'victory' : 'defeat'}`}>
          {victory ? 'Victory' : 'Defeat'}
        </h2>

        <div className="modal__stats">
          <div className="modal__stat">
            <span className="modal__stat-value">{state.score.toLocaleString()}</span>
            <span className="modal__stat-label">Score</span>
          </div>
          <div className="modal__stat">
            <span className="modal__stat-value">
              {victory ? state.totalWaves : Math.max(0, state.wave - 1)}
            </span>
            <span className="modal__stat-label">Waves cleared</span>
          </div>
          <div className="modal__stat">
            <span className="modal__stat-value">{state.leaks.toLocaleString()}</span>
            <span className="modal__stat-label">Leaks</span>
          </div>
          <div className="modal__stat">
            <span className="modal__stat-value">{state.health}</span>
            <span className="modal__stat-label">Base left</span>
          </div>
        </div>

        <p className="modal__best">
          {isBest ? 'New best score' : `Best ${highScore.toLocaleString()}`}
        </p>

        <button className="action action--primary" type="button" onClick={onRestart} autoFocus>
          Play again
        </button>
      </div>
    </div>
  );
}
