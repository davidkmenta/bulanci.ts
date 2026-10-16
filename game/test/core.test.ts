import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MsvcRand } from '../src/core/rand';
import { parseProgram } from '../src/core/vm/program';
import { LEVEL_IDS, readAsset } from './fixtures';

describe('MsvcRand', () => {
  it('matches MSVC rand() after srand(1)', () => {
    const r = new MsvcRand(1);
    expect([r.next(), r.next(), r.next(), r.next(), r.next()]).toEqual([41, 18467, 6334, 26500, 19169]);
  });
});

describe('parseProgram', () => {
  it('reads header, code and entries of every level', () => {
    for (const id of LEVEL_IDS) {
      const bytes = readAsset(`levels/${String(id).padStart(5, '0')}.bin`);
      const p = parseProgram(bytes);
      expect(p.entries).toHaveLength(11);
      expect(p.code.length).toBe(bytes.length - 12 - 4 * 11);
      expect(p.entries[0]).toBe(0);
    }
  });

  it('rejects a truncated script', () => {
    expect(() => parseProgram(new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toThrow(/bad script size/);
  });
});

describe('core stays platform independent', () => {
  it('has no Node or browser APIs', () => {
    const files: string[] = [];
    const walk = (dir: string) => readdirSync(dir).forEach(f => {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.ts')) files.push(p);
    });
    walk(new URL('../src/core', import.meta.url).pathname);
    for (const f of files) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/from ['"]node:|\bdocument\b|\bwindow\b|\bfetch\(|\bprocess\.|\bBuffer\b|\bMath\.random\b|\bDate\.now\b|\bperformance\./);
    }
  });
});
