import { Key } from '../core/game/input';
import { tick } from './haptics';
import { GAME_H, GAME_W } from './viewport';

const el = (cls: string, text = '') => Object.assign(document.createElement('div'), { className: cls, textContent: text });

/** A phone or tablet: the touch controls, one player per device, no way to quit. */
export const TOUCH = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

export type Pal = { hi: string; c: string; lo: string };
const RED: Pal = { hi: '#ff6a5a', c: '#d82020', lo: '#8a0c0c' };
const YELLOW: Pal = { hi: '#fff27a', c: '#f0c000', lo: '#9a6a00' };
const DARK: (p: Pal) => Pal = p => ({ hi: p.c, c: p.lo, lo: p.lo }); // a pressed cap: lit from nowhere

/** A pixel-art sprite: px(x, y) gives each pixel's colour, null leaves it clear. Shown scaled up, unsmoothed. */
function sprite(w: number, h: number, px: (x: number, y: number) => string | null): HTMLCanvasElement {
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const g = c.getContext('2d')!;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const col = px(x, y);
      if (col) (g.fillStyle = col), g.fillRect(x, y, 1, 1);
    }
  return c;
}

/** A ball or cap of radius r at (cx, cy), lit from the top left: outline, shade, body, light, a specular pixel pair. */
function dome(x: number, y: number, cx: number, cy: number, r: number, p: Pal, spec: boolean): string | null {
  const dx = x + 0.5 - cx;
  const dy = y + 0.5 - cy;
  const d = Math.hypot(dx, dy);
  if (d > r) return null;
  if (d > r - 1) return '#000';
  if (spec && Math.hypot(dx + r * 0.4, dy + r * 0.4) < r * 0.2) return '#fff';
  const l = -(dx + dy) / (r * 1.41);
  return l > 0.3 ? p.hi : l < -0.35 ? p.lo : p.c;
}

/** The joystick base, 48x48 from above: a bevelled plate with four screws, the round dust washer, the shaft. */
const base = () =>
  sprite(48, 48, (x, y) => {
    const e = Math.min(x, y, 47 - x, 47 - y);
    if (e === 0) return '#000';
    for (const [sx, sy] of [[7, 7], [40, 7], [7, 40], [40, 40]]) {
      const ds = Math.hypot(x + 0.5 - sx, y + 0.5 - sy);
      if (ds < 3) return ds > 2 ? '#000' : x - sx === y - sy ? '#000' : x + y < sx + sy ? '#d0d0dc' : '#7a7a8a';
    }
    const d = Math.hypot(x + 0.5 - 24, y + 0.5 - 24);
    if (d < 3) return x + y < 47 ? '#e8e8f0' : '#9a9aa8'; // the shaft seen from above, shows when the ball tilts away
    if (d < 4.5) return '#000';
    if (d < 18) return d > 17 ? '#000' : d > 14.5 && x + y < 40 ? '#2c2c38' : d > 11 && d < 12 ? '#20202a' : '#16161e';
    if (e <= 2) return x <= 2 || y <= 2 ? (e === 1 ? '#9a9aac' : '#7a7a8c') : e === 1 ? '#1a1a22' : '#2a2a36';
    return '#44445a';
  });
const ball = () => sprite(24, 24, (x, y) => dome(x, y, 12, 12, 12, RED, true));

/** A push button, 32x32 from above: the black bezel and the cap; pressed, the cap sinks (smaller) and darkens. */
export const buttonSprite = (p: Pal, down: boolean) =>
  sprite(32, 32, (x, y) => {
    const d = Math.hypot(x + 0.5 - 16, y + 0.5 - 16);
    if (d > 16) return null;
    if (d > 15) return '#000';
    const cap = down ? dome(x, y, 16, 16, 11, DARK(p), false) : dome(x, y, 16, 16, 12, p, true);
    if (cap) return cap;
    return x + y < 28 ? (d > 14 ? '#7a7a8a' : '#5a5a6a') : d > 14 ? '#18181e' : '#26262e';
  });

/** 5x7 pixel letters for the captions; a caron (as in Ř, Ň) goes in the two rows above. */
const FONT: Record<string, string> = {
  A: '.###.#...##...#######...##...##...#', P: '####.#...##...#####.#....#....#....', U: '#...##...##...##...##...##...#.###.', B: '####.#...##...#####.#...##...#####.', E: '######....#....####.#....#....#####',
  L: '#....#....#....#....#....#....#####', N: '#...###..##.#.##..###...##...##...#', R: '####.#...##...#####.#.#..#..#.#...#',
  S: '.#####....#.....###.....#....#####.', T: '#####..#....#....#....#....#....#..', Z: '#####....#...#...#...#...#....#####',
};
const CARON = '.#.#...#..';

/** A caption in pixel letters, white with a black outline. */
export function caption(text: string): HTMLCanvasElement {
  const on = new Set<string>();
  let x = 1;
  for (const ch of text.normalize('NFD')) {
    if (ch === '\u030c') {
      for (let i = 0; i < 10; i++) if (CARON[i] === '#') on.add(`${x - 6 + (i % 5)},${1 + Math.floor(i / 5)}`);
      continue;
    }
    const g = FONT[ch] ?? '';
    for (let i = 0; i < g.length; i++) if (g[i] === '#') on.add(`${x + (i % 5)},${3 + Math.floor(i / 5)}`);
    x += 6;
  }
  const is = (x: number, y: number) => on.has(`${x},${y}`);
  return sprite(x, 11, (x, y) =>
    is(x, y) ? '#f0f0f0' : is(x - 1, y) || is(x + 1, y) || is(x, y - 1) || is(x, y + 1) ? '#000' : null);
}

