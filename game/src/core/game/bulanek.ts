import { ANIM_END, AnimPlayer } from '../scene/anim';
import { animFrameData, animMeta, sampleMs } from '../manifest';
import { DrawItem, Rect, SceneObject } from '../scene/objects';
import { intersects, union, Zone, ZoneOwner } from '../scene/scene';
import { Timers } from '../timers';
import { Death, Death2 } from './death';
import type { Gaming } from './gaming';
import { Mine } from './mine';
import { Shot } from './shot';
import { BANK_HEAVY, BANK_LIGHT, MAX_AMMO, MG_OFF, MINE_OFF, PISTOL_OFF, PICKUP_SOUND, RANDOM_WEAPON, ROCKET_OFF, SHOTGUN_OFF, Weapon } from './weapons';

/** Walk anims per direction L, R, U, D: players 0x4af2ec, extras (zombies) 0x4af2dc. */
const WALK = [198, 200, 202, 196];
const WALK_EXTRA = [199, 201, 203, 197];
/** Voice sounds by voice index: spawn 0x4aef98, taunt 0x4aef88, groan 0x4aefa8. */
const SPAWN_VOICE = [1, 4, 7, 10];
const TAUNT_VOICE = [2, 5, 8, 11];
const GROAN_VOICE = [3, 6, 9, 12];

const R = (left: number, top: number, right: number, bottom: number): Rect => ({ left, top, right, bottom });
const sameRect = (a: Rect, b: Rect) => a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom;

/** CBulanek (vtable 0x481e54): player, NPC (slots 125-127) or zombie (extras 0x20-0x23). The view rect is the union
 *  of the body and the weapon in hand; body anim +0xa8 (seq = direction), weapon +0xf8, timers +0x88:
 *  0 pistol reload, 1 delayed shot, 2 NPC teleport, 3 zombie walk, 4 zombie look-out, 5 zombie fade-in. */
export class Bulanek extends SceneObject implements ZoneOwner {
  readonly timers = new Timers();
  readonly body: AnimPlayer;
  readonly bodyRes: number[];
  private readonly frameData: { offsets: [number, number][]; points: [number, number, number][][] }[];
  weapon: Weapon;
  readonly isExtra: boolean;
  readonly isBot: boolean;
  readonly speed: number;
  readonly voice: number;
  readonly color: number;
  lives: number;
  readonly maxLives: number;
  readonly ammo = [0, 0, 0, 0, 0, 0]; // +0x11c
  reloadCount = 0; // +0x122
  frags = 0; // +0x128
  readonly kills = [0, 0, 0, 0]; // +0x12c
  deaths = 0; // +0x13c
  fade = 100; // +0x140 opacity percent
  killer = 0xff; // +0x144
  eliminated = -1; // player record +0x22: elimination order in lives mode, -1 = still playing
  // sound-end times (CBulanek message 1), -1 = not playing: death sound +0x16c, taunt +0x170, groan +0x174
  private deathSoundEnd = -1;
  private tauntEnd = -1;
  private groanEnd = -1;
  invisible = false; // +0x198
  infiniteAmmo: boolean; // +0x199
  invulnerable = false; // +0x19a
  readonly zones: Zone[] = []; // +0x178 line-of-sight zones (slots > 3)
  target: Zone | null = null; // +0x188
  teleporting = false; // +0x16a
  corpse: Death | null = null; // +0xfc
  corpse2: Death2 | null = null; // +0x100
  attached = false;
  private prevDir: number; // +0x148
  private pin = 0; // +0xa4: perpendicular coordinate kept while walking
  private guard = false; // +0x168
  private bulOff = { x: 0, y: 0 };
  private weaponOff = { x: 0, y: 0 };
  private accum = { x: 0, y: 0 };
  private hand = { x: 0, y: 0 };
  private readonly rel: Rect; // collision rect relative to the body

