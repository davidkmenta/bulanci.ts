/** Tiny CDSScript assembler for tests: expressions are byte arrays, functions are lists of statements. */
export type Bytes = number[];

export const u8 = (v: number): Bytes => [v & 0xff];
export const u16 = (v: number): Bytes => [v & 0xff, (v >> 8) & 0xff];
export const i32 = (v: number): Bytes => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
export const op = (code: number, ...parts: Bytes[]): Bytes => [code, ...parts.flat()];
export const c = (v: number): Bytes => op(0x00, i32(v));
export const str = (s: string): Bytes => op(0x1b, ...[...s].map(ch => u16(ch.charCodeAt(0))), u16(0));
export const size = (...parts: Bytes[]): number => parts.reduce((n, p) => n + p.length, 0);

/** Functions are laid out back to back; function i is entry point i. */
export function program(funcs: { locals?: number; body: Bytes[] }[], nGlobals = 8): Uint8Array {
  const code: number[] = [];
  const entries: number[] = [];
  for (const f of funcs) {
    entries.push(code.length);
    code.push(f.locals ?? 0, ...f.body.flat());
  }
  return new Uint8Array([...i32(code.length), ...i32(entries.length), ...i32(nGlobals), ...code, ...entries.flatMap(i32)]);
}
