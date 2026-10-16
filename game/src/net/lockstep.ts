import type { KeyEdge } from '../core/game/input';
import { COUNTDOWN, DELAY, HASH_EVERY, NetEdge, STEPS_PER_TICK, TICK_MS, Tick } from './protocol';

export interface Simulation {
  step(edges: KeyEdge[]): void;
  playerLeft(slot: number): void;
  checksum(): number;
}

const CATCH_UP = 50; // most ticks run in one frame when far behind (a background tab)

/** Runs the sealed ticks of the server in order: a jitter buffer of DELAY ticks, never ahead of the server, faster
 *  when the backlog grows. The first COUNTDOWN ticks are the CGameCounter. Edges sealed while any machine pauses are
 *  kept for the first running tick (a release must not get lost). */
export class Lockstep {
  n = 0; // ticks run
  clock = 0; // ticks run unpaused: the countdown, then the round
  readonly paused = new Set<number>(); // machines
  private readonly queue: Tick[] = [];
  private carry: NetEdge[] = [];
  private acc = 0;
  private buffering = true;

  constructor(private readonly sim: Simulation, private readonly onHash: (n: number, crc: number) => void) {}

  push(t: Tick): void {
    this.queue.push(t);
  }

  /** Lights shown by the countdown (0..4) and whether the round runs. */
  get counter(): number {
    return Math.min(5, Math.floor(this.clock / (COUNTDOWN / 5)));
  }

  /** Advances by dt ms of real time; returns the number of ticks run. */
  update(dt: number): number {
    if (this.buffering) {
      if (this.queue.length < DELAY) return 0;
      this.buffering = false;
      this.acc = 0;
    }
    this.acc += dt;
    let ran = 0;
    while (this.acc >= TICK_MS) {
      const t = this.queue.shift();
      if (!t) {
        this.buffering = true;
        break;
      }
      this.acc -= TICK_MS;
      this.run(t);
      ran++;
    }
    while (this.queue.length > 2 * DELAY && ran < CATCH_UP) this.run(this.queue.shift()!), ran++;
    return ran;
  }

  private run(t: Tick): void {
    for (const e of t.events) {
      if ('left' in e) this.sim.playerLeft(e.left);
      else if (e.on) this.paused.add(e.pause);
      else this.paused.delete(e.pause);
    }
    const edges = this.carry.concat(t.edges);
    if (this.paused.size) this.carry = edges;
    else {
      this.carry = [];
      if (this.clock++ >= COUNTDOWN) {
        this.sim.step(edges);
        for (let i = 1; i < STEPS_PER_TICK; i++) this.sim.step([]);
      }
    }
    if (this.n % HASH_EVERY === HASH_EVERY - 1) this.onHash(this.n, this.sim.checksum());
    this.n++;
  }
}
