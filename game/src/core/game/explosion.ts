import { ANIM_END } from '../scene/anim';
import type { Rect, SceneObject } from '../scene/objects';
import { intersects } from '../scene/scene';
import type { Gaming } from './gaming';
import { GameAnim } from './items';
import { Mine } from './mine';
import { BANK_HEAVY } from './weapons';

/** 0x4828c8: blast ray steps for directions k = 0..7 (k & 3 is the death direction). */
const RAYS = [[-6, 0], [6, 0], [0, -6], [0, 6], [-4, -4], [4, 4], [4, -4], [-4, 4]];

const box = (o: SceneObject): Rect => ({ left: o.left, top: o.top, right: o.right, bottom: o.bottom });

/** CExplosion 0x41ce30: anim 178 centred on the source rect; damage on its frame event, removed at its end. */
export class Explosion extends GameAnim {
  constructor(game: Gaming, src: SceneObject, readonly owner: number) {
    super(game, 178);
    this.play(0, 1);
    this.moveTo(src.left + Math.trunc((src.width - this.width) / 2), src.top + Math.trunc((src.height - this.height) / 2));
    game.sound(1, BANK_HEAVY, box(this));
    this.setDepth(0);
  }

  override onEvent(ev: number): void {
    if (ev === 0) this.blast();
    else if (ev === ANIM_END) this.game.post(() => this.game.scene.remove(this));
  }

  // FUN_0041e140: 8 rays of 15 steps from the centre; obstacles do not stop rays; chains armed mines
  private blast(): void {
    const scene = this.game.scene;
    const big = { left: this.left - 60, top: this.top - 60, right: this.right + 60, bottom: this.bottom + 60 };
    const cands: (SceneObject | null)[] = scene.hitTestAll(big, true);
    if (!cands.length) return;
    const l = Math.trunc((big.left - 4 + big.right) / 2);
    const t = Math.trunc((big.top - 4 + big.bottom) / 2);
    const centre = { left: l, top: t, right: l + 4, bottom: t + 4 };
    this.probe(cands, centre, true, 0);
    for (let k = 7; k >= 0; k--) {
      const r = { ...centre };
      const [dx, dy] = RAYS[k];
      for (let left = 15; left > 0; ) {
        r.left += dx;
        r.right += dx;
        r.top += dy;
        r.bottom += dy;
        left--;
        if (this.probe(cands, r, left > 3, k & 3)) break;
      }
    }
    // FUN_0041a2f0: armed mines whose view meets the blast area, last first
    const mines = scene.objects().filter((o): o is Mine => o instanceof Mine && intersects(box(o), big));
    for (let i = mines.length - 1; i >= 0; i--) mines[i].explode();
  }

  // FUN_0041b250: hit the last candidate meeting rect, up to 4 times while it stays in its slot
  private probe(cands: (SceneObject | null)[], rect: Rect, blast: boolean, dir: number): boolean {
    for (let i = cands.length - 1; i >= 0; i--) {
      const c = cands[i];
      if (!c || c.slot === 0xff) continue;
      const cr = c.collisionRect();
      if (!cr || !intersects(rect, cr)) continue;
      // FUN_0041a0f0: a remote bulanek would stop the ray here; all are local in single player
      const kind = dir | (blast ? 0x80 : 0);
      const slot = c.slot;
      for (let n = 1; ; n++) {
        this.game.hit(slot, this.owner, kind);
        cands[i] = this.game.scene.getSlot(slot);
        if (n === 4) return true;
        if (!cands[i]) return false;
      }
    }
    return false;
  }
}