  // CBulanek::CBulanek 0x41e4b0 (game, slot, scene, dir, colour, lives, speed, weapon)
  constructor(readonly game: Gaming, id: number, dir: number, lives: number, speed: number, weaponType: number) {
    super();
    speed = speed > 200 ? 200 : speed < 40 ? 40 : speed;
    this.isExtra = id >= 0x20 && id < 0x24;
    this.isBot = id >= 0x24 && id < 0x28;
    if (weaponType < 0) weaponType = RANDOM_WEAPON[game.rnd(4)];
    if (this.isExtra) {
      speed = 40;
      lives = 1;
      weaponType = 4;
    }
    this.speed = speed;
    this.infiniteAmmo = id > 3;
    if (id > 3) {
      for (let i = 0; i < 4; i++) {
        const zone: Zone = { id: i, rect: R(0, 0, 0, 0), flags: 0, mask: 0, owner: this };
        this.zones.push(zone);
        game.addZone(zone);
      }
    }
    this.prevDir = dir;
    this.voice = id < 4 ? id : id & 3 || 3;
    this.lives = this.maxLives = lives;
    this.ammo[0] = MAX_AMMO[0];
    if (id > 4) this.ammo[1] = MAX_AMMO[1];
    // game_get_player_color: the human's profile colour; NPCs pick at random, unlike the original never the player's
    let color = id < 4 ? game.players[id]?.color ?? id : game.rnd(7);
    if (id >= 4 && color >= game.playerColor) color++;
    if (this.isExtra) color = 7;
    this.color = color;
    this.bodyRes = this.isExtra ? WALK_EXTRA : WALK;
    const m = game.level.manifest;
    this.frameData = this.bodyRes.map(r => {
      const d = animFrameData(m, r);
      return { offsets: d.offsets ?? [], points: d.points ?? [] };
    });
    this.body = new AnimPlayer(this.bodyRes.map(r => animMeta(m, r)), () => {}); // body events: nop 0x416770
    this.body.onShow = (f, wrapped) => this.bodyFrame(f, wrapped);
    this.weapon = this.newWeapon(weaponType, dir);
    this.setSeq(this.body, dir, false); // FUN_00439eb0(body, dir, 0)
    if (speed !== 100) this.body.frameTimeMs = Math.round((1 / (speed / 100)) * 47.25);
    const meta = this.body.meta;
    this.rel = R(2, 25, meta.width - 2, meta.height);
    this.collision = this.rel;
    this.solid = true;
    this.setDepth(0);
    this.body.reset(game.now); // FUN_00439b40
    const now = game.now;
    this.timers.add(0, game.playerCount === 1 ? 150 : 500, 7, now); // pistol reload: 150 ms single player, 500 MP
    if (this.isExtra) {
      this.timers.add(3, 0, 7, now);
      this.timers.add(4, 0, 7, now);
      this.timers.add(5, 100, 7, now);
    } else if (this.isBot) {
      this.timers.add(3, 0, 7, now);
      this.timers.add(4, 0, 7, now);
    } else if (id > 3) {
      this.timers.add(2, 0, 7, now);
    }
  }

  get dir(): number {
    return this.body.seq;
  }

  get isNpc(): boolean {
    return this.slot > 3 && !this.isExtra && !this.isBot;
  }

  /** FUN_00416490 */
  get isAi(): boolean {
    return this.isExtra || this.isBot;
  }

  private newWeapon(type: number, dir: number): Weapon {
    const w = new Weapon(type, this.game.level.manifest, ev => this.weaponEvent(w, ev));
    this.setSeq(w.player, dir, true);
    return w;
  }

  /** FUN_00439eb0: stop, switch sequence, optionally reset to frame 0. */
  private setSeq(p: AnimPlayer, seq: number, reset: boolean): void {
    p.stop();
    p.seq = seq;
    if (reset) p.reset(this.game.now);
  }

  // ---- geometry ----

  /** FUN_00417460: a relative rect placed on the view with the walking coordinate pinned. */
  private place(view: Rect, rel: Rect, dir: number): Rect {
    return dir > 1
      ? R(this.pin + rel.left, view.top + rel.top, this.pin + rel.right, view.top + rel.bottom)
      : R(view.left + rel.left, this.pin + rel.top, view.left + rel.right, this.pin + rel.bottom);
  }

