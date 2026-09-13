import { Camera } from '../core/camera';
import { TILE_SIZE } from '../data/map';
import { towerDps, towerUpgradeCost, SELL_REFUND_RATE } from '../data/towers';
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
import { NaiveRenderer, type HoverState } from './naiveRenderer';
import { NaiveSim } from './naiveSim';

/** Wires the naive simulation and renderer into the shared engine interface. */
export class NaiveEngine implements GameEngine {
  readonly mode: EngineMode = 'naive';
  readonly rendererLabel = 'Canvas 2D, immediate mode';

  private readonly sim = new NaiveSim();
  private readonly renderer = new NaiveRenderer();
  private readonly camera = new Camera();
  private readonly ctx: CanvasRenderingContext2D;
  private viewport: CanvasViewport;
  private hover: HoverState | null = null;

  constructor(ctx: CanvasRenderingContext2D, viewport: CanvasViewport) {
    this.ctx = ctx;
    this.viewport = viewport;
    this.camera.fit(viewport.cssWidth, viewport.cssHeight);
  }

  step(delta: number): void {
    this.sim.step(delta);
  }

  render(alpha: number): void {
    this.renderer.draw(this.sim, this.ctx, this.viewport, this.camera, alpha, this.hover);
  }

  resize(viewport: CanvasViewport): void {
    this.viewport = viewport;
    this.camera.fit(viewport.cssWidth, viewport.cssHeight);
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
      enemyCount: sim.enemies.length,
      towerCount: sim.towers.length,
      projectileCount: sim.projectiles.length,
      leaks: sim.leaks,
      selected: this.describeSelection(),
    };
  }

  getRenderStats(): RenderStats {
    // A rough estimate: Canvas 2D has no sprite buffer to count. The point is that
    // it grows with the entity count instead of staying at two.
    const sim = this.sim;
    return {
      sprites: sim.enemies.length + sim.projectiles.length + sim.towers.length,
      culled: 0,
      drawCalls: sim.enemies.length * 3 + sim.projectiles.length * 2 + sim.towers.length * 3 + 260,
    };
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

  private describeSelection(): SelectedTowerInfo | null {
    const tower = this.sim.selectedTower();
    if (!tower) return null;
    const stats = this.sim.towerLevelStats(tower);
    return {
      id: tower.id,
      typeId: tower.typeId,
      level: tower.level,
      damage: stats.damage,
      range: stats.range,
      cooldown: stats.cooldown,
      dps: towerDps(tower.typeId, tower.level),
      splashRadius: stats.splashRadius,
      slowFactor: stats.slowFactor,
      upgradeCost: towerUpgradeCost(tower.typeId, tower.level),
      sellValue: Math.floor(tower.invested * SELL_REFUND_RATE),
      kills: tower.kills,
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
    const tower = this.sim.towerAtPoint(
      this.camera.toWorldX(screenX),
      this.camera.toWorldY(screenY)
    );
    this.sim.selectedTowerId = tower ? tower.id : null;
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
    this.hover = { col, row, typeId, valid: this.sim.canPlace(col, row) };
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
  }
}
