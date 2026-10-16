import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCORES, balanceGains, defaultConfig, duplicateName, insertScore, isNight, parseConfig, parseHistoryPage, podium, profileOf, scoreRanks,
} from '../src/core/menu';

describe('parseConfig', () => {
  it('falls back to defaults for missing or broken storage', () => {
    expect(parseConfig(null)).toEqual(defaultConfig());
    expect(parseConfig('{nope')).toEqual(defaultConfig());
    expect(parseConfig('null')).toEqual(defaultConfig());
  });
  it('keeps valid fields and drops invalid ones', () => {
    const c = parseConfig(JSON.stringify({
      name: 'Pepíček-s-dlouhým-jménem', color: 9, balance: -20, lastLevel: 'Malárie',
      scores: { a: [{ name: 'X', kills: 3, deaths: 1 }], b: [{ name: 'Y' }], c: 'x' },
    }));
    // the M3 format kept profile 0 flat in name/color
    expect(c).toEqual({
      ...defaultConfig(),
      profiles: [{ name: 'Pepíček-s-dl', color: 0 }, ...defaultConfig().profiles.slice(1)],
      balance: -20, lastLevel: 'Malárie', scores: { a: [{ name: 'X', kills: 3, deaths: 1 }] },
    });
  });
  it('rejects an empty name', () => {
    expect(parseConfig('{"name":""}').profiles[0].name).toBe('Bulík');
  });
  it('defaults the multiplayer setup (FUN_0040a290) and clamps it', () => {
    const d = defaultConfig();
    expect([d.players, d.type, d.limits]).toEqual([1, 1, [30, 180, 30]]);
    expect(d.profiles.map(p => `${p.name} ${p.color}`)).toEqual(['Bulík 0', 'Bulík 0', 'Uzlík 2', 'Bulík 0', 'Uzlík 2', 'Mazlík 4']);
    const c = parseConfig(JSON.stringify({ players: 3, type: 2, limits: [4, 600, 1000], profiles: [{ name: 'A', color: 3 }] }));
    expect([c.players, c.type, c.limits, c.profiles[0], c.profiles[5].name]).toEqual([3, 2, [30, 600, 30], { name: 'A', color: 3 }, 'Mazlík']);
    expect(parseConfig('{"players":4}').players).toBe(1);
    expect([parseConfig('{"players":2}').total, parseConfig('{"players":2,"total":4}').total, parseConfig('{"players":2,"total":1}').total]).toEqual([2, 4, 2]);
  });
});

describe('insertScore', () => {
  it('seeds the default table and places the entry by kills - deaths', () => {
    const { table, row } = insertScore(undefined, { name: 'Bulík', kills: 22, deaths: 3 }); // 19: between Kapslík 15 and Žezlík 20
    expect(row).toBe(1);
    expect(table.map(t => t.name)).toEqual(['Žezlík', 'Bulík', 'Kapslík', 'Čmelík', 'Uhlík', 'Terčík']);
  });
  it('reports -1 when the entry does not make the table', () => {
    const { table, row } = insertScore(DEFAULT_SCORES, { name: 'Bulík', kills: 0, deaths: 9 });
    expect(row).toBe(-1);
    expect(table).toEqual(DEFAULT_SCORES);
  });
  it('puts a tie after the older entry', () => {
    expect(insertScore(DEFAULT_SCORES, { name: 'Bulík', kills: 15, deaths: 5 }).row).toBe(3); // 10 = Čmelík's 10
  });
});

describe('scoreRanks', () => {
  it('shares a rank on equal difference', () => {
    expect(scoreRanks([{ name: 'a', kills: 5, deaths: 0 }, { name: 'b', kills: 6, deaths: 1 }, { name: 'c', kills: 1, deaths: 0 }])).toEqual([1, 1, 3]);
  });
});

describe('menu helpers', () => {
  it('night is 22:00-5:59', () => {
    expect([0, 5, 6, 21, 22, 23].map(isNight)).toEqual([true, true, false, false, true, true]);
  });
  it('balance attenuates the other side', () => {
    expect(balanceGains(0)).toEqual({ musicPct: 50, effectsPct: 50, music: 1, effects: 1 });
    expect(balanceGains(25)).toEqual({ musicPct: 25, effectsPct: 75, music: 0.5, effects: 1 });
  });
});

describe('parseHistoryPage', () => {
  it('reads texts with and without colours, and movies (still, poster and video resources)', () => {
    const asm = [
      '      1  add(set_colors(text(30, 28, "Bulánek", 2, res_174), 0, 16777215, 14540253, 14540253))',
      '     61  add(text(100, 30, "- vyšší \\"forma\\"\\n  života", 2, res_175))',
      '   1693  add(movie(30, 266, res_116, 77826, 77827))',
      '   3179  return(0)',
    ].join('\n');
    expect(parseHistoryPage(asm)).toEqual([
      { kind: 'text', x: 30, y: 28, text: 'Bulánek', font: 174, color: 0xffffff },
      { kind: 'text', x: 100, y: 30, text: '- vyšší "forma"\n  života', font: 175, color: null },
      { kind: 'movie', x: 30, y: 266, res: 116, poster: 12290, video: 12291 },
    ]);
  });
});

describe('multiplayer helpers', () => {
  it('profile base by local players (FUN_00412640)', () => {
    expect([profileOf(1, 0), profileOf(2, 0), profileOf(2, 1), profileOf(3, 0), profileOf(3, 2)]).toEqual([0, 1, 2, 3, 5]);
  });
  it('finds a name used twice, ignoring case', () => {
    expect(duplicateName(['Bulík', 'Uzlík'])).toBeNull();
    expect(duplicateName(['Bulík', 'Uzlík', 'bulík'])).toBe('bulík');
  });
  it('podium: places by score, ties share the pose step, pillar 0x4ae708[place][step]', () => {
    const p = podium([{ n: 'a', score: 3 }, { n: 'b', score: 7 }, { n: 'c', score: 3 }]);
    expect(p.map(r => [r.n, r.place, r.step, r.pillar])).toEqual([['b', 0, 0, 150], ['a', 1, 1, 152], ['c', 2, 1, 154]]);
  });
});