  private view(): Rect {
    return R(this.left, this.top, this.right, this.bottom);
  }

  private relColl(off: { x: number; y: number }): Rect {
    const c = this.rel;
    return R(c.left + off.x, c.top + off.y, c.right + off.x, c.bottom + off.y);
  }

  /** vfunction29 0x4195c0: no hidden check (corpses keep blocking via solid). */
  override collisionRect(): Rect {
    return this.place(this.view(), this.relColl(this.bulOff), this.dir);
  }

  /** vfunction30 0x419560 */
  override depth(): number {
    return this.collisionRect().bottom;
  }

  /** Body frame listener: offset chunk 0x4178d0, point chunk 0x4178f0, then FUN_0041af70. */
  private bodyFrame(frame: number, wrapped: boolean): void {
    const d = this.frameData[this.body.seq];
    const o = d.offsets[wrapped ? d.offsets.length - 1 : frame];
    if (o) {
      this.accum.x += o[0];
      this.accum.y += o[1];
    }
    const p = d.points[frame]?.[0];
    if (p) this.hand = { x: p[1], y: p[2] };
    this.recompute();
  }

  // FUN_0041af70 composite recompute: body placed so its hand point meets the weapon's point
  private recompute(): void {
    const wm = this.weapon.player.meta;
    const wp = this.weapon.points[this.weapon.player.seq];
    const bm = this.body.meta;
    const a = R(wp.x - this.hand.x, wp.y - this.hand.y, wp.x - this.hand.x + bm.width, wp.y - this.hand.y + bm.height);
    const u = union(R(0, 0, wm.width, wm.height), a);
    const newOff = { x: a.left - u.left, y: a.top - u.top };
    this.weaponOff = { x: -u.left, y: -u.top };
    const nl = this.left - newOff.x + this.bulOff.x + this.accum.x;
    const nt = this.top - newOff.y + this.bulOff.y + this.accum.y;
    const n = R(nl, nt, nl + u.right - u.left, nt + u.bottom - u.top);
    const oldRel = this.relColl(this.bulOff);
    const newRel = this.relColl(newOff);
    this.bulOff = newOff;
    this.accum = { x: 0, y: 0 };
    const oldColl = this.place(this.view(), oldRel, this.prevDir);
    this.prevDir = this.dir;
    if (!this.body.running) this.pin = this.dir < 2 ? nt : nl;
    this.collide(n, this.place(n, newRel, this.dir), oldColl);
    this.setRect(n);
  }

  // FUN_004195f0 move + collide: clip the move on its axis at the first solid hit and the 800 x 515 field
  private collide(n: Rect, nc: Rect, oc: Rect): void {
    const scene = this.scene;
    if (!scene || sameRect(nc, oc)) return;
    const hit = scene.hitTest(nc, oc, false, false)?.collisionRect() ?? null;
    const top0 = nc.top;
    const left0 = nc.left;
    let blocked = false;
    switch (this.dir) {
      case 0: {
        let v = nc.left < 0 ? 0 : nc.left;
        blocked = nc.left < 0;
        if (hit && nc.left < oc.left) [blocked, v] = [true, hit.right];
        if (v !== nc.left) [nc.right, nc.left] = [nc.right + v - nc.left, v];
        break;
      }
      case 1: {
        let v = nc.right > 800 ? 800 : nc.right;
        blocked = nc.right > 800;
        if (hit && oc.left < nc.left) [blocked, v] = [true, hit.left];
        if (v !== nc.right) [nc.left, nc.right] = [nc.left + v - nc.right, v];
        break;
      }
      case 2: {
        let v = nc.top < 0 ? 0 : nc.top;
        blocked = nc.top < 0;
        if (hit && nc.top < oc.top) [blocked, v] = [true, hit.bottom];
        if (v !== nc.top) [nc.bottom, nc.top] = [nc.bottom + v - nc.top, v];
        break;
      }
      case 3: {
        let v = nc.bottom > 515 ? 515 : nc.bottom;
        blocked = nc.bottom > 515;
        if (hit && oc.top < nc.top) [blocked, v] = [true, hit.top];
        if (v !== nc.bottom) [nc.top, nc.bottom] = [nc.top + v - nc.bottom, v];
        break;
      }
    }
    const dx = nc.left - left0;
    const dy = nc.top - top0;
    n.left += dx;
    n.right += dx;
    n.top += dy;
    n.bottom += dy;
    if (this.isAi && blocked) this.game.post(() => this.randomMove()); // 0x102
  }

