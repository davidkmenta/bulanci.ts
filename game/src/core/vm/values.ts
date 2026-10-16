export type Value = number | string | object;

/** script: who runs the code (e.g. "level 319"); the Vm fills it in for errors raised by handlers. */
export class VmError extends Error {
  constructor(readonly reason: string, readonly pc: number, readonly script = '', options?: ErrorOptions) {
    super(`${script && `${script}: `}${reason} (pc ${pc})`, options);
  }
}

export function num(v: Value): number {
  if (typeof v !== 'number') throw new Error(`expected a number, got ${typeof v}`);
  return v;
}

/** Script list (CDSCollection created by new_list). */
export class ScriptList {
  items: Value[] = [];
}

/** Value of preload(res): a loaded resource handle. */
export class ResourceRef {
  constructor(readonly res: number) {}
}

/** CDSEasyMemStream: little-endian byte buffer (read 0x4307f0, write 0x4308c0, seek 0x430980, set_size 0x4309f0). */
export class MemStream {
  private bytes = new Uint8Array(64);
  size = 0;
  pos = 0;

  write(value: number, n: number): void {
    this.ensure(this.pos + n);
    for (let i = 0; i < n; i++) this.bytes[this.pos++] = (value >>> (8 * i)) & 0xff;
    this.size = Math.max(this.size, this.pos);
  }

  read(n: number): number {
    if (n < 0 || n > 4 || this.pos + n > this.size) throw new Error('stream read past end');
    let v = 0;
    for (let i = 0; i < n; i++) v |= this.bytes[this.pos++] << (8 * i);
    return n === 4 ? v | 0 : v >>> 0;
  }

  seek(pos: number): void {
    if (pos < 0 || pos > this.size) throw new Error('stream seek out of range');
    this.pos = pos;
  }

  setSize(n: number): void {
    if (n === -1) n = this.pos;
    this.ensure(n);
    this.size = n;
    if (this.pos > n) this.pos = n;
  }

  private ensure(n: number): void {
    if (n <= this.bytes.length) return;
    const bigger = new Uint8Array(Math.max(n, this.bytes.length * 2));
    bigger.set(this.bytes);
    this.bytes = bigger;
  }
}
