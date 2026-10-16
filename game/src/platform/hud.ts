import type { HudState } from '../core/game/gaming';
import type { Assets } from './assets';
import { STEP_MS } from '../core/level';
import { drawText } from './text';

/** CBlackView 0x4280f0: the panel at the bottom; children are placed relative to it. */
const PANEL = 117;
const PANEL_Y = 495;
const BLOCK_X = [12, 149, 556, 693]; // player blocks by slot (0x4af924)
const FRAME = 128;
const PICTURE = 29; // CBulPicture: 8 bpp on the app palette, one sheet per team colour (extract.py)
const SPELLS = 78; // CSpells sheet: source rects per spell bit (0x4b39b8)
const SPELL_RECTS = [[25, 0, 36, 14], [0, 0, 11, 14], [13, 0, 23, 14]]; // invisible, invulnerable, infinite ammo
const SHOT_BG = 166; // CShotCounter images 0x4af934: background, reload bar
const RELOAD_BAR = 124;
const NO_BULLETS = 165; // 0x100a5: weapons without a bullet image (detonator)
const DIGITS = 118; // CNumCounter 0x4af940: rolling strip 0..9, glass overlay
const DIGIT_GLASS = 33;
/** Weapon struct table 0x482820 fields 4 and 5: HUD icon and ammo bullet image per weapon type. */
const WEAPON_ICON = [172, 169, 170, 171, 168, 167];
const BULLET = [108, 160, 163, 0, 162, 161];
const CENTER_FONT = 174; // 0x100ae
const SMALL_FONT = 175; // 0x100af
const ROLL_MS = 100; // CNumCounter::CNumCounter: timers_add(0, 100, 7)
const RELOAD_STEPS = 16; // CBulanek +0x122 counts to 16

/** CBlackView 0x4280f0 panel: one block per player slot (name, picture, spells, shots, weapon, score counter) and the
 *  shared centre text. */
export class Hud {
  private readonly counters: NumCounter[] = [];

  constructor(private readonly assets: Assets) {}

  step(scores: number[]): void {
    scores.forEach((v, i) => (this.counters[i] ??= new NumCounter(this.assets)).step(v));
  }

  draw(ctx: CanvasRenderingContext2D, players: HudState[], reloadCounts: number[], paused: boolean | boolean[]): void {
    const p = this.assets.image(PANEL);
    if (p) ctx.drawImage(p, 0, PANEL_Y);
    players.forEach((s, i) => this.drawBlock(ctx, BLOCK_X[i], s, reloadCounts[i], Array.isArray(paused) ? paused[i] : paused, (this.counters[i] ??= new NumCounter(this.assets))));
    const center = players[0]?.center;
    if (center == null) return;
    const lines = center.split('\n');
    const f = this.assets.fonts.get(CENTER_FONT);
    const lh = f?.img.naturalHeight ?? 14;
    lines.forEach((l, k) => drawText(ctx, f, l, (358 + 444) / 2, PANEL_Y + (45 + 95) / 2 + (k - (lines.length - 1) / 2) * lh, '#606060'));
  }

