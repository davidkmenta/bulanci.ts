import { GameHook, Level, panFromX } from '../level';
import type { MsvcRand } from '../rand';
import { Rect, SceneObject } from '../scene/objects';
import { intersects, Scene, union, Zone } from '../scene/scene';
import { Timers } from '../timers';
import { num, Value } from '../vm/values';
import { Bulanek } from './bulanek';
import { KeyEdge } from './input';
import { BONUS_ANIMS, GameAnim, Item } from './items';
import { Mine } from './mine';
import { Shot } from './shot';
import { TeleportPoint } from './teleport';
import { BANK_LIGHT, ITEM_ANIM, MAX_AMMO, WEAPON_COUNT } from './weapons';

/** Game types (+0x19c): 0 hits, 1 time, 2 lives. */
export const HITS = 0;
export const TIME = 1;
export const LIVES = 2;

export interface PlayerSetup {
  name: string;
  color: number; // 0..7
}

export interface GamingOptions {
  players?: PlayerSetup[]; // humans in slots 0..n-1 (1 = single player against NPCs 125-127)
  type?: number; // default TIME
  limit?: number; // hits / seconds / lives; default 150 s: FUN_00413620 forces +0x1a2 = 150 in single player
}

export interface HudState {
  timeLeftS: number;
  score: number;
  frags: number;
  deaths: number;
  color: number;
  weapon: number;
  ammo: number;
  maxAmmo: number;
  reloading: boolean;
  spells: { invisible: boolean; invulnerable: boolean; infiniteAmmo: boolean };
  center: string | null; // the round clock "150".."1" or the leader "name\nvalue" (CBlackView centre text)
  name: string;
  eliminated: boolean; // lives: out of the round (port only: the original HUD does not mark it)
}

export interface PlayerResult {
  name: string;
  color: number;
  frags: number;
  deaths: number;
  kills: number[]; // per victim slot 0..3
  score: number; // FUN_004126e0 ranking value
}

const EXITUS = 324; // level res 0x10144: zombies get a forced respawn timer
const CLOCK = 4; // CGame timer 4
const BONUS_SOUND = [0x20, 0x23, 0x21, 0x1f];

interface Ticking {
  tick(now: number): void;
}
const ticks = (o: SceneObject): o is SceneObject & Ticking => typeof (o as Partial<Ticking>).tick === 'function';

/** CGaming (the game view, single player): spawns, random placement, zones, pickups, bonus cycle, weapon items,
 *  the round clock (CGame timer 4), spells and the round end. Posted Win32 messages (0xf4..0xf9, 0x102, 0x80cc)
 *  run from a queue at the end of each step; sent ones are direct calls. */
export class Gaming implements GameHook {
  readonly scene: Scene;
  readonly rand: MsvcRand;
  /** CGaming timers: 0 bonus cycle, 1 weapon item, 2 Exitus forced respawn. */
  readonly timers = new Timers();
  /** CGame timers: 4 round clock, spells from 5 up. */
  private readonly gameTimers = new Timers();
  readonly playerCount: number; // +0xd8
  readonly weaponCount = WEAPON_COUNT; // +0x368
  readonly players: PlayerSetup[];
  readonly type: number;
  readonly limit: number;
  private eliminated = 0; // +0x1e9
  private queue: (() => void)[] = [];
  private readonly bonuses: GameAnim[] = [];
  private bonusMode = 0; // +0x33c
  private readonly spells = new Map<string, number>();
  private readonly extras: Bulanek[] = []; // +0x148
  private readonly teleports: TeleportPoint[] = []; // +0x2f8
  private respawning = false; // DAT_004b372c
  private timeLeft = 0; // CGame +0x20e
  private center: string | null = null;
  private ended: PlayerResult[] | null = null;

  constructor(readonly level: Level, opts: GamingOptions = {}) {
    this.scene = level.scene;
    this.rand = level.rand;
    this.players = opts.players ?? [{ name: 'Bulík', color: 0 }];
    this.playerCount = this.players.length;
    this.type = opts.type ?? TIME;
    this.limit = opts.limit ?? 150;
    level.game = this;
  }

