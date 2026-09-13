import { TOWER_DEFS } from '../game/data/towers';
import './panels.css';

interface TowerShopProps {
  gold: number;
  selectedType: number | null;
  onSelect: (typeId: number | null) => void;
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
            title={def.description}
            onClick={() => onSelect(active ? null : typeId)}
          >
            <span className="shop__swatch" style={{ background: def.color }} aria-hidden="true" />
            <span className="shop__name">
              {def.name}
              <span className="shop__hotkey">{def.hotkey}</span>
            </span>
            <span className="shop__meta">
              <span className="shop__role">{def.role}</span>
              <span className="shop__cost">{cost}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
