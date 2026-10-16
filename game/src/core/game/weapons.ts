import { animFrameData, animMeta, Manifest } from '../manifest';
import { AnimPlayer } from '../scene/anim';

export const BANK_LIGHT = 4; // sound bank 0 = app default res 4: bulanek sounds and weapons 0-1
export const BANK_HEAVY = 3; // DAT_004b3730 = res 3: weapons >= 2 and explosions

/** Weapon types: 0 pistol, 1 shotgun, 2 mines, 3 detonator, 4 machine gun, 5 rocket. */
export const WEAPON_COUNT = 6;
/** Weapon struct table (0x1c bytes per type): hand anims per direction L, R, U, D. */
export const WEAPON_ANIMS = [
  [270, 271, 272, 269],
  [274, 275, 276, 273],
  [278, 279, 280, 277],
  [282, 283, 284, 281],
  [286, 287, 288, 285],
  [290, 291, 292, 289],
];
/** DAT_00481d38: pickup sound per type (-1 = none). */
export const PICKUP_SOUND = [-1, 15, 0, -1, 2, 5];
/** 0x481a60 (FUN_00412490): max ammo per type. */
export const MAX_AMMO = [5, 4, 4, 1, 4, 2];
/** 0x482918: weapon for a negative ctor argument. */
export const RANDOM_WEAPON = [0, 1, 4, 5];
/** 0x4827f4: weapon pickup anims per type. */
export const ITEM_ANIM = [-1, 179, 268, -1, 222, 219];

type Offsets = readonly [number, number][];
/** Shot/mine origin offsets from the composite view origin, per direction L, R, U, D. */
export const MINE_OFF: Offsets = [[-3, 44], [27, 33], [4, 19], [23, 49]]; // 0x4827d4
export const PISTOL_OFF: Offsets = [[-19, 46], [77, 25], [17, -11], [32, 84]]; // 0x482928
export const SHOTGUN_OFF: Offsets = [[-19, 47], [77, 33], [18, -11], [29, 84]]; // 0x482948
export const ROCKET_OFF: Offsets = [[-25, 40], [77, 27], [16, -17], [26, 84]]; // 0x4829b0
export const MG_OFF: Offsets = [[-19, 44], [77, 33], [19, -13], [28, 88]]; // 0x4829d0

/** CWeapon: the weapon in the bulanek's hand, one anim per direction; frame events and END go to the owner. */
export class Weapon {
  readonly player: AnimPlayer;
  readonly res: number[];
  /** Frame-0 attachment point per direction (the only frame with a point). */
  readonly points: { x: number; y: number }[];

  constructor(readonly type: number, manifest: Manifest, onEvent: (ev: number) => void) {
    this.res = WEAPON_ANIMS[type];
    this.player = new AnimPlayer(this.res.map(r => animMeta(manifest, r)), onEvent);
    this.points = this.res.map(r => {
      const p = animFrameData(manifest, r).points?.[0]?.[0];
      return { x: p?.[1] ?? 0, y: p?.[2] ?? 0 };
    });
  }

  get idle(): boolean {
    return !this.player.running;
  }
}
