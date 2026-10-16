import { Page, expect, test } from '@playwright/test';

// Levels whose scene must visibly change. 323 (a timer handler waits for 2+ players, so it is static with one player)
// and 324 (has no animations) are deliberate exceptions. 319-321 animate right away; 322 starts all its animations
// from a random timer (levels/00322.asm entry_1: timer_add(0, rand(0, 10) * 1000 + 5000, 6)), i.e. 5-15 s after start,
// so the check polls for up to 20 s instead of comparing two snapshots 1.5 s apart.
const ANIMATED = new Set(['319', '320', '321', '322']);

type AudioCounters = { __audioStarts: number; __musicStarts: number };

// Game-pixel targets (src/platform/screens.ts): START switch, Dále in CStartGame1, the lobby level list and Start,
// Konec hry in the pause dialog.
const LIST_X = 230 + 30 + 60;
const LIST_Y = 50 + 270 + 3 + 9;
const START = { x: 230 + 40 + 41, y: 50 + 466 + 12 };
const PAUSE_QUIT = { x: 247 + 209 + 41, y: 255 + 50 + 12 };

const screenName = (page: Page) => page.evaluate(() => document.getElementById('game')!.dataset.screen);

/** Clicks a point of the 800x600 game, letterboxed like computeViewport. */
async function tap(page: Page, x: number, y: number) {
  const { w, h } = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  const scale = Math.min(w / 800, h / 600);
  await page.mouse.click((w - 800 * scale) / 2 + x * scale, (h - 600 * scale) / 2 + y * scale);
}

async function openLobby(page: Page) {
  await expect.poll(() => screenName(page), { timeout: 30_000 }).toBe('splash');
  await tap(page, 400, 300);
  await expect.poll(() => screenName(page)).toBe('menu');
  await tap(page, 67, 87); // START
  await tap(page, 250 + 20 + 41, 60 + 456 + 12); // Dále
}

test('all six levels load, render and run without errors', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  // Count AudioBufferSourceNode.start() calls; music is the only looping source (AudioOut.playMusic sets loop = true).
  await page.addInitScript(() => {
    const w = window as unknown as AudioCounters;
    w.__audioStarts = 0;
    w.__musicStarts = 0;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (this: AudioBufferSourceNode, ...args: [number?, number?, number?]) {
      w.__audioStarts++;
      if (this.loop) w.__musicStarts++;
      return start.apply(this, args);
    };
  });

  await page.goto('/');
  await openLobby(page);

  // A failed level shows its message in `#ui.error` and returns to the lobby: surface that text instead of a timeout.
  const checkRunning = async (id: string, when: string) => {
    expect(await page.locator('#ui.error').allTextContents(), `level ${id} ${when}: error shown`).toEqual([]);
    expect(await screenName(page), `level ${id} ${when}: game screen`).toBe('game');
    await expect(page.locator('#pause'), `level ${id} ${when}: #pause visible`).toBeVisible({ timeout: 1_000 });
    expect(errors.splice(0), `level ${id} ${when}: console/page errors`).toEqual([]);
  };
  const snapshot = () => page.evaluate(() => {
    const c = document.getElementById('game') as HTMLCanvasElement;
    const img = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
    const px = new Uint32Array(img.data.buffer);
    let hash = 0;
    for (let i = 0; i < px.length; i++) hash = (Math.imul(hash, 31) + px[i]) | 0; // every pixel: small sprites must count
    const d = img.data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4 * 97) if (d[i] + d[i + 1] + d[i + 2] > 30) lit++;
    return { lit, hash };
  });
  const musicStarts = () => page.evaluate(() => (window as unknown as AudioCounters).__musicStarts);

  for (let row = 0; row < 6; row++) {
    const id = String(row);
    const music0 = await musicStarts();
    await tap(page, LIST_X, LIST_Y + row * 18);
    await tap(page, START.x, START.y);
    await expect.poll(() => screenName(page), { timeout: 30_000 }).toBe('game');
    await page.waitForTimeout(5500); // CGameCounter: 4 lights, 1 s apart, then the round starts
    await checkRunning(id, 'after start');
    await page.waitForTimeout(2000);
    await checkRunning(id, 'after 2 s');

    const a = await snapshot();
    expect(a.lit, `level ${id} draws something`).toBeGreaterThan(50);
    await page.screenshot({ path: `test-results/${info.project.name}-level-${id}.png` });
    if (ANIMATED.has(id)) {
      await expect.poll(async () => (await snapshot()).hash, { message: `level ${id} animates (canvas unchanged for 20 s)`, timeout: 20_000, intervals: [500] }).not.toBe(a.hash);
    } else {
      await page.waitForTimeout(1500);
    }
    await checkRunning(id, 'after animation check');
    expect(await musicStarts(), `level ${id} starts its music`).toBeGreaterThan(music0);

    await page.locator('#pause').click();
    await tap(page, PAUSE_QUIT.x, PAUSE_QUIT.y);
    await expect.poll(() => screenName(page)).toBe('menu');
    await expect(page.locator('#ui.error')).toHaveCount(0);
  }
  expect(errors, 'console/page errors').toEqual([]);
});

