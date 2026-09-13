import { describe, expect, it } from 'vitest';
import { AIR_ORIGIN_X, AIR_ORIGIN_Y, AIR_STEP_X, AIR_STEP_Y, GROUND_LUT } from '../core/pathLut';
import { ENEMY_DEFS, ENEMY_FLYER, ENEMY_SPLITTER } from '../data/enemies';
import { PATH_LENGTH } from '../data/map';
import {
  MAX_TOWER_LEVEL,
  SELL_REFUND_RATE,
  TOWER_GUN,
  TOWER_MORTAR,
  TOWER_TESLA,
  towerBuildCost,
} from '../data/towers';
import { STARTING_GOLD, STARTING_HEALTH, TOTAL_WAVES } from '../data/waves';
import { FastSim } from './fastSim';

const TICK = 1 / 60;

function run(sim: FastSim, seconds: number): void {
  const ticks = Math.round(seconds / TICK);
  for (let i = 0; i < ticks; i += 1) sim.step(TICK);
}

function findBuildableTile(sim: FastSim): { col: number; row: number } {
  for (let row = 0; row < 22; row += 1) {
    for (let col = 0; col < 40; col += 1) {
      if (sim.canPlace(col, row)) return { col, row };
    }
  }
  throw new Error('No buildable tile found');
}

/**
 * These mirror the naive tests on purpose: the optimized version is only worth
 * anything if it plays the same game.
 */

describe('economy', () => {
  it('charges for towers and refuses unaffordable ones', () => {
    const sim = new FastSim();
    const tile = findBuildableTile(sim);

    expect(sim.gold).toBe(STARTING_GOLD);
    expect(sim.placeTower(tile.col, tile.row, TOWER_GUN)).toBe(true);
    expect(sim.gold).toBe(STARTING_GOLD - towerBuildCost(TOWER_GUN));

    sim.gold = 0;
    expect(sim.placeTower(tile.col, tile.row + 2, TOWER_MORTAR)).toBe(false);
  });

  it('refuses to stack two towers on one tile', () => {
    const sim = new FastSim();
    const tile = findBuildableTile(sim);

    expect(sim.placeTower(tile.col, tile.row, TOWER_GUN)).toBe(true);
    expect(sim.canPlace(tile.col, tile.row)).toBe(false);
    expect(sim.placeTower(tile.col, tile.row, TOWER_GUN)).toBe(false);
    expect(sim.towerCount).toBe(1);
  });

  it('refunds a fraction of everything invested when selling', () => {
    const sim = new FastSim();
    const tile = findBuildableTile(sim);
    sim.placeTower(tile.col, tile.row, TOWER_GUN);
    sim.upgradeSelected();

    const invested = sim.tInvested[0];
    const goldBeforeSale = sim.gold;
    expect(sim.sellSelected()).toBe(true);
    expect(sim.gold).toBe(goldBeforeSale + Math.floor(invested * SELL_REFUND_RATE));
    expect(sim.towerCount).toBe(0);
    expect(sim.canPlace(tile.col, tile.row)).toBe(true);
  });

  it('keeps the tile index correct after a tower in the middle is sold', () => {
    // Swap-removal has to re-point the moved tower's tile, or the board disagrees.
    const sim = new FastSim();
    sim.gold = 10_000;

    const tiles: Array<{ col: number; row: number }> = [];
    for (let row = 0; row < 22 && tiles.length < 3; row += 1) {
      for (let col = 0; col < 40 && tiles.length < 3; col += 1) {
        if (sim.canPlace(col, row)) {
          sim.placeTower(col, row, TOWER_GUN);
          tiles.push({ col, row });
        }
      }
    }
    expect(tiles).toHaveLength(3);

    sim.selectedTowerId = sim.tId[0];
    expect(sim.sellSelected()).toBe(true);

    expect(sim.towerCount).toBe(2);
    expect(sim.canPlace(tiles[0].col, tiles[0].row)).toBe(true);
    for (const tile of tiles.slice(1)) {
      const index = sim.towerIndexAtTile(tile.col, tile.row);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(sim.tCol[index]).toBe(tile.col);
      expect(sim.tRow[index]).toBe(tile.row);
    }
  });

  it('stops upgrading at the maximum level', () => {
    const sim = new FastSim();
    const tile = findBuildableTile(sim);
    sim.placeTower(tile.col, tile.row, TOWER_GUN);
    sim.gold = 10_000;

    expect(sim.upgradeSelected()).toBe(true);
    expect(sim.upgradeSelected()).toBe(true);
    expect(sim.upgradeSelected()).toBe(false);
    expect(sim.tLevel[0]).toBe(MAX_TOWER_LEVEL);
  });
});

