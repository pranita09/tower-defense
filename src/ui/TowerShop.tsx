import { TOWER_DEFS } from '../game/data/towers';
import './panels.css';

interface TowerShopProps {
  gold: number;
  selectedType: number | null;
  onSelect: (typeId: number | null) => void;
}

function shopRole(role: string): string {
  if (role === 'Rapid single target') return 'Rapid fire';
  if (role === 'Splash damage') return 'Splash';
  if (role === 'Anti-armor chain') return 'Anti-armor';
  if (role === 'Long-range burst') return 'Long-range';
  return role;
}

export function TowerShop({ gold, selectedType, onSelect }: TowerShopProps) {
  return (
    <div className="panel shop" role="group" aria-label="Tower shop">
      {TOWER_DEFS.map((def, typeId) => {
        const cost = def.levels[0].cost;
        const affordable = gold >= cost;
        const active = selectedType === typeId;

        return (
          <button
            key={def.id}
            className={`shop__card${active ? ' is-active' : ''}`}
            type="button"
            disabled={!affordable}
            aria-pressed={active}
            aria-keyshortcuts={def.hotkey}
            title={`${def.description} Best vs ${def.bestVs}. ${def.watchOut}.`}
            onClick={() => onSelect(active ? null : typeId)}
          >
            <span className="shop__swatch" style={{ background: def.color }} aria-hidden="true" />
            <span className="shop__label">{def.name}</span>
            <span className="shop__hotkey">{def.hotkey}</span>
            <span className="shop__role">{shopRole(def.role)}</span>
            <span className="shop__cost">{cost}</span>
          </button>
        );
      })}
    </div>
  );
}
