import type { CanvasViewport } from './render/viewport';

/**
 * The contract between the React shell and a game implementation. The naive and
 * optimized engines both satisfy it, which is what lets the UI swap them at
 * runtime and compare them fairly.
 */

export type GamePhase = 'ready' | 'wave' | 'victory' | 'defeat';

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

/** What the renderer submitted last frame. */
export interface RenderStats {
  sprites: number;
  /** Rejected for being outside the visible area. */
  culled: number;
  drawCalls: number;
}

export type EngineMode = 'fast' | 'naive';

export interface GameEngine {
  readonly mode: EngineMode;
  readonly rendererLabel: string;

  step(delta: number): void;
  /** `alpha` interpolates between the last two ticks. */
  render(alpha: number): void;
  resize(viewport: CanvasViewport): void;

  getState(): GameStateSnapshot;
  getRenderStats(): RenderStats;

  /** Screen (CSS pixel) position to tile coordinates. */
  tileAt(screenX: number, screenY: number): { col: number; row: number };
  canPlace(col: number, row: number): boolean;
  placeTower(col: number, row: number, typeId: number): boolean;
  /** Selects the tower under the cursor, or clears the selection. */
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
  getZoom(): number;

  startWave(): boolean;
  restart(): void;

  /** Injects a synthetic load for benchmarking. */
  stress(request: StressRequest): void;

  dispose(): void;
}
