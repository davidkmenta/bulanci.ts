import { describe, expect, it } from 'vitest';
import { TIMER_FROM_NOW, TIMER_PAUSED, TIMER_REPEAT, Timers } from '../src/core/timers';

const run = (t: Timers, now: number) => {
  const fired: number[] = [];
  t.update(now, id => fired.push(id));
  return fired;
};

describe('Timers (timers_update 0x42eb30)', () => {
  it('repeating timer counted from now fires on time and catches up missed periods', () => {
    const t = new Timers();
    t.add(0, 100, TIMER_FROM_NOW | TIMER_REPEAT, 1000);
    expect(run(t, 1099)).toEqual([]);
    expect(run(t, 1100)).toEqual([0]);
    expect(run(t, 1350)).toEqual([0, 0]);
  });

  it('one-shot timer is removed after firing', () => {
    const t = new Timers();
    t.add(3, 50, TIMER_FROM_NOW, 0);
    expect(run(t, 60)).toEqual([3]);
    expect(run(t, 1000)).toEqual([]);
    expect(t.activeIds()).toEqual([]);
  });

  it('without FROM_NOW the period starts at time 0', () => {
    const t = new Timers();
    t.add(0, 100, TIMER_REPEAT, 500);
    expect(run(t, 500)).toEqual([0, 0, 0, 0, 0]);
  });

  it('paused timers do not fire; resume restarts FROM_NOW timers', () => {
    const t = new Timers();
    t.add(0, 100, TIMER_PAUSED | TIMER_FROM_NOW | TIMER_REPEAT, 0);
    expect(run(t, 1000)).toEqual([]);
    t.resume(0, 1000);
    expect(run(t, 1099)).toEqual([]);
    expect(run(t, 1100)).toEqual([0]);
    t.pause(0);
    t.pause(0);
    t.resume(0, 2000);
    expect(run(t, 5000)).toEqual([]);
  });

  it('add(-1) appends; update goes from the highest id down', () => {
    const t = new Timers();
    expect(t.add(-1, 10, TIMER_FROM_NOW, 0)).toBe(0);
    expect(t.add(-1, 10, TIMER_FROM_NOW, 0)).toBe(1);
    expect(run(t, 10)).toEqual([1, 0]);
  });

  it('values and intervals', () => {
    const t = new Timers();
    t.add(2, 100, TIMER_FROM_NOW | TIMER_REPEAT, 0);
    t.setValue(2, 'x');
    expect(t.getValue(2)).toBe('x');
    expect(t.getValue(7)).toBe(0);
    t.setInterval(2, 10);
    expect(run(t, 20)).toEqual([2, 2]);
  });

  it('a callback may remove its own timer', () => {
    const t = new Timers();
    t.add(0, 10, TIMER_FROM_NOW | TIMER_REPEAT, 0);
    const fired: number[] = [];
    t.update(100, id => { fired.push(id); t.remove(id); });
    expect(fired).toEqual([0]);
  });

  it('zero interval repeating timer fires once per update instead of hanging', () => {
    const t = new Timers();
    t.add(0, 0, TIMER_FROM_NOW | TIMER_REPEAT, 0);
    expect(run(t, 10)).toEqual([0]);
  });

  it('remove on non-existent timers does not grow the list', () => {
    const t = new Timers();
    t.remove(9);
    t.remove(-1);
    expect(t.add(-1, 10, TIMER_FROM_NOW, 0)).toBe(0);
  });
});
