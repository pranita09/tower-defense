/**
 * Owns the canvas backing-store size. The device pixel ratio is capped, since
 * matching a 4K display exactly quadruples the pixel work for no visible gain.
 * Resizes are applied from the render loop rather than from the observer, because
 * writing `canvas.width` mid-layout forces a reflow.
 */

export interface ViewportSize {
  /** CSS pixels — the space input events and layout use. */
  cssWidth: number;
  cssHeight: number;
  /** Backing-store pixels — what the renderer fills. */
  pixelWidth: number;
  pixelHeight: number;
  dpr: number;
}

export class CanvasViewport implements ViewportSize {
  cssWidth = 0;
  cssHeight = 0;
  pixelWidth = 0;
  pixelHeight = 0;
  dpr = 1;

  private readonly canvas: HTMLCanvasElement;
  private readonly mirrors: readonly HTMLCanvasElement[];
  private readonly maxDpr: number;
  private observer: ResizeObserver | null = null;
  private dprQuery: MediaQueryList | null = null;
  private pendingCssWidth = 0;
  private pendingCssHeight = 0;
  private dirty = true;

  /** `mirrors` are stacked canvases resized in lockstep, so their spaces agree. */
  constructor(
    canvas: HTMLCanvasElement,
    options: { maxDpr?: number; mirrors?: readonly HTMLCanvasElement[] } = {}
  ) {
    this.canvas = canvas;
    this.mirrors = options.mirrors ?? [];
    this.maxDpr = options.maxDpr ?? 2;
    this.pendingCssWidth = canvas.clientWidth;
    this.pendingCssHeight = canvas.clientHeight;
  }

  observe(): void {
    this.observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      // Already in CSS pixels, and avoids a layout read.
      const box = entry.contentBoxSize?.[0];
      if (box) {
        this.pendingCssWidth = box.inlineSize;
        this.pendingCssHeight = box.blockSize;
      } else {
        this.pendingCssWidth = entry.contentRect.width;
        this.pendingCssHeight = entry.contentRect.height;
      }
      this.dirty = true;
    });
    this.observer.observe(this.canvas);
    this.watchDevicePixelRatio();
  }

  dispose(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.dprQuery?.removeEventListener('change', this.onDprChange);
    this.dprQuery = null;
  }

  /** Applies any pending resize. Returns true when the buffer size changed. */
  sync(): boolean {
    if (!this.dirty) return false;
    this.dirty = false;

    const dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
    const cssWidth = this.pendingCssWidth || this.canvas.clientWidth;
    const cssHeight = this.pendingCssHeight || this.canvas.clientHeight;
    const pixelWidth = Math.max(1, Math.round(cssWidth * dpr));
    const pixelHeight = Math.max(1, Math.round(cssHeight * dpr));

    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
    this.dpr = dpr;

    if (pixelWidth === this.pixelWidth && pixelHeight === this.pixelHeight) return false;

    this.pixelWidth = pixelWidth;
    this.pixelHeight = pixelHeight;
    this.canvas.width = pixelWidth;
    this.canvas.height = pixelHeight;
    for (const mirror of this.mirrors) {
      mirror.width = pixelWidth;
      mirror.height = pixelHeight;
    }
    return true;
  }

  /** Moving to a monitor with a different ratio fires no resize event. */
  private watchDevicePixelRatio(): void {
    this.dprQuery?.removeEventListener('change', this.onDprChange);
    this.dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    this.dprQuery.addEventListener('change', this.onDprChange);
  }

  private onDprChange = (): void => {
    this.dirty = true;
    this.watchDevicePixelRatio();
  };
}