test('a short round ends on the score screen and returns to the lobby', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('/?round=2');
  await openLobby(page);
  await tap(page, START.x, START.y);
  await expect.poll(() => screenName(page), { timeout: 30_000 }).toBe('score');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('bulanci.config')!));
  expect(Object.values(stored.scores as Record<string, unknown[]>)[0]).toHaveLength(6);
  await tap(page, 400, 300);
  await expect.poll(() => screenName(page)).toBe('menu');
  expect(errors).toEqual([]);
});

test('a two-player round ends on the podium without touching the highscores', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'one player per phone: 2 hráči there is a network game');
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('/?round=2');
  await expect.poll(() => screenName(page), { timeout: 30_000 }).toBe('splash');
  await tap(page, 400, 300);
  await tap(page, 67, 87); // START
  await tap(page, 250 + 40 + 7, 60 + 179 + 7); // "2 hráči"
  await tap(page, 250 + 20 + 41, 60 + 456 + 12); // Dále
  await tap(page, START.x, START.y);
  await expect.poll(() => screenName(page), { timeout: 30_000 }).toBe('score');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('bulanci.config')!));
  expect([stored.players, stored.scores]).toEqual([2, {}]);
  expect(errors).toEqual([]);
});

test('touch: the joystick ball follows the thumb and springs back, the buttons press', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'touch controls only');
  await page.addInitScript(() => {
    const w = window as unknown as { __ticks: number };
    w.__ticks = 0;
    navigator.vibrate = () => (w.__ticks++, true);
  });
  const ticks = () => page.evaluate(() => (window as unknown as { __ticks: number }).__ticks);
  await page.goto('/?round=30');
  await openLobby(page);
  await tap(page, START.x, START.y);
  await expect.poll(() => screenName(page), { timeout: 30_000 }).toBe('game');
  const stick = page.locator('.touch .stick');
  await expect(stick).toBeHidden(); // no controls over the 3-2-1 countdown
  await expect(page.locator('#pause')).toBeHidden();
  await expect(stick).toBeVisible({ timeout: 30_000 });
  const s = (await stick.boundingBox())!;
  const cx = s.x + s.width / 2;
  const cy = s.y + s.height / 2;
  const center = async () => {
    const b = (await page.locator('.touch .ball').boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const rest = await center();
  const u = s.width / 48; // CSS pixels per sprite pixel: the ball moves in whole ones
  const ball = async () => {
    const c = await center();
    return { dx: Math.round((c.x - rest.x) / u), dy: Math.round((c.y - rest.y) / u) };
  };
  await page.mouse.move(cx + 2 * u, cy - u);
  await page.mouse.down();
  await expect.poll(ball).toEqual({ dx: 2, dy: -1 });
  expect(await ticks(), 'inside the dead zone: no switch closed').toBe(0);
  await page.mouse.move(cx + s.width, cy); // right: one click
  await page.mouse.move(cx + s.width, cy + 5 * u); // still right
  expect(await ticks()).toBe(1);
  await page.mouse.move(cx, cy + s.width); // past the gate: clamped to 10 sprite pixels; down: another click
  await expect.poll(ball).toEqual({ dx: 0, dy: 10 });
  expect(await ticks()).toBe(2);
  await page.mouse.up();
  await expect.poll(ball).toEqual({ dx: 0, dy: 0 });
  expect(await ticks(), 'releasing does not click').toBe(2);

  const fire = page.locator('.touch .fire');
  const f = (await fire.boundingBox())!;
  await page.mouse.move(f.x + f.width / 2, f.y + f.height / 3);
  await page.mouse.down();
  await expect(fire).toHaveClass(/\bon\b/);
  await page.mouse.up();
  await expect(fire).not.toHaveClass(/\bon\b/);
  await expect(page.locator('#pause')).toBeVisible();
});

test('history: a film plays in place with its sound', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(() => {
    const w = window as unknown as { __bitmaps: number; __sounds: number[] };
    w.__bitmaps = 0;
    w.__sounds = [];
    const bitmap = window.createImageBitmap;
    window.createImageBitmap = ((...a: Parameters<typeof bitmap>) => (w.__bitmaps++, bitmap(...a))) as typeof bitmap;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (this: AudioBufferSourceNode, ...args: [number?, number?, number?]) {
      w.__sounds.push(this.buffer?.duration ?? 0);
      return start.apply(this, args);
    };
  });
  await page.goto('/');
  await expect.poll(() => screenName(page), { timeout: 30_000 }).toBe('splash');
  await tap(page, 400, 300);
  await expect.poll(() => screenName(page)).toBe('menu');
  await tap(page, 67, 171); // HISTORIE
  await tap(page, 231 + 72 + 5, 36 + 480 + 5); // next page: 308, two films
  await tap(page, 231 + 350 + 80, 36 + 90 + 70); // the film at (350, 90): video 12289, 180 frames, 12 s
  await expect.poll(async () => (await page.evaluate(() => (window as unknown as { __bitmaps: number }).__bitmaps)), { timeout: 10_000 }).toBe(180);
  await expect.poll(async () => (await page.evaluate(() => (window as unknown as { __sounds: number[] }).__sounds)).some(d => d > 11.5 && d < 12.5)).toBe(true);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'test-results/history-film.png' });
  expect(errors).toEqual([]);
});
