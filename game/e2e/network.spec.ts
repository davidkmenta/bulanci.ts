import { Browser, Page, expect, test } from '@playwright/test';

const screenName = (page: Page) => page.evaluate(() => document.getElementById('game')!.dataset.screen);

async function tap(page: Page, x: number, y: number) {
  const { w, h } = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  const scale = Math.min(w / 800, h / 600);
  await page.mouse.click((w - 800 * scale) / 2 + x * scale, (h - 600 * scale) / 2 + y * scale);
}

async function open(browser: Browser, url: string) {
  const page = await (await browser.newContext({ viewport: { width: 800, height: 600 } })).newPage();
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url);
  await expect.poll(() => screenName(page), { timeout: 30_000 }).toBe('splash');
  await tap(page, 400, 300);
  await tap(page, 67, 87); // START
  return { page, errors };
}

// CStartGame1 (250,60), lobby (230,50), CTcpIpConfig (300,220), CSessionList (300,178)
const LOCAL_1 = { x: 250 + 40 + 7, y: 60 + 275 + 7 };
const DALE = { x: 250 + 20 + 41, y: 60 + 456 + 12 };
const START = { x: 230 + 40 + 41, y: 50 + 466 + 12 };

test('two browsers: create, join, chat, a round in lockstep, the same podium', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'one run is enough');
  const host = await open(browser, '/?round=3');
  await tap(host.page, 250 + 40 + 7, 60 + 179 + 7); // total "2 hráči"
  await tap(host.page, LOCAL_1.x, LOCAL_1.y); // on this computer: 1
  await tap(host.page, DALE.x, DALE.y); // creates the session and waits

  const guest = await open(browser, '/');
  await tap(guest.page, 250 + 40 + 7, 60 + 94 + 7); // Připojit se
  await tap(guest.page, DALE.x, DALE.y);
  await tap(guest.page, 300 + 73 + 41, 220 + 115 + 12); // CTcpIpConfig Ok: the default server
  await guest.page.waitForTimeout(1500); // the list refreshes every second and selects row 0
  await tap(guest.page, 300 + 83 + 41, 178 + 200 + 12); // Připojit

  for (const p of [host.page, guest.page]) await expect.poll(() => screenName(p), { timeout: 10_000 }).toBe('netlobby');
  await tap(guest.page, 230 + 34 + 130 + 38, 50 + 148); // own name edit (column 1): names must differ
  await guest.page.keyboard.press('ControlOrMeta+a');
  await guest.page.keyboard.type('Uzlík');
  await guest.page.keyboard.press('Enter');
  await tap(guest.page, 230 + 240 + 20, 50 + 244 + 184); // chat edit
  await guest.page.keyboard.type('ahoj');
  await guest.page.keyboard.press('Enter');
  await host.page.waitForTimeout(500);
  await host.page.screenshot({ path: 'test-results/net-lobby.png' });

  await tap(host.page, START.x, START.y);
  await guest.page.waitForTimeout(500);
  await tap(guest.page, START.x, START.y);
  for (const p of [host.page, guest.page]) await expect.poll(() => screenName(p), { timeout: 30_000 }).toBe('game');
  await host.page.waitForTimeout(5500); // countdown
  await host.page.keyboard.down('ArrowRight');
  await guest.page.keyboard.down('ArrowLeft');
  await guest.page.keyboard.press('Space');
  await host.page.screenshot({ path: 'test-results/net-game.png' });
  for (const p of [host.page, guest.page]) await expect.poll(() => screenName(p), { timeout: 15_000 }).toBe('score');
  const crc = await Promise.all([host.page, guest.page].map(p => p.evaluate(() => document.getElementById('game')!.dataset.crc)));
  expect(crc[0]).toBeTruthy();
  expect(crc[0]).toBe(crc[1]);
  expect([...host.errors, ...guest.errors]).toEqual([]);
});
