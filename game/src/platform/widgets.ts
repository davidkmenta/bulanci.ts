import { DEFAULT_SOUND_BANK } from '../core/manifest';
import type { Assets } from './assets';
import { fetchOk, type AudioOut } from './audio';
import { parseAvi } from './video';
import { drawText, drawTextAt } from './text';

/** Fonts (FUN_0042d510 callers): 174 buttons and labels, 175 small text, 176 the version line. */
export const BIG = 174;
export const SMALL = 175;
export const TINY = 176;
export const TEXT = '#c0c0c0';
export const DIM = '#5a5a5a';

/** What every widget draws and sounds with; set once by initWidgets. */
interface Env {
  assets: Assets;
  audio: AudioOut;
  input: HTMLInputElement; // the hidden text field behind Edit (canvas text cannot open a phone keyboard)
  toCss(x: number, y: number): { x: number; y: number; scale: number };
}
let env: Env;
export function initWidgets(e: Env): void {
  env = e;
}

/** A sample of the default bank 338 (sound_play(ch, 0, idx)). */
export const sound = (index: number) => env.audio.playSound(DEFAULT_SOUND_BANK, index, 0);
export const font = (res: number) => env.assets.fonts.get(res);

export function drawImage(g: CanvasRenderingContext2D, res: number, x: number, y: number, alpha = 1): void {
  const img = env.assets.image(res);
  if (!img) return;
  g.globalAlpha = alpha;
  g.drawImage(img, x, y);
  g.globalAlpha = 1;
}

/** Frame of an anim at time t since it started; a one-shot anim holds its last frame. */
export function animFrame(res: number, t: number, loop = true): number {
  const m = env.assets.manifest[String(res)] as { frames: number; duration_ms: number };
  const i = Math.floor(Math.max(0, t) / (m.duration_ms / m.frames));
  return loop ? i % m.frames : Math.min(i, m.frames - 1);
}

export function drawAnim(g: CanvasRenderingContext2D, res: number, frame: number, x: number, y: number, color = 0): void {
  const img = env.assets.image(res, color);
  const m = env.assets.manifest[String(res)] as unknown as { width: number; height: number; cols: number };
  if (!img) return;
  g.drawImage(img, (frame % m.cols) * m.width, Math.floor(frame / m.cols) * m.height, m.width, m.height, x, y, m.width, m.height);
}

export function label(g: CanvasRenderingContext2D, text: string, x: number, y: number, res = BIG, color = TEXT): void {
  drawTextAt(g, font(res), text, x, y, color);
}

export function centred(g: CanvasRenderingContext2D, text: string, cx: number, cy: number, res = SMALL, color = TEXT): void {
  drawText(g, font(res), text, cx, cy, color);
}

export abstract class Widget {
  enabled = true;
  hover = false;
  pressed = false;

  constructor(public x: number, public y: number, public w: number, public h: number) {}

  hit(px: number, py: number): boolean {
    return px >= this.x && px < this.x + this.w && py >= this.y && py < this.y + this.h;
  }

  abstract draw(g: CanvasRenderingContext2D, t: number): void;
  click(_px: number, _py: number): void {}
  drag(_px: number, _py: number): void {}
  blur(): void {}
}

/** CButton: images 31 normal, 30 hover/focus, 32 pressed (82x25), caption in font 174. */
export class Button extends Widget {
  constructor(x: number, y: number, public text: string, private readonly onClick: () => void) {
    super(x, y, 82, 25);
  }

  draw(g: CanvasRenderingContext2D): void {
    drawImage(g, !this.enabled ? 31 : this.pressed && this.hover ? 32 : this.hover ? 30 : 31, this.x, this.y);
    centred(g, this.text, this.x + this.w / 2, this.y + this.h / 2, BIG, this.enabled ? TEXT : DIM);
  }

  click(): void {
    sound(14);
    this.onClick();
  }
}

/** Radio item: 15x15 icons 119 off, 120 on, 121/123 disabled off/on (ponytail: icon roles read off the images). */
export class Radio extends Widget {
  constructor(x: number, y: number, private readonly text: string, public checked: boolean, private readonly onClick: () => void = () => {}) {
    super(x, y, 160, 18);
  }