  get playerColor(): number {
    return this.players[0].color;
  }

  get now(): number {
    return this.level.now;
  }

  /** rand() * n >> 15 */
  rnd(n: number): number {
    return Math.trunc((this.rand.next() * n) / 32768);
  }

  /** sound_play with sound_pan_from_rect (pan 0 without a rect); -1 = no sound. */
  sound(index: number, bankRes: number, rect: Rect | null): void {
    if (index === -1) return;
    const pan = rect ? panFromX(Math.trunc((rect.left + rect.right) / 2)) : 0;
    this.level.emit({ type: 'sound', bankRes, index, pan });
  }

  /** PostMessage: handled after the current step's timers. */
  post(fn: () => void): void {
    this.queue.push(fn);
  }

  // ---- public API ----

  start(lang: 0 | 1): void {
    const level = this.level;
    level.info(lang);
    level.vm.callEntry(1);
    // CGaming::CGaming 0x41ff90 after entry 1: bonus anims and the bonus cycle, single player only (+0xd8 == 1)
    if (this.playerCount === 1) {
      for (const res of BONUS_ANIMS) {
        const a = new GameAnim(this, res);
        a.play(0, 3);
        a.setDepth(0);
        this.bonuses.push(a);
      }
      this.timers.add(0, 0, 6, this.now);
      this.setBonusMode(0);
    }
    // FUN_0042bed0: the game view, then its children, get vfunction16(1)
    this.scene.active = true;
    this.activate();
    for (const o of this.scene.objects()) o.attach();
  }

  step(edges: KeyEdge[]): void {
    if (this.ended) return;
    // CGame timer 7 (0x416030): every local player with its own key set
    for (const e of edges) {
      const p = this.scene.getSlot(e.player ?? 0);
      if (p instanceof Bulanek && p.keyAllowed(e.key, e.down)) p.keyAction(e.key, e.down);
    }
    this.level.step();
    const now = this.now;
    this.gameTimers.update(now, id => this.onGameTimer(id));
    this.timers.update(now, id => this.onTimer(id));
    for (const o of this.scene.objects()) if (o.scene === this.scene && ticks(o)) o.tick(now);
    while (this.queue.length) this.queue.shift()!();
  }

  stop(): void {
    this.level.stop();
  }

  hud(slot = 0): HudState {
    const p = this.scene.getSlot(slot);
    const b = p instanceof Bulanek ? p : null;
    const w = b?.weapon.type ?? 0;
    return {
      timeLeftS: this.timeLeft,
      score: b ? this.counter(b) : 0,
      frags: b?.frags ?? 0,
      deaths: b?.deaths ?? 0,
      color: b?.color ?? 0,
      weapon: w,
      ammo: b?.ammo[w] ?? 0,
      maxAmmo: MAX_AMMO[w],
      reloading: b?.timers.running(0) ?? false,
      spells: { invisible: b?.invisible ?? false, invulnerable: b?.invulnerable ?? false, infiniteAmmo: b?.infiniteAmmo ?? false },
      center: this.center,
      name: this.players[slot]?.name ?? '',
      eliminated: (b?.eliminated ?? -1) >= 0,
    };
  }

  result(): PlayerResult[] | null {
    return this.ended;
  }

  /** Port only (network game): FNV-1a over the random state and every slot object (position, visibility and the
   *  bulánci's lives, score, weapon, ammo); equal on every machine as long as the simulations agree. */
  checksum(): number {
    let h = 0x811c9dc5;
    const mix = (v: number) => (h = Math.imul(h ^ (v | 0), 0x01000193));
    mix(this.rand.state);
    mix(this.scene.count());
    this.scene.slots.forEach((o, slot) => {
      if (!o) return;
      [slot, o.left, o.top, +o.shown].forEach(mix);
      if (o instanceof Bulanek) [o.lives, o.frags, o.deaths, o.weapon.type, ...o.ammo].forEach(mix);
    });
    return h >>> 0;
  }