  /** vfunction9 0x4175f0; returns false when the rect did not change. */
  setRect(r: Rect): boolean {
    if (!this.body.running) this.pin = this.dir > 1 ? r.left : r.top;
    if (r.left === this.left && r.top === this.top && r.right === this.right && r.bottom === this.bottom) return false;
    this.left = r.left;
    this.top = r.top;
    this.width = r.right - r.left;
    this.height = r.bottom - r.top;
    this.moved();
    return true;
  }

  override moveTo(x: number, y: number): void {
    this.setRect(R(x, y, x + this.width, y + this.height));
  }

  /** vfunction12 0x41fb90: pickups and zones, then the four line-of-sight zones follow the collision rect. */
  private moved(): void {
    if (!this.scene) return;
    this.game.bulanekMoved(this);
    if (!this.zones.length) return;
    const c = this.collisionRect();
    const rects = [R(0, c.top, c.left, c.bottom), R(c.right, c.top, 799, c.bottom), R(c.left, 0, c.right, c.top), R(c.left, c.bottom, c.right, 515)];
    this.zones.forEach((z, i) => {
      z.rect = rects[i];
      this.game.zoneEvalAll(z);
    });
  }

  // ---- movement ----

  // FUN_00417910 stop walking and snap the pinned coordinate
  private stopWalk(): void {
    this.body.stop();
    if (this.dir > 1) this.moveTo(this.pin, this.top);
    else this.moveTo(this.left, this.pin);
  }

  // FUN_004197b0 face a direction, optionally start walking
  face(dir: number, walk: boolean): boolean {
    if (this.teleporting) return false;
    if (this.body.running) {
      this.stopWalk();
      this.body.reset(this.game.now);
    }
    if (this.dir !== dir) {
      this.guard = true;
      if (this.weapon.player.seq !== dir) this.setSeq(this.weapon.player, dir, true); // FUN_004179e0
      this.guard = false;
      this.setSeq(this.body, dir, true);
      this.timers.remove(1);
    }
    if (walk) this.body.start(true, this.game.now);
    return true;
  }

  // FUN_004174a0 is the key edge allowed
  keyAllowed(key: number, down: boolean): boolean {
    if (!this.shown) return false;
    if (key === 4 || key === 5) return down && this.weapon.idle;
    return down || key === this.dir;
  }

  // FUN_00420910 key edge action
  keyAction(key: number, down: boolean): void {
    if (!down) {
      this.stopWalk();
      this.body.reset(this.game.now);
    } else if (key === 4) this.fire();
    else if (key === 5) this.switchWeapon();
    else this.face(key, true);
  }

  // FUN_00420a90 zombie random walk
  randomMove(): void {
    if (!this.weapon.idle) return;
    if (this.game.rnd(13) === 0 && this.body.running) {
      this.keyAction(this.dir, false);
      return;
    }
    const d = this.game.rnd(4);
    if (this.keyAllowed(d, true)) this.keyAction(d, true);
  }

  // ---- weapons ----

  private soundAt(index: number, type: number): void {
    // FUN_00417950: bank res 3 for weapon types > 1, else 4
    if (index !== -1) this.game.sound(index, type > 1 ? BANK_HEAVY : BANK_LIGHT, this.view());
  }

  private shotAt(off: readonly [number, number][], type: number): void {
    const [dx, dy] = off[this.dir];
    const shot = new Shot(this.game, this.left + dx, this.top + dy, this.dir, this.slot, type, 0);
    this.game.scene.add(shot, 1);
  }

