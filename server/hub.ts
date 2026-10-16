import {
  CHAT_GAP_MS, CHAT_MAX, DEAD_MS, MAX_PLAYERS, MAX_ROOMS, NAME_MAX, PROTOCOL, TICK_MS,
} from '../game/src/net/protocol.ts';
import type { ClientMsg, GameSetup, NetEdge, NetPlayer, ServerMsg, Slot, TickEvent } from '../game/src/net/protocol.ts';

const MSGS_PER_S = 200; // more is a flood: the connection is dropped

interface Machine {
  id: number;
  send: (m: ServerMsg) => void;
  close: () => void;
  room: Room | null;
  hello: boolean;
  ready: boolean;
  seen: number;
  lastChat: number;
  window: number; // start of the current 1 s message window
  count: number;
}

interface Room {
  id: number;
  name: string;
  total: number;
  state: 'waiting' | 'lobby' | 'game';
  machines: Machine[];
  slots: Slot[];
  setup: GameSetup;
  started: boolean; // the host pressed Start
  n: number;
  next: number;
  edges: NetEdge[];
  events: TickEvent[];
  paused: Set<number>;
  hashes: Map<number, Map<number, number>>;
}

export interface Conn {
  message(m: unknown): void;
  alive(): void;
  closed(): void;
}

const isInt = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const cleanName = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, NAME_MAX) : '');
const players = (v: unknown): NetPlayer[] | null => {
  if (!Array.isArray(v) || v.length < 1 || v.length > MAX_PLAYERS - 1) return null;
  const ps = v.map(p => ({ name: cleanName(p?.name), color: p?.color }));
  return ps.every(p => p.name && isInt(p.color, 0, 7)) ? ps : null;
};

/** Rooms, the session list, chat and the tick clock. Transport-free: index.ts wires it to WebSockets and the tests
 *  drive it with a fake clock. Anti-cheat: the server seals every tick (nobody sees others' input before its own is
 *  in), keeps time (late input lands in the next tick), owns the seed, drops edges for foreign slots and compares
 *  the clients' state checksums. */
export class Hub {
  private readonly rooms = new Map<number, Room>();
  private readonly machines = new Set<Machine>();
  private ids = 0;

  private readonly now: () => number;
  private readonly random: () => number;

  constructor(now: () => number, random = () => Math.random()) {
    this.now = now;
    this.random = random;
  }

  connect(send: (m: ServerMsg) => void, close: () => void): Conn {
    const m: Machine = { id: ++this.ids, send, close, room: null, hello: false, ready: false, seen: this.now(), lastChat: -Infinity, window: 0, count: 0 };
    this.machines.add(m);
    return {
      message: raw => this.message(m, raw),
      alive: () => (m.seen = this.now()),
      closed: () => this.leave(m),
    };
  }

  /** Seals due ticks and drops silent machines; index.ts calls it every few ms. */
  update(): void {
    const now = this.now();
    for (const m of [...this.machines]) if (now - m.seen > DEAD_MS) this.drop(m);
    for (const r of this.rooms.values()) {
      if (r.state !== 'game') continue;
      if (now - r.next > 1000) r.next = now; // the server itself stalled: do not burst
      while (now >= r.next) {
        this.broadcast(r, { t: 'tick', n: r.n++, edges: r.edges, events: r.events });
        r.edges = [];
        r.events = [];
        r.next += TICK_MS;
      }
    }
  }

  private drop(m: Machine): void {
    this.leave(m);
    m.close();
  }