  /** Port only (network game): the machine of this player left; the bulánek leaves the play for good like an
   *  eliminated one and the round ends when one player is left. */
  playerLeft(slot: number): void {
    const b = this.scene.getSlot(slot);
    if (!(b instanceof Bulanek) || b.eliminated >= 0) return;
    b.eliminated = this.eliminated++;
    b.endTeleport();
    b.shown = false;
    b.solid = false;
    if (this.eliminated + 1 >= this.playerCount) this.post(() => this.end());
  }

  // FUN_00412680 HUD counter: hits -> kills, time -> kills - deaths, lives -> limit - deaths
  private counter(b: Bulanek): number {
    return this.type === HITS ? b.frags : this.type === TIME ? b.frags - b.deaths : this.limit - b.deaths;
  }

  // the humans in slots 0..total-1
  private humans(): Bulanek[] {
    return Array.from({ length: this.playerCount }, (_, i) => this.scene.getSlot(i)).filter((b): b is Bulanek => b instanceof Bulanek);
  }

  // ---- CGaming ----

  // CGaming::vfunction16(1) 0x41c140
  private activate(): void {
    this.level.vm.callEntry(10);
    if (this.type === TIME) {
      // FUN_004129c0
      this.timeLeft = this.limit;
      this.gameTimers.add(CLOCK, 1000, 6, this.now);
      this.showTime();
    }
    for (let s = this.playerCount - 1; s >= 0; s--) this.zoneEvalBul(this.scene.getSlot(s));
    if (this.scene.getSlot(127)) for (const s of [125, 126, 127]) this.zoneEvalBul(this.scene.getSlot(s));
    this.timers.add(1, this.playerCount === 1 ? 10000 : 5000, 6, this.now);
    if (this.level.id === EXITUS) this.timers.add(2, 7000, 6, this.now);
  }

  // CGame timer 4 (case 0x416346) and spell timers
  private onGameTimer(id: number): void {
    if (id === CLOCK) {
      this.timeLeft--;
      this.showTime();
      return;
    }
    const [type, slot] = this.gameTimers.getValue(id) as number[];
    this.spells.delete(`${type},${slot}`);
    const b = this.scene.getSlot(slot);
    if (b instanceof Bulanek) b.spell(type, false); // 0xef
  }

  // FUN_00419d60
  private showTime(): void {
    const t = this.timeLeft;
    if (t >= 1 && t <= 5) this.sound(0x12, BANK_LIGHT, null);
    this.center = String(t);
    if (t === 0) this.post(() => this.end()); // 0x80cc
  }

  // CGaming::vfunction27 0x80cc: round over
  private end(): void {
    if (this.ended) return;
    this.sound(0x11, BANK_LIGHT, null);
    // FUN_004126e0: lives ranks eliminated players by their elimination order - 4 (later = higher)
    this.ended = this.humans().map(b => ({
      name: this.players[b.slot].name, color: b.color, frags: b.frags, deaths: b.deaths, kills: [...b.kills],
      score: this.type === LIVES && b.eliminated >= 0 ? b.eliminated - 4 : this.counter(b),
    }));
  }

  // FUN_004180e0 (hits, after a frag): leader = most frags, ties keep the higher slot; the limit ends the round
  private fragged(killer: Bulanek): void {
    if (this.type !== HITS) return;
    let leader: Bulanek | null = null;
    for (const b of this.humans().reverse()) if (!leader || b.frags > leader.frags) leader = b;
    if (leader !== killer) return;
    this.center = `${this.players[killer.slot].name}\n${killer.frags}`;
    if (killer.frags === this.limit) this.post(() => this.end()); // 0x80cc
  }

