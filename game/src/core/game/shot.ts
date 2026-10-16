import { imageSize } from '../manifest';
import { DrawItem, Rect, SceneObject } from '../scene/objects';
import { union } from '../scene/scene';
import { Timers } from '../timers';
import { ResourceRef, ScriptList, Value } from '../vm/values';
import { Explosion } from './explosion';
import type { Gaming } from './gaming';

/** 0x482968: shot images by direction + min(type, 3) * 4 (pistol, shotgun pellet, rocket, machine gun). */
const IMAGES = [110, 111, 112, 109, 24, 25, 26, 23, 50, 51, 52, 49, 80, 81, 82, 79];

const R = (left: number, top: number, right: number, bottom: number): Rect => ({ left, top, right, bottom });

/** CShot: type 0 pistol, 1 shotgun (5 pellets spreading 5 px per step), 2 rocket, 3..6 machine gun rounds.
 *  Moves 40 px every 50 ms, testing hits in 4 sub-steps; leaves at 0..800 x 0..516. */
export class Shot extends SceneObject {
  readonly timers = new Timers();
  private readonly res: number;
  private readonly img: { width: number; height: number };
  private done = false; // +0xa7
  private mask = 0x1f; // live shotgun pellets
  private spread = 0;

  // CShot::CShot 0x41edf0 (pos, scene, dir, owner slot, type, image list)
  constructor(readonly game: Gaming, x: number, y: number, readonly dir: number, readonly owner: number, readonly type: number, images: Value) {
    super();
    const item = images instanceof ScriptList ? images.items[dir] : undefined;
    this.res = item instanceof ResourceRef ? item.res : typeof item === 'number' ? item & 0xffff : IMAGES[dir + Math.min(type, 3) * 4];
    this.img = imageSize(game.level.manifest, this.res);
    this.left = x;
    this.top = y;
    this.width = this.img.width;
    this.height = this.img.height;
    this.setDepth(15);
    this.timers.add(0, 50, 6, game.now);
    const r = this.box();
    const hit = game.scene.hitTest(r, r, true, true);
    if (hit) {
      this.onHit(hit);
      this.finish();
    }
    if (type > 2) this.spread = game.rnd(9) - 4;
  }

  private box(): Rect {
    return R(this.left, this.top, this.right, this.bottom);
  }

  private finish(): void {
    this.done = true;
    this.shown = false;
    this.timers.pause(0);
    this.game.post(() => this.game.scene.remove(this)); // ponytail: the original keeps done shots until 0xf4
  }

  tick(now: number): void {
    this.timers.update(now, () => this.step());
  }

  // 0x419b40 timer: advance and sweep
  private step(): void {
    const old = this.box();
    const r = { ...old };
    const d = this.dir;
    const dx = d === 0 ? -40 : d === 1 ? 40 : 0;
    const dy = d === 2 ? -40 : d === 3 ? 40 : 0;
    r.left += dx;
    r.right += dx;
    r.top += dy;
    r.bottom += dy;
    if (this.type === 1) {
      if (d < 2) {
        r.top -= 5;
        r.bottom += 5;
      } else {
        r.left -= 5;
        r.right += 5;
      }
      this.setDepth(this.depthOffset - 5);
    } else {
      const s = this.spread;
      if (d < 2) {
        r.top += d === 0 ? -s : s;
        r.bottom += d === 0 ? -s : s;
      } else {
        r.left += d === 2 ? -s : s;
        r.right += d === 2 ? -s : s;
      }
    }
    this.left = r.left;
    this.top = r.top;
    this.width = r.right - r.left;
    this.height = r.bottom - r.top;
    this.sweep(r, old);
    this.scene?.resort(this);
    if (this.done) {
      this.timers.pause(0);
      this.shown = false;
    }
  }

  // 0x41df60 vfunction12
  private sweep(n: Rect, old: Rect): void {
    if (this.type !== 1) {
      if (this.travel(n, old)) this.finish();
      return;
    }
    for (let i = 0; i < 5; i++) {
      if (this.mask & (1 << i) && this.travel(this.pellet(n, i), this.pellet(old, i))) this.mask &= ~(1 << i);
    }
    if (!this.mask) this.finish();
  }

  // FUN_00417b30: pellet i of 5 across the spread rect
  private pellet(r: Rect, i: number): Rect {
    const { width: w, height: h } = this.img;
    if (this.dir < 2) {
      const y = r.top + Math.trunc(((r.bottom - r.top - h) * i) / 4);
      return R(r.left, y, r.right, y + h);
    }
    const x = r.left + Math.trunc(((r.right - r.left - w) * i) / 4);
    return R(x, r.top, x + w, r.bottom);
  }

  // FUN_0041de60: 4 sub-steps from old towards n; true when something was hit or n left the field
  private travel(n: Rect, old: Rect): boolean {
    for (let i = 1; i <= 4; i++) {
      const ox = Math.trunc(((n.left - old.left) * i) / 4);
      const oy = Math.trunc(((n.top - old.top) * i) / 4);
      const test = union(R(old.left + ox, old.top + oy, old.right + ox, old.bottom + oy), old);
      const hit = this.game.scene.hitTest(test, old, true, true);
      if (hit) {
        this.onHit(hit);
        return true;
      }
    }
    return n.left < 0 || n.top < 0 || n.right >= 800 || n.bottom >= 516;
  }

  // FUN_0041dd70
  private onHit(obj: SceneObject): void {
    if (this.type === 2) {
      this.game.scene.add(new Explosion(this.game, this, this.owner), 1);
      return;
    }
    this.game.hit(obj.slot, this.owner, this.dir);
  }

  draw(): DrawItem | DrawItem[] {
    const item = (x: number, y: number): DrawItem => ({ res: this.res, frame: -1, x, y, w: this.img.width, h: this.img.height, opacity: this.opacity });
    if (this.type !== 1) return item(this.left, this.top);
    const r = this.box();
    const out: DrawItem[] = [];
    for (let i = 0; i < 5; i++) {
      if (!(this.mask & (1 << i))) continue;
      const p = this.pellet(r, i);
      out.push(item(p.left, p.top));
    }
    return out;
  }
}
