import type { Font } from './assets';

/** FUN_00437370 advances by glyph width + the text style's spacing (+4); ponytail: style not decoded, 1 px reads
 *  like the original (with 0 a 1 px '.' merges into its neighbours). */
const SPACING = 1;

export function textWidth(font: Font, text: string): number {
  let w = 0;
  for (const ch of text) w += (font.glyphs.get(ch)?.w ?? 0) + SPACING;
  return w;
}

/** Font sheets are white-on-black: recolour them to an ink with the brightness as alpha. */
const inked = new WeakMap<Font, Map<string, HTMLCanvasElement>>();
export function ink(font: Font, color: string): HTMLCanvasElement {
  const cache = inked.get(font) ?? new Map<string, HTMLCanvasElement>();
  inked.set(font, cache);
  let c = cache.get(color);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = font.img.naturalWidth;
  c.height = font.img.naturalHeight;
  const g = c.getContext('2d')!;
  g.drawImage(font.img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height);
  const rgb = parseInt(color.slice(1), 16);
  for (let i = 0; i < d.data.length; i += 4) {
    d.data[i + 3] = d.data[i];
    d.data[i] = rgb >> 16;
    d.data[i + 1] = (rgb >> 8) & 0xff;
    d.data[i + 2] = rgb & 0xff;
  }
  g.putImageData(d, 0, 0);
  cache.set(color, c);
  return c;
}

/** Draws one line centred on (cx, cy). */
export function drawText(ctx: CanvasRenderingContext2D, font: Font | undefined, text: string, cx: number, cy: number, color: string): void {
  if (!font) return;
  const img = ink(font, color);
  const h = img.height;
  let x = Math.round(cx - textWidth(font, text) / 2);
  const y = Math.round(cy - h / 2);
  for (const ch of text) {
    const g = font.glyphs.get(ch);
    if (!g) continue;
    if (g.x >= 0) ctx.drawImage(img, g.x, 0, g.w, h, x, y, g.w, h);
    x += g.w + SPACING;
  }
}

/** Draws text with its top-left at (x, y); `\n` starts a new line one glyph-sheet height lower. */
export function drawTextAt(ctx: CanvasRenderingContext2D, font: Font | undefined, text: string, x: number, y: number, color: string): void {
  if (!font) return;
  const img = ink(font, color);
  const h = img.height;
  text.split('\n').forEach((line, i) => {
    let dx = Math.round(x);
    for (const ch of line) {
      const g = font.glyphs.get(ch);
      if (!g) continue;
      if (g.x >= 0) ctx.drawImage(img, g.x, 0, g.w, h, dx, Math.round(y) + i * h, g.w, h);
      dx += g.w + SPACING;
    }
  });
}

/** 0xRRGGBB -> '#rrggbb' */
export const hex = (rgb: number) => `#${rgb.toString(16).padStart(6, '0')}`;
