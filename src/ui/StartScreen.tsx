import { ENEMY_DEFS } from '../game/data/enemies';
import { TOWER_DEFS } from '../game/data/towers';
import { STARTING_GOLD, STARTING_HEALTH, TOTAL_WAVES } from '../game/data/waves';
import './StartScreen.css';

/**
 * Title screen. Puts the rules in one place, and gives browsers the click they
 * require before audio can start.
 */

interface StartScreenProps {
  highScore: number;
  onStart: () => void;
}

export function StartScreen({ highScore, onStart }: StartScreenProps) {
  return (
    <div className="start" role="dialog" aria-modal="true" aria-label="SiegeBound">
      <div className="start__panel">
        <p className="start__eyebrow">Tower defense</p>
        <h1 className="start__title">SiegeBound</h1>
        <p className="start__lede">
          {TOTAL_WAVES} waves march down the road toward your core. Build turrets on the open ground
          beside it, upgrade what is working, and sell what is not.
        </p>

        <ol className="start__steps">
          <li>
            <strong>Pick a tower</strong> from the shop at the bottom, then click a dark tile to
            build. You start with {STARTING_GOLD} gold and {STARTING_HEALTH} core health.
          </li>
          <li>
            <strong>Towers fire on their own.</strong> Kills pay gold; enemies that reach the core
            cost health.
          </li>
          <li>
            <strong>Click a tower</strong> to inspect it, then upgrade (<kbd>U</kbd>) or sell (
            <kbd>X</kbd>).
          </li>
          <li>
            <strong>Waves send themselves</strong> after a breather, or press <kbd>Enter</kbd> early
            for bonus gold.
          </li>
        </ol>

        <div className="start__columns">
          <section>
            <h2 className="start__subtitle">Towers</h2>
            <ul className="start__list">
              {TOWER_DEFS.map((def) => (
                <li key={def.id}>
                  <span className="start__swatch" style={{ background: def.color }} />
                  <strong>{def.name}</strong>
                  <span>{def.role}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="start__subtitle">Enemies</h2>
            <ul className="start__list">
              {ENEMY_DEFS.map((def) => (
                <li key={def.id}>
                  <span className="start__swatch" style={{ background: def.color }} />
                  <strong>{def.name}</strong>
                  <span>{def.description}</span>
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
            <kbd>Space</kbd> pause · <kbd>1</kbd>–<kbd>3</kbd> speed · scroll to zoom · right-drag
            to pan
          </span>
        </div>
      </div>
    </div>
  );
}
