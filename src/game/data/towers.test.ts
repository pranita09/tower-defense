import { describe, expect, it } from 'vitest';
import { planAffordableUpgrades, TOWER_GUN, towerUpgradeCost } from './towers';

describe('planAffordableUpgrades', () => {
  it('spends on the cheapest upgrade first', () => {
    const gunCost = towerUpgradeCost(TOWER_GUN, 1);
    expect(gunCost).toBe(45);
    const plan = planAffordableUpgrades(
      [
        { typeId: TOWER_GUN, level: 1 },
        { typeId: TOWER_GUN, level: 1 },
        { typeId: TOWER_GUN, level: 1 },
      ],
      90
    );
    expect(plan.indices).toEqual([0, 1]);
    expect(plan.cost).toBe(90);
  });

  it('returns nothing when gold is too low', () => {
    const plan = planAffordableUpgrades([{ typeId: TOWER_GUN, level: 1 }], 10);
    expect(plan.indices).toHaveLength(0);
    expect(plan.cost).toBe(0);
  });
});