  // FUN_004208c0 fire when the weapon is idle
  fire(): void {
    if (!this.shown || !this.weapon.idle) return;
    const w = this.weapon;
    const now = this.game.now;
    // FUN_00420650 dispatch
    switch (w.type) {
      case 0: // FUN_0041fce0 pistol
        if (this.ammo[0] === 0) {
          this.soundAt(0x13, 0);
          break;
        }
        this.soundAt(0x15, 0);
        w.player.start(false, now);
        this.useAmmo();
        this.shotAt(PISTOL_OFF, 0);
        break;
      case 1: // FUN_0041fdf0 shotgun
        this.soundAt(0xd, 1);
        w.player.start(false, now);
        this.useAmmo();
        this.shotAt(SHOTGUN_OFF, 1);
        break;
      case 2: // FUN_00416780 mines and rocket: the anim events do the work
      case 5:
        w.player.start(false, now);
        break;
      case 3: // FUN_0041ed60 detonator: explode own mines
        this.detonate();
        break;
      case 4: // FUN_00417a20 machine gun
        this.useAmmo();
        w.player.start(false, now);
        break;
    }
  }

  private detonate(): void {
    let mines = 0;
    let exploded = 0;
    for (const o of this.game.scene.objects()) {
      if (!(o instanceof Mine) || o.owner !== this) continue;
      mines++;
      if (o.explode()) exploded++;
    }
    if (exploded > 0) {
      this.weapon.player.start(false, this.game.now);
      if (exploded === mines) this.useAmmo();
    }
  }

  // FUN_00417500 use ammo; an empty pistol starts reloading
  private useAmmo(): void {
    const t = this.weapon.type;
    if (this.infiniteAmmo || this.slot >= 4 || (t === 0 && this.ammo[0] === 0)) return;
    this.ammo[t]--;
    if (this.ammo[t] === 0 && t === 0) {
      this.reloadCount = 0;
      this.timers.resume(0, this.game.now);
    }
  }

  // CWeapon::vfunction5 0x4212b0 weapon anim events
  private weaponEvent(w: Weapon, ev: number): void {
    let teleported = false;
    if (w.type === 2 && ev === 0) {
      this.game.scene.add(new Mine(this.game, this), 1);
      this.useAmmo();
      if (this.slot > 3) {
        this.teleport(-1, -1, false);
        teleported = true;
      }
    }
    if (w.type === 4 && ev !== ANIM_END) {
      this.shotAt(MG_OFF, ev + 3);
      this.soundAt(ev < 3 ? 3 : 4, 4);
    }
    if (w.type === 5 && ev === 0) {
      this.useAmmo();
      this.shotAt(ROCKET_OFF, 2);
      this.soundAt(7, 5);
      return;
    }
    if (ev !== ANIM_END) return;
    if (w.type !== 0 && this.ammo[w.type] === 0 && this.game.scene.active) this.game.post(() => this.bestWeapon()); // 0xd9
    if (this.slot > 3 && !teleported) {
      if (this.isAi) this.randomMove();
      else if (this.game.rnd(100) < 40) this.teleport(-1, -1, false);
    }
  }

  // FUN_0041eca0 next weapon with ammo
  switchWeapon(): void {
    const cur = this.weapon.type;
    let t = cur + 1;
    for (;;) {
      if (t === this.game.weaponCount) t = 0;
      if (this.ammo[t] !== 0 || t === 0) break;
      t++;
      if (t === cur) return;
    }
    if (t !== cur) this.setWeapon(t);
  }

  // FUN_0041ed10 (0xd9) highest weapon with ammo
  bestWeapon(): void {
    let t = this.game.weaponCount;
    do t--;
    while (t > 0 && this.ammo[t] === 0);
    if (t !== this.weapon.type) this.setWeapon(t);
  }

  // FUN_0041ea90 take another weapon (not for zombies and bots)
  setWeapon(type: number): void {
    if (this.isAi) return;
    this.weapon.player.stop(); // the old CWeapon is released (vfunction3 0x416750 stops its anim)
    this.weapon = this.newWeapon(type, this.dir);
    this.recompute();
    if (this.slot > 3) MAX_AMMO.forEach((a, i) => (this.ammo[i] = a));
  }

