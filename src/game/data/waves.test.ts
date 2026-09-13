import { describe, expect, it } from 'vitest';
import { ENEMY_ARMORED, ENEMY_RUNNER } from './enemies';
import { getWave, TOTAL_WAVES, WAVES } from './waves';

describe('wave curve', () => {
  it('defines the full run', () => {
    expect(TOTAL_WAVES).toBeGreaterThanOrEqual(50);
    expect(WAVES).toHaveLength(TOTAL_WAVES);
    expect(WAVES[0].number).toBe(1);
    expect(WAVES[TOTAL_WAVES - 1].number).toBe(TOTAL_WAVES);
  });

  it('gets harder every wave without exception', () => {
    // Boss groups make the raw head count dip the wave after a boss, so the
    // monotonic invariant is on the regular population.
    const regularEnemies = (wave: (typeof WAVES)[number]) =>
      wave.groups.reduce((total, group) => (group.boss ? total : total + group.count), 0);

    for (let i = 1; i < WAVES.length; i += 1) {
      const previous = WAVES[i - 1];
      const wave = WAVES[i];
      expect(wave.healthScale).toBeGreaterThan(previous.healthScale);
      expect(regularEnemies(wave)).toBeGreaterThanOrEqual(regularEnemies(previous));
      expect(wave.armorBonus).toBeGreaterThanOrEqual(previous.armorBonus);
      expect(wave.reward).toBeGreaterThan(previous.reward);
    }
  });

  it('ramps difficulty by orders of magnitude, not percent', () => {
    const first = WAVES[0];
    const last = WAVES[TOTAL_WAVES - 1];
    expect(last.healthScale / first.healthScale).toBeGreaterThan(100);
    expect(last.totalEnemies).toBeGreaterThan(first.totalEnemies * 8);
    // Speed must stay readable, or late waves become unplayable rather than hard.
    expect(last.speedScale).toBeLessThan(1.5);
  });

  it('introduces new enemy types as the run progresses', () => {
    const usesType = (waveNumber: number, enemyId: number) =>
      getWave(waveNumber).groups.some((group) => group.enemyId === enemyId && !group.boss);

    expect(usesType(1, ENEMY_RUNNER)).toBe(false);
    expect(usesType(10, ENEMY_RUNNER)).toBe(true);
    expect(usesType(1, ENEMY_ARMORED)).toBe(false);
    expect(usesType(12, ENEMY_ARMORED)).toBe(true);
  });

  it('sends bosses every tenth wave and never before', () => {
    for (const wave of WAVES) {
      const hasBoss = wave.groups.some((group) => group.boss);
      expect(hasBoss).toBe(wave.number % 10 === 0);
    }
  });

  it('keeps waves small enough to read on screen', () => {
    for (const wave of WAVES) {
      expect(wave.totalEnemies).toBeLessThan(250);
    }
  });

  it('clamps lookups to the defined range', () => {
    expect(getWave(0).number).toBe(1);
    expect(getWave(-5).number).toBe(1);
    expect(getWave(999).number).toBe(TOTAL_WAVES);
  });
});
