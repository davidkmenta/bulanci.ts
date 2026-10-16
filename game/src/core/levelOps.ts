import type { GameHook, Level } from './level';
import type { Zone } from './scene/scene';
import { imageSize } from './manifest';
import { AnimObject, BitmapObject, ObstacleObject, SceneObject } from './scene/objects';
import { ResourceRef, ScriptList, Value, num } from './vm/values';
import type { Handler, Vm } from './vm/vm';

const objOf = (v: Value): SceneObject | null => (v instanceof SceneObject ? v : null);
const animOf = (v: Value): AnimObject | null => (v instanceof AnimObject ? v : null);
const listOf = (v: Value): ScriptList | null => (v instanceof ScriptList ? v : null);
const evalN = (vm: Vm, n: number): Value[] => Array.from({ length: n }, () => vm.eval());
const nums = (vm: Vm, n: number): number[] => evalN(vm, n).map(num);
const resId = (key: number) => key & 0xffff;

/** Level opcodes 0x2d..0x66 (table 0x4af018, handlers level_op_* in decompiled/_script_ops.c). Player, shot and
 *  network opcodes only log
 *  unless a game (CGaming) is attached to the level. Object opcodes ignore a null object like most originals. */
export function levelOps(level: Level): Record<number, Handler> {
  const { scene, timers } = level;
  const stub = (name: string, n: number): Handler => vm => {
    level.log(`${name}(${evalN(vm, n).map(v => (typeof v === 'number' ? v : typeof v)).join(', ')})`);
    return 0;
  };
  const withObj = (n: number, f: (o: SceneObject, args: number[]) => void): Handler => vm => {
    const o = objOf(vm.eval());
    const args = nums(vm, n);
    if (o) f(o, args);
    return o ?? 0;
  };
  /** Real handler when a game (CGaming) is attached, the milestone-1 stub otherwise. */
  const gameOr = (fallback: Handler, real: (vm: Vm, game: GameHook) => Value): Handler => vm =>
    level.game ? real(vm, level.game) : fallback(vm);
  const addZone = (zone: Zone) => {
    scene.zones.push(zone);
    level.game?.zoneAdded(zone); // scene_add_zone 0x41bad0 evaluates the new zone at once (FUN_00419fd0)
  };
  const withAnim = (n: number, f: (a: AnimObject, args: number[]) => void): Handler => vm => {
    const a = animOf(vm.eval());
    const args = nums(vm, n);
    if (a) f(a, args);
    return a ?? 0;
  };

  return {
    /* 0x2d new_anim(x, y, u8 flags, u8 n, n * res) */ 0x2d: vm => {
      const [x, y] = nums(vm, 2);
      const flags = vm.u8();
      const keys = Array.from({ length: vm.u8() }, () => vm.u32());
      return level.newAnim(x, y, flags, keys);
    },
    /* 0x2e new_bitmap(x, y, res) */ 0x2e: vm => {
      const [x, y] = nums(vm, 2);
      const id = resId(vm.u32());
      const { width, height } = imageSize(level.manifest, id);
      return new BitmapObject(id, x, y, width, height);
    },
    /* 0x2f new_obstacle(l, t, r, b) */ 0x2f: vm => {
      const [l, t, r, b] = nums(vm, 4);
      return new ObstacleObject(l, t, r, b);
    },
    /* 0x30 set_collision_rect */ 0x30: withObj(4, (o, [l, t, r, b]) => {
      o.collision = { left: l, top: t, right: r, bottom: b };
      o.solid = true;
    }),
    /* 0x31 set_depth */ 0x31: withObj(1, (o, [z]) => o.setDepth(z)),
    /* 0x32 spawn_players */ 0x32: gameOr(stub('spawn_players', 0), (_, g) => (g.spawnPlayers(), 0)),
    /* 0x33 add */ 0x33: withObj(0, o => scene.add(o)),
    /* 0x34 set_layer */ 0x34: vm => {
      scene.currentLayer = (num(vm.eval()) & 3) as 0 | 1 | 2;
      return 0;
    },
    /* 0x35 set_background(res) */ 0x35: vm => {
      scene.background = resId(vm.u32());
      return 0;
    },
    /* 0x36 set_audio(music res, sound bank res; 0 keeps the current bank) */ 0x36: vm => {
      const music = vm.u32();
      const bank = vm.u32();
      if (bank) level.soundBank = resId(bank);
      if (music) level.emit({ type: 'music', res: resId(music) });
      return 0;
    },
    /* 0x37 set_solid */ 0x37: withObj(1, (o, [v]) => { o.solid = v > 0; }),
    /* 0x38 set_slot */ 0x38: withObj(1, (o, [s]) => scene.setSlot(o, s & 0xff)),
    /* 0x39 resort */ 0x39: withObj(0, o => scene.resort(o)),
    /* 0x3a move_to */ 0x3a: withObj(2, (o, [x, y]) => o.moveTo(x, y)),
    /* 0x3b show */ 0x3b: withObj(0, o => { o.shown = true; }),
    /* 0x3c hide */ 0x3c: withObj(0, o => { o.shown = false; }),
    /* 0x3d first_of_3 */ 0x3d: vm => evalN(vm, 3)[0],
    /* 0x3e get_slot */ 0x3e: vm => scene.getSlot(num(vm.eval()) & 0xff) ?? 0,
    /* 0x3f anim_play(obj, seq, flags) */ 0x3f: withAnim(2, (a, [seq, flags]) => a.play(seq, flags)),
    /* 0x40 anim_stop */ 0x40: withAnim(0, a => a.player.stop()),
    /* 0x41 play_sound(index, slot) */ 0x41: vm => {
      const [index, slot] = nums(vm, 2);
      level.playSound(index, slot & 0xff);
      return 0;
    },
    /* 0x42 anim_set_stop_frame */ 0x42: withAnim(1, (a, [f]) => { a.player.stopFrame = f; }),
    /* 0x43 fire(x, y, dir, owner, flags) */ 0x43: gameOr(stub('fire', 5), (vm, g) => {
      const [x, y, dir, owner, flags] = nums(vm, 5);
      g.fire(x, y, dir & 0xff, owner & 0xff, flags & 0xff, 0);
      return 0;
    }),
    /* 0x44 timer_add(id, interval, flags) */ 0x44: vm => {
      const [id, interval, flags] = nums(vm, 3);
      return timers.add(id, interval, flags, level.now);
    },
    /* 0x45 timer_resume */ 0x45: vm => {
      const id = num(vm.eval());
      timers.resume(id, level.now);
      return id;
    },
    /* 0x46 timer_pause */ 0x46: vm => {
      const id = num(vm.eval());
      timers.pause(id);
      return id;
    },
    /* 0x47 timer_remove */ 0x47: vm => {
      timers.remove(num(vm.eval()));
      return 0;
    },
    /* 0x48 timer_set_interval */ 0x48: vm => {
      const [id, ms] = nums(vm, 2);
      timers.setInterval(id, ms);
      return id;
    },
    /* 0x49 add_zone(id, l, t, r, b) */ 0x49: vm => {
      const [id, l, t, r, b] = nums(vm, 5);
      addZone({ id, rect: { left: l, top: t, right: r, bottom: b }, flags: 1, mask: 0 });
      return 0;
    },
    /* 0x4a is_master */ 0x4a: () => 1,
    /* 0x4b net_send */ 0x4b: vm => vm.eval(),
    /* 0x4c net_set_stream */ 0x4c: vm => (level.netStream = vm.eval()),
    /* 0x4d net_mode */ 0x4d: () => 0,
    /* 0x4e set_opacity */ 0x4e: withObj(1, (o, [v]) => { o.opacity = v & 0xff; }),
    /* 0x4f set_alpha_from(obj, res) */ 0x4f: vm => {
      const o = objOf(vm.eval());
      const id = resId(vm.u32());
      if (o) {
        o.alphaMaskRes = id;
        level.log(`set_alpha_from(${id}) not rendered`);
      }
      return o ?? 0;
    },
    /* 0x50 anim_start(obj, loop) */ 0x50: withAnim(1, (a, [loop]) => {
      a.player.stop();
      a.player.flags = (a.player.flags & 2) | (loop ? 2 : 0) | 1;
      a.player.start(Boolean(loop), level.now);
    }),
    /* 0x51 timer_set_value */ 0x51: vm => {
      const id = num(vm.eval());
      timers.setValue(id, vm.eval());
      return id;
    },
    /* 0x52 timer_get_value */ 0x52: vm => timers.getValue(num(vm.eval())),
    /* 0x53 add_zone_flags(id, l, t, r, b, flags) */ 0x53: vm => {
      const [id, l, t, r, b, flags] = nums(vm, 6);
      addZone({ id, rect: { left: l, top: t, right: r, bottom: b }, flags: flags | 1, mask: 0 });
      return 0;
    },
    /* 0x54 teleport(slot) */ 0x54: gameOr(stub('teleport', 1), (vm, g) => g.teleport(num(vm.eval()) & 0xff, -1, -1, false)),
    /* 0x55 teleport_to(slot, x, y, force) */ 0x55: gameOr(stub('teleport_to', 4), (vm, g) => {
      const [slot, x, y, force] = nums(vm, 4);
      return g.teleport(slot & 0xff, x, y, force !== 0);
    }),
    /* 0x56 remove(obj, destroy) */ 0x56: vm => {
      const o = objOf(vm.eval());
      const destroy = num(vm.eval());
      if (o) scene.remove(o);
      return o && !destroy ? o : 0;
    },
    /* 0x57 anim_is_playing */ 0x57: vm => (animOf(vm.eval())?.player.running ? 1 : 0),
    /* 0x58 anim_set_frame */ 0x58: withAnim(1, (a, [f]) => a.player.setFrame(f, level.now)),
    /* 0x59 new_list */ 0x59: () => new ScriptList(),
    /* 0x5a list_count */ 0x5a: vm => listOf(vm.eval())?.items.length ?? 0,
    /* 0x5b list_resize(list, size, destroy) */ 0x5b: vm => {
      const l = listOf(vm.eval());
      const [n] = nums(vm, 2);
      // array_resize 0x431000 only reallocates; the count drops when the list shrinks
      if (l && n < l.items.length) l.items.length = n;
      return l ?? 0;
    },
    /* 0x5c list_get */ 0x5c: vm => {
      const l = listOf(vm.eval());
      const i = num(vm.eval());
      return l?.items[i] ?? 0;
    },
    /* 0x5d list_set */ 0x5d: vm => {
      const l = listOf(vm.eval());
      const i = num(vm.eval());
      const v = vm.eval();
      if (l) l.items[i] = v;
      return l ?? 0;
    },
    /* 0x5e list_remove(list, index, count, destroy) */ 0x5e: vm => {
      const l = listOf(vm.eval());
      const [i, count] = nums(vm, 3);
      l?.items.splice(i, count);
      return l ?? 0;
    },
    /* 0x5f list_insert(list, index (-1 append), value) */ 0x5f: vm => {
      const l = listOf(vm.eval());
      const i = num(vm.eval());
      const v = vm.eval();
      if (l) {
        if (i < 0) l.items.push(v);
        else l.items.splice(i, 0, v);
      }
      return l ?? 0;
    },
    /* 0x60 delete (Release: the scene keeps its own reference) */ 0x60: vm => {
      vm.eval();
      return 0;
    },
    /* 0x61 preload(res) */ 0x61: vm => new ResourceRef(resId(vm.u32())),
    /* 0x62 fire_ex(x, y, dir, owner, flags, images) */ 0x62: gameOr(stub('fire_ex', 6), (vm, g) => {
      const [x, y, dir, owner, flags] = nums(vm, 5);
      g.fire(x, y, dir & 0xff, owner & 0xff, flags & 0xff, vm.eval());
      return 0;
    }),
    /* 0x63 set_shoot_through */ 0x63: withObj(1, (o, [v]) => { o.shootThrough = v !== 0; }),
    /* 0x64 spawn_extra */ 0x64: gameOr(stub('spawn_extra', 0), (_, g) => (g.spawnExtra(), 0)),
    /* 0x65 spawn_bot */ 0x65: stub('spawn_bot', 4),
    /* 0x66 new_mine(x, y) */ 0x66: gameOr(stub('new_mine', 2), (vm, g) => {
      const [x, y] = nums(vm, 2);
      return g.newMine(x, y);
    }),
  };
}
