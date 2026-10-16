import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHAT_GAP_MS, DEAD_MS, PROTOCOL, TICK_MS } from '../game/src/net/protocol.ts';
import type { ServerMsg } from '../game/src/net/protocol.ts';
import { Hub } from './hub.ts';

function setup() {
  let now = 0;
  const hub = new Hub(() => now, () => 0.5);
  const client = (...names: string[]) => {
    const inbox: ServerMsg[] = [];
    const c = { inbox, closed: false, conn: hub.connect(m => inbox.push(m), () => (c.closed = true)) };
    c.conn.message({ t: 'hello', v: PROTOCOL });
    const send = (m: object) => c.conn.message(m);
    const last = <T extends ServerMsg['t']>(t: T) => inbox.filter(m => m.t === t).at(-1) as Extract<ServerMsg, { t: T }> | undefined;
    const ps = names.map((name, i) => ({ name, color: i }));
    return { inbox, c, send, last, ps };
  };
  const advance = (ms: number) => {
    now += ms;
    hub.update();
  };
  /** Host a (1 player) and b (1 player) in a started game. */
  const game = (total = 2, extra = 0) => {
    const a = client('A');
    a.send({ t: 'create', total, players: a.ps });
    const others = Array.from({ length: total - 1 - extra }, (_, i) => client(`B${i}`));
    const id = hub_id(a);
    for (const o of others) o.send({ t: 'join', id, players: o.ps });
    for (const m of [a, ...others]) m.send({ t: 'start' });
    return [a, ...others];
  };
  const hub_id = (a: ReturnType<typeof client>) => {
    a.send({ t: 'list' });
    return a.last('sessions')!.list[0].id;
  };
  return { hub, client, advance, game, id: hub_id, setNow: (t: number) => (now = t) };
}

test('create, list, join until full, then the lobby', () => {
  const { client, id } = setup();
  const a = client('A');
  a.send({ t: 'create', total: 3, players: a.ps });
  assert.deepEqual(a.last('waiting'), { t: 'waiting', joined: 1, total: 3 });
  const b = client('B', 'C');
  const sid = id(b);
  assert.deepEqual(b.last('sessions')!.list, [{ id: sid, name: 'A' }]);
  const c = client('X');
  c.send({ t: 'join', id: sid, players: c.ps }); // 1 + 1 of 3
  b.send({ t: 'join', id: sid, players: b.ps }); // 2 more: full
  assert.deepEqual(b.last('refused'), { t: 'refused', reason: 'full' });
  const d = client('D');
  d.send({ t: 'join', id: sid, players: d.ps });
  const lobby = a.last('lobby')!;
  assert.deepEqual(lobby.slots.map(s => s.name), ['A', 'X', 'D']);
  assert.equal(lobby.host, lobby.you);
  const e = client('E');
  e.send({ t: 'join', id: sid, players: e.ps });
  assert.deepEqual(e.last('refused'), { t: 'refused', reason: 'running' });
  e.send({ t: 'list' });
  assert.deepEqual(e.last('sessions')!.list, []);
});

test('a wrong protocol version is refused', () => {
  const { hub } = setup();
  const inbox: ServerMsg[] = [];
  hub.connect(m => inbox.push(m), () => {}).message({ t: 'hello', v: -1 });
  assert.deepEqual(inbox, [{ t: 'refused', reason: 'version' }]);
});

test('only the host sets up the game; clients start after the host; go carries the seed', () => {
  const { client, id } = setup();
  const a = client('A');
  a.send({ t: 'create', total: 2, players: a.ps });
  const b = client('B');
  b.send({ t: 'join', id: id(b), players: b.ps });
  b.send({ t: 'setup', setup: { level: 3, type: 0, limit: 10 } });
  a.send({ t: 'setup', setup: { level: 2, type: 0, limit: 10 } });
  assert.deepEqual(b.last('lobby')!.setup, { level: 2, type: 0, limit: 10 });
  b.send({ t: 'start' }); // too early: ignored
  a.send({ t: 'start' });
  assert.equal(b.last('lobby')!.started, true);
  assert.equal(b.last('go'), undefined);
  b.send({ t: 'start' });
  assert.deepEqual(b.last('go'), { t: 'go', seed: 2 ** 31, setup: { level: 2, type: 0, limit: 10 }, slots: b.last('lobby')!.slots });
});

