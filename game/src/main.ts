/// <reference types="vite/client" />
import './style.css';
import { Bulanek } from './core/game/bulanek';
import { Gaming, TIME } from './core/game/gaming';
import { KEYSETS, Key, KeyEdge } from './core/game/input';
import { Level, LevelEvent } from './core/level';
import { PROFILE_KEYSET, balanceGains, insertScore, parseConfig, parseHistoryPage, profileOf } from './core/menu';
import { MsvcRand } from './core/rand';
import { Assets } from './platform/assets';
import { AudioOut } from './platform/audio';
import { Hud } from './platform/hud';
import { advance } from './platform/loop';
import { drawScene } from './platform/render';
import { NetClient } from './net/client';
import { Lockstep } from './net/lockstep';
import { STEPS_PER_TICK } from './net/protocol';
import { App, MenuScreen, S, ScoreScreen, SplashScreen, netPauseDialog, pauseDialog, setupDialog } from './platform/screens';
import { TOUCH, TouchControls } from './platform/touch';
import { Ui } from './platform/ui';
import { GAME_H, GAME_W, computeViewport } from './platform/viewport';
import { Pointer, Screen, drawImage, initWidgets, sound } from './platform/widgets';

const STORE = 'bulanci.config';
const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const ui = new Ui();

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  return computeViewport(innerWidth, innerHeight, dpr);
}
let viewport = resize();
addEventListener('resize', () => { viewport = resize(); });

// Player input: held keys turn into press/release edges for the next simulation step (auto-repeat is ignored).
// Each local player has its own key set (KEYSETS by profile); KEYS maps KeyboardEvent.code -> player and key.
let KEYS: Record<string, { player: number; key: Key }> = {};
const useKeysets = (sets: number[]) => {
  KEYS = {};
  sets.forEach((ks, player) => KEYSETS[ks].forEach((code, key) => (KEYS[code] = { player, key })));
};
useKeysets([0]);
const held = new Set<string>(); // `${player},${key}`
let edges: KeyEdge[] = [];
let accepting = false; // a round is running and not paused
const press = (k: Key, player = 0) => {
  const id = `${player},${k}`;
  if (!accepting || held.has(id)) return;
  held.add(id);
  edges.push({ key: k, down: true, player });
};
const release = (k: Key, player = 0) => {
  if (held.delete(`${player},${k}`)) edges.push({ key: k, down: false, player });
};
const releaseAll = () => held.forEach(id => {
  const [player, k] = id.split(',').map(Number);
  release(k, player);
});
const setAccepting = (on: boolean) => {
  if (!on) releaseAll();
  accepting = on;
};
const touch = TOUCH ? new TouchControls(press, release) : null;
const roundS = Number(new URLSearchParams(location.search).get('round')); // dev/test helper: ?round=<seconds>

// VmErrors already name the level and pc; other errors (fetch, decode) carry their own message too
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

let screen: Screen = new (class extends Screen {
  draw() {}
})('loading');
const pointer = new Pointer(() => screen);
function show(s: Screen): void {
  pointer.reset();
  screen = s;
  canvas.dataset.screen = s.name; // for e2e tests
}

/** Client (CSS) pixels -> game pixels. */
const toGame = (e: PointerEvent) => {
  const dpr = window.devicePixelRatio || 1;
  return [(e.clientX * dpr - viewport.offsetX) / viewport.scale, (e.clientY * dpr - viewport.offsetY) / viewport.scale] as const;
};
canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); pointer.down(...toGame(e)); });
canvas.addEventListener('pointermove', e => pointer.move(...toGame(e)));
canvas.addEventListener('pointerup', e => {
  pointer.up(...toGame(e));
  if (e.pointerType !== 'mouse') pointer.leave();
});
canvas.addEventListener('pointerleave', () => pointer.leave());
let pressTimer = 0;
canvas.addEventListener('touchstart', () => { pressTimer = window.setTimeout(() => ui.toggleDebug(), 600); });
canvas.addEventListener('touchend', () => clearTimeout(pressTimer));

addEventListener('keydown', e => {
  if (e.target === ui.input) return; // typing a name
  const k = KEYS[e.code];
  if (accepting && k !== undefined) {
    e.preventDefault();
    if (!e.repeat) press(k.key, k.player);
  } else if (e.key === 'd' && !(screen instanceof MenuScreen)) ui.toggleDebug();
  else if (!e.repeat && screen.key(e)) e.preventDefault();
});
addEventListener('keyup', e => {
  const k = KEYS[e.code];
  if (k === undefined) return;
  e.preventDefault();
  release(k.key, k.player);
});
addEventListener('blur', releaseAll);

