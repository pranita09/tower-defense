import { Camera } from '../core/camera';
import { GRID_COLS, TILE_SIZE } from '../data/map';
import { SELL_REFUND_RATE, TOWER_DEFS, towerDps, towerUpgradeCost } from '../data/towers';
import { TOTAL_WAVES } from '../data/waves';
import type {
  EngineMode,
  GameEngine,
  GameStateSnapshot,
  RenderStats,
  SelectedTowerInfo,
  StressRequest,
} from '../engine';
import type { CanvasViewport } from '../render/viewport';
import { FastRenderer, type HoverState } from './fastRenderer';
import { FastSim } from './fastSim';

/** Wires the optimized simulation and renderer into the shared engine interface. */
export class FastEngine implements GameEngine {
  readonly mode: EngineMode = 'fast';
  readonly rendererLabel = 'WebGL2 instanced';

  private readonly sim = new FastSim();
  private readonly renderer: FastRenderer;
  private readonly camera = new Camera();
  private viewport: CanvasViewport;
  private hover: HoverState | null = null;

  constructor(
    gl: WebGL2RenderingContext,
    overlay: CanvasRenderingContext2D,
    viewport: CanvasViewport
  ) {
    this.renderer = new FastRenderer(gl, overlay);
    this.viewport = viewport;
    this.camera.fit(viewport.cssWidth, viewport.cssHeight);
    this.renderer.resize(viewport);
  }

  step(delta: number): void {
    this.sim.step(delta);
  }

  render(alpha: number): void {
    this.renderer.draw(
      this.sim,
      this.viewport,
      this.camera,
      alpha,
      this.hover,
      this.sim.towerIndexById(this.sim.selectedTowerId)
    );
  }

  resize(viewport: CanvasViewport): void {
    this.viewport = viewport;
    this.camera.fit(viewport.cssWidth, viewport.cssHeight);
    this.renderer.resize(viewport);
  }

  getState(): GameStateSnapshot {
    const sim = this.sim;
    return {
      phase: sim.phase,
      health: sim.health,
      maxHealth: sim.maxHealth,
      gold: sim.gold,
      score: sim.score,
      wave: sim.wave,
      totalWaves: TOTAL_WAVES,
      waveSpawned: sim.waveSpawned,
      waveTotal: sim.waveTotal,
      restSeconds: sim.phase === 'ready' ? Math.max(0, sim.restTimer) : 0,
      enemyCount: sim.enemyCount,
      towerCount: sim.towerCount,
      projectileCount: sim.projectileCount,
      leaks: sim.leaks,
      selected: this.describeSelection(),
    };
  }

  getRenderStats(): RenderStats {
    return this.renderer.stats;
  }

  private describeSelection(): SelectedTowerInfo | null {
    const index = this.sim.towerIndexById(this.sim.selectedTowerId);
    if (index < 0) return null;

    const typeId = this.sim.tType[index];
    const level = this.sim.tLevel[index];
    const stats = TOWER_DEFS[typeId].levels[level - 1];

    return {
      id: this.sim.tId[index],
      typeId,
      level,
      damage: stats.damage,
      range: stats.range,
      cooldown: stats.cooldown,
      dps: towerDps(typeId, level),
      splashRadius: stats.splashRadius,
      slowFactor: stats.slowFactor,
      upgradeCost: towerUpgradeCost(typeId, level),
      sellValue: Math.floor(this.sim.tInvested[index] * SELL_REFUND_RATE),
      kills: this.sim.tKills[index],
    };
  }

  tileAt(screenX: number, screenY: number): { col: number; row: number } {
    return {
      col: Math.floor(this.camera.toWorldX(screenX) / TILE_SIZE),
      row: Math.floor(this.camera.toWorldY(screenY) / TILE_SIZE),
    };
  }

  canPlace(col: number, row: number): boolean {
    return this.sim.canPlace(col, row);
  }

  placeTower(col: number, row: number, typeId: number): boolean {
    return this.sim.placeTower(col, row, typeId);
  }

  selectAt(screenX: number, screenY: number): number | null {
    const { col, row } = this.tileAt(screenX, screenY);
    const index = this.sim.towerIndexAtTile(col, row);
    this.sim.selectedTowerId = index >= 0 ? this.sim.tId[index] : null;
    return this.sim.selectedTowerId;
  }

  clearSelection(): void {
    this.sim.selectedTowerId = null;
  }

  upgradeSelected(): boolean {
    return this.sim.upgradeSelected();
  }

  sellSelected(): boolean {
    return this.sim.sellSelected();
  }

  setHover(screenX: number | null, screenY: number | null, typeId: number | null): void {
    if (screenX === null || screenY === null || typeId === null) {
      this.hover = null;
      return;
    }
    const { col, row } = this.tileAt(screenX, screenY);
    if (col < 0 || row < 0 || col >= GRID_COLS) {
      this.hover = null;
      return;
    }
    this.hover = { col, row, typeId, valid: this.sim.canPlace(col, row) };
  }

  zoomAt(factor: number, screenX: number, screenY: number): void {
    this.camera.setZoom(this.camera.zoom * factor, screenX, screenY);
  }

  panBy(dx: number, dy: number): void {
    this.camera.panByScreen(dx, dy);
  }

  resetView(): void {
    this.camera.reset();
  }

  getZoom(): number {
    return this.camera.zoom;
  }

  startWave(): boolean {
    return this.sim.startWave();
  }

  restart(): void {
    this.sim.reset();
    this.hover = null;
    this.camera.reset();
  }

  stress(request: StressRequest): void {
    this.sim.stress(request);
  }

  dispose(): void {
    this.sim.reset();
    this.renderer.dispose();
  }
}
