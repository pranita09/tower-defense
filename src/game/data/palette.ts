import { ENEMY_DEFS } from './enemies';
import { TOWER_DEFS } from './towers';

/**
 * Colours packed as 0xRRGGBB integers.
 *
 * The optimized simulation stores a particle's colour as one number in a typed
 * array rather than a string reference, and the WebGL renderer needs floats per
 * channel anyway. Packing once at startup avoids parsing hex strings per frame.
 */

export function packHex(hex: string): number {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;
  return Number.parseInt(full, 16) >>> 0;
}

export function unpackRed(packed: number): number {
  return ((packed >> 16) & 0xff) / 255;
}

export function unpackGreen(packed: number): number {
  return ((packed >> 8) & 0xff) / 255;
}

export function unpackBlue(packed: number): number {
  return (packed & 0xff) / 255;
}

export const ENEMY_COLORS: readonly number[] = ENEMY_DEFS.map((def) => packHex(def.color));
export const ENEMY_ACCENTS: readonly number[] = ENEMY_DEFS.map((def) => packHex(def.accent));
export const TOWER_COLORS: readonly number[] = TOWER_DEFS.map((def) => packHex(def.color));
export const TOWER_ACCENTS: readonly number[] = TOWER_DEFS.map((def) => packHex(def.accent));

export const COLOR_GOLD = packHex('#ffc94d');
export const COLOR_DANGER = packHex('#ff5d5d');
export const COLOR_FROST = packHex('#7ad7ff');
export const COLOR_GOOD = packHex('#5ddf8f');
export const COLOR_WARN = packHex('#ffa94d');
export const COLOR_WHITE = packHex('#ffffff');