test('edits only own slots; names are trimmed and limited', () => {
  const { client, id } = setup();
  const a = client('A');
  a.send({ t: 'create', total: 2, players: a.ps });
  const b = client('B');
  b.send({ t: 'join', id: id(b), players: b.ps });
  b.send({ t: 'player', slot: 0, name: 'hack', color: 3 });
  b.send({ t: 'player', slot: 1, name: '  Bobíkbobíkbobík  ', color: 5 });
  assert.deepEqual(a.last('lobby')!.slots.map(s => [s.name, s.color]), [['A', 0], ['Bobíkbobíkbo', 5]]);
});

test('ticks are sealed by the server clock; foreign edges are dropped; nobody sees input before the seal', () => {
  const { game, advance } = setup();
  const [a, b] = game();
  a.send({ t: 'input', edges: [{ key: 0, down: true, player: 0 }, { key: 1, down: true, player: 1 }] });
  assert.equal(b.inbox.some(m => m.t === 'tick'), false);
  advance(TICK_MS);
  assert.deepEqual(b.last('tick'), { t: 'tick', n: 0, edges: [{ key: 0, down: true, player: 0 }], events: [] });
  // late input of an old tick lands in the next open one
  b.send({ t: 'input', edges: [{ key: 4, down: true, player: 1 }] });
  advance(3 * TICK_MS);
  assert.deepEqual(a.inbox.filter(m => m.t === 'tick').map(m => [m.n, m.edges.length]), [[0, 1], [1, 1], [2, 0], [3, 0]]);
});

test('checksums: a minority is kicked, two machines that differ end the game', () => {
  const s3 = setup();
  const [a, b, c] = s3.game(3);
  s3.advance(TICK_MS);
  a.send({ t: 'hash', n: 0, crc: 7 });
  b.send({ t: 'hash', n: 0, crc: 7 });
  c.send({ t: 'hash', n: 0, crc: 8 });
  assert.deepEqual(c.last('kicked'), { t: 'kicked' });
  assert.equal(c.c.closed, true);
  s3.advance(TICK_MS);
  assert.deepEqual(a.last('tick')!.events, [{ left: 2 }]);

  const s2 = setup();
  const [x, y] = s2.game();
  s2.advance(TICK_MS);
  x.send({ t: 'hash', n: 0, crc: 1 });
  y.send({ t: 'hash', n: 0, crc: 2 });
  assert.deepEqual([x.last('ended'), y.last('ended')], [{ t: 'ended' }, { t: 'ended' }]);
});

test('a machine that goes silent leaves with a tick event; pause is per machine', () => {
  const { game, advance, setNow } = setup();
  const [a, b] = game(3);
  a.send({ t: 'pause', on: true });
  b.send({ t: 'pause', on: false }); // not paused: ignored
  advance(TICK_MS);
  assert.deepEqual(b.last('tick')!.events, [{ pause: a.last('lobby')!.you, on: true }]);
  a.c.conn.alive();
  setNow(DEAD_MS - 1);
  a.c.conn.alive();
  advance(2);
  assert.equal(b.c.closed, true); // b never answered a ping
  advance(TICK_MS);
  assert.deepEqual(a.inbox.flatMap(m => (m.t === 'tick' ? m.events.filter(e => 'left' in e) : [])), [{ left: 1 }, { left: 2 }]);
});

test('leaving the lobby ends it for everybody ("Někdo z hráčů opustil hru.")', () => {
  const { client, id } = setup();
  const a = client('A');
  a.send({ t: 'create', total: 2, players: a.ps });
  const b = client('B');
  b.send({ t: 'join', id: id(b), players: b.ps });
  b.c.conn.closed();
  assert.deepEqual(a.last('left'), { t: 'left' });
});

test('chat: own slots only, trimmed to 80 chars, one message per 0.5 s', () => {
  const { client, id, advance } = setup();
  const a = client('A');
  a.send({ t: 'create', total: 2, players: a.ps });
  const b = client('B');
  b.send({ t: 'join', id: id(b), players: b.ps });
  b.send({ t: 'chat', slot: 0, text: 'fake' });
  b.send({ t: 'chat', slot: 1, text: 'x'.repeat(100) });
  b.send({ t: 'chat', slot: 1, text: 'spam' });
  advance(CHAT_GAP_MS);
  b.send({ t: 'chat', slot: 1, text: 'ahoj' });
  assert.deepEqual(a.inbox.filter(m => m.t === 'chat'), [{ t: 'chat', slot: 1, text: 'x'.repeat(80) }, { t: 'chat', slot: 1, text: 'ahoj' }]);
});
