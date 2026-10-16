import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { BASE_OPS, LEVEL_OPS, exprEnd, levelOpTable } from '../src/core/vm/ops';
import { parseProgram } from '../src/core/vm/program';
import { LEVEL_IDS, readAsset, readText } from './fixtures';

const PY = `import sys, json; sys.path.insert(0, 'tools'); import extract
print(json.dumps({'base': extract.BASE_OPS, 'level': {k: list(v) for k, v in extract.LEVEL_OPS.items()}}))`;

describe('opcode tables', () => {
  it('match extract.py', () => {
    const py = JSON.parse(execFileSync('python3', ['-c', PY], { encoding: 'utf8' }));
    expect(BASE_OPS.map(o => [o.name, o.grammar])).toEqual(py.base);
    expect(Object.fromEntries(Object.entries(LEVEL_OPS).map(([k, o]) => [k, [o.name, o.grammar]]))).toEqual(py.level);
  });
});

describe('exprEnd', () => {
  it('walks every statement of every level exactly like the Python disassembler', () => {
    const table = levelOpTable();
    for (const id of LEVEL_IDS) {
      const name = String(id).padStart(5, '0');
      const { code } = parseProgram(readAsset(`levels/${name}.bin`));
      const stmts = [...readText(`levels/${name}.asm`).matchAll(/^ {2,}(\d+) {2}(.*)$/gm)].map(m => ({ off: +m[1], text: m[2] }));
      stmts.forEach((s, i) => {
        const end = s.text.startsWith('.locals') ? s.off + 1 : exprEnd(code, s.off, table);
        expect(end, `level ${id} @${s.off} ${s.text}`).toBe(i + 1 < stmts.length ? stmts[i + 1].off : code.length);
      });
    }
  });
});
