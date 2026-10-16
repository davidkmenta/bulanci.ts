export interface Program {
  code: Uint8Array;
  entries: number[];
  nGlobals: number;
}

/** CDSScript::load (0x438e40): u32 code_len, u32 n_entries, u32 n_globals, code, n_entries * u32 entry offsets. */
export function parseProgram(bytes: Uint8Array): Program {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const codeLen = dv.getUint32(0, true);
  const nEntries = dv.getUint32(4, true);
  const nGlobals = dv.getUint32(8, true);
  if (12 + codeLen + 4 * nEntries !== bytes.byteLength) throw new Error(`bad script size ${bytes.byteLength}`);
  const entries = Array.from({ length: nEntries }, (_, i) => dv.getUint32(12 + codeLen + 4 * i, true));
  return { code: bytes.subarray(12, 12 + codeLen), entries, nGlobals };
}
