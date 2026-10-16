import { ANIM_END } from '../scene/anim';
import type { DrawItem } from '../scene/objects';
import type { Bulanek } from './bulanek';
import type { Gaming } from './gaming';
import { GameAnim } from './items';

/** 0x4aefb8: death anim by shot direction + bulanek direction * 4 (0 = look further). */
const DEATH = [297, 298, 0, 0, 299, 300, 0, 0, 0, 0, 302, 301, 0, 0, 296, 295];
/** Explosion deaths by ray direction: players 0x4aeff8, zombies 0x4af008. */
const BLAST = [206, 208, 210, 204];
const BLAST_EXTRA = [207, 209, 211, 205];

function deathAnim(b: Bulanek, kind: number): { res: number; dir: number } {
  const shot = kind & 0x7f;
  if (kind & 0x80) return { res: (b.isExtra ? BLAST_EXTRA : BLAST)[shot], dir: shot };
  let i = shot + b.dir * 4;
  while (DEATH[i] === 0) i += shot < 2 ? -4 : 4;
  return { res: DEATH[i], dir: i >> 2 };
}

/** Places a corpse anim so its frame-0 point meets the bulanek's hand point, at the bulanek's depth. */
function alignToHand(a: GameAnim, b: Bulanek): void {
  const h = b.handPoint();
  const p = a.point();
  a.moveTo(h.x - p.x, h.y - p.y);
  a.setDepth(b.depth() - a.bottom);
}

/** CDeath (FUN_0041c610): the corpse, solid for the first 3/4 of the anim (3 frames for blasts); its end
 *  respawns the bulanek (0xf6). */
export class Death extends GameAnim {
  private readonly solidUntil: number;

  constructor(game: Gaming, readonly bulanek: Bulanek, kind: number) {
    const { res, dir } = deathAnim(bulanek, kind);
    super(game, res);
    bulanek.face(dir, false);
    this.solidUntil = kind & 0x80 ? 3 : Math.trunc((this.player.meta.frames * 3) / 4);
    this.play(0, 1);
    alignToHand(this, bulanek);
    const c = bulanek.collisionRect();
    this.collision = { left: c.left - this.left, top: c.top - this.top, right: c.right - this.left, bottom: c.bottom - this.top };
    this.solid = true;
    this.player.onShow = f => {
      if (this.solid && f >= this.solidUntil) this.solid = false;
    };
  }

  override onEvent(ev: number): void {
    if (ev !== ANIM_END) return;
    this.shown = false;
    this.game.post(() => this.game.respawn(this.bulanek)); // 0xf6
  }

  override draw(): DrawItem {
    return { ...super.draw(), color: this.bulanek.color };
  }
}

/** CDeath2 (FUN_0041c860): the zombie's rising soul (anim 218), hidden at its end. */
export class Death2 extends GameAnim {
  constructor(game: Gaming, readonly bulanek: Bulanek) {
    super(game, 218);
    this.play(0, 1);
    alignToHand(this, bulanek);
  }

  override onEvent(ev: number): void {
    if (ev === ANIM_END) this.shown = false;
  }

  override draw(): DrawItem {
    return { ...super.draw(), color: this.bulanek.color };
  }
}