  private message(m: Machine, raw: unknown): void {
    const now = this.now();
    m.seen = now;
    if (now - m.window >= 1000) (m.window = now), (m.count = 0);
    if (++m.count > MSGS_PER_S) return this.drop(m);
    const msg = raw as ClientMsg;
    if (typeof msg !== 'object' || msg === null) return this.drop(m);
    if (msg.t === 'hello') {
      if (msg.v !== PROTOCOL) return m.send({ t: 'refused', reason: 'version' });
      m.hello = true;
      return;
    }
    if (!m.hello) return this.drop(m);
    const r = m.room;
    switch (msg.t) {
      case 'list':
        return m.send({ t: 'sessions', list: [...this.rooms.values()].filter(r => r.state === 'waiting').map(r => ({ id: r.id, name: r.name })) });
      case 'create': {
        const ps = players(msg.players);
        if (r || !ps || !isInt(msg.total, ps.length + 1, MAX_PLAYERS)) return;
        if (this.rooms.size >= MAX_ROOMS) return m.send({ t: 'refused', reason: 'busy' });
        const room: Room = {
          id: this.ids++, name: ps[0].name, total: msg.total, state: 'waiting', machines: [m], slots: ps.map(p => ({ ...p, machine: m.id })),
          setup: { level: 0, type: 1, limit: 180 }, started: false, n: 0, next: 0, edges: [], events: [], paused: new Set(), hashes: new Map(),
        };
        this.rooms.set(room.id, room);
        m.room = room;
        m.ready = false;
        return this.waiting(room);
      }
      case 'join': {
        const ps = players(msg.players);
        if (r || !ps) return;
        const room = this.rooms.get(msg.id);
        if (!room) return m.send({ t: 'refused', reason: 'gone' });
        if (room.state !== 'waiting') return m.send({ t: 'refused', reason: 'running' });
        if (room.slots.length + ps.length > room.total) return m.send({ t: 'refused', reason: 'full' });
        room.machines.push(m);
        room.slots.push(...ps.map(p => ({ ...p, machine: m.id })));
        m.room = room;
        m.ready = false;
        if (room.slots.length < room.total) return this.waiting(room);
        room.state = 'lobby';
        return this.lobby(room);
      }
      case 'player': {
        const s = r?.slots[msg.slot];
        const name = cleanName(msg.name);
        if (r?.state !== 'lobby' || s?.machine !== m.id || m.ready || !name || !isInt(msg.color, 0, 7)) return;
        s.name = name;
        s.color = msg.color;
        return this.lobby(r);
      }
      case 'setup': {
        const s = msg.setup;
        if (r?.state !== 'lobby' || r.machines[0] !== m || r.started || !isInt(s?.level, 0, 999) || !isInt(s.type, 0, 2) || !isInt(s.limit, 1, 9999)) return;
        r.setup = { level: s.level, type: s.type, limit: s.limit };
        return this.lobby(r);
      }
      case 'chat': {
        const text = typeof msg.text === 'string' ? msg.text.trim().slice(0, CHAT_MAX) : '';
        if (!r || r.state === 'waiting' || r.slots[msg.slot]?.machine !== m.id || !text || now - m.lastChat < CHAT_GAP_MS) return;
        m.lastChat = now;
        return this.broadcast(r, { t: 'chat', slot: msg.slot, text });
      }
      case 'start': {
        if (r?.state !== 'lobby' || m.ready) return;
        if (r.machines[0] === m) r.started = true;
        else if (!r.started) return;
        m.ready = true;
        if (!r.machines.every(x => x.ready)) return this.lobby(r);
        r.state = 'game';
        r.next = now + TICK_MS;
        return this.broadcast(r, { t: 'go', seed: Math.floor(this.random() * 2 ** 32) >>> 0, setup: r.setup, slots: r.slots });
      }
      case 'input': {
        if (r?.state !== 'game' || !Array.isArray(msg.edges) || msg.edges.length > 32) return;
        for (const e of msg.edges) {
          if (isInt(e?.key, 0, 5) && typeof e.down === 'boolean' && r.slots[e.player]?.machine === m.id) r.edges.push({ key: e.key, down: e.down, player: e.player });
        }
        return;
      }
      case 'hash': {
        if (r?.state !== 'game' || !isInt(msg.n, 0, r.n) || !isInt(msg.crc, 0, 2 ** 32 - 1)) return;
        const h = r.hashes.get(msg.n) ?? new Map<number, number>();
        h.set(m.id, msg.crc);
        r.hashes.set(msg.n, h);
        return this.check(r, msg.n);
      }
      case 'pause': {
        if (r?.state !== 'game' || typeof msg.on !== 'boolean' || r.paused.has(m.id) === msg.on) return;
        if (msg.on) r.paused.add(m.id);
        else r.paused.delete(m.id);
        r.events.push({ pause: m.id, on: msg.on });
        return;
      }
    }
  }

  /** Compares the checksums of tick n once every machine sent one: a minority is kicked, 2 machines that differ end the game. */
  private check(r: Room, n: number): void {
    const h = r.hashes.get(n);
    if (!h || r.machines.some(m => !h.has(m.id))) return;
    r.hashes.delete(n);
    const votes = new Map<number, number>();
    for (const m of r.machines) votes.set(h.get(m.id)!, (votes.get(h.get(m.id)!) ?? 0) + 1);
    if (votes.size === 1) return;
    const [crc, count] = [...votes].sort((a, b) => b[1] - a[1])[0];
    if (r.machines.length === 2 || count * 2 <= r.machines.length) {
      this.broadcast(r, { t: 'ended' });
      return this.close(r);
    }
    for (const m of r.machines.filter(m => h.get(m.id) !== crc)) {
      m.send({ t: 'kicked' });
      this.drop(m);
    }
  }

  private leave(m: Machine): void {
    this.machines.delete(m);
    const r = m.room;
    if (!r) return;
    m.room = null;
    const i = r.machines.indexOf(m);
    if (i < 0) return;
    if (r.state === 'lobby' || (r.state === 'waiting' && i === 0)) {
      // the original ends the session for everybody: "Někdo z hráčů opustil hru."
      r.machines.splice(i, 1);
      this.broadcast(r, { t: 'left' });
      return this.close(r);
    }
    r.machines.splice(i, 1);
    if (r.state === 'waiting') {
      r.slots = r.slots.filter(s => s.machine !== m.id);
      return this.waiting(r);
    }
    // in game: a deterministic event in the next tick, the others play on
    if (!r.machines.length) return this.close(r);
    r.slots.forEach((s, slot) => s.machine === m.id && r.events.push({ left: slot }));
    if (r.paused.delete(m.id)) r.events.push({ pause: m.id, on: false });
    for (const n of [...r.hashes.keys()]) this.check(r, n);
  }

  private close(r: Room): void {
    for (const m of r.machines) m.room = null;
    r.machines = [];
    this.rooms.delete(r.id);
  }

  private waiting(r: Room): void {
    this.broadcast(r, { t: 'waiting', joined: r.slots.length, total: r.total });
  }

  private lobby(r: Room): void {
    for (const m of r.machines) m.send({ t: 'lobby', slots: r.slots, host: r.machines[0].id, you: m.id, setup: r.setup, started: r.started });
  }

  private broadcast(r: Room, msg: ServerMsg): void {
    for (const m of r.machines) m.send(msg);
  }
}