describe('waves', () => {
  it('sends the next wave automatically and pays a bonus for sending early', () => {
    const sim = new FastSim();
    const goldBefore = sim.gold;

    expect(sim.phase).toBe('ready');
    expect(sim.startWave()).toBe(true);
    expect(sim.phase).toBe('wave');
    expect(sim.wave).toBe(1);
    expect(sim.gold).toBeGreaterThan(goldBefore);
  });

  it('spawns the whole wave over time', () => {
    const sim = new FastSim();
    sim.startWave();
    expect(sim.enemyCount).toBe(0);

    run(sim, 30);
    expect(sim.waveSpawned).toBe(sim.waveTotal);
    expect(sim.enemyCount).toBeGreaterThan(0);
  });

  it('starts the first wave on its own once the build timer expires', () => {
    const sim = new FastSim();
    run(sim, 21);
    expect(sim.wave).toBe(1);
    expect(sim.phase).toBe('wave');
  });

  it('refuses to send a wave past the last one', () => {
    const sim = new FastSim();
    sim.wave = TOTAL_WAVES;
    sim.phase = 'ready';
    expect(sim.startWave()).toBe(false);
  });
});

describe('base damage', () => {
  it('leaks cost health, and an undefended base eventually falls', () => {
    const sim = new FastSim();
    sim.startWave();
    run(sim, 400);

    expect(sim.leaks).toBeGreaterThan(0);
    expect(sim.health).toBe(0);
    expect(sim.phase).toBe('defeat');
  });
});