  draw(g: CanvasRenderingContext2D): void {
    drawImage(g, this.enabled ? (this.checked ? 120 : 119) : this.checked ? 123 : 121, this.x, this.y);
    label(g, this.text, this.x + 22, this.y - 2, BIG, this.enabled ? TEXT : DIM);
  }

  click(): void {
    sound(14);
    this.onClick();
  }
}

/** CSwitch: the main-menu ball (anim 212 opens, 213 closes) at x=35 and its label image at x=100. */
export class MenuSwitch extends Widget {
  private since = -1e9; // when the current open/close anim started
  private open = false;
  active = false; // its dialog is shown: stays open

  constructor(y: number, private readonly labels: [number, number], private readonly clickSound: number, private readonly onClick: () => void) {
    super(35, y, 195, 65);
  }

  draw(g: CanvasRenderingContext2D, t: number): void {
    const want = this.hover || this.active;
    if (want !== this.open) {
      this.open = want;
      this.since = t;
      if (want && this.hover) sound(0);
    }
    drawAnim(g, this.open ? 212 : 213, animFrame(this.open ? 212 : 213, t - this.since, false), this.x, this.y);
    drawImage(g, this.labels[want ? 1 : 0], 100, this.y + 20);
  }

  click(): void {
    sound(this.clickSound);
    this.onClick();
  }
}

/** CColorSet: image 19 holds 8 colours in a 4x2 grid of 20x15 cells; the choice is framed in 0xeeeeee. */
export class ColorSet extends Widget {
  constructor(x: number, y: number, public value: number, private readonly onChange: (c: number) => void) {
    super(x, y, 81, 29);
  }

  draw(g: CanvasRenderingContext2D): void {
    drawImage(g, 19, this.x, this.y);
    g.strokeStyle = '#eeeeee';
    g.lineWidth = 1;
    g.strokeRect(this.x + (this.value % 4) * 20 + 0.5, this.y + Math.floor(this.value / 4) * 15 + 0.5, 20, 14);
  }

  click(px: number, py: number): void {
    const c = Math.min(3, Math.floor((px - this.x) / 20)) + 4 * Math.min(1, Math.floor((py - this.y) / 15));
    sound(14);
    this.value = c;
    this.onChange(c);
  }
}

/** CListBox: one row per item in font 175; unavailable items grey 0x858585 (ponytail: frame/scrollbar images not decoded). */
export class ListBox extends Widget {
  static readonly ROW = 18;

  constructor(x: number, y: number, w: number, h: number, public items: string[], public selected: number, private readonly onSelect: (i: number) => void) {
    super(x, y, w, h);
  }

  draw(g: CanvasRenderingContext2D): void {
    g.strokeStyle = '#606060';
    g.strokeRect(this.x + 0.5, this.y + 0.5, this.w - 1, this.h - 1);
    this.items.forEach((s, i) => {
      const y = this.y + 3 + i * ListBox.ROW;
      if (i === this.selected) {
        g.fillStyle = '#3c3c3c';
        g.fillRect(this.x + 2, y, this.w - 4, ListBox.ROW);
      }
      label(g, s, this.x + 8, y + 2, SMALL, i === this.selected ? '#ffffff' : TEXT);
    });
  }

  click(_px: number, py: number): void {
    const i = Math.floor((py - this.y - 3) / ListBox.ROW);
    if (i < 0 || i >= this.items.length) return;
    sound(14);
    this.selected = i;
    this.onSelect(i);
  }
}

/** CEdit: text in font 175 with a caret; typing goes through the hidden <input> laid over the box. */
export class Edit extends Widget {
  private focused = false;

  constructor(x: number, y: number, w: number, public value: string, private readonly max: number, private readonly onChange: (v: string) => void,
    private readonly onEnter?: () => void) {
    super(x, y, w, 20);
  }

  draw(g: CanvasRenderingContext2D, t: number): void {
    g.fillStyle = '#101010';
    g.fillRect(this.x, this.y, this.w, this.h);
    g.strokeStyle = this.focused ? '#a0a0a0' : '#505050';
    g.strokeRect(this.x + 0.5, this.y + 0.5, this.w - 1, this.h - 1);
    const caret = this.focused && Math.floor(t / 500) % 2 === 0 ? '|' : '';
    centred(g, this.value + caret, this.x + this.w / 2, this.y + this.h / 2, SMALL, '#ffffff');
  }