  // FUN_0041eba0 pick up a weapon item
  pickup(type: number): void {
    if (type === 2) this.ammo[2] = Math.min(MAX_AMMO[2], this.ammo[2] + 1);
    else this.ammo[type] = MAX_AMMO[type];
    this.setWeapon(type); // local bulanek: always in single player
    this.soundAt(PICKUP_SOUND[type], type); // FUN_004179c0
  }

  // ---- timers and messages ----

  // CBulanek timer handler 0x420b30
  private onTimer(id: number): void {
    const now = this.game.now;
    switch (id) {
      case 0:
        if (++this.reloadCount === 16) {
          this.timers.pause(0);
          this.reloaded();
        }
        break;
      case 1:
        this.fire();
        break;
      case 2:
        if (this.weapon.idle) this.teleport(-1, -1, false);
        break;
      case 3:
        if (this.weapon.idle && this.isAi) {
          this.randomMove();
          this.rollAiTimers();
        }
        break;
      case 4:
        for (const z of this.zones) {
          if (z.mask! & 0xf && this.lineOfSight(z.mask! & 0xf, z.id)) {
            if (!this.face(z.id, false)) return;
            this.timers.add(1, this.aiShotDelay(), 2, now);
            return;
          }
        }
        break;
      case 5:
        this.fade += 10;
        if (this.fade > 100) {
          this.fade = 100;
          this.timers.pause(5);
        }
        break;
    }
  }

  // FUN_00417570 pistol reloaded
  private reloaded(): void {
    if (this.timers.running(0)) this.timers.pause(0);
    this.ammo[0] = MAX_AMMO[0];
    this.soundAt(0x10, 0);
  }

  private aiShotDelay(): number {
    return Math.round((1 / (this.speed / 100)) * 200);
  }

  // FUN_00417260 NPC: next teleport in 5-15 s
  rollTeleport(): void {
    if (!this.isNpc) return;
    const now = this.game.now;
    this.timers.setInterval(2, (this.game.rnd(11) + 5) * 1000);
    this.timers.setStart(2, now);
    if (!this.timers.running(2)) this.timers.resume(2, now);
  }

  // FUN_004172d0 zombies and bots: walk change in 1-10 s, look-out every 2 s
  private rollAiTimers(): void {
    if (!this.isAi) return;
    const now = this.game.now;
    this.timers.setInterval(3, (this.game.rnd(10) + 1) * 1000);
    this.timers.setStart(3, now);
    if (!this.timers.running(3)) this.timers.resume(3, now);
    this.timers.setInterval(4, 2000);
    this.timers.setStart(4, now);
    if (!this.timers.running(4)) this.timers.resume(4, now);
  }

  /** vfunction16(1): attached to the active game scene. */
  override attach(): void {
    if (this.attached) return;
    this.attached = true;
    this.rollTeleport();
    this.rollAiTimers();
  }

  /** vfunction31: body anim, own timers, then the weapon anim. */
  tick(now: number): void {
    this.body.tick(now);
    this.timers.update(now, id => this.onTimer(id));
    this.weapon.player.tick(now);
    if (this.deathSoundEnd >= 0 && now >= this.deathSoundEnd) {
      this.deathSoundEnd = -1;
      this.groanEnd = this.playVoice(this.isExtra ? 0x28 : GROAN_VOICE[this.voice]); // FUN_00416690
    }
    if (this.groanEnd >= 0 && now >= this.groanEnd) {
      this.groanEnd = -1;
      const k = this.game.scene.getSlot(this.killer);
      if (this.killer !== 0xff && k instanceof Bulanek) k.taunt(); // 0xdb to the killer
      this.killer = 0xff;
    }
    if (this.tauntEnd >= 0 && now >= this.tauntEnd) this.tauntEnd = -1;
  }

  /** Plays a voice sound (bank 4) and returns when it ends. */
  private playVoice(index: number): number {
    this.soundAt(index, 0);
    return this.game.now + sampleMs(this.game.level.manifest, BANK_LIGHT, index);
  }