describe('combat', () => {
  it('fires at enemies that come into range', () => {
    const sim = new FastSim();
    const tile = findBuildableTile(sim);
    sim.placeTower(tile.col, tile.row, TOWER_GUN);
    sim.startWave();

    run(sim, 1);
    expect(sim.shotsFired).toBeGreaterThan(0);
  });

  it('kills enemies and pays gold and score', () => {
    const sim = new FastSim();
    sim.gold = 100_000;

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

  it('credits kills to the tesla coil that landed them', () => {
    const sim = new FastSim();
    sim.gold = 100_000;
    let placed = 0;
    for (let row = 0; row < 22 && placed < 8; row += 1) {
      for (let col = 0; col < 10 && placed < 8; col += 1) {
        if (sim.canPlace(col, row) && sim.placeTower(col, row, TOWER_TESLA)) placed += 1;
      }
    }

    sim.startWave();
    run(sim, 25);

    let credited = 0;
    for (let i = 0; i < sim.towerCount; i += 1) credited += sim.tKills[i];
    expect(sim.kills).toBeGreaterThan(0);
    expect(credited).toBeGreaterThan(0);
  });
});

describe('enemy behaviour', () => {
  it('flies wisps straight to the base instead of along the road', () => {
    const sim = new FastSim();
    // Wave 6 is the first one with flyers in it.
    sim.wave = 5;
    sim.startWave();
    run(sim, 14);

    const road = { x: 0, y: 0 };
    let flyers = 0;
    let offRoad = 0;

    for (let i = 0; i < sim.enemies.activeCount; i += 1) {
      const slot = sim.enemies.active[i];
      if (!sim.isFlying(slot)) continue;
      flyers += 1;

      // On the straight line from spawn to base: the cross product vanishes.
      const cross =
        (sim.eX[slot] - AIR_ORIGIN_X) * AIR_STEP_Y - (sim.eY[slot] - AIR_ORIGIN_Y) * AIR_STEP_X;
      expect(Math.abs(cross)).toBeLessThan(0.5);

      // And genuinely away from where the road would have put it.
      GROUND_LUT.positionAt(sim.eDistance[slot], road);
      if (Math.hypot(sim.eX[slot] - road.x, sim.eY[slot] - road.y) > 50) offRoad += 1;
    }

    expect(ENEMY_DEFS[ENEMY_FLYER].flying).toBe(true);
    expect(flyers).toBeGreaterThan(0);
    expect(offRoad).toBeGreaterThan(0);
  });

  it('bursts splitters into children on death', () => {
    const sim = new FastSim();
    sim.wave = 1;
    sim.gold = 100_000;

    // A kill zone over the opening straight.
    let placed = 0;
    for (let row = 0; row < 22 && placed < 6; row += 1) {
      for (let col = 0; col < 8 && placed < 6; col += 1) {
        if (sim.canPlace(col, row) && sim.placeTower(col, row, TOWER_GUN)) placed += 1;
      }
    }
    expect(placed).toBeGreaterThan(2);

    // One enemy on the field, then out of stress mode so kills are counted.
    sim.stress({ enemies: 1, towers: 0, projectiles: 0 });
    sim.stress({ enemies: 0, towers: 0, projectiles: 0 });

    const slot = sim.enemies.active[0];
    sim.eType[slot] = ENEMY_SPLITTER;
    sim.eDistance[slot] = 0;
    sim.eMaxHp[slot] = 60;
    sim.eHp[slot] = 60;
    sim.eArmor[slot] = 0;
    sim.eSpeed[slot] = 30;

    // Short enough that the rest timer cannot send wave 2 into the kill count.
    run(sim, 6);

    // One spawn in, four kills out: more kills than spawns is the point of the type.
    expect(sim.kills).toBeGreaterThan(1);
    expect(sim.kills).toBeLessThanOrEqual(1 + ENEMY_DEFS[ENEMY_SPLITTER].splitCount);
  });
});

describe('stress mode', () => {
  it('holds the requested population and recycles leaks instead of ending the run', () => {
    const sim = new FastSim();
    sim.stress({ enemies: 400, towers: 25, projectiles: 120 });

    expect(sim.enemyCount).toBe(400);
    expect(sim.towerCount).toBe(25);
    expect(sim.projectileCount).toBeGreaterThanOrEqual(120);

    run(sim, 20);

    expect(sim.enemyCount).toBe(400);
    expect(sim.health).toBe(STARTING_HEALTH);
    expect(sim.phase).not.toBe('defeat');
  });

  it('reaches the graded load exactly', () => {
    const sim = new FastSim();
    sim.stress({ enemies: 5000, towers: 100, projectiles: 1000 });

    expect(sim.enemyCount).toBe(5000);
    expect(sim.towerCount).toBe(100);
    expect(sim.projectileCount).toBeGreaterThanOrEqual(1000);

    run(sim, 5);
    expect(sim.enemyCount).toBe(5000);
  });

  it('spreads stress enemies along the whole path', () => {
    const sim = new FastSim();
    sim.stress({ enemies: 300, towers: 0, projectiles: 0 });

    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < sim.enemies.activeCount; i += 1) {
      const slot = sim.enemies.active[i];
      min = Math.min(min, sim.eDistance[slot]);
      max = Math.max(max, sim.eDistance[slot]);
    }
    expect(min).toBeLessThan(PATH_LENGTH * 0.1);
    expect(max).toBeGreaterThan(PATH_LENGTH * 0.9);
  });

  it('is cleared by a reset', () => {
    const sim = new FastSim();
    sim.stress({ enemies: 200, towers: 10, projectiles: 50 });
    sim.reset();

    expect(sim.inStressMode).toBe(false);
    expect(sim.enemyCount).toBe(0);
    expect(sim.towerCount).toBe(0);
    expect(sim.gold).toBe(STARTING_GOLD);
  });
});

describe('memory behaviour', () => {
  it('returns every slot to its pool once the field clears', () => {
    const sim = new FastSim();
    sim.stress({ enemies: 2000, towers: 60, projectiles: 500 });
    run(sim, 10);
    expect(sim.enemies.freeSlots).toBeLessThan(sim.enemies.capacity);

    sim.reset();

    // No leaked slots, so a long session of restarts keeps memory flat.
    expect(sim.enemies.freeSlots).toBe(sim.enemies.capacity);
    expect(sim.projectiles.freeSlots).toBe(sim.projectiles.capacity);
  });
});