/** CGameCounter (lights 34 off, 36 red, 35 green at x=517+70k, y=537; sounds 0x12 x3, 0x11; 1 s per light) on the
 *  level wallpaper, then CGaming. A network game runs the server's sealed ticks through Lockstep instead of the
 *  local clock; any machine's pause shows the pause dialog everywhere (CPauseDlg 0x40b2f0). */
class GameScreen extends Screen {
  private readonly hud: Hud;
  private readonly logs: string[] = [];
  private readonly lights = [34, 34, 34, 34];
  private counter = 0; // CGameCounter timer events seen; 5 = round running
  private counterAt = performance.now();
  private running = true;
  private acc = 0;
  private last = performance.now();
  private frames = 0;
  private fps = 0;
  private fpsAt = this.last;

  private readonly ls: Lockstep | null = null;

  constructor(private readonly app: App, private readonly id: number, private readonly level: Level, private readonly gaming: Gaming,
    private readonly net: NetClient | null = null) {
    super('game');
    if (net) {
      const ls = (this.ls = new Lockstep(gaming, (n, crc) => net.send({ t: 'hash', n, crc })));
      net.listener = m => {
        if (m.t === 'tick') ls.push(m);
        else if (m.t === 'kicked' || m.t === 'ended') this.stop(S.desync);
      };
      net.onClose = () => this.stop(S.lost);
    }
    this.hud = new Hud(app.assets);
    gaming.start(1);
    // the colour sheets load during the 4 s countdown
    app.assets.preloadColors(level.scene.layers.flat().filter(o => o instanceof Bulanek).map(b => b.color)).catch(() => {});
    this.handle(level.takeEvents());
    edges = [];
    held.clear();
  }

  private handle(events: LevelEvent[]): void {
    for (const e of events) {
      if (e.type === 'music') this.app.audio.playMusic(e.res);
      else if (e.type === 'sound') this.app.audio.playSound(e.bankRes, e.index, e.pan);
      else this.logs.push(e.text);
    }
  }

  private pause(): void {
    if (this.net) {
      if (!this.ls!.paused.has(this.net.you)) this.net.send({ t: 'pause', on: true });
      return;
    }
    if (!this.running || this.dialog) return;
    setAccepting(false);
    pointer.reset();
    const resume = () => {
      pointer.reset();
      this.dialog = null;
      this.last = performance.now();
      setAccepting(this.counter >= 5);
    };
    const open = () => {
      pointer.reset();
      this.dialog = pauseDialog(this.app, resume, () => this.stop(), () => {
        pointer.reset();
        this.dialog = setupDialog(this.app, open);
      });
    };
    open();
  }

  /** The network pause dialog, open while any machine pauses; Pokračuj takes back this machine's pause. */
  private openNetPause(): void {
    const net = this.net!;
    pointer.reset();
    this.dialog = netPauseDialog(this.app, net, () => net.send({ t: 'pause', on: false }), () => this.stop(), () => {
      pointer.reset();
      this.dialog = setupDialog(this.app, () => this.openNetPause());
    });
  }

  /** CGameCounter light k (0-3), k = 4 starts the round. */
  private light(k: number): void {
    if (k < 3) { this.lights[k] = 36; sound(0x12); }
    else if (k === 3) { this.lights[3] = 35; sound(0x11); }
  }

  /** Leaves the level: to the score screen after a finished round, else back to the lobby (or an error). A network
   *  game goes back to the menu (the original does not return to the lobby). */
  stop(error?: string): void {
    if (!this.running) return;
    this.running = false;
    if (this.net) {
      this.net.listener = () => {};
      this.net.onClose = () => {};
      this.net.close();
    }
    setAccepting(false);
    touch?.show(false);
    ui.showPause(null);
    try {
      this.gaming.stop();
    } catch (e) {
      error ??= errorText(e); // a failure of the stop entry must not vanish; an earlier error wins
    }
    const app = this.app;
    const lobby = () => {
      app.audio.playMusic(MenuScreen.music());
      show(new MenuScreen(app, this.net ? 'none' : 'lobby'));
    };
    const players = this.gaming.result();
    if (this.net) canvas.dataset.crc = String(this.gaming.checksum()); // for e2e tests: both machines must agree
    if (players && !error) {
      app.audio.stopMusic();
      if (players.length > 1) show(new ScoreScreen({ players }, lobby)); // highscores only in single player
      else {
        const name = app.levels.find(l => l.id === this.id)!.name;
        const { table, row } = insertScore(app.config.scores[name], { name: players[0].name, kills: players[0].frags, deaths: players[0].deaths });
        app.config.scores[name] = table;
        app.save();
        show(new ScoreScreen({ players, table, row }, lobby));
      }
    } else {
      lobby();
      ui.showError(error ?? null);
    }
  }