  private drawBlock(ctx: CanvasRenderingContext2D, X0: number, s: HudState, reloadCount: number, paused: boolean, counter: NumCounter): void {
    ctx.save();
    if (s.eliminated) ctx.globalAlpha = 0.35; // port only: dim a player out of a lives round
    const img = (res: number) => this.assets.image(res);
    const put = (res: number, x: number, y: number) => {
      const i = img(res);
      if (i) ctx.drawImage(i, x, PANEL_Y + y);
    };
    // name (x+4,9)-(x+92,22), font 175
    drawText(ctx, this.assets.fonts.get(SMALL_FONT), s.name, X0 + 48, PANEL_Y + 15.5, '#b0b0b0');
    put(FRAME, X0 + 5, 40);

    // CBulPicture at (x+6, 41), 50x40
    const px = X0 + 6;
    const py = 41;
    const pic = this.assets.image(PICTURE, s.color);
    if (pic) ctx.drawImage(pic, px, PANEL_Y + py);
    const spells = img(SPELLS);
    const on = [s.spells.invisible, s.spells.invulnerable, s.spells.infiniteAmmo];
    if (spells) {
      SPELL_RECTS.forEach(([l, t, r, b], i) => {
        if (on[i]) ctx.drawImage(spells, l, t, r - l, b - t, px + l, PANEL_Y + py + t, r - l, b - t);
      });
    }
    const pw = pic?.width ?? 50;
    const ph = pic?.height ?? 40;
    if (paused) {
      ctx.fillStyle = '#9f9f9f';
      ctx.fillRect(px, PANEL_Y + py, pw, ph);
      drawText(ctx, this.assets.fonts.get(SMALL_FONT), 'Pauza', px + pw / 2, PANEL_Y + py + ph / 2, '#eeeeee');
    }

    // CShotCounter at (pic.left, pic.bottom + 3)
    const sx = px;
    const sy = PANEL_Y + py + ph + 3;
    const bg = img(SHOT_BG);
    if (bg) ctx.drawImage(bg, sx, sy);
    const bar = img(RELOAD_BAR);
    if (s.weapon === 0 && s.ammo === 0) {
      // reload bar: width = count * w / (max - 1), from (left + 1, top + 1)
      const w = Math.min(bar?.width ?? 0, Math.trunc((reloadCount * (bar?.width ?? 0)) / (RELOAD_STEPS - 1)));
      if (bar && w > 0) ctx.drawImage(bar, 0, 0, w, bar.height, sx + 1, sy + 1, w, bar.height);
    } else {
      const bullet = BULLET[s.weapon] ? img(BULLET[s.weapon]) : undefined;
      if (!bullet) put(NO_BULLETS, sx, sy - PANEL_Y);
      else if (bg) {
        // ponytail: even spacing; the original's spacing helper (FUN_00448b50) is not decoded
        const gap = (bg.width - bullet.width * s.maxAmmo) / (s.maxAmmo + 1);
        for (let i = 0; i < s.ammo; i++) ctx.drawImage(bullet, Math.round(sx + gap + i * (bullet.width + gap)), sy + 2);
      }
    }

    // weapon icon at (pic.right + 3, pic.bottom - icon height)
    const icon = img(WEAPON_ICON[s.weapon]);
    if (icon) ctx.drawImage(icon, px + pw + 3, PANEL_Y + py + ph - icon.height);

    counter.draw(ctx, px + pw + 3, PANEL_Y + py);
    ctx.restore();
  }
}

/** CNumCounter: per digit the current strip offset (+0x90) and the target (+0x9c), and the roll direction (+0x88). */
export class NumCounter {
  private readonly offset = [0, 0, 0];
  private readonly target = [0, 0, 0];
  private up = true;
  private value = 0;
  private ms = 0;

  constructor(private readonly assets: Assets) {}

  /** One 10 ms step; the roll itself (FUN_00427020: 1 px, wrapping around the strip) runs on CNumCounter timer 0
   *  every 100 ms. */
  step(score: number): void {
    if (score !== this.value) this.setValue(score);
    this.ms += STEP_MS;
    if (this.ms < ROLL_MS) return;
    this.ms -= ROLL_MS;
    const stripH = this.assets.image(DIGITS)?.naturalHeight ?? 130;
    for (let i = 0; i < 3; i++) {
      if (this.offset[i] === this.target[i]) continue;
      this.offset[i] = this.up ? (this.offset[i] + 1) % stripH : (this.offset[i] - 1 + stripH) % stripH;
    }
  }

  // FUN_00427100
  private setValue(v: number): void {
    this.up = Math.abs(this.value) < Math.abs(v);
    this.value = v;
    const n = Math.abs(v) % 1000;
    const h = this.assets.image(DIGIT_GLASS)?.naturalHeight ?? 13;
    this.target[0] = Math.trunc(n / 100) * h;
    this.target[1] = Math.trunc((n % 100) / 10) * h;
    this.target[2] = (n % 10) * h;
  }

  // CNumCounter::vfunction15: three 9 px windows into the digit strip, 2 px apart, wrapping at the strip end
  draw(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    const strip = this.assets.image(DIGITS);
    const glass = this.assets.image(DIGIT_GLASS);
    if (!strip || !glass) return;
    const w = glass.width;
    const h = glass.height;
    for (let i = 0; i < 3; i++) {
      const dx = x + i * (w + 2);
      const o = this.offset[i];
      const first = Math.min(h, strip.height - o);
      ctx.drawImage(strip, 0, o, w, first, dx, y, w, first);
      if (first < h) ctx.drawImage(strip, 0, 0, w, h - first, dx, y + first, w, h - first);
      if (this.value < 0) {
        // FUN_004365f0(colour 0xff0000, per-channel alpha 0xaf0000): c' = c + (255 - c) * 0xaf/255 in red only,
        // which is a screen blend with rgb(0xaf, 0, 0)
        ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = '#af0000';
        ctx.fillRect(dx, y, w, h);
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.drawImage(glass, dx, y);
    }
  }
}
