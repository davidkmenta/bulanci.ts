import { afterEach, describe, expect, it, vi } from 'vitest';
import { Assets } from '../src/platform/assets';
import { fetchOk, stereoPan } from '../src/platform/audio';
import { MAX_STEPS, advance } from '../src/platform/loop';
import { computeViewport } from '../src/platform/viewport';

describe('computeViewport', () => {
  it('letterboxes a wide phone screen', () => {
    expect(computeViewport(915, 412, 2)).toEqual({ scale: (412 / 600) * 2, width: 1099, height: 824, offsetX: 366, offsetY: 0 });
  });
  it('pillarboxes a tall window', () => {
    expect(computeViewport(800, 1000, 1)).toEqual({ scale: 1, width: 800, height: 600, offsetX: 0, offsetY: 200 });
  });
});

describe('advance', () => {
  it('turns real time into whole 10 ms steps and keeps the remainder', () => {
    expect(advance(0, 16)).toEqual({ steps: 1, acc: 6 });
    expect(advance(6, 16)).toEqual({ steps: 2, acc: 2 });
  });
  it('drops the backlog after a long pause', () => {
    expect(advance(0, 5000)).toEqual({ steps: MAX_STEPS, acc: 0 });
  });
});

describe('fetchOk', () => {
  it('accepts the status 0 of Capacitor iOS media responses, rejects HTTP errors', () => {
    expect([fetchOk({ ok: true, status: 200 }), fetchOk({ ok: false, status: 0 }), fetchOk({ ok: false, status: 404 })]).toEqual([true, true, false]);
  });
});

describe('stereoPan', () => {
  it('maps DirectSound pan ±1500 (−15 dB) to an equal-power pan of ±0.775', () => {
    expect([stereoPan(-1500), stereoPan(0), stereoPan(1500), stereoPan(9999)]).toEqual([-0.775, 0, 0.775, 0.775]);
  });
});

describe('Assets.load', () => {
  afterEach(() => vi.unstubAllGlobals());
  const respond = (body: string, type: string) => vi.stubGlobal('fetch', async () => new Response(body, { headers: { 'content-type': type } }));

  it('reads the manifest', async () => {
    respond('{"1":{"kind":"music"}}', 'application/json');
    expect((await Assets.load()).manifest).toEqual({ 1: { kind: 'music' } });
  });
  it('a dev-server HTML fallback for a missing manifest gives the npm run assets hint', async () => {
    respond('<!doctype html>', 'text/html');
    await expect(Assets.load()).rejects.toThrow(/run npm run assets/);
  });
  it('releaseImages drops the cached images', async () => {
    respond('{}', 'application/json');
    const assets = await Assets.load();
    assets.images.set(1, {} as HTMLImageElement);
    assets.releaseImages();
    expect(assets.images.size).toBe(0);
  });

  it('preloadColors loads the team sheets of the loaded resources, so a new pose never shows the base sheet', async () => {
    respond(JSON.stringify({ 5: { kind: 'anim', file: 'anims/5.png', colors: 8 }, 6: { kind: 'anim', file: 'anims/6.png', colors: 8 } }), 'application/json');
    const assets = await Assets.load();
    const loaded: string[] = [];
    vi.stubGlobal('Image', class { src = ''; decode() { loaded.push(this.src); return Promise.resolve(); } });
    assets.images.set(5, {} as HTMLImageElement);
    await assets.preloadColors([0, 3]);
    expect(loaded).toEqual(['data/anims/5_c3.png']);
    expect(assets.image(5, 3)).toMatchObject({ src: 'data/anims/5_c3.png' });
  });
});

describe('Hud score counter', () => {
  it('rolls 1 px per 100 ms (CNumCounter timer 0, 100 ms)', async () => {
    const { NumCounter } = await import('../src/platform/hud');
    const hud = new NumCounter({ image: () => undefined } as never);
    const offset = () => (hud as unknown as { offset: number[] }).offset[2];
    hud.step(1);
    for (let i = 0; i < 9; i++) hud.step(1);
    expect(offset()).toBe(1);
    for (let i = 0; i < 10; i++) hud.step(1);
    expect(offset()).toBe(2);
  });
});
