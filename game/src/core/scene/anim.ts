export interface AnimMeta {
  width: number;
  height: number;
  frames: number;
  durationMs: number;
  events: Record<number, number>; // frame index -> event id (FLX chunk 12)
}

export const ANIM_AUTOPLAY = 1;
export const ANIM_LOOP = 2;
export const ANIM_END = 0xffff;

/** Playback of one CDSAnim: anim_play 0x4391e0, animplayer_start 0x439940, animplayer_stop 0x439840,
 *  animplayer_next_frame 0x4399b0, animplayer_on_timer 0x439b90, animplayer_seek 0x439a30. */
export class AnimPlayer {
  seq = 0;
  frame = 0;
  flags = 0;
  running = false;
  loop = false;
  stopFrame = 0;
  frameTimeMs = -1; // animplayer_set_frame_time; -1 = from the file
  private next = 0; // player +0x38: index of the next frame to show
  private nextAt = 0;
  /** Frame-shown listener (CDSAnim chunk callbacks); wrapped = frame 0 reached by advancing (the ring frame). */
  onShow: ((frame: number, wrapped: boolean) => void) | null = null;

  constructor(readonly sequences: AnimMeta[], private readonly emit: (event: number) => void) {}

  get meta(): AnimMeta {
    return this.sequences[this.seq];
  }

  frameDuration(i: number): number {
    if (this.frameTimeMs !== -1) return this.frameTimeMs;
    const { durationMs: d, frames: n } = this.meta;
    // ponytail: guard against zero-length frames, the original would spin in timers_update
    return Math.max(1, Math.trunc((d * (i + 1)) / n) - Math.trunc((d * i) / n));
  }

  play(seq: number, flags: number, now: number): void {
    if (flags !== -1) this.flags = flags;
    this.stop();
    this.seq = seq;
    this.next = 0;
    this.show(now);
    if (this.flags & ANIM_AUTOPLAY) this.start(Boolean(this.flags & ANIM_LOOP), now);
  }

  start(loop: boolean, now: number): void {
    if (this.running) this.stop();
    this.loop = loop;
    this.running = true;
    this.nextAt = now + this.frameDuration(this.frame);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.emit(ANIM_END);
  }

  setFrame(frame: number, now: number): void {
    const target = (frame + 1) % this.meta.frames;
    while (this.next !== target) this.show(now, this.next === 0);
  }

  /** FUN_00439b40: back to frame 0 (shown now). */
  reset(now: number): void {
    this.next = 0;
    this.show(now);
  }

  tick(now: number): void {
    while (this.running && now >= this.nextAt) {
      this.show(this.nextAt, this.next === 0);
      if (this.next === this.stopFrame && !this.loop) this.stop();
    }
  }

  private show(now: number, wrapped = false): void {
    this.frame = this.next;
    this.nextAt = now + this.frameDuration(this.frame);
    this.next = (this.next + 1) % this.meta.frames;
    this.onShow?.(this.frame, wrapped);
    const event = this.meta.events[this.frame];
    if (event !== undefined) this.emit(event);
  }
}
