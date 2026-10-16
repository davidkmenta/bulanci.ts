import { describe, expect, it } from 'vitest';
import { ANIM_AUTOPLAY, ANIM_END, ANIM_LOOP, AnimMeta, AnimPlayer } from '../src/core/scene/anim';

const meta = (over: Partial<AnimMeta> = {}): AnimMeta => ({ width: 10, height: 10, frames: 4, durationMs: 400, events: { 2: 7 }, ...over });
const setup = (m: AnimMeta[] = [meta()]) => {
  const events: number[] = [];
  return { p: new AnimPlayer(m, e => events.push(e)), events };
};

describe('AnimPlayer', () => {
  it('frame durations split duration_ms like animplayer_next_frame', () => {
    const { p } = setup([meta({ frames: 3, durationMs: 100 })]);
    expect([0, 1, 2].map(i => p.frameDuration(i))).toEqual([33, 33, 34]);
    p.frameTimeMs = 50;
    expect(p.frameDuration(0)).toBe(50);
  });

  it('autoplay without loop plays once, emits frame events and 0xffff at the end', () => {
    const { p, events } = setup();
    p.play(0, ANIM_AUTOPLAY, 0);
    expect(p.frame).toBe(0);
    p.tick(99);
    expect(p.frame).toBe(0);
    p.tick(100);
    expect(p.frame).toBe(1);
    p.tick(200);
    expect([p.frame, events]).toEqual([2, [7]]);
    p.tick(300);
    expect([p.frame, p.running, events]).toEqual([3, false, [7, ANIM_END]]);
    p.tick(10_000);
    expect(p.frame).toBe(3);
  });

  it('looping keeps going', () => {
    const { p, events } = setup();
    p.play(0, ANIM_AUTOPLAY | ANIM_LOOP, 0);
    p.tick(1000);
    expect(p.running).toBe(true);
    expect(events).toEqual([7, 7, 7]);
  });

  it('stop frame ends a non-looping play early', () => {
    const { p } = setup();
    p.stopFrame = 2;
    p.play(0, ANIM_AUTOPLAY, 0);
    p.tick(1000);
    expect([p.frame, p.running]).toEqual([1, false]);
  });

  it('without autoplay it shows frame 0 and waits; start() emits 0xffff only when already running', () => {
    const { p, events } = setup();
    p.play(0, 0, 0);
    p.tick(1000);
    expect([p.frame, p.running]).toEqual([0, false]);
    p.start(false, 1000);
    expect(events).toEqual([]);
    p.tick(1100);
    expect(p.frame).toBe(1);
    p.start(true, 1100);
    expect(events).toEqual([ANIM_END]);
  });

  it('setFrame steps to the frame and emits passed events', () => {
    const { p, events } = setup();
    p.play(0, 0, 0);
    p.setFrame(3, 0);
    expect([p.frame, events]).toEqual([3, [7]]);
  });

  it('playing over a running animation emits ANIM_END', () => {
    const { p, events } = setup();
    p.play(0, ANIM_AUTOPLAY | ANIM_LOOP, 0);
    expect(p.running).toBe(true);
    p.play(0, 0, 50);
    expect([events.includes(ANIM_END), p.running, p.frame]).toEqual([true, false, 0]);
  });
});
