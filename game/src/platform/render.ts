import type { DrawItem } from '../core/scene/objects';
import type { Assets } from './assets';
import { GAME_H, GAME_W, Viewport } from './viewport';

/** Draws the scene; leaves the game transform set (800x600 game pixels in the letterboxed viewport) for the HUD. */
export function drawScene(ctx: CanvasRenderingContext2D, vp: Viewport, items: DrawItem[], assets: Assets): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.imageSmoothingEnabled = false; // at fractional scale smoothing would bleed neighbouring frames of the sheet
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(vp.scale, 0, 0, vp.scale, vp.offsetX, vp.offsetY);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, GAME_W, GAME_H);
  ctx.clip();
  for (const it of items) {
    const img = assets.image(it.res, it.color);
    if (!img) continue;
    ctx.globalAlpha = it.opacity / 255;
    if (it.frame < 0) ctx.drawImage(img, it.x, it.y);
    else {
      // sheets are grids at most 4096 px wide (extract.py anim): the column count follows from the image itself;
      // a partial item (srcY) carries only its rows in h, so the cell height comes from the manifest
      const cellH = it.srcY === undefined ? it.h : (assets.manifest[String(it.res)] as { height: number }).height;
      const cols = Math.max(1, Math.round(img.naturalWidth / it.w));
      ctx.drawImage(img, (it.frame % cols) * it.w, Math.floor(it.frame / cols) * cellH + (it.srcY ?? 0), it.w, it.h, it.x, it.y, it.w, it.h);
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}
