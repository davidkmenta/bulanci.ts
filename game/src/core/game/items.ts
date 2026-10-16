import { animFrameData, animMeta } from '../manifest';
import { AnimObject } from '../scene/objects';
import { Timers } from '../timers';
import type { Gaming } from './gaming';

/** A game-owned CAnim-like object with its own timers. The game ticks it (timers, then anim); the level ticks
 *  only the anims its script created. */
export class GameAnim extends AnimObject {
  readonly timers = new Timers();
  attached = false;

  constructor(readonly game: Gaming, res: number, x = 0, y = 0) {
    super([{ res, meta: animMeta(game.level.manifest, res) }], x, y, {
      event: (o, ev) => (o as GameAnim).onEvent(ev),
      now: () => game.level.now,
    });
  }

  /** Frame-0 attachment point of the anim (chunk 11). */
  point(): { x: number; y: number } {
    const p = animFrameData(this.game.level.manifest, this.sequences[0].res).points?.[0]?.[0];
    return { x: p?.[1] ?? 0, y: p?.[2] ?? 0 };
  }

  onEvent(_ev: number): void {}
  onTimer(_id: number): void {}

  tick(now: number): void {
    this.timers.update(now, id => this.onTimer(id));
    this.player.tick(now);
  }
}

/** Weapon pickup (FUN_0041d240): type 1 shotgun (slot 100), 2 mines, 4 machine gun, 5 rocket (slots 101-107). */
export class Item extends GameAnim {
  constructor(game: Gaming, readonly type: number, res: number) {
    super(game, res);
    this.play(0, 3);
    this.setDepth(0);
  }
}

/** Bonus kinds (CGaming +0x324..+0x330): 0 invisibility, 1 invulnerability, 2 infinite ammo, 3 hourglass. */
export const BONUS_ANIMS = [293, 294, 221, 220];