/** On-screen controls for touch devices, styled as an arcade cabinet panel: a ball-top joystick on the left, the
 *  Zbraň and Střelba push buttons stacked on the right with their captions below. They sit at the screen edges in
 *  the side bars of the 4:3 viewport, or float semi-transparently over the game when the bars are too narrow. */
export class TouchControls {
  private readonly root = el('touch');
  private readonly dirs = new Map<number, Key | null>(); // joystick pointer id -> held direction
  private readonly stick = el('stick');
  private readonly ball = ball();
  private unit = 6; // CSS pixels per sprite pixel

  constructor(private readonly press: (k: Key) => void, private readonly release: (k: Key) => void) {
    const stick = this.stick;
    this.ball.className = 'ball';
    stick.append(base(), this.ball);
    stick.addEventListener('pointerdown', e => {
      stick.setPointerCapture(e.pointerId);
      this.dirs.set(e.pointerId, null);
      this.aim(stick, e);
    });
    stick.addEventListener('pointermove', e => this.aim(stick, e));
    const end = (e: PointerEvent) => {
      const k = this.dirs.get(e.pointerId);
      if (k !== undefined && k !== null) this.release(k);
      this.dirs.delete(e.pointerId);
      if (!this.dirs.size) this.tilt(0, 0);
    };
    stick.addEventListener('pointerup', end);
    stick.addEventListener('pointercancel', end);

    const buttons = el('buttons');
    buttons.append(this.button('Zbraň', Key.Switch, 'switch'), this.button('Střelba', Key.Fire, 'fire'));
    this.root.append(stick, buttons);
    this.root.hidden = true;
    document.body.append(this.root);
    addEventListener('resize', () => this.layout());
    this.layout();
  }

  show(on: boolean): void {
    if (this.root.hidden === !on) return;
    this.root.hidden = !on;
    if (on) return;
    for (const [id, k] of this.dirs) if (k !== null) { this.release(k); this.dirs.set(id, null); }
    this.tilt(0, 0);
  }

  /** The ball follows the thumb within the gate; its offset from the centre picks the direction (release old,
   *  press new), so sliding the thumb changes it. */
  private aim(stick: HTMLElement, e: PointerEvent): void {
    if (!this.dirs.has(e.pointerId)) return;
    const r = stick.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const len = Math.hypot(dx, dy);
    const max = r.width * (10 / 48); // the gate: 10 sprite pixels
    this.tilt(len > max ? (dx * max) / len : dx, len > max ? (dy * max) / len : dy);
    const k = len < r.width * 0.12 ? null : Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? Key.Left : Key.Right) : dy < 0 ? Key.Up : Key.Down;
    const old = this.dirs.get(e.pointerId)!;
    if (k === old) return;
    if (old !== null) this.release(old);
    if (k !== null) {
      this.press(k);
      tick(); // a switch closed; the stick has no diagonals, so never two at once
    }
    this.dirs.set(e.pointerId, k);
  }

  /** Ball offset from the centre, snapped to whole sprite pixels. */
  private tilt(x: number, y: number): void {
    const u = this.unit;
    this.ball.style.translate = `${Math.round(x / u) * u}px ${Math.round(y / u) * u}px`;
  }

  private button(label: string, key: Key, cls: string): HTMLElement {
    const c = el(`ctl ${cls}`);
    const p = cls === 'fire' ? RED : YELLOW;
    const up = buttonSprite(p, false);
    const down = buttonSprite(p, true);
    up.className = 'up';
    down.className = 'down';
    const b = el('btn');
    b.append(up, down);
    const cap = caption(label.toUpperCase());
    cap.className = 'cap';
    c.append(b, cap);
    const held = new Set<number>(); // two fingers on one button are one press
    c.addEventListener('pointerdown', e => {
      c.setPointerCapture(e.pointerId);
      if (held.size === 0) this.press(key);
      held.add(e.pointerId);
      c.classList.add('on');
    });
    const end = (e: PointerEvent) => {
      if (!held.delete(e.pointerId) || held.size) return;
      this.release(key);
      c.classList.remove('on');
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    return c;
  }

  private layout(): void {
    const bar = (innerWidth - (innerHeight * GAME_W) / GAME_H) / 2;
    const overlay = bar < 120;
    const side = 12; // from the screen edge: the rounded corners still fit a circle at the bottom
    const pad = overlay ? Math.min(170, innerHeight * 0.4) : Math.min(bar - 2 * side, 200, innerHeight * 0.5);
    const u = (this.unit = Math.max(1, Math.floor(pad / 48))); // whole CSS pixels per sprite pixel keep them square
    this.root.classList.toggle('overlay', overlay);
    for (const [name, v] of [['u', u], ['pad', 48 * u], ['btn', 32 * Math.max(1, Math.round(u * 0.9))], ['side', side]] as const)
      document.documentElement.style.setProperty(`--${name}`, `${v}px`); // the pause button sits above the stick
    this.tilt(0, 0);
  }
}
