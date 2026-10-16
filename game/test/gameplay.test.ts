import { describe, expect, it } from 'vitest';
import { Bulanek } from '../src/core/game/bulanek';
import { Gaming, GamingOptions, HITS, LIVES } from '../src/core/game/gaming';
import { Key } from '../src/core/game/input';
import { MAX_AMMO } from '../src/core/game/weapons';
import { Level } from '../src/core/level';
import { MsvcRand } from '../src/core/rand';
import { loadManifest, readAsset } from './fixtures';

const manifest = loadManifest();
const TWO = [{ name: 'A', color: 0 }, { name: 'B', color: 2 }];

function game(opts: GamingOptions = {}, seed = 1) {
  const g = new Gaming(new Level(321, readAsset('levels/00321.bin'), manifest, new MsvcRand(seed)), opts);
  g.start(1);
  return g;
}
const bul = (g: Gaming, slot: number) => g.scene.getSlot(slot) as Bulanek;
const steps = (g: Gaming, n: number) => {
  for (let i = 0; i < n; i++) g.step([]);
};

describe('Gaming (single player)', () => {
  it('spawns the player and three NPCs in slots 125-127', () => {
    const g = game();
    for (const s of [0, 125, 126, 127]) expect(bul(g, s)).toBeInstanceOf(Bulanek);
    expect(bul(g, 0).shown).toBe(true);
  });

  it('runs the round clock from 150 s and ends the round at 0', () => {
    const g = game({ limit: 2 });
    expect(g.hud().center).toBe('2');
    steps(g, 100);
    expect(g.hud().timeLeftS).toBe(1);
    expect(g.result()).toBeNull();
    steps(g, 101);
    expect(g.result()!.map(p => p.name)).toEqual(['Bulík']);
    const before = g.checksum();
    g.step([]);
    expect(g.checksum()).toBe(before); // an ended game no longer steps
  });

  it('a direction key turns the bulánek that way', () => {
    const g = game();
    const target = bul(g, 0).dir === Key.Left ? Key.Right : Key.Left;
    g.step([{ key: target, down: true }]);
    expect(bul(g, 0).dir).toBe(target);
  });
});

describe('Bulanek weapons', () => {
  it('the pistol uses ammo, an empty one starts reloading', () => {
    const g = game();
    const b = bul(g, 0);
    b.ammo[0] = 1;
    g.step([{ key: Key.Fire, down: true }]);
    expect(b.ammo[0]).toBe(0);
    expect(g.hud().reloading).toBe(true);
  });

  it('infinite ammo keeps the count', () => {
    const g = game();
    const b = bul(g, 0);
    b.spell(2, true);
    const n = b.ammo[0];
    b.fire();
    expect(b.ammo[0]).toBe(n);
  });

  it('pickup fills the ammo and takes the weapon; mines add one at a time', () => {
    const b = bul(game(), 0);
    b.pickup(4);
    expect(b.weapon.type).toBe(4);
    expect(b.ammo[4]).toBe(MAX_AMMO[4]);
    b.pickup(2);
    b.pickup(2);
    expect(b.ammo[2]).toBe(2);
  });

  it('switch goes to the next weapon with ammo, best takes the highest', () => {
    const b = bul(game(), 0);
    b.ammo[1] = 1;
    b.ammo[5] = 1;
    b.switchWeapon();
    expect(b.weapon.type).toBe(1);
    b.switchWeapon();
    expect(b.weapon.type).toBe(5);
    b.switchWeapon();
    expect(b.weapon.type).toBe(0);
    b.bestWeapon();
    expect(b.weapon.type).toBe(5);
  });
});

describe('hits and round types', () => {
  it('a hit kills, counts the frag and the kill; invulnerability protects', () => {
    const g = game({ players: TWO });
    g.hit(1, 0, 0);
    expect(bul(g, 1).shown).toBe(false);
    expect(bul(g, 1).deaths).toBe(1);
    expect(bul(g, 0).frags).toBe(1);
    expect(bul(g, 0).kills).toEqual([0, 1, 0, 0]);
    expect(g.hud(0).score).toBe(1); // time: frags - deaths
    expect(g.hud(1).score).toBe(-1);

    bul(g, 0).spell(1, true);
    g.hit(0, 1, 0);
    expect(bul(g, 0).deaths).toBe(0);
  });

  it('death drops the special weapons', () => {
    const g = game({ players: TWO });
    bul(g, 1).pickup(5);
    g.hit(1, 0, 0);
    expect(bul(g, 1).weapon.type).toBe(0);
    expect(bul(g, 1).ammo.slice(1)).toEqual([0, 0, 0, 0, 0]);
  });

  it('hits: the leader shows in the centre and the limit ends the round', () => {
    const g = game({ players: TWO, type: HITS, limit: 2 });
    g.hit(0, 1, 0);
    expect(g.hud().center).toBe('B\n1');
    g.respawn(bul(g, 0));
    g.hit(0, 1, 0);
    g.step([]);
    expect(g.result()!.map(p => [p.name, p.score])).toEqual([['A', 0], ['B', 2]]);
  });

  it('lives: losing all of them eliminates and the last one standing ends the round', () => {
    const g = game({ players: TWO, type: LIVES, limit: 2 });
    g.hit(1, 0, 0);
    expect(g.hud().center).toBe('A\n2');
    g.respawn(bul(g, 1));
    g.hit(1, 0, 0);
    expect(g.hud(1).eliminated).toBe(true);
    g.respawn(bul(g, 1));
    expect(bul(g, 1).shown).toBe(false); // out of lives: no respawn
    g.step([]);
    expect(g.result()!.map(p => [p.name, p.score])).toEqual([['A', 2], ['B', -4]]);
  });
});
