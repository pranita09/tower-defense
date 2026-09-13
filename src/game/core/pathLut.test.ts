import { describe, expect, it } from 'vitest';
import { AIR_ROUTE_LENGTH, GROUND_LUT } from './pathLut';
import { BASE_POSITION, PATH, PATH_LENGTH, samplePath, type PathPoint } from '../data/map';

const scratch: PathPoint = { x: 0, y: 0, segment: 0 };
const result = { x: 0, y: 0 };

describe('PathLut', () => {
  it('matches the exact path within a fraction of a pixel', () => {
    // The table replaces `samplePath`, so it has to give the same answer.
    let worst = 0;
    for (let distance = 0; distance <= PATH_LENGTH; distance += 1.7) {
      samplePath(distance, scratch);
      GROUND_LUT.positionAt(distance, result);
      worst = Math.max(worst, Math.hypot(result.x - scratch.x, result.y - scratch.y));
    }
    expect(worst).toBeLessThan(0.5);
  });

  it('is exact at the ends', () => {
    GROUND_LUT.positionAt(0, result);
    expect(result.x).toBeCloseTo(PATH[0].x, 3);
    expect(result.y).toBeCloseTo(PATH[0].y, 3);

    GROUND_LUT.positionAt(PATH_LENGTH, result);
    expect(result.x).toBeCloseTo(BASE_POSITION.x, 1);
    expect(result.y).toBeCloseTo(BASE_POSITION.y, 1);
  });

  it('clamps instead of reading past the table', () => {
    GROUND_LUT.positionAt(-500, result);
    expect(Number.isFinite(result.x)).toBe(true);
    expect(result.x).toBeCloseTo(PATH[0].x, 3);

    GROUND_LUT.positionAt(PATH_LENGTH * 4, result);
    expect(Number.isFinite(result.x)).toBe(true);
    expect(result.x).toBeCloseTo(BASE_POSITION.x, 1);
  });

  it('gives flyers a shorter route than the road', () => {
    // Flying straight has to be a real advantage, or the type is pointless.
    expect(AIR_ROUTE_LENGTH).toBeLessThan(PATH_LENGTH);
  });
});
