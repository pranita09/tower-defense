import { MAX_TOWER_LEVEL, TOWER_DEFS } from '../game/data/towers';
import type { SelectedTowerInfo } from '../game/engine';
import './panels.css';

interface TowerPanelProps {
  selected: SelectedTowerInfo;
  gold: number;
  onUpgrade: () => void;
  onSell: () => void;
}

export function TowerPanel({ selected, gold, onUpgrade, onSell }: TowerPanelProps) {
  const def = TOWER_DEFS[selected.typeId];
  const maxed = selected.upgradeCost === null;
  const affordable = selected.upgradeCost !== null && gold >= selected.upgradeCost;

  return (
    <aside className="panel tower-panel" aria-label={`${def.name} details`}>
      <header className="tower-panel__header">
        <span
          className="tower-panel__swatch"
          style={{ background: def.color }}
          aria-hidden="true"
        />
        <span className="tower-panel__name">{def.name}</span>
        <span className="tower-panel__level">
          Lv {selected.level}/{MAX_TOWER_LEVEL}
        </span>
      </header>

      <dl className="tower-panel__stats">
        <Stat label="dmg" value={selected.damage.toFixed(0)} />
        <Stat label="dps" value={selected.dps.toFixed(1)} />
        <Stat label="range" value={selected.range.toFixed(0)} />
        <Stat label="rate" value={`${selected.cooldown.toFixed(2)}s`} />
        {selected.splashRadius > 0 && (
          <Stat label="splash" value={selected.splashRadius.toFixed(0)} />
        )}
        {selected.slowFactor > 0 && (
          <Stat label="slow" value={`${Math.round(selected.slowFactor * 100)}%`} />
        )}
        <Stat label="kills" value={selected.kills.toLocaleString()} />
      </dl>

      <div className="tower-panel__actions">
        <button
          className="action action--primary"
          type="button"
          disabled={maxed || !affordable}
          onClick={onUpgrade}
          aria-keyshortcuts="U"
        >
          {maxed ? 'Max level' : 'Upgrade'}
          {!maxed && <span className="action__cost">{selected.upgradeCost}</span>}
        </button>
        <button
          className="action action--danger"
          type="button"
          onClick={onSell}
          aria-keyshortcuts="X"
        >
          Sell<span className="action__cost">{selected.sellValue}</span>
        </button>
      </div>
    </aside>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="tower-panel__stat">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
