import { describe, expect, it } from 'vitest';
import { Gaming } from '../src/core/game/gaming';
import { KeyEdge } from '../src/core/game/input';
import { Level } from '../src/core/level';
import { MsvcRand } from '../src/core/rand';
import { Lockstep, Simulation } from '../src/net/lockstep';
import { COUNTDOWN, DELAY, HASH_EVERY, TICK_MS, Tick } from '../src/net/protocol';
import { loadManifest, readAsset } from './fixtures';

const manifest = loadManifest();
const tick = (n: number, edges: Tick['edges'] = [], events: Tick['events'] = []): Tick => ({ t: 'tick', n, edges, events });

function fake() {
  const log: string[] = [];
  const sim: Simulation = {
    step: (e: KeyEdge[]) => log.push(`step ${e.map(x => `${x.player}:${x.key}${x.down ? 'v' : '^'}`).join(',')}`),
    playerLeft: s => log.push(`left ${s}`),
    checksum: () => 42,
  };
  const hashes: number[] = [];
  return { log, hashes, ls: new Lockstep(sim, n => hashes.push(n)) };
}

describe('Lockstep', () => {
  it('waits for DELAY ticks, then runs one per 20 ms and never ahead of the server', () => {
    const { ls } = fake();
    for (let n = 0; n < DELAY - 1; n++) ls.push(tick(n));
    expect(ls.update(1000)).toBe(0);
    ls.push(tick(DELAY - 1));
    expect(ls.update(TICK_MS * 2)).toBe(2);
    expect(ls.update(TICK_MS * 10)).toBe(2); // only 2 left: then it buffers again
    expect(ls.update(TICK_MS)).toBe(0);
  });

  it('catches up when the backlog grows', () => {
    const { ls } = fake();
    for (let n = 0; n < 30; n++) ls.push(tick(n));
    expect(ls.update(TICK_MS)).toBe(30 - 2 * DELAY);
  });

  it('counts down, then steps twice per tick; hashes every HASH_EVERY ticks', () => {
    const { ls, log, hashes } = fake();
    for (let n = 0; n <= COUNTDOWN; n++) ls.push(tick(n, n === COUNTDOWN ? [{ key: 4, down: true, player: 1 }] : []));
    while (ls.update(TICK_MS * 50) > 0);
    expect(ls.counter).toBe(5);
    expect(log).toEqual(['step 1:4v', 'step ']);
    expect(hashes).toEqual(Array.from({ length: COUNTDOWN / HASH_EVERY }, (_, i) => (i + 1) * HASH_EVERY - 1));
  });

  it('pause keeps the edges for the first running tick; left goes to the simulation', () => {
    const { ls, log } = fake();
    ls.clock = COUNTDOWN;
    ls.push(tick(0, [], [{ pause: 7, on: true }]));
    ls.push(tick(1, [{ key: 0, down: false, player: 0 }]));
    ls.push(tick(2, [], [{ pause: 7, on: false }, { left: 1 }]));
    ls.push(tick(3));
    while (ls.update(TICK_MS) > 0);
    expect(log).toEqual(['left 1', 'step 0:0^', 'step ', 'step ', 'step ']);
  });
});

describe('Gaming in lockstep', () => {
  const run = (seed: number, left?: number) => {
    const level = new Level(321, readAsset('levels/00321.bin'), manifest, new MsvcRand(seed));
    const game = new Gaming(level, { players: [{ name: 'A', color: 0 }, { name: 'B', color: 2 }, { name: 'C', color: 4 }], type: 0, limit: 30 });
    game.start(1);
    for (let i = 0; i < 6000; i++) {
      const edges: KeyEdge[] = i % 97 === 0 ? [{ key: (i / 97) % 6, down: (i / 97) % 2 === 0, player: i % 3 }] : [];
      game.step(edges);
      if (i === 3000 && left !== undefined) game.playerLeft(left);
    }
    return game;
  };

  it('two machines with the same seed and edges agree on the checksum after 60 s', () => {
    expect(run(123).checksum()).toBe(run(123).checksum());
    expect(run(123).checksum()).not.toBe(run(124).checksum());
  });

  it('a different state changes the checksum', () => {
    const g = run(5);
    const c = g.checksum();
    (g.scene.getSlot(0) as unknown as { frags: number }).frags++;
    expect(g.checksum()).not.toBe(c);
  });

  it('a player that left is out (hidden, dimmed in the HUD) and the last one ends the round', () => {
    const g = run(9, 2);
    expect(g.scene.getSlot(2)!.shown).toBe(false);
    expect(g.hud(2).eliminated).toBe(true);
    expect(g.result()).toBeNull();
    g.playerLeft(1);
    g.step([]);
    expect(g.result()!.map(p => p.name)).toEqual(['A', 'B', 'C']);
  });
});

describe('serverUrl (CTcpIpConfig address)', async () => {
  const { serverUrl } = await import('../src/net/client');
  const page = { protocol: 'https:', hostname: 'bulanci.cz' } as Location;
  it.each([
    ['', undefined, 'wss://bulanci.cz:8787'],
    ['', 'ws://srv:9', 'ws://srv:9'],
    ['10.0.0.5', undefined, 'wss://10.0.0.5:8787'],
    [' host:1234 ', undefined, 'wss://host:1234'],
    ['ws://a.b/x', undefined, 'ws://a.b/x'],
  ])('%j -> %s', (addr, env, url) => expect(serverUrl(addr, env, page)).toBe(url));
});
