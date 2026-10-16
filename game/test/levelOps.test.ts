import { describe, expect, it } from 'vitest';
import { Level, panFromX } from '../src/core/level';
import type { Manifest } from '../src/core/manifest';
import { MsvcRand } from '../src/core/rand';
import { AnimObject, BitmapObject } from '../src/core/scene/objects';
import { LEVEL_OPS } from '../src/core/vm/ops';
import { VmError } from '../src/core/vm/values';
import { Bytes, c, i32, op, program, u16, u8 } from './asm';

const M: Manifest = {
  '0': { kind: 'image', file: 'a.png', files: [], width: 20, height: 30 },
  '1': { kind: 'anim', file: 'b.png', files: [], width: 8, height: 9, frames: 2, duration_ms: 100, events: { '1': 5 } },
  '4': { kind: 'soundbank', file: 'x', files: [], bank: 338 },
};
const RES = (id: number) => i32(0x10000 | id);
const levelOf = (funcs: { locals?: number; body: Bytes[] }[]) => new Level(999, program(funcs, 16), M, new MsvcRand(1));
const ret = (e: Bytes) => op(0x11, e);
const g = (i: number) => op(0x02, u8(i));
const setG = (i: number, e: Bytes) => op(0x0b, u8(i), e);
const newBitmap = (x: number, y: number) => op(0x2e, c(x), c(y), RES(0));
const newAnim = (x: number, y: number, flags: number) => op(0x2d, c(x), c(y), u8(flags), u8(1), RES(1));
const entry0 = { body: [ret(c(0))] };

describe('every level opcode consumes exactly its grammar', () => {
  it.each(Object.entries(LEVEL_OPS))('0x%s %o', (key, info) => {
    const code = Number(key);
    const operands: Bytes[] = code === 0x2d
      ? [c(0), c(0), u8(0), u8(1), RES(1)]
      : [...(info.grammar ?? '')].map(t => (t === 'E' ? c(0) : t === 'B' ? u8(0) : t === 'H' ? u16(0) : RES(0)));
    const stmt = op(code, ...operands);
    const level = levelOf([entry0, { body: [stmt, ret(c(0))] }]);
    level.vm.pc = 1 + 6 + 1; // after entry 0 (locals + return(const)) and the locals byte of function 1
    level.vm.eval();
    expect(level.vm.pc).toBe(1 + 6 + 1 + stmt.length);
  });
});

