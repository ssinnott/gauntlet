// 640x360 render canvas, scaled up to the window by the compositor (ARCHITECTURE.md section 0/3).
//
// The game draws at exactly 640x360 into the canvas that is on the page, and CSS (`image-rendering: pixelated`
// in index.html) blows it up to fill the window. It used to render into a separate offscreen canvas and
// `present()` it with a per-frame `drawImage` onto a display canvas whose backing store was the FULL window in
// device pixels — 3840x2160 on a 4K screen, 5120x2880 at 4x on a retina panel. That blit re-rasterised up to
// 8-15 million pixels every frame to produce a nearest-neighbour upscale the compositor already does for free
// as part of the layer transform, and it was by far the most expensive thing the game did. Sizing the backing
// store to the art instead (640x360, ~0.9 MB instead of up to 32 MB) deletes that pass.
//
// Measured with the headless-Chromium harness (software rasteriser, so the absolute numbers are pessimistic —
// but the shape is the point), a busy fight in a 4K window: 30.1 ms per frame before, 19.6 ms after. The telling
// part is how frame time tracked the WINDOW, which a 640x360 game has no business caring about — 19.6 / 21.0 /
// 21.7 / 24.1 ms at 640x360 / 1280x720 / 1920x1080 / 2560x1440 before, and a flat 19.6 ms at every one of them
// after. On a machine with a GPU the blit is cheaper than it is here, but it is still a full extra rasterisation
// pass into a bitmap tens of MB wide, every frame, for no pixels.
//
// The output is identical wherever the scale is a whole number of device pixels per game pixel, which is the
// case the `cssScale` logic below already aims for; at a fractional scale the compositor now does one
// nearest-neighbour resample where the old path did two (game -> rounded backing store -> screen).
//
// LIBRARY SEAM: in both games this module read `VIEW_W` / `VIEW_H` from the game's own `src/constants.js`,
// which a library cannot import. They are now `width` / `height` on the options object, defaulting to the
// 640 / 360 that both games define today, so `createCanvas(mount)` behaves exactly as it did before.

/** A point in internal canvas space: 0,0 is the top-left of the game rect. */
export interface CanvasPoint {
  x: number;
  y: number;
}

/** Options for `createCanvas`: the internal render size, i.e. the game's own `VIEW_W` / `VIEW_H`. */
export interface CanvasOptions {
  /** Internal render width in px. */
  width?: number;
  /** Internal render height in px. */
  height?: number;
}

/** The render canvas, its 2D context and the window hookup, as returned by `createCanvas`. */
export interface Canvas {
  /** The 2D context to draw the frame into, with image smoothing already off. */
  ctx: CanvasRenderingContext2D;
  /** The canvas that is on the page. */
  canvas: HTMLCanvasElement;
  /** The same element as `canvas`: there is no separate internal canvas any more. */
  displayCanvas: HTMLCanvasElement;
  /** Device pixels per game pixel. */
  scale: number;
  /** CSS pixels per game pixel. */
  cssScale: number;
  /** Device pixel ratio, clamped to [1, 4]. */
  dpr: number;
  /** Left edge of the game rect inside the canvas; always 0, the page centres the element. */
  offsetX: number;
  /** Top edge of the game rect inside the canvas; always 0, the page centres the element. */
  offsetY: number;
  /** Size the canvas ELEMENT to the window, keeping the 16:9 game rect and crisp pixels. */
  resize(): void;
  /** End-of-frame call site; a no-op with this backend. */
  present(): void;
  /** Map a client (pointer) coordinate to internal canvas space. */
  toInternal(clientX: number, clientY: number): CanvasPoint;
}

/**
 * Create the render canvas and hook it up to the window.
 * @param mount a canvas element (used directly), a container, or an element id
 * @param options the internal render size; defaults to the 640x360 both games use
 * @returns the `Canvas` api.
 *   `scale` is device pixels per game pixel; `cssScale` is CSS pixels per game pixel. `canvas` and
 *   `displayCanvas` are the same element: there is no separate internal canvas any more.
 */
export function createCanvas(
  mount: HTMLCanvasElement | HTMLElement | string,
  { width = 640, height = 360 }: CanvasOptions = {},
): Canvas {
  const found = typeof mount === 'string' ? document.getElementById(mount) : mount;
  let display: HTMLCanvasElement;
  if (found instanceof HTMLCanvasElement) {
    display = found;
  } else {
    display = document.createElement('canvas');
    display.id = 'game';
    (found || document.body).appendChild(display);
  }
  // The backing store is the game's own resolution and never changes size, so `imageSmoothingEnabled` (which a
  // width/height assignment would reset) is set once here, and a resize can never clear a half-drawn frame.
  display.width = width;
  display.height = height;
  // A fresh 2D context is never null in a browser, and a runtime null check here would be new behaviour.
  const ctx = display.getContext('2d', { alpha: false })!;
  ctx.imageSmoothingEnabled = false;
  /** Cached client rect for toInternal, invalidated on resize so pointer events force no layout. */
  let rect: DOMRect | null = null;

  const api: Canvas = {
    ctx, canvas: display, displayCanvas: display, scale: 1, cssScale: 1, dpr: 1, offsetX: 0, offsetY: 0,
    /** Size the canvas ELEMENT to the window, keeping the 16:9 game rect and crisp pixels. */
    resize() {
      const dpr = Math.max(1, Math.min(4, window.devicePixelRatio || 1));
      const cw = Math.max(1, window.innerWidth || width);
      const ch = Math.max(1, window.innerHeight || height);
      api.dpr = dpr;
      // CSS pixels per game pixel that would exactly fit the window.
      const fit = Math.min(cw / width, ch / height);
      // Prefer a whole number of CSS pixels per game pixel, but only when that still fills most of
      // the window: on a phone (fit < 1) the next whole step would overflow, and on a small window
      // it would waste half the screen, so there we scale to fit instead.
      const whole = Math.floor(fit);
      const cssScale = whole >= 1 && whole / fit >= 0.8 ? whole : fit;
      api.cssScale = cssScale;
      api.scale = cssScale * dpr;
      display.style.width = Math.round(width * cssScale) + 'px';
      display.style.height = Math.round(height * cssScale) + 'px';
      // The canvas is exactly the game rect now; the page centres it, so there is no inner letterbox.
      api.offsetX = 0;
      api.offsetY = 0;
      rect = null;
    },
    /**
     * No-op: the frame is already in the canvas that is on the page. Kept so the render path keeps an explicit
     * end-of-frame call site (and so a future backend that does need a commit step has somewhere to put it).
     */
    present() {},
    /** Map a client (pointer) coordinate to internal canvas space. */
    toInternal(clientX, clientY) {
      if (!rect || !rect.width) rect = display.getBoundingClientRect();
      if (!rect.width || !rect.height) return { x: 0, y: 0 };
      return { x: (clientX - rect.left) * (width / rect.width), y: (clientY - rect.top) * (height / rect.height) };
    },
  };
  api.resize();
  window.addEventListener('resize', api.resize);
  // The element is centred by the page, so its client rect also moves when the page scrolls or the mobile
  // visual viewport shifts (an on-screen keyboard); both are rare, so just drop the cache.
  window.addEventListener('scroll', () => { rect = null; }, { passive: true });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', () => { rect = null; });
  return api;
}
