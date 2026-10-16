export const GAME_W = 800;
export const GAME_H = 600;

export interface Viewport {
  scale: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

/** Fits the 800x600 game into a CSS box with black bars; results are in device pixels. */
export function computeViewport(cssW: number, cssH: number, dpr: number): Viewport {
  const scale = Math.min(cssW / GAME_W, cssH / GAME_H) * dpr;
  const width = Math.round(GAME_W * scale);
  const height = Math.round(GAME_H * scale);
  return { scale, width, height, offsetX: Math.round((cssW * dpr - width) / 2), offsetY: Math.round((cssH * dpr - height) / 2) };
}
