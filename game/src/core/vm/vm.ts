import type { MsvcRand } from '../rand';
import type { Program } from './program';
import { Value, VmError } from './values';

export type Handler = (vm: Vm) => Value;

export interface Frame {
  vars: Value[]; // locals followed by arguments
  nLocals: number;
  argc: number;
  result: Value;
}

const EVAL_BUDGET = 1_000_000; // per callEntry; the original would hang instead

/** CDSScript interpreter: script_eval 0x4384c0, script_run 0x438b30, script_call_entry 0x438c40. */
export class Vm {
  pc = 0;
  halted = false;
  frame: Frame = { vars: [], nLocals: 0, argc: 0, result: 0 };
  readonly globals: Value[];
  private evals = 0;

  constructor(readonly program: Program, readonly handlers: Handler[], readonly rand: MsvcRand, readonly name = 'script') {
    this.globals = new Array<Value>(program.nGlobals).fill(0);
  }

  u8(): number {
    this.need(1);
    return this.program.code[this.pc++];
  }

  u16(): number {
    this.need(2);
    const c = this.program.code;
    const v = c[this.pc] | (c[this.pc + 1] << 8);
    this.pc += 2;
    return v;
  }

  i32(): number {
    this.need(4);
    const c = this.program.code;
    const v = c[this.pc] | (c[this.pc + 1] << 8) | (c[this.pc + 2] << 16) | (c[this.pc + 3] << 24);
    this.pc += 4;
    return v;
  }

  u32(): number {
    return this.i32() >>> 0;
  }

  eval(): Value {
    const at = this.pc;
    if (++this.evals > EVAL_BUDGET) throw new VmError('evaluation budget exceeded', at, this.name);
    const code = this.u8();
    const handler = this.handlers[code];
    if (!handler) throw new VmError(`unknown opcode 0x${code.toString(16)}`, at, this.name);
    try {
      return handler(this);
    } catch (e) {
      throw this.located(e, at);
    }
  }

  /** Handler errors get the script name and, unless already a VmError, the pc of the failing opcode. */
  private located(e: unknown, at: number): VmError {
    if (e instanceof VmError) return e.script ? e : new VmError(e.reason, e.pc, this.name, { cause: e });
    return new VmError(e instanceof Error ? e.message : String(e), at, this.name, { cause: e });
  }

  /** Runs the function at pc: u8 local count, then statements until return. Like the original, every run
   *  clears the halt flag when it ends, so return(call(...)) continues with the next statement. */
  run(pc: number, args: Value[]): Value {
    const saved = { pc: this.pc, frame: this.frame };
    this.pc = pc;
    const nLocals = this.u8();
    this.frame = { vars: [...new Array<Value>(nLocals).fill(0), ...args], nLocals, argc: args.length, result: 0 };
    this.halted = false;
    while (!this.halted) this.eval();
    const result = this.frame.result;
    this.pc = saved.pc;
    this.frame = saved.frame;
    this.halted = false;
    return result;
  }

  callEntry(index: number, args: Value[] = []): Value {
    const pc = this.program.entries[index];
    if (pc === undefined) return 0;
    this.evals = 0;
    return this.run(pc, args);
  }

  jump(target: number): void {
    this.pc = target;
  }

  private need(n: number): void {
    if (this.pc + n > this.program.code.length) throw new VmError('read past end of code', this.pc, this.name);
  }
}
