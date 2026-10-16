import { describe, expect, it } from 'vitest';
import { AnimObject, BitmapObject, ObstacleObject } from '../src/core/scene/objects';
import { Scene } from '../src/core/scene/scene';

const resOf = (list: unknown[]) => list.map(o => (o as BitmapObject).res);
const bmp = (res: number, x: number, y: number, h = 10) => new BitmapObject(res, x, y, 10, h);

describe('SceneObject', () => {
  it('depth = bottom + depth offset (CGameView vfunc +0x74)', () => {
    const o = bmp(1, 0, 20, 30);
    o.depthOffset = -40;
    expect(o.depth()).toBe(10);
  });

  it('collision rect is relative to left/top and empty while hidden', () => {
    const o = bmp(1, 100, 50);
    o.collision = { left: 1, top: 2, right: 3, bottom: 4 };
    expect(o.collisionRect()).toEqual({ left: 101, top: 52, right: 103, bottom: 54 });
    o.shown = false;
    expect(o.collisionRect()).toBeNull();
  });

  it('obstacle is solid, invisible and collides with its absolute rect', () => {
    const o = new ObstacleObject(5, 6, 7, 8);
    expect([o.solid, o.draw(), o.collisionRect()]).toEqual([true, null, { left: 5, top: 6, right: 7, bottom: 8 }]);
  });

  it('anim object draws its current sequence frame and forwards events', () => {
    const seen: number[] = [];
    const a = new AnimObject([{ res: 9, meta: { width: 4, height: 5, frames: 2, durationMs: 100, events: { 1: 3 } } }], 1, 2,
      { event: (_, ev) => seen.push(ev), now: () => 0 });
    a.play(0, 1);
    a.player.tick(50);
    expect(a.draw()).toEqual({ res: 9, frame: 1, x: 1, y: 2, w: 4, h: 5, opacity: 255 });
    expect([a.width, a.height, seen]).toEqual([4, 5, [3, 0xffff]]);
  });

  it('moves by the chunk-10 offset of each shown frame; the wrap uses the ring entry', () => {
    const meta = { width: 4, height: 5, frames: 2, durationMs: 100, events: {} };
    const a = new AnimObject([{ res: 9, meta, offsets: [[0, 0], [3, 4], [-3, -4]] }], 10, 20, { event: () => {}, now: () => 0 });
    a.play(0, 3);
    a.player.tick(50);
    expect([a.left, a.top]).toEqual([13, 24]);
    a.player.tick(100);
    expect([a.left, a.top]).toEqual([10, 20]);
  });
});

describe('Scene', () => {
  it('layers draw in order 0, 1, 2 after the background; hidden objects are skipped', () => {
    const s = new Scene();
    s.background = 53;
    s.currentLayer = 2;
    s.add(bmp(3, 0, 0));
    s.add(bmp(1, 0, 0), 0);
    const hidden = bmp(4, 0, 0);
    hidden.shown = false;
    s.add(hidden, 1);
    s.add(bmp(2, 0, 0), 1);
    expect(s.drawList().map(d => d.res)).toEqual([53, 1, 2, 3]);
    expect(s.count()).toBe(4);
  });

  it('layer 1 stays sorted by depth; equal depth keeps insertion order', () => {
    const s = new Scene();
    const a = bmp(1, 0, 50), b = bmp(2, 0, 10), c = bmp(3, 0, 50);
    [a, b, c].forEach(o => s.add(o, 1));
    expect(resOf(s.layers[1])).toEqual([2, 1, 3]);
    b.depthOffset = 100;
    s.resort(b);
    expect(resOf(s.layers[1])).toEqual([1, 3, 2]);
  });

  it('slots: set, get, free with 255, remove frees too', () => {
    const s = new Scene();
    const o = bmp(1, 0, 0);
    s.add(o);
    s.setSlot(o, 6);
    expect([s.getSlot(6), o.slot]).toEqual([o, 6]);
    s.setSlot(o, 255);
    expect([s.getSlot(6), o.slot]).toEqual([null, 255]);
    s.setSlot(o, 7);
    s.remove(o);
    expect([s.getSlot(7), o.layer, s.count()]).toEqual([null, null, 0]);
    expect(s.getSlot(200)).toBeNull();
  });

  it('moving an explicit-depth object re-sorts layer 1 (CGameView vfunc 12 0x419010)', () => {
    const s = new Scene();
    const a = bmp(1, 0, 10), b = bmp(2, 0, 50);
    [a, b].forEach(o => s.add(o, 1));
    a.setDepth(0);
    a.moveTo(0, 100);
    expect(resOf(s.layers[1])).toEqual([2, 1]);
  });

  it('moving an object without an explicit depth keeps the order', () => {
    const s = new Scene();
    const a = bmp(1, 0, 10), b = bmp(2, 0, 50);
    [a, b].forEach(o => s.add(o, 1));
    a.moveTo(0, 100);
    expect(resOf(s.layers[1])).toEqual([1, 2]);
  });

  it('a sequence change resizing an explicit-depth anim re-sorts layer 1', () => {
    const meta = (height: number) => ({ width: 4, height, frames: 1, durationMs: 100, events: {} });
    const s = new Scene();
    const a = new AnimObject([{ res: 1, meta: meta(5) }, { res: 1, meta: meta(100) }], 0, 0, { event: () => {}, now: () => 0 });
    a.play(0, 0);
    const b = bmp(2, 0, 50);
    [a, b].forEach(o => s.add(o, 1));
    a.setDepth(0);
    a.play(1, 0);
    expect(s.layers[1]).toEqual([b, a]);
  });
});
