import type { Value } from './vm/values';

export const TIMER_PAUSED = 1;
export const TIMER_FROM_NOW = 2;
export const TIMER_REPEAT = 4;

interface Timer {
  start: number;
  interval: number;
  flags: number;
  pauseCount: number;
  value: Value;
}

/** Timer collection: timers_add 0x42f210, pause 0x42f300, resume 0x42f330, update 0x42eb30. Times in ms. */
export class Timers {
  private list: (Timer | undefined)[] = [];

  add(id: number, interval: number, flags: number, now: number): number {
    if (id === -1) id = this.list.length;
    this.list[id] = {
      start: flags & TIMER_FROM_NOW ? now : 0,
      interval,
      flags,
      pauseCount: flags & TIMER_PAUSED ? 1 : 0,
      value: 0,
    };
    return id;
  }

  pause(id: number): void {
    const t = this.list[id];
    if (!t) return;
    t.flags |= TIMER_PAUSED;
    t.pauseCount++;
  }

  resume(id: number, now: number): void {
    const t = this.list[id];
    if (!t || !(t.flags & TIMER_PAUSED)) return;
    if (--t.pauseCount !== 0) return;
    t.flags &= ~TIMER_PAUSED;
    if (t.flags & TIMER_FROM_NOW) t.start = now;
  }

  remove(id: number): void {
    if (this.list[id]) this.list[id] = undefined;
  }

  setInterval(id: number, ms: number): void {
    const t = this.list[id];
    if (t) t.interval = ms;
  }

  setValue(id: number, v: Value): void {
    const t = this.list[id];
    if (t) t.value = v;
  }

  /** timers_set_start */
  setStart(id: number, now: number): void {
    const t = this.list[id];
    if (t) t.start = now;
  }

  /** Exists and is not paused (timers_get(id)->flags & 1 == 0). */
  running(id: number): boolean {
    const t = this.list[id];
    return t !== undefined && !(t.flags & TIMER_PAUSED);
  }

  getValue(id: number): Value {
    return this.list[id]?.value ?? 0;
  }

  activeIds(): number[] {
    return this.list.flatMap((t, id) => (t ? [id] : []));
  }

  /** Fires due timers from the highest id down; repeating timers catch up missed periods. */
  update(now: number, fire: (id: number) => void): void {
    for (let id = this.list.length - 1; id >= 0; id--) {
      const t = this.list[id];
      while (t && !(t.flags & TIMER_PAUSED) && now >= t.start + t.interval) {
        t.start += t.interval;
        fire(id);
        if (this.list[id] !== t) break; // removed or replaced by the callback
        if (!(t.flags & TIMER_REPEAT)) {
          this.list[id] = undefined;
          break;
        }
        // ponytail: the original spins forever on a zero-interval repeating timer; fire once per update instead
        if (t.interval <= 0) break;
      }
    }
  }
}
