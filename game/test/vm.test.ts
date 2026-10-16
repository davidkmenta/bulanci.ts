import { describe, expect, it } from 'vitest';
import { MsvcRand } from '../src/core/rand';
import { baseOps } from '../src/core/vm/baseOps';
import { parseProgram } from '../src/core/vm/program';
import { MemStream, VmError } from '../src/core/vm/values';
import { Vm } from '../src/core/vm/vm';
import { Bytes, c, i32, op, program, size, str, u8 } from './asm';

const ret = (e: Bytes) => op(0x11, e);
const vmOf = (bytes: Uint8Array, seed = 1) => new Vm(parseProgram(bytes), baseOps, new MsvcRand(seed));
const evalExpr = (e: Bytes) => vmOf(program([{ body: [ret(e)] }])).callEntry(0);

describe('arithmetic and logic', () => {
  it.each([
    [op(0x04, c(2), c(3)), 5], [op(0x05, c(2), c(3)), -1], [op(0x06, c(-4), c(3)), -12], [op(0x07, c(-7), c(2)), -3],
    [op(0x08, c(15), c(0), c(10)), 10], [op(0x08, c(-5), c(0), c(10)), 0], [op(0x09, c(4), c(9)), 4], [op(0x0a, c(4), c(9)), 9],
    [op(0x1f, c(-1), c(28)), 15], [op(0x20, c(1), c(31)), -2147483648], [op(0x21, c(12), c(10)), 8], [op(0x22, c(12), c(3)), 15],
    [op(0x23, c(0)), -1], [op(0x24, c(5)), -5], [op(0x04, c(0x7fffffff), c(1)), -2147483648],
  ])('%#', (e, expected) => expect(evalExpr(e)).toBe(expected));

  it('division by zero is an error', () => expect(() => evalExpr(op(0x07, c(1), c(0)))).toThrow(VmError));

  it('rand(a, b) uses MSVC rand: a + trunc(rand * (b - a + 1) / 32768)', () => {
    // first rand() after srand(1) is 41 -> 0; second is 18467 -> trunc(18467 * 10 / 32768) = 5
    const vm = vmOf(program([{ body: [op(0x0b, u8(0), op(0x01, c(0), c(9))), ret(op(0x01, c(0), c(9)))] }]));
    expect(vm.callEntry(0)).toBe(5);
    expect(vm.globals[0]).toBe(0);
  });

  it('rand uses C int semantics: the product rand * (b - a + 1) wraps at 32 bits', () => {
    // rand(0, 0x7fffffff): b - a + 1 = 2^31 wraps to -2^31; first rand() after srand(1) is 41,
    // imul(41, -2^31) = -2^31 (41 is odd), -2^31 / 32768 = -65536. Double math would give 41 * 2^31 / 32768 = 2686976.
    expect(evalExpr(op(0x01, c(0), c(0x7fffffff)))).toBe(-65536);
  });
});

describe('variables, calls and frames', () => {
  it('globals and locals', () => {
    const vm = vmOf(program([{ locals: 2, body: [op(0x0c, u8(1), c(7)), op(0x0b, u8(3), op(0x03, u8(1))), ret(op(0x02, u8(3)))] }]));
    expect(vm.callEntry(0)).toBe(7);
  });

  it('args follow the locals; arg(i) and argc', () => {
    // f0: g0 = call(f1, 10, 20); return g0; f1 (1 local): return arg(1) + argc + local(1)
    // (not return(call(...)): the nested run clears the halt flag, so f0 would run on into f1)
    const f1Body = [ret(op(0x04, op(0x04, op(0x10, c(1)), op(0x0f)), op(0x03, u8(1))))];
    const f0Body = [op(0x0b, u8(0), op(0x0e, i32(0), u8(2), c(10), c(20))), ret(op(0x02, u8(0)))];
    const f1At = 1 + size(...f0Body);
    f0Body[0] = op(0x0b, u8(0), op(0x0e, i32(f1At), u8(2), c(10), c(20)));
    expect(vmOf(program([{ body: f0Body }, { locals: 1, body: f1Body }])).callEntry(0)).toBe(20 + 2 + 10);
  });

  it('return(call(...)) keeps running like the original (the nested run clears the halt flag)', () => {
    const f0Body = [ret(op(0x0e, i32(0), u8(0))), op(0x0b, u8(0), c(7)), ret(c(1))];
    const f1At = 1 + size(...f0Body);
    f0Body[0] = ret(op(0x0e, i32(f1At), u8(0)));
    const vm = vmOf(program([{ body: f0Body }, { body: [ret(c(5))] }]));
    expect(vm.callEntry(0)).toBe(1);
    expect(vm.globals[0]).toBe(7);
  });

  it('callEntry outside the table returns 0', () => expect(vmOf(program([{ body: [ret(c(1))] }])).callEntry(5)).toBe(0));
});

