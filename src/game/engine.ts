import type { CanvasViewport } from './render/viewport';

/**
 * The contract between the React shell and a game implementation.
 *
 * Two implementations exist behind this interface: the naive one, kept as a
 * baseline so its breaking point stays reproducible, and the optimized one.
 * Because the UI only ever talks to this surface, the two can be swapped at
 * runtime and compared directly.
 */

export type GamePhase =
  /** Between waves, waiting for the player to send the next one. */
  | 'ready'
  /** A wave is spawning or still on the field. */
  | 'wave'
  /** All 50 waves cleared. */
  | 'victory'
  /** Base health reached zero. */
  | 'defeat';

export interface SelectedTowerInfo {
  id: number;
  typeId: number;
  level: number;
  damage: number;
  range: number;
  cooldown: number;
  dps: number;
  splashRadius: number;
  slowFactor: number;
  /** Null when the tower is fully upgraded. */
  upgradeCost: number | null;
  sellValue: number;
  kills: number;
}

export interface GameStateSnapshot {
  phase: GamePhase;
  health: number;
  maxHealth: number;
  gold: number;
  score: number;
  wave: number;
  totalWaves: number;
  /** Enemies spawned so far in the current wave. */
  waveSpawned: number;
  /** Enemies the current wave will spawn in total. */
  waveTotal: number;
  /** Seconds until the next wave sends itself. Zero while a wave is running. */
  restSeconds: number;
  enemyCount: number;
  towerCount: number;
  projectileCount: number;
  /** Enemies that reached the base this run. */
  leaks: number;
  selected: SelectedTowerInfo | null;
}

export interface StressRequest {
  enemies: number;
  towers: number;
  projectiles: number;
}

/** What the renderer actually submitted last frame. */
export interface RenderStats {
  /** Sprites uploaded and drawn. */
  sprites: number;
  /** Sprites rejected for being outside the visible area. */
  culled: number;
  drawCalls: number;
}

export type EngineMode = 'fast' | 'naive';

export interface GameEngine {
  /** Which implementation this is, for the UI badge. */
  readonly mode: EngineMode;
  readonly rendererLabel: string;

  /** Advance the simulation by a fixed delta. */
  step(delta: number): void;
  /** Draw the world. `alpha` interpolates between the last two ticks. */
  render(alpha: number): void;
  /** Called when the canvas backing store changes size. */
  resize(viewport: CanvasViewport): void;

  getState(): GameStateSnapshot;
  getRenderStats(): RenderStats;

  /** Screen (CSS pixel) position to tile coordinates. */
  tileAt(screenX: number, screenY: number): { col: number; row: number };
  canPlace(col: number, row: number): boolean;
  placeTower(col: number, row: number, typeId: number): boolean;
  /** Selects the tower under the cursor, or clears the selection. Returns the id. */
  selectAt(screenX: number, screenY: number): number | null;
  clearSelection(): void;
  upgradeSelected(): boolean;
  sellSelected(): boolean;

  /** Ghost preview follows the cursor; pass null to hide it. */
  setHover(screenX: number | null, screenY: number | null, typeId: number | null): void;

  /** Zooms about a screen point. `factor` multiplies the current zoom. */
  zoomAt(factor: number, screenX: number, screenY: number): void;
  panBy(dx: number, dy: number): void;
  resetView(): void;
  /** Current zoom level, for the UI. */
  getZoom(): number;

  startWave(): boolean;
  restart(): void;

  /** Injects a synthetic load for benchmarking. */
  stress(request: StressRequest): void;

  dispose(): void;
}