  draw(g: CanvasRenderingContext2D, t: number): void {
    if (!this.running) return;
    const dt = t - this.last;
    this.last = t;
    let paused: boolean | boolean[] = this.dialog !== null;
    try {
      if (this.ls) {
        const ls = this.ls;
        const net = this.net!;
        const ran = ls.update(dt);
        while (this.counter < ls.counter) this.light(this.counter++);
        for (let i = 0; i < ran * STEPS_PER_TICK; i++) this.hud.step(this.huds().map(h => h.score));
        if (ls.paused.size && !this.dialog) this.openNetPause();
        else if (!ls.paused.size && this.dialog) (this.dialog = null), pointer.reset();
        if (accepting !== (this.counter >= 5 && !this.dialog)) setAccepting(!accepting);
        const mine = net.mine;
        if (edges.length) net.send({ t: 'input', edges: edges.splice(0).map(e => ({ key: e.key, down: e.down, player: mine[e.player ?? 0] })) });
        paused = this.huds().map((_, i) => ls.paused.has(net.slots[i]?.machine));
      } else {
        const r = advance(this.acc, dt);
        this.acc = r.acc;
        if (this.counter < 5 && !paused && t - this.counterAt >= 1000) {
          this.counterAt = t;
          const k = this.counter++;
          this.light(k);
          if (k === 4) setAccepting(true);
        }
        for (let i = 0; i < r.steps && !paused && this.counter >= 5; i++) {
          this.gaming.step(edges.splice(0));
          this.hud.step(this.huds().map(h => h.score));
        }
      }
      this.handle(this.level.takeEvents());
      const live = this.counter >= 5; // no controls over the 3-2-1 countdown
      touch?.show(live);
      if (live !== ui.pauseShown) ui.showPause(live ? () => this.pause() : null);
      if (this.counter < 5) {
        // the counter runs over the level's wallpaper (set_background, scene +0x360) before the map is shown
        drawScene(g, viewport, [], this.app.assets);
        drawImage(g, this.gaming.scene.background, 0, 0);
        this.lights.forEach((res, k) => drawImage(g, res, 517 + 70 * k, 537));
      } else {
        drawScene(g, viewport, this.gaming.scene.drawList(), this.app.assets);
        const reload = this.huds().map((_, i) => {
          const b = this.gaming.scene.getSlot(i);
          return b instanceof Bulanek ? b.reloadCount : 0;
        });
        this.hud.draw(g, this.huds(), reload, paused);
      }
      if (this.gaming.result()) this.stop();
    } catch (e) {
      this.stop(errorText(e));
      return;
    }
    this.frames++;
    if (t - this.fpsAt >= 1000) { this.fps = this.frames; this.frames = 0; this.fpsAt = t; }
    ui.setDebug([`level ${this.id}  fps ${this.fps}  objekty ${this.level.scene.count()}  čas ${(this.level.now / 1000).toFixed(1)} s`, ...this.logs.slice(-20)]);
  }

  private huds() {
    return Array.from({ length: this.gaming.playerCount }, (_, i) => this.gaming.hud(i));
  }

  key(e: KeyboardEvent): boolean {
    if (e.key !== 'Escape') return false;
    if (this.net) {
      if (this.ls!.paused.has(this.net.you)) this.net.send({ t: 'pause', on: false });
      else this.pause();
    } else if (this.dialog) this.dialog = null, this.last = performance.now(), setAccepting(this.counter >= 5);
    else this.pause();
    return true;
  }
}

function frame(t: number): void {
  if (screen instanceof GameScreen) screen.render(ctx, t); // drawScene sets the transform and clears
  else {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(viewport.scale, 0, 0, viewport.scale, viewport.offsetX, viewport.offsetY);
    ctx.imageSmoothingEnabled = false;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, GAME_W, GAME_H);
    ctx.clip();
    screen.render(ctx, t);
    ctx.restore();
  }
  requestAnimationFrame(frame);
}