describe('control flow', () => {
  it('conditional jumps return 1/0 and jump when true', () => {
    // 0: locals; 1: if_lt_goto(1, 2, L) ; then return 0 ; L: return 1
    const head = op(0x13, c(1), c(2), i32(0));
    const L = 1 + size(head, ret(c(0)));
    const body = [op(0x13, c(1), c(2), i32(L)), ret(c(0)), ret(c(1))];
    expect(vmOf(program([{ body }])).callEntry(0)).toBe(1);
  });

  it.each([[0x12, 3, 3], [0x14, 4, 3], [0x15, 3, 3], [0x16, 3, 3], [0x17, 3, 4]])('jump op 0x%s taken', (code, a, b) => {
    const L = 1 + size(op(code, c(a), c(b), i32(0)), ret(c(0)));
    expect(vmOf(program([{ body: [op(code, c(a), c(b), i32(L)), ret(c(0)), ret(c(1))] }])).callEntry(0)).toBe(1);
  });

  it('switch_goto jumps to the first matching key, lookup returns the last matching value', () => {
    const sw = (target: number) => op(0x18, c(2), u8(2), i32(1), i32(0), i32(2), i32(target));
    const L = 1 + size(sw(0), ret(c(0)));
    expect(vmOf(program([{ body: [sw(L), ret(c(0)), ret(c(9))] }])).callEntry(0)).toBe(9);
    expect(evalExpr(op(0x19, c(2), u8(3), i32(2), i32(5), i32(1), i32(6), i32(2), i32(7)))).toBe(7);
    expect(evalExpr(op(0x19, c(3), u8(1), i32(2), i32(5)))).toBe(-1);
  });

  it('goto', () => {
    const L = 1 + size(op(0x0d, i32(0)), ret(c(0)));
    expect(vmOf(program([{ body: [op(0x0d, i32(L)), ret(c(0)), ret(c(2))] }])).callEntry(0)).toBe(2);
  });

  it('an endless loop hits the evaluation budget', () => {
    expect(() => vmOf(program([{ body: [op(0x0d, i32(1))] }])).callEntry(0)).toThrow(/budget/);
  });

  it('unknown opcode reports its pc', () => {
    expect(() => vmOf(program([{ body: [[0xee]] }])).callEntry(0)).toThrow(/0xee.*pc 1/);
  });
});

describe('strings and streams', () => {
  it('string literal, strlen, char_at, strdup', () => {
    expect(evalExpr(str('Malárie'))).toBe('Malárie');
    expect(evalExpr(op(0x1d, str('abc')))).toBe(3);
    expect(evalExpr(op(0x1e, str('abc'), c(1)))).toBe(98);
    expect(evalExpr(op(0x1a, str('x')))).toBe('x');
  });

  it('mem stream round trip', () => {
    const s = new MemStream();
    s.write(0x1234, 2);
    s.write(-2, 4);
    s.seek(0);
    expect([s.read(2), s.read(4)]).toEqual([0x1234, -2]);
    s.setSize(1);
    expect(s.size).toBe(1);
    expect(() => s.read(4)).toThrow();
  });

  it('stream ops through the VM', () => {
    // set_global(0, mem_stream(0, 0)); stream_write(g0, 7, 1); stream_seek(g0, 0); return stream_read(g0, 1)
    const g0 = op(0x02, u8(0));
    expect(vmOf(program([{ body: [op(0x0b, u8(0), op(0x25, c(0), c(0))), op(0x27, g0, c(7), c(1)), op(0x29, g0, c(0)), ret(op(0x28, g0, c(1)))] }])).callEntry(0)).toBe(7);
  });
});
