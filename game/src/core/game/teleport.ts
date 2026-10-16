import { ANIM_END } from '../scene/anim';
import type { Bulanek } from './bulanek';
import type { Gaming } from './gaming';
import { GameAnim } from './items';

/** CTeleportPoint (anim 304): the origin flash centred on the bulanek, and the solid destination flash whose
 *  frame event moves the bulanek there. The origin's end finishes the teleport (0xf5 removes both). */
export class TeleportPoint extends GameAnim {
  constructor(game: Gaming, readonly bulanek: Bulanek, readonly origin: boolean) {
    super(game, 304);
    this.play(0, 1);
    const c = bulanek.collisionRect();
    const cw = c.right - c.left;
    const ch = c.bottom - c.top;
    const dx = Math.trunc((this.width - cw) / 2);
    const dy = Math.trunc((this.height - ch) / 2);
    if (origin) this.moveTo(c.left - dx, c.top - dy);
    else {
      this.collision = { left: dx, top: dy, right: dx + cw, bottom: dy + ch };
      this.solid = true;
    }
    this.setDepth(-11);
  }

  override onEvent(ev: number): void {
    if (!this.origin && ev === 0) {
      this.solid = false;
      this.bulanek.arrive(this.collisionRect()!);
    } else if (this.origin && ev === ANIM_END && this.game.scene.active) this.bulanek.endTeleport();
  }
}