  click(): void {
    if (this.focused) return;
    this.focused = true;
    const el = env.input;
    const p = env.toCss(this.x, this.y);
    Object.assign(el.style, { left: `${p.x}px`, top: `${p.y}px`, width: `${this.w * p.scale}px`, height: `${this.h * p.scale}px` });
    el.maxLength = this.max;
    el.value = this.value;
    el.oninput = () => {
      this.value = el.value;
      this.onChange(this.value);
    };
    el.onkeydown = e => {
      if (e.key === 'Enter' && this.onEnter) {
        this.onEnter(); // CChatEdit: send and stay in the field
        el.value = this.value;
      } else if (e.key === 'Enter' || e.key === 'Escape') this.blur();
      e.stopPropagation();
    };
    el.onblur = () => this.blur();
    el.hidden = false;
    el.focus();
  }

  blur(): void {
    if (!this.focused) return;
    this.focused = false;
    env.input.onblur = null;
    env.input.blur();
    env.input.hidden = true;
  }
}

/** CVolume: horizontal slider over -50..50 (ponytail: its images are not decoded; a line and a knob). */
export class Slider extends Widget {
  constructor(x: number, y: number, w: number, h: number, public value: number, private readonly onChange: (v: number) => void) {
    super(x, y, w, h);
  }

  draw(g: CanvasRenderingContext2D): void {
    const cy = this.y + this.h / 2;
    g.fillStyle = '#606060';
    g.fillRect(this.x, cy - 1, this.w, 2);
    g.fillRect(this.x + this.w / 2, cy - 6, 1, 12);
    const kx = this.x + ((this.value + 50) / 100) * this.w;
    g.fillStyle = this.hover || this.pressed ? '#ffffff' : '#c0c0c0';
    g.fillRect(kx - 4, cy - 9, 8, 18);
  }

  click(px: number): void {
    this.drag(px);
  }

  drag(px: number): void {
    const v = Math.max(-50, Math.min(50, Math.round(((px - this.x) / this.w) * 100 - 50)));
    if (v === this.value) return;
    this.value = v;
    this.onChange(v);
  }
}

/** CIcon: three images (normal, hover, pressed), e.g. the history page arrows. */
export class Icon extends Widget {
  constructor(x: number, y: number, private readonly images: [number, number, number], private readonly onClick: () => void) {
    const m = (env.assets.manifest[String(images[0])] as { width: number; height: number });
    super(x, y, m.width, m.height);
  }

  draw(g: CanvasRenderingContext2D): void {
    drawImage(g, this.images[this.pressed && this.hover ? 2 : this.hover ? 1 : 0], this.x, this.y);
  }

  click(): void {
    sound(14);
    this.onClick();
  }
}

/** CMovieView: a still image, on hover the film-strip poster with ▶; a click plays the film in place (its sound at
 *  the effects volume), another click stops it. One plays at a time; at the end the still comes back. The film is
 *  fetched and its JPEG frames decoded on the first click. */
export class Movie extends Widget {
  private static current: Movie | null = null;
  private film: { frames: ImageBitmap[]; sound: AudioBuffer; usPerFrame: number } | null = null;
  private loading = false;
  private startedAt = -1; // AudioContext time: the picture follows the sound
  private stopSound: (() => void) | null = null;

  constructor(x: number, y: number, private readonly still: number, private readonly poster: number, private readonly video: number) {
    const m = env.assets.manifest[String(still)] as { width: number; height: number };
    super(x, y, m.width, m.height);
  }

  static stop(): void {
    Movie.current?.halt();
  }

  draw(g: CanvasRenderingContext2D): void {
    if (this.startedAt >= 0 && this.film) {
      const i = Math.floor(((env.audio.ctx.currentTime - this.startedAt) * 1e6) / this.film.usPerFrame);
      if (i < this.film.frames.length) return g.drawImage(this.film.frames[Math.max(0, i)], this.x, this.y);
      this.halt();
    }
    drawImage(g, this.hover ? this.poster : this.still, this.x, this.y);
  }