describe('level opcodes', () => {
  it('builds the scene: layers, bitmaps, depth, slots, background', () => {
    const level = levelOf([entry0, { body: [
      op(0x35, RES(0)),
      op(0x34, c(1)),
      op(0x33, op(0x38, newBitmap(0, 100), c(6))),
      op(0x33, op(0x31, newBitmap(0, 0), c(200))),
      ret(c(0)),
    ] }]);
    level.start(1);
    const slotted = level.scene.getSlot(6) as BitmapObject; // y 100 + h 30 -> depth 130
    const offset = level.scene.layers[1][1] as BitmapObject; // y 0 + h 30 + depth offset 200 -> 230
    expect(level.scene.background).toBe(0); // RES(0) = resource 0
    expect(level.scene.layers[1]).toEqual([slotted, offset]);
    expect([slotted.depth(), offset.depth()]).toEqual([130, 230]);
  });

  it('timers call entry 6 with the timer id', () => {
    // entry 1: timer_add(3, 100, 6); entry 6 (index 6): set_global(0, arg(0))
    const funcs = [entry0, { body: [op(0x44, c(3), c(100), c(6)), ret(c(0))] }];
    while (funcs.length < 6) funcs.push(entry0);
    funcs.push({ body: [setG(0, op(0x10, c(0))), ret(c(0))] });
    const level = levelOf(funcs);
    level.start(1);
    for (let i = 0; i < 10; i++) level.step();
    expect(level.vm.globals[0]).toBe(3);
  });

  it('anim events of slotted objects call entry 3 (slot, event)', () => {
    // autoplay + loop, so frame 1 (event 5) is not followed by the end event 0xffff
    const funcs = [entry0, { body: [op(0x33, op(0x38, newAnim(0, 0, 3), c(9))), ret(c(0))] }, entry0];
    funcs.push({ body: [setG(1, op(0x10, c(0))), setG(2, op(0x10, c(1))), ret(c(0))] });
    const level = levelOf(funcs);
    level.start(1);
    for (let i = 0; i < 5; i++) level.step();
    expect([level.vm.globals[1], level.vm.globals[2]]).toEqual([9, 5]);
    (level.scene.getSlot(9) as AnimObject).player.stop();
    expect(level.vm.globals[2]).toBe(0xffff);
  });

  it('audio: set_audio emits music, play_sound pans by the slot object', () => {
    const level = levelOf([entry0, { body: [
      op(0x36, RES(333), i32(0)),
      op(0x38, newBitmap(790, 0), c(2)),
      op(0x41, c(5), c(2)),
      op(0x41, c(6), c(50)),
      ret(c(0)),
    ] }]);
    level.start(1);
    expect(level.takeEvents()).toEqual([
      { type: 'music', res: 333 },
      { type: 'sound', bankRes: 4, index: 5, pan: panFromX(800) },
      { type: 'sound', bankRes: 4, index: 6, pan: 0 },
    ]);
    expect([panFromX(0), panFromX(400), panFromX(800)]).toEqual([-1500, 0, 1500]);
  });

  it('network and player opcodes are single-player stubs', () => {
    const level = levelOf([entry0, { body: [setG(0, op(0x4d)), setG(1, op(0x4a)), op(0x32), ret(c(0))] }]);
    level.start(1);
    expect([level.vm.globals[0], level.vm.globals[1]]).toEqual([0, 1]);
    expect(level.takeEvents()).toContainEqual({ type: 'log', text: 'spawn_players()' });
  });

  it('object opcodes ignore a null object', () => {
    const level = levelOf([entry0, { body: [setG(0, op(0x3a, op(0x3e, c(0)), c(1), c(2))), ret(c(0))] }]);
    level.start(1);
    expect(level.vm.globals[0]).toBe(0);
  });

  it('start runs entry 0, entry 1, then entry 10 (CGaming::vfunction16 0x41c140)', () => {
    const funcs = [{ body: [setG(0, c(1)), ret(c(0))] }, { body: [setG(1, op(0x04, g(0), c(1))), ret(c(0))] }];
    while (funcs.length < 10) funcs.push(entry0);
    funcs.push({ body: [setG(2, op(0x04, g(1), c(1))), ret(c(0))] });
    const level = levelOf(funcs);
    level.start(1);
    expect(level.vm.globals.slice(0, 3)).toEqual([1, 2, 3]);
  });

  it('errors carry the level id and the pc of the failing opcode', () => {
    const missing = levelOf([entry0, { body: [op(0x33, op(0x2e, c(0), c(0), RES(77))), ret(c(0))] }]);
    expect(() => missing.start(1)).toThrow(VmError);
    expect(() => missing.start(1)).toThrow(/^level 999: unknown resource 77 \(pc 9\)$/);
    const divZero = levelOf([entry0, { body: [op(0x07, c(1), c(0)), ret(c(0))] }]);
    expect(() => divZero.start(1)).toThrow(/^level 999: division by zero \(pc \d+\)$/);
  });

  it('play_sound pans an obstacle by its collision rect, empty while hidden', () => {
    const level = levelOf([entry0, { body: [
      setG(0, op(0x38, op(0x2f, c(700), c(0), c(800), c(10)), c(2))),
      op(0x41, c(1), c(2)),
      op(0x3c, g(0)),
      op(0x41, c(1), c(2)),
      ret(c(0)),
    ] }]);
    level.start(1);
    expect(level.takeEvents()).toEqual([
      { type: 'sound', bankRes: 4, index: 1, pan: panFromX(750) },
      { type: 'sound', bankRes: 4, index: 1, pan: panFromX(0) },
    ]);
  });

  it('list_resize only lowers the count (array_resize 0x431000)', () => {
    const level = levelOf([entry0, { body: [
      setG(0, op(0x59)),
      op(0x5f, g(0), c(-1), c(7)),
      op(0x5b, g(0), c(5), c(0)),
      setG(1, op(0x5a, g(0))),
      op(0x5f, g(0), c(-1), c(8)),
      op(0x5b, g(0), c(1), c(1)),
      setG(2, op(0x5a, g(0))),
      setG(3, op(0x5c, g(0), c(0))),
      ret(c(0)),
    ] }]);
    level.start(1);
    expect(level.vm.globals.slice(1, 4)).toEqual([1, 1, 7]);
  });
});
