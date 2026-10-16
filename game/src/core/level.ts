import { levelOps } from './levelOps';
import { DEFAULT_SOUND_BANK, Manifest, animFrameData, animMeta } from './manifest';
import type { MsvcRand } from './rand';
import { AnimObject, ObstacleObject } from './scene/objects';
import { Scene, Zone } from './scene/scene';
import { Timers } from './timers';
import { baseOps } from './vm/baseOps';
import { parseProgram } from './vm/program';
import { Value } from './vm/values';
import { Handler, Vm } from './vm/vm';

export const STEP_MS = 10;

export type LevelEvent =
  | { type: 'music'; res: number }
  | { type: 'sound'; bankRes: number; index: number; pan: number }
  | { type: 'log'; text: string };

/** The game (CGaming) behind the gameplay opcodes; absent in the plain level viewer. */
export interface GameHook {
  spawnPlayers(): void;
  spawnExtra(): void;
  teleport(slot: number, x: number, y: number, force: boolean): number;
  fire(x: number, y: number, dir: number, owner: number, flags: number, images: Value): void;
  newMine(x: number, y: number): Value;
  zoneAdded(zone: Zone): void;
}

export interface LevelInfo {
  name: string;
  order: number;
  guid: string;
}

/** sound_pan_from_rect 0x422500: x 0..800 -> DirectSound pan -1500..1500. */
export function panFromX(x: number): number {
  const clamped = Math.min(800, Math.max(0, x));
  return Math.trunc((clamped * 3000) / 800) - 1500;
}

/** One running level: its script (CLevelScript) and scene (CGaming). Script entry points: 0 info (arg: 1 = Czech),
 *  1 start, 2 end, 3 object event (slot, event), 6 timer (id), 10 game view activated. */
export class Level {
  readonly scene = new Scene();
  readonly timers = new Timers();
  readonly vm: Vm;
  now = 0;
  soundBank = DEFAULT_SOUND_BANK;
  netStream: Value = 0;
  game: GameHook | null = null;
  private readonly anims: AnimObject[] = [];
  private events: LevelEvent[] = [];

  constructor(readonly id: number, bytes: Uint8Array, readonly manifest: Manifest, readonly rand: MsvcRand) {
    const handlers: Handler[] = [...baseOps];
    for (const [op, h] of Object.entries(levelOps(this))) handlers[Number(op)] = h;
    this.vm = new Vm(parseProgram(bytes), handlers, rand, `level ${id}`);
  }

  info(lang: 0 | 1): LevelInfo {
    this.vm.callEntry(0, [lang]);
    const g = this.vm.globals;
    return { name: String(g[0]), order: Number(g[1]), guid: String(g[2]) };
  }

  /** The level list runs entry 0 on the same script before the game runs entry 1; activating the game view
   *  (CGaming::vfunction16 0x41c140) then runs entry 10. */
  start(lang: 0 | 1): void {
    this.info(lang);
    this.vm.callEntry(1);
    this.vm.callEntry(10);
  }

  step(): void {
    this.now += STEP_MS;
    this.timers.update(this.now, id => this.vm.callEntry(6, [id]));
    for (const a of this.anims) a.player.tick(this.now);
  }

  stop(): void {
    this.vm.callEntry(2);
  }

  takeEvents(): LevelEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  emit(e: LevelEvent): void {
    this.events.push(e);
  }

  log(text: string): void {
    this.emit({ type: 'log', text });
  }

  newAnim(x: number, y: number, flags: number, keys: number[]): AnimObject {
    const sequences = keys.map(k => ({ res: k & 0xffff, meta: animMeta(this.manifest, k & 0xffff), offsets: animFrameData(this.manifest, k & 0xffff).offsets }));
    const anim = new AnimObject(sequences, x, y, {
      event: (obj, ev) => {
        if (obj.slot !== 255) this.vm.callEntry(3, [obj.slot, ev]);
      },
      now: () => this.now,
    });
    this.anims.push(anim);
    anim.play(0, flags);
    return anim;
  }

  /** scene_play_sound_at_slot 0x418000: obstacles pan by their collision rect (empty while hidden). */
  playSound(index: number, slot: number): void {
    const obj = this.scene.getSlot(slot);
    const rect = obj instanceof ObstacleObject ? obj.collisionRect() ?? { left: 0, right: 0 } : obj;
    const pan = rect ? panFromX(Math.trunc((rect.left + rect.right) / 2)) : 0;
    this.emit({ type: 'sound', bankRes: this.soundBank, index, pan });
  }
}