  // 0xd7: hit; returns the frag flag for the shooter
  hit(shooter: number, kind: number): number {
    if (!this.shown || this.invulnerable) return 0;
    if (this.isAi && --this.lives !== 0) return 0;
    this.die(shooter, kind);
    return 1;
  }

  // 0xd8: frag for killing victim
  frag(victim: number): void {
    if (!(this.game.scene.getSlot(victim) instanceof Bulanek)) return; // FUN_00417e40
    this.frags++;
    if (victim < 4) this.kills[victim]++;
  }

  // 0xdb: taunt the victim
  taunt(): void {
    if (this.shown && this.tauntEnd < 0) this.tauntEnd = this.playVoice(this.isExtra ? 0x27 : TAUNT_VOICE[this.voice]); // FUN_004166b0
  }

  // 0xee / 0xef spells: 0 invisible, 1 invulnerable, 2 infinite ammo
  spell(type: number, on: boolean): void {
    if (type === 0) {
      this.invisible = on;
      this.game.zoneEvalBul(this);
    } else if (type === 1) this.invulnerable = on;
    else if (type === 2) this.infiniteAmmo = on;
  }

  // 0xf2 / 0xf3 from the line-of-sight zones
  zoneMessage(zone: Zone, enter: boolean): void {
    if (!enter) {
      if (this.target) {
        this.timers.remove(1);
        this.target = null;
      }
      return;
    }
    if (!this.zones.length || !this.shown || this.target || !this.attached) return;
    this.target = zone;
    if (!this.lineOfSight(zone.mask! & 0xf, zone.id) || !this.face(zone.id, false)) return;
    const delay = this.isAi ? this.aiShotDelay() : this.game.rnd(4) * 500;
    this.timers.add(1, delay, 2, this.game.now);
  }

  // FUN_004194b0 / FUN_004192b0 line of sight towards any slot in mask along dir
  private lineOfSight(mask: number, dir: number): boolean {
    for (let slot = 0; mask; slot++, mask >>= 1) {
      if (!(mask & 1)) continue;
      const t = this.game.scene.getSlot(slot)?.collisionRect();
      if (!t) continue;
      const o = this.collisionRect();
      const r = [R(t.right, t.top, o.left, t.bottom), R(o.right, t.top, t.left, t.bottom), R(t.left, t.bottom, t.right, o.top), R(t.left, o.bottom, t.right, t.top)][dir];
      if (dir < 2) {
        r.top = Math.max(t.top, o.top);
        r.bottom = Math.min(t.bottom, o.bottom);
      } else {
        r.left = Math.max(t.left, o.left);
        r.right = Math.min(t.right, o.right);
      }
      const s = { ...r };
      let u = r;
      for (const obj of this.game.scene.hitTestAll(r, true)) u = union(u, obj.collisionRect()!);
      const vertical = s.top === u.top || s.bottom === u.bottom;
      if (dir < 2 ? vertical : (s.left === u.left || s.right === u.right) && vertical) return true;
    }
    return false;
  }

  // ---- death, respawn, teleport ----

  // FUN_0041f900 die
  die(killer: number, kind: number): void {
    const game = this.game;
    this.lives = this.maxLives;
    if (this.isExtra) kind |= 0x80;
    this.fade = 100;
    if (this.isExtra && this.timers.running(5)) this.timers.pause(5);
    this.shown = false;
    this.solid = false;
    this.killer = killer;
    const k = game.scene.getSlot(killer);
    const sound = k instanceof Bulanek && k.weapon.type === 1 ? 0x16 : 0x17; // FUN_00417f80
    this.deaths++;
    if (kind & 0x80) {
      if (k instanceof Bulanek) k.taunt();
      this.killer = 0xff;
    } else {
      this.deathSoundEnd = this.playVoice(sound); // its end plays the groan, the groan's end makes the killer taunt
    }
    this.corpse = new Death(game, this, kind);
    game.scene.add(this.corpse, 1);
    if (this.isExtra) {
      this.corpse2 = new Death2(game, this);
      game.scene.add(this.corpse2, 1);
    }
    this.endTeleport();
    if (this.isNpc && this.timers.running(2)) this.timers.pause(2);
    if (!this.zones.length && this.weapon.type !== 0) this.setWeapon(0);
    for (let i = 1; i < 6; i++) this.ammo[i] = 0;
    game.bulanekMoved(this); // FUN_0041f350 -> FUN_0041f0c0
    game.died(this);
  }

