import { clamp } from './math';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../data/map';

// Maps world coordinates to the canvas. At zoom 1 the whole field is fitted and
// centred, with insets keeping it clear of the floating HUD. Zooming in is also
// how off-screen culling becomes observable in the overlay.

export interface CameraInset {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const DEFAULT_INSET: CameraInset = { top: 62, right: 14, bottom: 96, left: 14 };

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 6;

export class Camera {
  // Final world-to-screen scale, including zoom.
  scale = 1;
  offsetX = 0;
  offsetY = 0;
  zoom = 1;
  // World point held at the centre of the view.
  centreX = WORLD_WIDTH / 2;
  centreY = WORLD_HEIGHT / 2;

  private viewWidth = 0;
  private viewHeight = 0;
  private inset: CameraInset = DEFAULT_INSET;
  private fitScale = 1;

  // Visible world rectangle, used for culling.
  minX = 0;
  minY = 0;
  maxX = WORLD_WIDTH;
  maxY = WORLD_HEIGHT;

  fit(viewWidth: number, viewHeight: number, inset: CameraInset = DEFAULT_INSET): void {
    this.viewWidth = viewWidth;
    this.viewHeight = viewHeight;
    this.inset = inset;
    this.recompute();
  }

  setZoom(zoom: number, anchorScreenX?: number, anchorScreenY?: number): void {
    const next = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    if (next === this.zoom) return;

    if (anchorScreenX === undefined || anchorScreenY === undefined) {
      this.zoom = next;
      this.recompute();
      return;
    }

    // Keep the world point pinned while zooming.
    const worldX = this.toWorldX(anchorScreenX);
    const worldY = this.toWorldY(anchorScreenY);
    this.zoom = next;
    this.recompute();
    const afterX = this.toWorldX(anchorScreenX);
    const afterY = this.toWorldY(anchorScreenY);
    this.centreX += worldX - afterX;
    this.centreY += worldY - afterY;
    this.recompute();
  }

  panByScreen(dx: number, dy: number): void {
    if (this.scale === 0) return;
    this.centreX -= dx / this.scale;
    this.centreY -= dy / this.scale;
    this.recompute();
  }

  reset(): void {
    this.zoom = 1;
    this.centreX = WORLD_WIDTH / 2;
    this.centreY = WORLD_HEIGHT / 2;
    this.recompute();
  }

  toWorldX(screenX: number): number {
    return (screenX - this.offsetX) / this.scale;
  }

  toWorldY(screenY: number): number {
    return (screenY - this.offsetY) / this.scale;
  }

  private recompute(): void {
    const availableWidth = Math.max(120, this.viewWidth - this.inset.left - this.inset.right);
    const availableHeight = Math.max(120, this.viewHeight - this.inset.top - this.inset.bottom);

    this.fitScale = Math.min(availableWidth / WORLD_WIDTH, availableHeight / WORLD_HEIGHT);
    this.scale = this.fitScale * this.zoom;

    const visibleWidth = availableWidth / this.scale;
    const visibleHeight = availableHeight / this.scale;

    // Clamp the centre so the world never drifts.
    const halfWidth = Math.min(visibleWidth, WORLD_WIDTH) / 2;
    const halfHeight = Math.min(visibleHeight, WORLD_HEIGHT) / 2;
    this.centreX = clamp(this.centreX, halfWidth, WORLD_WIDTH - halfWidth);
    this.centreY = clamp(this.centreY, halfHeight, WORLD_HEIGHT - halfHeight);

    const viewCentreX = this.inset.left + availableWidth / 2;
    const viewCentreY = this.inset.top + availableHeight / 2;
    this.offsetX = viewCentreX - this.centreX * this.scale;
    this.offsetY = viewCentreY - this.centreY * this.scale;

    this.minX = this.toWorldX(0);
    this.minY = this.toWorldY(0);
    this.maxX = this.toWorldX(this.viewWidth);
    this.maxY = this.toWorldY(this.viewHeight);
  }
}