  // FUN_0041f350 (lives, after a death): the limit eliminates; the round ends when one player is left
  died(b: Bulanek): void {
    if (this.type !== LIVES || b.slot >= this.playerCount) return;
    if (b.deaths === this.limit) b.eliminated = this.eliminated++;
    let leader: Bulanek | null = null;
    for (const h of this.humans().reverse()) if (!leader || h.deaths < leader.deaths) leader = h;
    if (leader) this.center = `${this.players[leader.slot].name}\n${this.limit - leader.deaths}`;
    if (this.eliminated + 1 >= this.playerCount) this.post(() => this.end());
  }

  // CGaming::vfunction5 0x41f050 timers
  private onTimer(id: number): void {
    if (id === 0) {
      if (this.bonusMode === 0) this.showBonus();
      else if (this.bonusMode === 1) {
        // FUN_00419e40
        for (const b of this.bonuses) if (b.scene) this.scene.remove(b);
        this.setBonusMode(0);
      }
    } else if (id === 1) {
      if (this.rnd(101) < 80) this.spawnItem();
    } else if (id === 2) {
      // FUN_004168f0: force the first dead zombie back
      const dead = this.extras.find(e => e.corpse);
      if (dead) this.post(() => this.respawn(dead));
    }
  }

  // FUN_00417c80: 0 = waiting 25 s, 1 = bonus shown for 10 s
  private setBonusMode(mode: number): void {
    this.bonusMode = mode;
    this.timers.setInterval(0, mode === 0 ? 25000 : 10000);
    if (!this.timers.running(0)) this.timers.resume(0, this.now);
    this.timers.setStart(0, this.now);
  }

  // FUN_0041b500
  private showBonus(): void {
    const b = this.bonuses[this.rnd(256) >> 6];
    this.scene.add(b, 1); // FUN_0041b390
    this.placeRandom(b);
    this.setBonusMode(1);
  }

  // FUN_0041e350 weapon item (never the detonator); FUN_0041e2c0 finds a slot
  private spawnItem(): void {
    const v = Math.trunc(Math.trunc((this.rand.next() * (this.weaponCount * 25 - 25)) / 32768) / 25);
    let t = v + 1;
    if (t > 2) t = v + 2;
    if (t === 1 && this.scene.getSlot(100)) t = 4;
    if (t >= this.weaponCount) return;
    let slot = 100;
    if (t !== 1) {
      slot = 101;
      while (this.scene.getSlot(slot)) if (++slot > 107) return;
    }
    const item = new Item(this, t, ITEM_ANIM[t]);
    this.scene.setSlot(item, slot);
    this.scene.add(item, 1);
    this.placeRandom(item);
  }

  // scene_place_random 0x41a140: random free spot for the collision rect (view rect when not solid)
  placeRandom(o: SceneObject): void {
    const c = (o.solid && o.collisionRect()) || { left: o.left, top: o.top, right: o.right, bottom: o.bottom };
    const w = c.right - c.left;
    const h = c.bottom - c.top;
    // ponytail: the original retries forever; 10000 tries keeps a full map from hanging the page
    for (let i = 0; i < 10000; i++) {
      const y = this.rnd(516 - h);
      const x = this.rnd(801 - w);
      const r = { left: x, top: y, right: x + w, bottom: y + h };
      if (!this.scene.hitTest(r, r, true, false) || i === 9999) {
        o.moveTo(o.left + x - c.left, o.top + y - c.top);
        return;
      }
    }
  }

  // FUN_0041f0c0: re-sort, pick up items and bonuses, re-evaluate zones
  bulanekMoved(b: Bulanek): void {
    this.scene.resort(b);
    if (b.shown) {
      for (let s = 107; s >= 100; s--) {
        const it = this.scene.getSlot(s);
        if (it instanceof Item && b.overlaps(it)) {
          this.scene.remove(it);
          b.pickup(it.type);
        }
      }
      if (this.playerCount === 1) {
        for (const t of [0, 3, 1, 2]) if (b.overlaps(this.bonuses[t])) this.takeBonus(b, t);
      }
    }
    this.zoneEvalBul(b);
  }