async function boot(): Promise<void> {
  requestAnimationFrame(frame);
  const audio = new AudioOut();
  const assets = await Assets.load();
  initWidgets({
    assets, audio, input: ui.input,
    toCss: (x, y) => {
      const dpr = window.devicePixelRatio || 1;
      return { x: (x * viewport.scale + viewport.offsetX) / dpr, y: (y * viewport.scale + viewport.offsetY) / dpr, scale: viewport.scale / dpr };
    },
  });
  const [levels, poems, history] = await Promise.all([
    assets.levelList(),
    Promise.all(Array.from({ length: 13 }, (_, i) => assets.text(5 + i))), // poems: texts 5-17
    Promise.all([307, 308, 309].map(async id => parseHistoryPage(await assets.text(id)))),
    assets.preloadMenu(audio),
  ]);
  let store: Storage | null = null;
  try {
    store = localStorage;
  } catch { /* storage blocked: settings and highscores last for this session only */ }
  const config = parseConfig(store?.getItem(STORE) ?? null);
  const gains = balanceGains(config.balance);
  audio.setVolumes(gains.music, gains.effects);

  let busy = false; // a second Start while a level is loading would start a second game
  const app: App = {
    assets, audio, config, levels, poems, history,
    save: () => {
      try {
        store?.setItem(STORE, JSON.stringify(config));
      } catch { /* quota or blocked: keep playing */ }
    },
    show,
    screen: () => screen,
    devRound: roundS,
    playNet: net => {
      if (busy) return;
      busy = true;
      ui.showError(null);
      playNet(net).catch(e => { net.close(); show(new MenuScreen(app)); ui.showError(errorText(e)); }).finally(() => { busy = false; });
    },
    play: id => {
      if (busy) return;
      busy = true;
      ui.showError(null);
      play(id).catch(e => { show(new MenuScreen(app, 'lobby')); ui.showError(errorText(e)); }).finally(() => { busy = false; });
    },
    quit: () => {
      audio.stopMusic();
      splash();
    },
  };

  async function play(id: number): Promise<void> {
    assets.releaseImages();
    await assets.preloadLevel(id, audio);
    audio.stopMusic();
    const level = new Level(id, await assets.levelBytes(id), assets.manifest, new MsvcRand(Date.now() >>> 0));
    // single player is always time 150 s (FUN_00413620); multiplayer uses the CGameTypeDlg setup
    const n = config.players;
    const profiles = Array.from({ length: n }, (_, i) => profileOf(n, i));
    useKeysets(profiles.map(p => PROFILE_KEYSET[p]));
    const type = n === 1 ? TIME : config.type;
    const limit = type === TIME && roundS > 0 ? roundS : n === 1 ? 150 : config.limits[type];
    const gaming = new Gaming(level, { players: profiles.map(p => ({ ...config.profiles[p] })), type, limit });
    show(new GameScreen(app, id, level, gaming));
  }

  /** Loads the level first so that `go` starts the game at once (no sealed tick may be missed), then reports ready. */
  async function playNet(net: NetClient): Promise<void> {
    const id = levels[net.setup.level].id;
    assets.releaseImages();
    await assets.preloadLevel(id, audio);
    const bytes = await assets.levelBytes(id);
    const lobby = net.listener;
    net.listener = m => {
      if (m.t !== 'go') return lobby(m);
      audio.stopMusic();
      const level = new Level(id, bytes, assets.manifest, new MsvcRand(m.seed));
      useKeysets(net.mine.map((_, i) => PROFILE_KEYSET[profileOf(config.players, i)]));
      const gaming = new Gaming(level, { players: m.slots.map(({ name, color }) => ({ name, color })), type: m.setup.type, limit: m.setup.limit });
      show(new GameScreen(app, id, level, gaming, net));
    };
    net.send({ t: 'start' });
  }

  const splash = () => show(new SplashScreen(() => {
    audio.unlock().catch(() => {}); // iOS may never settle resume(); must not block
    audio.playMusic(MenuScreen.music());
    show(new MenuScreen(app));
  }));
  splash();
}

boot().catch(e => ui.showError(`Spuštění selhalo: ${errorText(e)}`));
