import { describe, expect, it } from 'vitest';
import { Level } from '../src/core/level';
import { MsvcRand } from '../src/core/rand';
import { LEVEL_IDS, loadManifest, readAsset } from './fixtures';

const manifest = loadManifest();
const bytes = (id: number) => readAsset(`levels/${String(id).padStart(5, '0')}.bin`);

function run(id: number, seed: number, steps: number) {
  const level = new Level(id, bytes(id), manifest, new MsvcRand(seed));
  level.start(1);
  const events = level.takeEvents();
  for (let i = 0; i < steps; i++) {
    level.step();
    events.push(...level.takeEvents());
  }
  const draw = level.scene.drawList();
  level.stop();
  return { level, events, draw };
}

describe('the six original levels', () => {
  it('report their Czech and English names', () => {
    const names = LEVEL_IDS.map(id => {
      const l = new Level(id, bytes(id), manifest, new MsvcRand(1));
      return [l.info(1).name, l.info(0).name];
    });
    expect(names).toEqual([
      ['Vybíjená', 'Dj Slaughter'], ['Na dobrou noc', 'Bedtime story'], ['Noční směna', 'Steel works'],
      ['Malárie', 'Malaria'], ['V zajetí 8-bitu', '8-bit'], ['Exitus', 'Exitus'],
    ]);
  });

  it.each(LEVEL_IDS)('level %i runs 60 simulated seconds', id => {
    const { level, events, draw } = run(id, 1, 6000);
    expect(level.scene.background).not.toBe(0);
    expect(draw.length).toBeGreaterThan(1);
    expect(events.some(e => e.type === 'music')).toBe(true);
    expect({
      layers: level.scene.layers.map(l => l.length),
      timers: level.timers.activeIds(),
      events: events.reduce<Record<string, number>>((n, e) => ({ ...n, [e.type]: (n[e.type] ?? 0) + 1 }), {}),
      draw,
    }).toMatchSnapshot();
  });

  it('level 323 starts its timers in entry 10', () => {
    const level = new Level(323, bytes(323), manifest, new MsvcRand(1));
    level.start(1);
    expect(level.timers.activeIds()).not.toEqual([]);
  });

  it('is deterministic for a given seed', () => {
    const a = run(322, 42, 3000);
    const b = run(322, 42, 3000);
    expect(JSON.stringify([a.draw, a.events])).toBe(JSON.stringify([b.draw, b.events]));
  });
});

describe('Gaming', () => {
  it('NPCs never get the player colour', async () => {
    const { Gaming } = await import('../src/core/game/gaming');
    const { Bulanek } = await import('../src/core/game/bulanek');
    for (let color = 0; color < 8; color++) {
      for (let seed = 1; seed < 20; seed++) {
        const level = new Level(321, bytes(321), manifest, new MsvcRand(seed));
        new Gaming(level, { players: [{ name: 'Bulík', color }] }).start(1);
        const npcs = [125, 126, 127].map(s => level.scene.getSlot(s) as InstanceType<typeof Bulanek>);
        expect(npcs.map(b => b.color)).not.toContain(color);
      }
    }
  });
});

describe('Bulanek voices', () => {
  it('death sound -> groan of the victim -> taunt of the killer (sound-end chain, CBulanek message 1)', async () => {
    const { Gaming } = await import('../src/core/game/gaming');
    const { Bulanek } = await import('../src/core/game/bulanek');
    const level = new Level(321, bytes(321), manifest, new MsvcRand(1));
    const game = new Gaming(level);
    game.start(1);
    const npc = level.scene.getSlot(125) as InstanceType<typeof Bulanek>;
    level.takeEvents();
    npc.die(0, 0);
    const sounds: number[] = [];
    for (let i = 0; i < 400; i++) {
      game.step([]);
      sounds.push(...level.takeEvents().flatMap(e => (e.type === 'sound' && e.bankRes === 4 && e.index <= 0x17 ? [e.index] : [])));
    }
    const groan = [3, 6, 9, 12][npc.voice];
    expect(sounds.filter(s => [0x17, groan, 2].includes(s)).slice(0, 3)).toEqual([0x17, groan, 2]);
  });
});

describe('Gaming multiplayer', () => {
  const setup = async (type: number, limit: number, n = 2) => {
    const { Gaming } = await import('../src/core/game/gaming');
    const { Bulanek } = await import('../src/core/game/bulanek');
    const level = new Level(321, bytes(321), manifest, new MsvcRand(1));
    const players = ['Bulík', 'Uzlík', 'Mazlík'].slice(0, n).map((name, i) => ({ name, color: 2 * i }));
    const game = new Gaming(level, { players, type, limit });
    game.start(1);
    const slot = (s: number) => level.scene.getSlot(s) as InstanceType<typeof Bulanek>;
    // kill victim by killer once the victim is back in play
    const kill = (victim: number, killer: number) => {
      for (let i = 0; i < 1000 && !slot(victim).shown; i++) game.step([]);
      game.hit(victim, killer, 0);
      game.step([]);
    };
    return { game, level, slot, kill };
  };

  it('spawns the humans in slots 0..n-1 with their colours and no NPCs; keys go to their player', async () => {
    const { game, level, slot } = await setup(1, 180, 3);
    expect([0, 1, 2].map(s => slot(s).color)).toEqual([0, 2, 4]);
    expect([125, 126, 127].map(s => level.scene.getSlot(s))).toEqual([null, null, null]);
    const before = [slot(0).left, slot(1).left];
    game.step([{ key: 0, down: true, player: 1 }]);
    for (let i = 0; i < 50; i++) game.step([]);
    expect(slot(0).left).toBe(before[0]);
    expect(slot(1).left).not.toBe(before[1]);
  });

  it('has no bonuses (CGaming::CGaming creates them only for 1 player)', async () => {
    const { BONUS_ANIMS } = await import('../src/core/game/items');
    const { game, level } = await setup(1, 180);
    const bonuses = () => level.scene.objects().filter(o => 'sequences' in o && BONUS_ANIMS.includes((o as any).sequences[0].res));
    for (let i = 0; i < 3000; i++) game.step([]); // the first bonus shows after 25 s
    expect(bonuses()).toEqual([]);
  });

  it('hits: the leader is shown in the centre and reaching the limit ends the round', async () => {
    const { game, kill } = await setup(0, 5);
    for (let i = 0; i < 4; i++) kill(1, 0);
    expect(game.hud().center).toBe('Bulík\n4');
    expect(game.result()).toBeNull();
    kill(1, 0);
    const r = game.result()!;
    expect(r.map(p => [p.name, p.frags, p.deaths, p.score, p.kills[1]])).toEqual([['Bulík', 5, 0, 5, 5], ['Uzlík', 0, 5, 0, 0]]);
  });

  it('lives: the limit eliminates (no respawn) and the last player standing ends the round', async () => {
    const { game, slot, kill } = await setup(2, 5, 3);
    for (let i = 0; i < 5; i++) kill(2, 0);
    expect(slot(2).eliminated).toBe(0);
    expect([game.hud(1).eliminated, game.hud(2).eliminated]).toEqual([false, true]);
    for (let i = 0; i < 1000; i++) game.step([]);
    expect(slot(2).shown).toBe(false);
    expect(game.hud(1).score).toBe(5); // limit - deaths
    expect(game.result()).toBeNull();
    for (let i = 0; i < 5; i++) kill(1, 0);
    for (let i = 0; i < 5 && !game.result(); i++) game.step([]);
    const r = game.result()!;
    expect(r.map(p => p.score)).toEqual([5, 1 - 4, 0 - 4]); // survivor: limit - deaths; out: order - 4
  });
});