  // FUN_0041a020
  private takeBonus(b: Bulanek, type: number): void {
    this.scene.remove(this.bonuses[type]);
    this.spell(type, b.slot);
    this.sound(b.slot === 0 ? BONUS_SOUND[type] : 0x22, BANK_LIGHT, { left: b.left, top: b.top, right: b.right, bottom: b.bottom });
    this.setBonusMode(0);
  }

  // FUN_00414550 spells: 20 s, a repeat pickup restarts the timer; 3 = hourglass (+-15 s)
  private spell(type: number, slot: number): void {
    if (type === 3) {
      this.timeLeft = slot < 3 ? this.timeLeft + 15 : Math.max(1, this.timeLeft - 15);
      return;
    }
    const key = `${type},${slot}`;
    const id = this.spells.get(key);
    if (id !== undefined) {
      this.gameTimers.setStart(id, this.now);
      return;
    }
    const nid = this.gameTimers.add(-1, 20000, 2, this.now);
    this.gameTimers.setValue(nid, [type, slot]);
    this.spells.set(key, nid);
    const b = this.scene.getSlot(slot);
    if (b instanceof Bulanek) b.spell(type, true); // 0xee
  }

  // FUN_00417e80: hit message (0xd7) to the victim slot, frag message (0xd8) to the shooter when it counts
  hit(victim: number, owner: number, kind: number): void {
    let result = 1;
    const v = victim !== 0xff ? this.scene.getSlot(victim) : null;
    if (v instanceof Bulanek) result = v.hit(owner, kind);
    else if (v) result = num(this.level.vm.callEntry(4, [victim, owner, kind & 3]));
    if (owner === 0xff || !result) return;
    const o = this.scene.getSlot(owner);
    if (o instanceof Bulanek) {
      o.frag(victim);
      if (v instanceof Bulanek) this.fragged(o);
    }
    else if (o) this.level.vm.callEntry(5, [owner, victim]);
  }

  // FUN_00420480 (0xf6): respawn; a zombie may bring another dead one along
  respawn(b: Bulanek): void {
    if (b.eliminated >= 0) return; // FUN_004125b0: out of lives
    b.respawn(this.rnd(4));
    this.zoneEvalBul(b);
    if (this.respawning || !b.isExtra) return;
    if (this.rnd(3) !== 0) return;
    this.respawning = true;
    const i = this.extras.filter(e => e.solid).length; // FUN_00416940
    if (i < 4) this.respawn(this.extras[i]);
    this.respawning = false;
  }

  // scene_spawn_bulanek 0x41f500
  private spawn(slot: number): Bulanek {
    const b = new Bulanek(this, slot, 0, 1, 100, 0);
    this.scene.add(b);
    this.scene.setSlot(b, slot);
    this.placeRandom(b);
    b.face(this.rnd(4), false);
    return b;
  }

  // ---- zones ----

  addZone(zone: Zone): void {
    this.scene.zones.push(zone);
    this.zoneAdded(zone);
  }

  removeZone(zone: Zone | null): void {
    const i = zone ? this.scene.zones.indexOf(zone) : -1;
    if (i >= 0) this.scene.zones.splice(i, 1);
  }

  // FUN_00419fd0: evaluate one zone for the players and NPCs
  zoneEvalAll(zone: Zone): void {
    for (const s of [...Array.from({ length: this.playerCount }, (_, i) => this.playerCount - 1 - i), 127, 126, 125]) {
      const b = this.scene.getSlot(s);
      if (b instanceof Bulanek) this.zoneEval(zone, s, b);
    }
  }

  // FUN_0041b5a0: evaluate all zones (last first) for one bulanek
  zoneEvalBul(b: SceneObject | null): void {
    if (!(b instanceof Bulanek)) return;
    const zones = this.scene.zones;
    for (let i = zones.length - 1; i >= 0; i--) this.zoneEval(zones[i], b.slot, b);
  }

