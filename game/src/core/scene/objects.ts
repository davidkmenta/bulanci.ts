import { AnimMeta, AnimPlayer } from './anim';
import type { Scene } from './scene';

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** What the renderer draws; frame -1 = whole static image at its natural size. color = team colour sheet 0..7;
 *  srcY = only source rows [srcY, srcY + h) of the frame are drawn at (x, y) (weapon split around the bulanek). */
export interface DrawItem {
  res: number;
  frame: number;
  x: number;
  y: number;
  w: number;
  h: number;
  opacity: number;
  color?: number;
  srcY?: number;
}

/** CGameView: rect +0x20..+0x2c, shown +0x44 bit 0, explicit depth +0x68, solid +0x69, shoot-through +0x6a,
 *  depth offset +0x6c, slot +0x70, relative collision rect +0x74..+0x80, scene +0x84. */
export abstract class SceneObject {
  left = 0;
  top = 0;
  width = 0;
  height = 0;
  shown = true;
  solid = false;
  shootThrough = false;
  collision: Rect | null = null;
  depthOffset = 0;
  explicitDepth = false;
  opacity = 255;
  slot = 255;
  layer: 0 | 1 | 2 | null = null;
  scene: Scene | null = null;
  alphaMaskRes = 0;

  get right(): number {
    return this.left + this.width;
  }

  get bottom(): number {
    return this.top + this.height;
  }

  /** CGameView vfunc +0x74 (0x416f50). */
  depth(): number {
    return this.bottom + this.depthOffset;
  }

  /** CGameView vfunc +0x70 (0x417210): absolute collision rect, none while hidden. */
  collisionRect(): Rect | null {
    const c = this.collision;
    if (!this.shown || !c) return null;
    return { left: c.left + this.left, top: c.top + this.top, right: c.right + this.left, bottom: c.bottom + this.top };
  }

  /** obj_set_depth 0x418fe0 */
  setDepth(z: number): void {
    this.depthOffset = z;
    this.explicitDepth = true;
    this.scene?.resort(this);
  }

  moveTo(x: number, y: number): void {
    const before = this.depth();
    this.left = x;
    this.top = y;
    this.rectChanged(before);
  }

  /** CGameView vfunc 12 (0x419010): a rect change re-sorts an explicit-depth object whose depth changed. */
  protected rectChanged(depthBefore: number): void {
    if (this.explicitDepth && this.depth() !== depthBefore) this.scene?.resort(this);
  }

  /** CGameView vfunction16(1): the object got attached to an active game scene. */
  attach(): void {}

  abstract draw(): DrawItem | DrawItem[] | null;
}

export class BitmapObject extends SceneObject {
  constructor(readonly res: number, x: number, y: number, w: number, h: number) {
    super();
    this.moveTo(x, y);
    this.width = w;
    this.height = h;
  }

  draw(): DrawItem {
    return { res: this.res, frame: -1, x: this.left, y: this.top, w: this.width, h: this.height, opacity: this.opacity };
  }
}

/** CObstacle: invisible, its collision rect is absolute (view rect stays at 0,0). */
export class ObstacleObject extends SceneObject {
  constructor(l: number, t: number, r: number, b: number) {
    super();
    this.collision = { left: l, top: t, right: r, bottom: b };
    this.solid = true;
  }

  draw(): null {
    return null;
  }
}

export interface AnimHooks {
  event(obj: AnimObject, event: number): void;
  now(): number;
}

/** CAnim: a level animation with one or more sequences; frame events go to the level (CBitmap::vfunction5). */
export class AnimObject extends SceneObject {
  readonly player: AnimPlayer;

  constructor(readonly sequences: { res: number; meta: AnimMeta; offsets?: [number, number][] }[], x: number, y: number,
    private readonly hooks: AnimHooks) {
    super();
    this.moveTo(x, y);
    this.player = new AnimPlayer(sequences.map(s => s.meta), ev => this.hooks.event(this, ev));
    // chunk 10 (image_notify_offset): each shown frame moves the object; the wrap uses the ring frame's entry
    this.player.onShow = (frame, wrapped) => {
      const o = this.sequences[this.player.seq].offsets;
      const d = o?.[wrapped ? o.length - 1 : frame];
      if (d) this.moveTo(this.left + d[0], this.top + d[1]);
    };
  }

  play(seq: number, flags: number): void {
    this.player.play(seq, flags, this.hooks.now());
    const before = this.depth();
    const m = this.player.meta;
    this.width = m.width;
    this.height = m.height;
    this.rectChanged(before);
  }

  draw(): DrawItem {
    const s = this.sequences[this.player.seq];
    return { res: s.res, frame: this.player.frame, x: this.left, y: this.top, w: s.meta.width, h: s.meta.height, opacity: this.opacity };
  }
}