  // FUN_0041f770 respawn at a random free place
  respawn(dir: number): void {
    const game = this.game;
    for (const c of [this.corpse, this.corpse2]) if (c) game.scene.remove(c);
    this.corpse = this.corpse2 = null;
    this.shown = true;
    this.solid = true;
    if (this.slot > 3) this.setWeapon(game.rnd(101) < 10 ? 1 : 0);
    game.placeRandom(this);
    this.face(dir, false);
    this.rollTeleport();
    this.soundAt(this.isExtra ? 0x26 : SPAWN_VOICE[this.voice], 0);
    if (this.isExtra) {
      this.fade = 0;
      if (!this.timers.running(5)) this.timers.resume(5, game.now);
    }
  }

  // bulanek_teleport 0x41db00
  teleport(x: number, y: number, force: boolean): boolean {
    const game = this.game;
    if (this.corpse || this.teleporting || !this.scene || !game.scene.active || !this.shown) return false;
    if (!game.spawnTeleport(this, x, y, force)) return false;
    this.soundAt(0x24, 0);
    if (this.isAi) this.face(this.dir, false);
    this.teleporting = true;
    this.rollTeleport();
    return true;
  }

  // FUN_004165d0
  endTeleport(): void {
    if (!this.teleporting) return;
    this.game.post(() => this.game.removeTeleportPoints(this)); // 0xf5
    this.teleporting = false;
  }

  /** Teleport destination reached (CTeleportPoint event 0): move so the collision rects' corners meet. */
  arrive(c: Rect): void {
    const o = this.collisionRect();
    this.moveTo(this.left + c.left - o.left, this.top + c.top - o.top);
    // FUN_0041fca0
    if (this.dir > 1) this.pin = this.left;
    else if (this.pin !== this.top) {
      this.pin = this.top;
      this.game.bulanekMoved(this);
    }
  }

  /** Hand point in scene coordinates (corpses are aligned to it). */
  handPoint(): { x: number; y: number } {
    return { x: this.left + this.bulOff.x + this.hand.x, y: this.top + this.bulOff.y + this.hand.y };
  }

  // ---- drawing ----

  /** vfunction15 0x417640: weapon split around the body for L/R, behind for U, in front for D. */
  draw(): DrawItem[] | null {
    let opacity = 255;
    if (this.invisible) {
      if (this.slot !== 0) return null;
      opacity = 0x30;
    } else if (this.fade !== 100) opacity = Math.trunc((this.fade * 255) / 100);
    const wm = this.weapon.player.meta;
    const bm = this.body.meta;
    const w: DrawItem = {
      res: this.weapon.res[this.weapon.player.seq], frame: this.weapon.player.frame,
      x: this.left + this.weaponOff.x, y: this.top + this.weaponOff.y, w: wm.width, h: wm.height, opacity,
    };
    const b: DrawItem = {
      res: this.bodyRes[this.dir], frame: this.body.frame,
      x: this.left + this.bulOff.x, y: this.top + this.bulOff.y, w: bm.width, h: bm.height, opacity, color: this.color,
    };
    if (this.dir === 2) return [w, b];
    if (this.dir === 3) return [b, w];
    const split = Math.trunc(wm.height / 2) + (this.dir === 0 ? -7 : 5);
    return [{ ...w, h: split, srcY: 0 }, b, { ...w, y: w.y + split, h: wm.height - split, srcY: split }];
  }

  /** View rects overlap (FUN_00419530). */
  overlaps(o: SceneObject | null): boolean {
    return !!o && !!o.scene && intersects(R(o.left, o.top, o.right, o.bottom), this.view());
  }
}
