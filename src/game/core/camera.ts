import { WORLD_HEIGHT, WORLD_WIDTH } from '../data/map';

/**
 * Maps world coordinates to the canvas.
 *
 * The whole battlefield is fitted into the visible area and centred, so the
 * simulation never has to care about window size. Insets keep the play field
 * clear of the floating HUD.
 */

export interface CameraInset {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const DEFAULT_INSET: CameraInset = { top: 62, right: 14, bottom: 96, left: 14 };

export class Camera {
  scale = 1;
  offsetX = 0;
  offsetY = 0;

  fit(viewWidth: number, viewHeight: number, inset: CameraInset = DEFAULT_INSET): void {
    const availableWidth = Math.max(120, viewWidth - inset.left - inset.right);
    const availableHeight = Math.max(120, viewHeight - inset.top - inset.bottom);

    this.scale = Math.min(availableWidth / WORLD_WIDTH, availableHeight / WORLD_HEIGHT);
    this.offsetX = inset.left + (availableWidth - WORLD_WIDTH * this.scale) / 2;
    this.offsetY = inset.top + (availableHeight - WORLD_HEIGHT * this.scale) / 2;
  }

  toWorldX(screenX: number): number {
    return (screenX - this.offsetX) / this.scale;
  }

  toWorldY(screenY: number): number {
    return (screenY - this.offsetY) / this.scale;
  }
}
