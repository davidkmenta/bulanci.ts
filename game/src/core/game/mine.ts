import type { Zone } from '../scene/scene';
import type { Bulanek } from './bulanek';
import { Explosion } from './explosion';
import type { Gaming } from './gaming';
import { GameAnim } from './items';
import { MINE_OFF } from './weapons';

/** CMina: armed 2 s after it is attached; then anyone (flags 8 = also slots > 3, 2 = also invisible) entering its
 *  zone (view rect + 10 px) sets it off. */
export class Mine extends GameAnim {
  private armed = false;
  private zone: Zone | null = null;

  // CMina::CMina 0x41cb70 (owner) and 0x41cce0 (new_mine: centred above x, y, no owner)
  constructor(game: Gaming, readonly owner: Bulanek | null, at?: { x: number; y: number }) {
    super(game, 177);
    this.play(0, 1);
    if (owner) {
      const [dx, dy] = MINE_OFF[owner.dir];
      this.moveTo(owner.left + dx, owner.top + dy);
    } else if (at) this.moveTo(at.x - Math.trunc(this.width / 2), at.y - this.height - 2);
    this.setDepth(-14);
  }

  override attach(): void {
    if (this.attached) return;
    this.attached = true;
    this.timers.add(0, 2000, 2, this.game.now);
  }

  override onTimer(): void {
    this.armed = true;
    this.zone = { id: 0, rect: { left: this.left - 10, top: this.top - 10, right: this.right + 10, bottom: this.bottom + 10 }, flags: 10, mask: 0, owner: this };
    this.game.addZone(this.zone);
  }

  /** 0xf2 */
  zoneMessage(_zone: Zone, enter: boolean): void {
    if (enter) this.explode();
  }

  // FUN_0041e070
  explode(): boolean {
    if (!this.armed) return false;
    this.armed = false;
    this.shown = false;
    this.game.post(() => {
      // 0xf9: remove the mine and its zone
      this.game.scene.remove(this);
      this.game.removeZone(this.zone);
    });
    this.game.scene.add(new Explosion(this.game, this, this.owner?.slot ?? 0xff), 1);
    return true;
  }
}