  // FUN_00419e90 + FUN_00417dd0 + FUN_00417d20
  private zoneEval(zone: Zone, slot: number, b: Bulanek): void {
    const r = b.shown ? b.collisionRect() : { left: -1, top: -1, right: -1, bottom: -1 };
    let inside: boolean;
    if (zone.flags & 4) {
      // whole rect inside; an empty rect (hidden bulanek) counts as inside, as in the original
      const u = union(zone.rect, r);
      inside = u.left === zone.rect.left && u.top === zone.rect.top && u.right === zone.rect.right && u.bottom === zone.rect.bottom;
    } else inside = intersects(zone.rect, r);
    if (slot > 3 && !(zone.flags & 8)) return;
    const bit = 1 << ((slot > 3 ? 0x88 - slot : slot) & 31);
    const mask = zone.mask ?? 0;
    const enter = inside && !(b.invisible && !(zone.flags & 2));
    if (enter === Boolean(mask & bit)) return;
    zone.mask = enter ? mask | bit : mask & ~bit;
    if (zone.flags & 1) this.level.vm.callEntry(enter ? 7 : 8, [zone.id, slot]);
    else zone.owner?.zoneMessage(zone, enter);
  }

  // ---- teleports ----

  // scene_teleport 0x41d090: origin flash, destination flash at x, y (collision corner) or a random free spot
  spawnTeleport(b: Bulanek, x: number, y: number, force: boolean): boolean {
    if (x !== -1 && !force) {
      const c = b.collisionRect();
      const r = { left: x, top: y, right: x + c.right - c.left, bottom: y + c.bottom - c.top };
      if (this.scene.hitTest(r, r, true, false)) return false;
    }
    const from = new TeleportPoint(this, b, true);
    this.teleports.push(from);
    this.scene.add(from, 1);
    const to = new TeleportPoint(this, b, false);
    this.teleports.push(to);
    this.scene.add(to);
    if (x === -1) this.placeRandom(to);
    else {
      const c = to.collisionRect()!;
      to.moveTo(to.left + x - c.left, to.top + y - c.top);
    }
    return true;
  }

  // 0xf5
  removeTeleportPoints(b: Bulanek): void {
    for (const p of this.teleports.filter(t => t.bulanek === b)) {
      this.scene.remove(p);
      this.teleports.splice(this.teleports.indexOf(p), 1);
    }
  }

  // ---- GameHook (level opcodes) ----

  // scene_spawn_players 0x4205a0
  spawnPlayers(): void {
    this.scene.currentLayer = 1;
    for (let s = 0; s < this.playerCount; s++) this.spawn(s);
    if (this.playerCount === 1) for (const s of [125, 126, 127]) this.spawn(s);
  }

  // scene_spawn_extra 0x420550: four zombies, all but the first start dead
  spawnExtra(): void {
    for (let i = 0; i < 4; i++) {
      const b = this.spawn(0x20 + i);
      this.extras.push(b);
      if (i > 0) {
        b.shown = false;
        b.solid = false;
        this.bulanekMoved(b); // FUN_0041f350
      }
    }
  }

  teleport(slot: number, x: number, y: number, force: boolean): number {
    const b = this.scene.getSlot(slot);
    return b instanceof Bulanek && b.teleport(x, y, force) ? 1 : 0;
  }

  // scene_fire 0x41f230: flags bits 0-1 = shot type + 1, bits 4-7 = sound
  fire(x: number, y: number, dir: number, owner: number, flags: number, images: Value): void {
    if (flags & 3) this.scene.add(new Shot(this, x, y, dir, owner, (flags & 3) - 1, images), 1);
    const sound = { 0x10: 0x15, 0x20: 0xd, 0x40: 0x13 }[flags & 0xf0];
    if (sound === undefined) return;
    const o = owner !== 0xff ? this.scene.getSlot(owner) : null;
    this.sound(sound, BANK_LIGHT, o && { left: o.left, top: o.top, right: o.right, bottom: o.bottom });
  }

  newMine(x: number, y: number): Value {
    return new Mine(this, null, { x, y });
  }

  zoneAdded(zone: Zone): void {
    this.zoneEvalAll(zone);
  }
}
