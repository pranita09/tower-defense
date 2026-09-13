import { describe, expect, it } from 'vitest';
import { applyArmor } from '../data/enemies';
import { PATH_LENGTH } from '../data/map';
import { SELL_REFUND_RATE, TOWER_GUN, TOWER_MORTAR, towerBuildCost } from '../data/towers';
import { STARTING_GOLD, STARTING_HEALTH } from '../data/waves';
import { NaiveSim } from './naiveSim';

const TICK = 1 / 60;

/** Runs the simulation for `seconds` of game time at the fixed tick rate. */
function run(sim: NaiveSim, seconds: number): void {
  const ticks = Math.round(seconds / TICK);
  for (let i = 0; i < ticks; i += 1) sim.step(TICK);
}

/** A tile that is buildable and close to the start of the path. */
function findBuildableTile(sim: NaiveSim): { col: number; row: number } {
  for (let row = 0; row < 22; row += 1) {
    for (let col = 0; col < 40; col += 1) {
      if (sim.canPlace(col, row)) return { col, row };
    }
  }
  throw new Error('No buildable tile found');
}

describe('armor', () => {
  it('reduces damage but never nullifies a hit', () => {
    expect(applyArmor(20, 5)).toBe(15);
    expect(applyArmor(9, 7)).toBe(2);
    expect(applyArmor(4, 40)).toBe(1);
  });
});

describe('economy', () => {
  it('charges for towers and refuses unaffordable ones', () => {
    const sim = new NaiveSim();
    const tile = findBuildableTile(sim);

    expect(sim.gold).toBe(STARTING_GOLD);
    expect(sim.placeTower(tile.col, tile.row, TOWER_GUN)).toBe(true);
    expect(sim.gold).toBe(STARTING_GOLD - towerBuildCost(TOWER_GUN));

    sim.gold = 0;
    expect(sim.placeTower(tile.col, tile.row + 2, TOWER_MORTAR)).toBe(false);
  });

  it('refuses to stack two towers on one tile', () => {
    const sim = new NaiveSim();
    const tile = findBuildableTile(sim);

    expect(sim.placeTower(tile.col, tile.row, TOWER_GUN)).toBe(true);
    expect(sim.canPlace(tile.col, tile.row)).toBe(false);
    expect(sim.placeTower(tile.col, tile.row, TOWER_GUN)).toBe(false);
    expect(sim.towers).toHaveLength(1);
  });

  it('refunds a fraction of everything invested when selling', () => {
    const sim = new NaiveSim();
    const tile = findBuildableTile(sim);
    sim.placeTower(tile.col, tile.row, TOWER_GUN);
    sim.upgradeSelected();

    const invested = sim.towers[0].invested;
    const goldBeforeSale = sim.gold;
    expect(sim.sellSelected()).toBe(true);
    expect(sim.gold).toBe(goldBeforeSale + Math.floor(invested * SELL_REFUND_RATE));
    expect(sim.towers).toHaveLength(0);
    // The tile is free again.
    expect(sim.canPlace(tile.col, tile.row)).toBe(true);
  });

  it('stops upgrading at the maximum level', () => {
    const sim = new NaiveSim();
    const tile = findBuildableTile(sim);
    sim.placeTower(tile.col, tile.row, TOWER_GUN);
    sim.gold = 10_000;

    expect(sim.upgradeSelected()).toBe(true);
    expect(sim.upgradeSelected()).toBe(true);
    expect(sim.upgradeSelected()).toBe(false);
    expect(sim.towers[0].level).toBe(sim.maxTowerLevel());
  });
});

describe('waves', () => {
  it('sends the next wave automatically and pays a bonus for sending early', () => {
    const sim = new NaiveSim();
    const goldBefore = sim.gold;

    expect(sim.phase).toBe('ready');
    expect(sim.startWave()).toBe(true);
    expect(sim.phase).toBe('wave');
    expect(sim.wave).toBe(1);
    expect(sim.gold).toBeGreaterThan(goldBefore);
  });

  it('spawns the whole wave over time', () => {
    const sim = new NaiveSim();
    sim.startWave();
    expect(sim.enemies).toHaveLength(0);

    run(sim, 30);
    expect(sim.waveSpawned).toBe(sim.waveTotal);
    expect(sim.enemies.length).toBeGreaterThan(0);
  });

  it('starts the first wave on its own once the build timer expires', () => {
    const sim = new NaiveSim();
    run(sim, 21);
    expect(sim.wave).toBe(1);
    expect(sim.phase).toBe('wave');
  });
});

describe('base damage', () => {
  it('leaks cost health, and an undefended base eventually falls', () => {
    const sim = new NaiveSim();
    sim.startWave();
    // Unopposed, but one wave does not carry 20 damage, so this takes several.
    run(sim, 400);

    expect(sim.leaks).toBeGreaterThan(0);
    expect(sim.health).toBe(0);
    expect(sim.phase).toBe('defeat');
  });
});

describe('combat', () => {
  it('fires at enemies that come into range', () => {
    const sim = new NaiveSim();
    const tile = findBuildableTile(sim);
    sim.placeTower(tile.col, tile.row, TOWER_GUN);
    sim.startWave();

    // Counting shots, since the live projectile list is empty between hits.
    run(sim, 1);
    expect(sim.shotsFired).toBeGreaterThan(0);
  });

  it('kills enemies and pays gold and score', () => {
    const sim = new NaiveSim();
    sim.gold = 100_000;
    // A kill zone over the opening straight; one turret cannot finish a grunt alone.
    let towers = 0;
    for (let row = 0; row < 22; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        if (sim.canPlace(col, row) && sim.placeTower(col, row, TOWER_GUN)) towers += 1;
      }
    }
    expect(towers).toBeGreaterThan(4);

    sim.startWave();
    const goldAfterBuild = sim.gold;
    run(sim, 20);

    expect(sim.kills).toBeGreaterThan(0);
    expect(sim.score).toBeGreaterThan(0);
    expect(sim.gold).toBeGreaterThan(goldAfterBuild);
    expect(sim.leaks).toBe(0);
  });
});

describe('stress mode', () => {
  it('holds the requested population and recycles leaks instead of ending the run', () => {
    const sim = new NaiveSim();
    sim.stress({ enemies: 400, towers: 25, projectiles: 120 });

    expect(sim.enemies.length).toBe(400);
    expect(sim.towers.length).toBe(25);
    expect(sim.projectiles.length).toBeGreaterThanOrEqual(120);

    run(sim, 20);

    expect(sim.enemies.length).toBe(400);
    expect(sim.health).toBe(STARTING_HEALTH);
    expect(sim.phase).not.toBe('defeat');
  });

  it('spreads stress enemies along the whole path', () => {
    const sim = new NaiveSim();
    sim.stress({ enemies: 300, towers: 0, projectiles: 0 });

    let min = Infinity;
    let max = -Infinity;
    for (const enemy of sim.enemies) {
      min = Math.min(min, enemy.traveled);
      max = Math.max(max, enemy.traveled);
    }
    expect(min).toBeLessThan(PATH_LENGTH * 0.1);
    expect(max).toBeGreaterThan(PATH_LENGTH * 0.9);
  });

  it('is cleared by a reset', () => {
    const sim = new NaiveSim();
    sim.stress({ enemies: 200, towers: 10, projectiles: 50 });
    sim.reset();

    expect(sim.inStressMode).toBe(false);
    expect(sim.enemies).toHaveLength(0);
    expect(sim.towers).toHaveLength(0);
    expect(sim.gold).toBe(STARTING_GOLD);
  });
});
