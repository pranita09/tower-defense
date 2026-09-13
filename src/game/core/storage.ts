/**
 * Small wrapper around `localStorage`.
 *
 * Private-browsing modes throw on access rather than returning null, so every
 * read and write is guarded: losing a high score is not worth crashing the game
 * over.
 */

const HIGH_SCORE_KEY = 'td.highScore';
const MUTED_KEY = 'td.muted';

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage is unavailable; the game is still perfectly playable.
  }
}

export function loadHighScore(): number {
  const raw = read(HIGH_SCORE_KEY);
  const value = raw === null ? 0 : Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function saveHighScore(score: number): number {
  const best = loadHighScore();
  if (score <= best) return best;
  write(HIGH_SCORE_KEY, String(Math.floor(score)));
  return Math.floor(score);
}

export function loadMuted(): boolean {
  return read(MUTED_KEY) === '1';
}

export function saveMuted(muted: boolean): void {
  write(MUTED_KEY, muted ? '1' : '0');
}
