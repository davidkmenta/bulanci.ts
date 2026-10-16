import type { DrawItem, Rect, SceneObject } from './objects';

/** Receives zone enter/leave for zones without script flag 1 (messages 0xf2/0xf3). */
export interface ZoneOwner {
  zoneMessage(zone: Zone, enter: boolean): void;
}

/** scene_add_zone 0x41bad0: id +0, inside-slot bit mask +4, rect +8, flags +0x18, owner +0x1c. */
export interface Zone {
  id: number;
  rect: Rect;
  flags: number;
  mask?: number;
  owner?: ZoneOwner;
}

export function intersects(a: Rect, b: Rect): boolean {
  return Math.max(a.left, b.left) < Math.min(a.right, b.right) && Math.max(a.top, b.top) < Math.min(a.bottom, b.bottom);
}

const isEmpty = (r: Rect) => !(r.left < r.right && r.top < r.bottom);

/** FUN_00433200: union; an empty operand leaves the other one. */
export function union(a: Rect, b: Rect): Rect {
  if (isEmpty(b)) return { ...a };
  if (isEmpty(a)) return { ...b };
  return { left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) };
}

const SLOTS = 128;

/** CGaming as the level sees it: 3 layers (0 back, 1 depth sorted, 2 front), named slots, background, zones. */
export class Scene {
  readonly layers: SceneObject[][] = [[], [], []];
  currentLayer: 0 | 1 | 2 = 0;
  readonly slots: (SceneObject | null)[] = new Array(SLOTS).fill(null);
  background = 0;
  readonly zones: Zone[] = [];
  /** Set by an attached game once activated; then scene_add attaches new objects (vfunction16). */
  active = false;

  /** scene_add 0x41a390 */
  add(obj: SceneObject, layer: 0 | 1 | 2 = this.currentLayer): void {
    if (obj.layer !== null) this.detach(obj);
    obj.layer = layer;
    obj.scene = this;
    this.layers[layer].push(obj);
    if (layer === 1) this.resort(obj);
    if (this.active) obj.attach();
  }

  /** All objects in child-list order (layer 0, 1, 2). */
  objects(): SceneObject[] {
    return [...this.layers[0], ...this.layers[1], ...this.layers[2]];
  }

  /** scene_hit_test 0x418300: first solid object whose collision rect intersects rect; unless includeOld, objects
   *  already intersecting old are ignored; skipShootThrough skips shoot-through objects. Walks the child list
   *  (layers 0..2 in list order). */
  hitTest(rect: Rect, old: Rect, includeOld: boolean, skipShootThrough: boolean): SceneObject | null {
    for (const o of this.objects()) {
      if (!o.solid) continue;
      const c = o.collisionRect();
      if (!c || !intersects(rect, c)) continue;
      if (!includeOld && intersects(old, c)) continue;
      if (skipShootThrough && o.shootThrough) continue;
      return o;
    }
    return null;
  }

  /** scene_hit_test_all 0x4183d0 */
  hitTestAll(rect: Rect, skipShootThrough: boolean): SceneObject[] {
    return this.objects().filter(o => {
      const c = o.solid ? o.collisionRect() : null;
      return c !== null && intersects(rect, c) && !(skipShootThrough && o.shootThrough);
    });
  }

  /** scene_remove 0x419ca0 */
  remove(obj: SceneObject): void {
    this.setSlot(obj, 255);
    if (obj.layer !== null) this.detach(obj);
  }

  /** scene_set_slot 0x417fb0: slot >= 0x80 frees the object's slot. */
  setSlot(obj: SceneObject, slot: number): void {
    if (slot < SLOTS) {
      this.slots[slot] = obj;
      obj.slot = slot;
    } else if (obj.slot !== 255) {
      this.slots[obj.slot] = null;
      obj.slot = 255;
    }
  }

  getSlot(slot: number): SceneObject | null {
    return slot < SLOTS ? this.slots[slot] : null;
  }

  /** scene_resort_depth 0x4184a0: move obj backward past deeper objects, else forward past shallower ones. */
  resort(obj: SceneObject): void {
    if (obj.layer !== 1) return;
    const list = this.layers[1];
    const from = list.indexOf(obj);
    list.splice(from, 1);
    const d = obj.depth();
    let i = from;
    while (i > 0 && list[i - 1].depth() > d) i--;
    if (i === from) while (i < list.length && list[i].depth() < d) i++;
    list.splice(i, 0, obj);
  }

  count(): number {
    return this.layers[0].length + this.layers[1].length + this.layers[2].length;
  }

  drawList(): DrawItem[] {
    const items: DrawItem[] = [];
    if (this.background) items.push({ res: this.background, frame: -1, x: 0, y: 0, w: 0, h: 0, opacity: 255 });
    for (const layer of this.layers) {
      for (const obj of layer) {
        const item = obj.shown ? obj.draw() : null;
        if (Array.isArray(item)) items.push(...item);
        else if (item) items.push(item);
      }
    }
    return items;
  }

  private detach(obj: SceneObject): void {
    const list = this.layers[obj.layer!];
    list.splice(list.indexOf(obj), 1);
    obj.layer = null;
    obj.scene = null;
  }
}
