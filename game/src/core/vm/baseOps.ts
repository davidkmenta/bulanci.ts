import type { Handler } from './vm';
import { MemStream, Value, VmError, num } from './values';

const int = (v: number) => v | 0;

const jumpIf = (test: (a: Value, b: Value) => boolean): Handler => vm => {
  const a = vm.eval();
  const b = vm.eval();
  const target = vm.u32();
  if (!test(a, b)) return 0;
  vm.jump(target);
  return 1;
};

const stream = (v: Value, pc: number): MemStream => {
  if (v instanceof MemStream) return v;
  throw new VmError('expected a stream', pc);
};

/** Base opcodes 0x00..0x2c (table 0x4b0118, handlers in decompiled/_script_ops.c); operands evaluate left to right. */
export const baseOps: Handler[] = [
  /* 0x00 const */ vm => vm.i32(),
  /* 0x01 rand */ vm => {
    const a = num(vm.eval());
    const b = num(vm.eval());
    // C int semantics: the product wraps at 32 bits before the division
    return int(a + Math.trunc(Math.imul(vm.rand.next(), b - a + 1) / 32768));
  },
  /* 0x02 global */ vm => vm.globals[vm.u8()] ?? 0,
  /* 0x03 local */ vm => vm.frame.vars[vm.u8()] ?? 0,
  /* 0x04 add */ vm => int(num(vm.eval()) + num(vm.eval())),
  /* 0x05 sub */ vm => int(num(vm.eval()) - num(vm.eval())),
  /* 0x06 mul */ vm => Math.imul(num(vm.eval()), num(vm.eval())),
  /* 0x07 div */ vm => {
    const at = vm.pc;
    const a = num(vm.eval());
    const b = num(vm.eval());
    if (b === 0) throw new VmError('division by zero', at);
    return int(Math.trunc(a / b));
  },
  /* 0x08 clamp(v, lo, hi) */ vm => {
    const v = num(vm.eval());
    const lo = num(vm.eval());
    const hi = num(vm.eval());
    return Math.max(Math.min(v, hi), lo);
  },
  /* 0x09 min */ vm => Math.min(num(vm.eval()), num(vm.eval())),
  /* 0x0a max */ vm => Math.max(num(vm.eval()), num(vm.eval())),
  /* 0x0b set_global */ vm => {
    const i = vm.u8();
    return (vm.globals[i] = vm.eval());
  },
  /* 0x0c set_local */ vm => {
    const i = vm.u8();
    return (vm.frame.vars[i] = vm.eval());
  },
  /* 0x0d goto */ vm => {
    vm.jump(vm.u32());
    return 0;
  },
  /* 0x0e call(target, argc, args...) */ vm => {
    const target = vm.u32();
    const n = vm.u8();
    const args: Value[] = [];
    for (let i = 0; i < n; i++) args.push(vm.eval());
    return vm.run(target, args);
  },
  /* 0x0f argc */ vm => vm.frame.argc,
  /* 0x10 arg */ vm => vm.frame.vars[vm.frame.nLocals + num(vm.eval())] ?? 0,
  /* 0x11 return: halt flag first, then the value (see Vm.run) */ vm => {
    vm.halted = true;
    const frame = vm.frame;
    frame.result = vm.eval();
    return frame.result;
  },
  /* 0x12 if_eq_goto */ jumpIf((a, b) => a === b),
  /* 0x13 if_lt_goto */ jumpIf((a, b) => num(a) < num(b)),
  /* 0x14 if_gt_goto */ jumpIf((a, b) => num(a) > num(b)),
  /* 0x15 if_le_goto */ jumpIf((a, b) => num(a) <= num(b)),
  /* 0x16 if_ge_goto */ jumpIf((a, b) => num(a) >= num(b)),
  /* 0x17 if_ne_goto */ jumpIf((a, b) => a !== b),
  /* 0x18 switch_goto: first matching key jumps and returns its index, -1 if none */ vm => {
    const v = vm.eval();
    const n = vm.u8();
    for (let i = 0; i < n; i++) {
      const key = vm.i32();
      const target = vm.u32();
      if (key === v) {
        vm.jump(target);
        return i;
      }
    }
    return -1;
  },
  /* 0x19 lookup: value of the last matching key, -1 if none */ vm => {
    const v = vm.eval();
    const n = vm.u8();
    let result: Value = -1;
    for (let i = 0; i < n; i++) {
      const key = vm.i32();
      const value = vm.i32();
      if (key === v) result = value;
    }
    return result;
  },
  /* 0x1a strdup */ vm => {
    const s = vm.eval();
    return typeof s === 'string' ? s : 0;
  },
  /* 0x1b string literal (UTF-16LE up to u16 0) */ vm => {
    let s = '';
    for (let ch = vm.u16(); ch !== 0; ch = vm.u16()) s += String.fromCharCode(ch);
    return s;
  },
  /* 0x1c free */ vm => {
    vm.eval();
    return 0;
  },
  /* 0x1d strlen */ vm => {
    const s = vm.eval();
    return typeof s === 'string' ? s.length : 0;
  },
  /* 0x1e char_at */ vm => {
    const at = vm.pc;
    const s = vm.eval();
    const i = num(vm.eval());
    if (typeof s !== 'string') throw new VmError('char_at on a non-string', at);
    return s.charCodeAt(i) || 0;
  },
  /* 0x1f shr (unsigned) */ vm => {
    const a = num(vm.eval());
    return int(a >>> (num(vm.eval()) & 31));
  },
  /* 0x20 shl */ vm => {
    const a = num(vm.eval());
    return a << (num(vm.eval()) & 31);
  },
  /* 0x21 and */ vm => num(vm.eval()) & num(vm.eval()),
  /* 0x22 or */ vm => num(vm.eval()) | num(vm.eval()),
  /* 0x23 not */ vm => ~num(vm.eval()),
  /* 0x24 neg */ vm => int(-num(vm.eval())),
  /* 0x25 mem_stream(initial, grow) */ vm => {
    vm.eval();
    vm.eval();
    return new MemStream();
  },
  /* 0x26 release */ vm => {
    vm.eval();
    return 0;
  },
  /* 0x27 stream_write(s, value, size) */ vm => {
    const s = stream(vm.eval(), vm.pc);
    const v = num(vm.eval());
    s.write(v, num(vm.eval()));
    return s;
  },
  /* 0x28 stream_read(s, size) */ vm => {
    const s = stream(vm.eval(), vm.pc);
    return s.read(num(vm.eval()));
  },
  /* 0x29 stream_seek(s, pos) */ vm => {
    const s = stream(vm.eval(), vm.pc);
    s.seek(num(vm.eval()));
    return s;
  },
  /* 0x2a stream_set_size(s, n) */ vm => {
    const s = stream(vm.eval(), vm.pc);
    s.setSize(num(vm.eval()));
    return s;
  },
  /* 0x2b stream_vf20: empty for memory streams */ vm => {
    vm.eval();
    return 0;
  },
  /* 0x2c stream_vf1c: empty for memory streams */ vm => {
    vm.eval();
    return 0;
  },
];
