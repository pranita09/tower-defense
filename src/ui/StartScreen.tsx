import { ENEMY_DEFS } from '../game/data/enemies';
import { TOWER_DEFS } from '../game/data/towers';
import { STARTING_GOLD, STARTING_HEALTH, TOTAL_WAVES } from '../game/data/waves';
import './StartScreen.css';

interface StartScreenProps {
  highScore: number;
  onStart: () => void;
}

export function StartScreen({ highScore, onStart }: StartScreenProps) {
  return (
    <div className="start" role="dialog" aria-modal="true" aria-label="SiegeBound">
      <div className="start__panel">
        <header className="start__hero">
          <p className="start__eyebrow">Tower defense</p>
          <h1 className="start__title">SiegeBound</h1>
          <p className="start__lede">
            {TOTAL_WAVES} waves march toward your core. You start with {STARTING_GOLD} gold and{' '}
            {STARTING_HEALTH} health. Towers fire on their own — your job is where to put them, and
            when to upgrade.
          </p>
        </header>

        <ol className="start__steps">
          <li>
            <span className="start__step-n">1</span>
            <span>
              Pick a tower, then click a dark tile beside the road. <kbd>Q</kbd>–<kbd>T</kbd> select
              from the shop.
            </span>
          </li>
          <li>
            <span className="start__step-n">2</span>
            <span>
              Click a tower to inspect it. <kbd>U</kbd> upgrades one. <kbd>A</kbd> upgrades every
              tower you can currently afford, cheapest first.
            </span>
          </li>
          <li>
            <span className="start__step-n">3</span>
            <span>
              Waves send themselves, or press <kbd>Enter</kbd> early for bonus gold. Every 5th wave
              is a surge. Every 10th is a boss.
            </span>
          </li>
        </ol>

        <div className="start__columns">
          <section>
            <h2 className="start__subtitle">Defenses</h2>
            <ul className="start__cards">
              {TOWER_DEFS.map((def) => (
                <li key={def.id} className="start__card">
                  <span className="start__swatch" style={{ background: def.color }} />
                  <div>
                    <strong>
                      {def.name} <em>{def.hotkey}</em>
                    </strong>
                    <p>{def.description}</p>
                    <p className="start__tip">
                      Best vs {def.bestVs}. {def.watchOut}.
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="start__subtitle">Attackers</h2>
            <ul className="start__cards">
              {ENEMY_DEFS.map((def) => (
                <li key={def.id} className="start__card">
                  <span className="start__swatch" style={{ background: def.color }} />
                  <div>
                    <strong>{def.name}</strong>
                    <p>{def.description}</p>
                    <p className="start__tip">{def.counter}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="start__footer">
          <button className="action action--primary start__play" type="button" onClick={onStart}>
            Play
          </button>
          {highScore > 0 && (
            <span className="start__best">Best score {highScore.toLocaleString()}</span>
          )}
          <span className="start__hint">
            <kbd>Space</kbd> pause · <kbd>1</kbd>–<kbd>3</kbd> speed · scroll to zoom
          </span>
        </div>
      </div>
    </div>
  );
}