  click(): void {
    if (this.startedAt >= 0) return this.halt();
    Movie.stop();
    Movie.current = this;
    this.play().catch(e => console.error(e));
  }

  private halt(): void {
    this.stopSound?.();
    this.stopSound = null;
    this.startedAt = -1;
    if (Movie.current === this) Movie.current = null;
  }

  private async play(): Promise<void> {
    if (!this.film) {
      if (this.loading) return;
      this.loading = true;
      try {
        const url = env.assets.base + (env.assets.manifest[String(this.video)] as { file: string }).file;
        const res = await fetch(url);
        if (!fetchOk(res)) throw new Error(`${url}: HTTP ${res.status}`);
        const avi = parseAvi(new Uint8Array(await res.arrayBuffer()));
        const frames = await Promise.all(avi.frames.map(f => createImageBitmap(new Blob([f as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }))));
        this.film = { frames, sound: env.audio.pcmBuffer(avi.pcm, avi.channels, avi.rate), usPerFrame: avi.usPerFrame };
      } finally {
        this.loading = false;
      }
    }
    if (Movie.current !== this) return; // stopped, or another film clicked while this one loaded
    this.stopSound = env.audio.playBuffer(this.film.sound);
    this.startedAt = env.audio.ctx.currentTime;
  }
}

/** A modal CWindow over the screen (pause, setup, controls): dark box with a thin frame. */
export interface Dialog {
  x: number;
  y: number;
  w: number;
  h: number;
  widgets: Widget[];
  draw?(g: CanvasRenderingContext2D, t: number): void;
  key?(e: KeyboardEvent): boolean;
}

export abstract class Screen {
  widgets: Widget[] = [];
  dialog: Dialog | null = null;

  constructor(readonly name: string) {}

  /** Background and anything under the widgets. */
  abstract draw(g: CanvasRenderingContext2D, t: number): void;
  key(_e: KeyboardEvent): boolean {
    return false;
  }

  active(): Widget[] {
    return this.dialog ? this.dialog.widgets : this.widgets;
  }

  render(g: CanvasRenderingContext2D, t: number): void {
    this.draw(g, t);
    for (const w of this.widgets) w.draw(g, t);
    const d = this.dialog;
    if (!d) return;
    g.fillStyle = 'rgba(0, 0, 0, 0.85)';
    g.fillRect(d.x, d.y, d.w, d.h);
    g.strokeStyle = '#808080';
    g.strokeRect(d.x + 0.5, d.y + 0.5, d.w - 1, d.h - 1);
    d.draw?.(g, t);
    for (const w of d.widgets) w.draw(g, t);
  }
}

/** Mouse/touch routing for the current screen: hover, press, click on release over the same widget, drag. */
export class Pointer {
  private pressed: Widget | null = null;
  private focus: Widget | null = null;

  constructor(private readonly screen: () => Screen) {}

  private top(x: number, y: number): Widget | undefined {
    return [...this.screen().active()].reverse().find(w => w.enabled && w.hit(x, y));
  }

  move(x: number, y: number): void {
    for (const w of this.screen().active()) w.hover = w.enabled && w.hit(x, y);
    this.pressed?.drag(x, y);
  }

  down(x: number, y: number): void {
    this.move(x, y);
    const w = this.top(x, y);
    if (this.focus && this.focus !== w) this.focus.blur();
    this.focus = w ?? null;
    if (!w) return;
    this.pressed = w;
    w.pressed = true;
  }

  up(x: number, y: number): void {
    const w = this.pressed;
    this.pressed = null;
    if (!w) return;
    w.pressed = false;
    if (w.hit(x, y) && this.screen().active().includes(w)) w.click(x, y);
  }

  /** A finger lifted (touch has no hover) or the mouse left the canvas: nothing stays hovered. */
  leave(): void {
    for (const w of this.screen().active()) w.hover = false;
  }

  /** On a screen or dialog change: nothing stays pressed, hovered or focused. */
  reset(): void {
    this.focus?.blur();
    this.focus = null;
    if (this.pressed) this.pressed.pressed = false;
    this.pressed = null;
  }
}
