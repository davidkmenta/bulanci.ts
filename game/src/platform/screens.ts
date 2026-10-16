import { KEYSET_NAMES } from '../core/game/input';
import {
  Config, LIMITS, NAME_MAX, PROFILE_KEYSET, PageItem, ScoreItem, balanceGains, duplicateName, isNight, podium, profileOf, scoreRanks,
} from '../core/menu';
import type { Assets } from './assets';
import type { AudioOut } from './audio';
import type { PlayerResult } from '../core/game/gaming';
import { NetClient, serverUrl } from '../net/client';
import { CHAT_MAX, Refusal, ServerMsg } from '../net/protocol';
import { hex } from './text';
import { TOUCH } from './touch';
import {
  BIG, Button, ColorSet, Dialog, Edit, Icon, ListBox, MenuSwitch, Movie, Radio, SMALL, Screen, Slider, TEXT, TINY, Widget,
  animFrame, centred, drawAnim, drawImage, font, label, sound,
} from './widgets';

/** UI strings from the table at 0x4af9b8 (PTR_PTR_004afbbc), by offset. */
export const S = {
  ok: 'Ok', cancel: 'Zrušit', game: 'Hru:', create: 'Vytvořit', join: 'Připojit se', players: 'Počet hráčů celkem:',
  p1: '1 hráč (trénink)', p2: '2 hráči', p3: '3 hráči', p4: '4 hráči', next: 'Dále', controls: 'Ovládání', gameType: 'Typ hry:',
  levels: 'Levely:', start: 'Start', local: 'Na tomto počítači:', l1: '1 hráč', gameTypeBtn: 'Typ hry',
  types: ['na zásahy', 'na čas', 'na životy'],
  typeDesc: [(n: number) => `Kdo ${n}-krát zasáhne soupeře, vyhrál.`, (n: number) => `Hra končí po ${n} vteřinách.`, (n: number) => `Kdo bude ${n}-krát zabit, skončil.`],
  limitLabel: ['Počet zásahů k výhře:', 'Délka hry ve vteřinách:', 'Počet životů:'],
  nameUsed: (n: string) => `Jméno "${n}" je již použito.`,
  keys: 'Vlevo:\nVpravo:\nNahoru:\nDolu:\nStřílení:\nZměna zbraně:',
  about: '    Cílem projektu Bulánci bylo vytvořit hru, která by ukázala možnosti výroby\na šíření nezávislých her v prostředí internetu. Tato hra je distribuována zcela\nzdarma. Můžete ji libovolně kopírovat, šířit, zasílat přátelům či nabízet ke\nstažení.\n\n    Hra Bulánci Vám také dává možnost vytvořit si své vlastní levely\nprostřednictvím editoru nebo si stáhnout levely jiných hráčů z internetu.\nPodrobné informace o hře, odkazy na klany či oficiální přídavky ke stažení\nnajdete na adrese www.bulanci.cz.\n\n\n    Děkujeme Vám za Vaši přízeň\n\n\n\n                                                       SleepTeam Labs',
  quit: 'Konec hry', paused: 'Hra je pozastavena', resume: 'Pokračuj', setup: 'Nastavení',
  balance: (m: number, e: number) => `Vyvážení: ${m}% hudby a ${e}% efektů`, version: 'Verze: 1.80',
  killed: (n: number) => `Zabil: ${n}x`, died: (n: number) => `Mrtev: ${n}x`,
  table: ['Pořadí', 'Jméno', 'Zabil', 'Mrtev', 'Rozdíl'],
  // network game; noServer, lost, desync are the port's own
  wait: 'Čekám na zbytek hráčů...', connect: 'Připojit', chat: 'Chat:', created: 'Hra je vytvořena, stiskněte Start...',
  address: 'Zadejte název nebo IP adresu počítače.\nNezadá-li se nic, bude se počítač hledat.',
  searchInit: 'Inicializuje se hledání...', searching: 'Hledám hry...',
  someoneLeft: 'Někdo z hráčů opustil hru.',
  refusedRunning: 'Připojení ke hře bylo odmítnuto,\nprotože tato hra již běží.',
  refusedFull: 'Připojení ke hře bylo odmítnuto,\nprotože je na tomto počítači příliš mnoho hráčů.',
  noServer: 'Nepodařilo se připojit k serveru.', lost: 'Spojení se serverem bylo přerušeno.', desync: 'Hra se rozjela.',
};

const REFUSED: Record<Refusal, string> = { running: S.refusedRunning, gone: S.refusedRunning, full: S.refusedFull, version: S.noServer, busy: S.noServer };

export const ROUND_S = 150;
/** Team colours as shown by the CColorSet image 19 (sampled cell centres). */
export const TEAM_RGB = ['#078b00', '#ff5f5f', '#875b3b', '#bf0000', '#f7ef3b', '#bb63bb', '#7b7bbf', '#3b3b3b'];

export interface App {
  assets: Assets;
  audio: AudioOut;
  config: Config;
  levels: { id: number; name: string }[];
  poems: string[];
  history: PageItem[][];
  save(): void;
  show(s: Screen): void;
  screen(): Screen;
  play(levelId: number): void;
  /** Loads the network game's level, reports ready and starts the game on `go`. */
  playNet(net: NetClient): void;
  quit(): void;
  devRound: number; // ?round=<seconds>: a short time round for tests
}

/** Full-screen click/tap target (splash, score). */
class Anywhere extends Widget {
  constructor(private readonly onClick: () => void) {
    super(0, 0, 800, 600);
  }

  draw(): void {}
  click(): void {
    this.onClick();
  }
}

/** CAdvertising/CBlackView splash: JPEG 314 until a tap (which also unlocks audio on phones). */
export class SplashScreen extends Screen {
  constructor(private readonly onDone: () => void) {
    super('splash');
    this.widgets = [new Anywhere(onDone)];
  }

  draw(g: CanvasRenderingContext2D): void {
    drawImage(g, 314, 0, 0);
  }

  key(): boolean {
    this.onDone();
    return true;
  }
}

/** CPoemScroller: poems scroll up through (10,384)-(215,550) in font 175, 0xb0b0b0, with 40 px fades.
 *  ponytail: speed and poem order not decoded; 20 px/s, random poems. */
class PoemScroller {
  private readonly box = document.createElement('canvas');
  private sheet: HTMLCanvasElement | null = null;
  private start = 0;

  constructor(private readonly poems: string[]) {
    this.box.width = 205;
    this.box.height = 166;
  }

  private next(t: number): void {
    const f = font(SMALL);
    if (!f || !this.poems.length) return;
    const text = this.poems[Math.floor(Math.random() * this.poems.length)].replace(/\r/g, '').trim();
    const lh = f.img.naturalHeight;
    const c = document.createElement('canvas');
    c.width = this.box.width;
    c.height = text.split('\n').length * lh;
    label(c.getContext('2d')!, text, 0, 0, SMALL, '#b0b0b0');
    this.sheet = c;
    this.start = t;
  }

  draw(g: CanvasRenderingContext2D, t: number): void {
    if (!this.sheet) this.next(t);
    const s = this.sheet;
    if (!s) return;
    const y = this.box.height - ((t - this.start) * 20) / 1000;
    if (y < -s.height) {
      this.sheet = null;
      return;
    }
    const b = this.box.getContext('2d')!;
    b.globalCompositeOperation = 'source-over';
    b.clearRect(0, 0, this.box.width, this.box.height);
    b.drawImage(s, 0, Math.round(y));
    const fade = b.createLinearGradient(0, 0, 0, this.box.height);
    fade.addColorStop(0, 'rgba(0,0,0,0)');
    fade.addColorStop(40 / 166, 'rgba(0,0,0,1)');
    fade.addColorStop(126 / 166, 'rgba(0,0,0,1)');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    b.globalCompositeOperation = 'destination-in';
    b.fillStyle = fade;
    b.fillRect(0, 0, this.box.width, this.box.height);
    g.drawImage(this.box, 10, 384);
  }
}

type Sub = 'none' | 'start' | 'lobby' | 'history' | 'exit';
const CORNER: Partial<Record<Sub, number>> = { start: 316, history: 318, exit: 317 }; // FUN_00425870

/** CMenu (0x4265e0) with its child windows: CStartGame1, the StartGame2 lobby, CHistoryDlg, CExitDlg. */
export class MenuScreen extends Screen {
  private readonly switches: MenuSwitch[];
  private readonly poem: PoemScroller;
  private readonly scratches = [0, 0, 0, 0];
  private scratchAt = 0;
  private sub: Sub = 'none';
  private page = 0;
  private pageWidgets: Widget[] = [];
  private draws: ((g: CanvasRenderingContext2D, t: number) => void)[] = [];

  private static joining = false; // CStartGame1 "Hru:" Připojit se (not stored)

  constructor(private readonly app: App, sub: Sub = 'none', private net: NetClient | null = null) {
    super(net ? 'netlobby' : 'menu');
    this.poem = new PoemScroller(app.poems);
    this.switches = [
      new MenuSwitch(55, [147, 148], 27, () => this.open('start')),
      new MenuSwitch(139, [67, 68], 24, () => this.open('history')),
      new MenuSwitch(223, [75, 76], 25, () => this.open('exit')),
    ].slice(0, TOUCH ? 2 : 3); // Konec: a phone app is not quit from inside
    this.open(sub);
  }

  /** Menu music by time of day (FUN_00425400/4252f0). */
  static music(): number {
    return isNight(new Date().getHours()) ? 330 : 329;
  }

  private open(sub: Sub): void {
    if (this.net && sub !== 'lobby') {
      this.net.close();
      this.net = null;
    }
    Movie.stop();
    this.sub = sub;
    this.dialog = null;
    this.draws = [];
    this.pageWidgets = [];
    this.onEnter = null;
    this.switches.forEach((s, i) => (s.active = ['start', 'history', 'exit'][i] === (sub === 'lobby' ? 'start' : sub)));
    if (sub === 'start') this.buildStart();
    else if (sub === 'lobby' && this.net) this.buildNetLobby(this.net);
    else if (sub === 'lobby') this.buildLobby();
    else if (sub === 'history') this.buildHistory();
    else if (sub === 'exit') this.buildExit();
    this.widgets = [...this.switches, ...this.pageWidgets];
  }

  /** CStartGame1 (250,60): Vytvořit / Připojit se, players in total (1-4) and on this computer (1-3). Picking the
   *  total also puts all of them on this computer; fewer local players than in total = a network game (FUN_00414dd0).
   *  Joining takes the total from the host. */
  private buildStart(): void {
    const X = 250;
    const Y = 60;
    const c = this.app.config;
    const mode = [S.create, S.join].map((t, i) => new Radio(X + 40, Y + 72 + 22 * i, t, false, () => pickMode(i === 1)));
    const total = [S.p1, S.p2, S.p3, S.p4].map((t, i) => new Radio(X + 40, Y + 157 + 22 * i, t, false, () => pick(i + 1, Math.min(i + 1, 3))));
    const local = [S.l1, S.p2, S.p3].map((t, i) => new Radio(X + 40, Y + 275 + 22 * i, t, false, () => pick(c.total, i + 1)));
    const pick = (tot: number, loc: number) => {
      const join = MenuScreen.joining;
      c.total = tot;
      c.players = TOUCH ? 1 : join ? loc : Math.min(loc, tot); // one set of touch controls: one player per phone
      this.app.save();
      mode.forEach((r, i) => (r.checked = (i === 1) === join));
      total.forEach((r, i) => ((r.checked = !join && i + 1 === c.total), (r.enabled = !join)));
      local.forEach((r, i) => ((r.checked = i + 1 === c.players), (r.enabled = join || (c.total > 1 && i < c.total))));
    };
    const pickMode = (join: boolean) => {
      MenuScreen.joining = join;
      pick(c.total, c.players);
    };
    pickMode(MenuScreen.joining);
    this.pageWidgets = [...mode, ...total, ...(TOUCH ? [] : local), new Button(X + 20, Y + 456, S.next, () => this.next())];
    this.draws = [g => {
      label(g, S.game, X + 30, Y + 45);
      label(g, S.players, X + 30, Y + 130);
      if (!TOUCH && (c.total > 1 || MenuScreen.joining)) label(g, S.local, X + 30, Y + 248);
    }];
  }

  /** Dále: the local lobby, or create / join a network game. */
  private next(): void {
    const c = this.app.config;
    if (MenuScreen.joining) this.dialog = addressDialog(addr => this.connect(addr, net => this.sessions(net)), () => (this.dialog = null));
    else if (c.total > c.players) this.connect('', net => {
      net.send({ t: 'create', total: c.total, players: this.localPlayers() });
      this.waitForLobby(net);
    });
    else this.open('lobby');
  }

  private localPlayers() {
    const c = this.app.config;
    return Array.from({ length: c.players }, (_, i) => ({ ...c.profiles[profileOf(c.players, i)] }));
  }

  private connect(addr: string, then: (net: NetClient) => void): void {
    this.dialog = waitDialog(S.searchInit, null);
    NetClient.connect(serverUrl(addr)).then(net => {
      if (this.app.screen() !== this || this.sub !== 'start') return net.close();
      net.onClose = () => this.fail(net, S.lost);
      then(net);
    }, () => this.fail(null, S.noServer));
  }

  /** A network error: back to CStartGame1 with a message box. */
  private fail(net: NetClient | null, text: string): void {
    net?.close();
    if (this.app.screen() !== this) return;
    this.open('start');
    this.dialog = messageDialog(text, () => (this.dialog = null));
  }

  /** CSessionList: the session names, refreshed every second; Připojit joins the selected one. */
  private sessions(net: NetClient): void {
    let ids: number[] = [];
    let status = S.searchInit;
    let polled = -Infinity;
    const w = 335;
    const h = 244;
    const x = 300;
    const y = (600 - h) / 2;
    const list = new ListBox(x + 20, y + 50, 295, 130, [], -1, () => (join.enabled = true));
    const join = new Button(x + 83, y + 200, S.connect, () => {
      net.send({ t: 'join', id: ids[list.selected], players: this.localPlayers() });
      this.waitForLobby(net);
    });
    join.enabled = false;
    net.listener = m => {
      if (m.t === 'sessions') {
        const id = ids[list.selected];
        ids = m.list.map(s => s.id);
        list.items = m.list.map(s => s.name);
        list.selected = ids.includes(id) ? ids.indexOf(id) : ids.length ? 0 : -1;
        join.enabled = list.selected >= 0;
        status = S.searching;
      } else if (m.t === 'refused') this.fail(net, REFUSED[m.reason]);
    };
    this.dialog = {
      x, y, w, h,
      widgets: [list, join, new Button(x + 173, y + 200, S.cancel, () => { net.close(); this.dialog = null; })],
      draw: (g, t) => {
        if (t - polled >= 1000) (polled = t), net.send({ t: 'list' });
        label(g, status, x + 20, y + 20);
      },
    };
  }

  /** "Čekám na zbytek hráčů..." until the session is full, then the lobby. */
  private waitForLobby(net: NetClient): void {
    this.dialog = waitDialog(S.wait, () => { net.close(); this.dialog = null; });
    net.listener = m => {
      if (m.t === 'lobby') this.app.show(new MenuScreen(this.app, 'lobby', net));
      else if (m.t === 'refused') this.fail(net, REFUSED[m.reason]);
      else if (m.t === 'left') this.fail(net, S.someoneLeft);
    };
  }

  /** StartGame2 lobby (230,50), a column per player at x=34+130i: colour, portrait, name, controls; game type
   *  ("Typ hry" button only with more than one player), levels. */
  private buildLobby(): void {
    const X = 230;
    const Y = 50;
    const c = this.app.config;
    const n = c.players;
    const profiles = Array.from({ length: n }, (_, i) => c.profiles[profileOf(n, i)]);
    const keysets = Array.from({ length: n }, (_, i) => PROFILE_KEYSET[profileOf(n, i)]);
    const heads = profiles.map(() => 180 + Math.floor(Math.random() * 4));
    const levels = this.app.levels;
    let sel = Math.max(0, levels.findIndex(l => l.name === c.lastLevel));
    const close = () => (this.dialog = null);
    const start = () => {
      const dup = duplicateName(profiles.map(p => p.name));
      if (dup !== null) {
        this.dialog = messageDialog(S.nameUsed(dup), close);
        return;
      }
      c.lastLevel = levels[sel].name;
      this.app.save();
      sound(28);
      this.app.play(levels[sel].id);
    };
    const columns = profiles.flatMap((p, i) => {
      const x = X + 34 + 130 * i;
      return [
        new ColorSet(x - 3, Y + 10, p.color, v => { p.color = v; this.app.save(); }),
        new Edit(x - 12, Y + 138, 100, p.name, NAME_MAX, v => { p.name = v.trim() ? v : p.name; this.app.save(); }),
        new Button(x - 3, Y + 170, S.controls, () => (this.dialog = controlsDialog(keysets[i], close))),
      ];
    });
    this.pageWidgets = [
      ...columns,
      ...(n > 1 ? [new Button(X + 31, Y + 208, S.gameTypeBtn, () => (this.dialog = gameTypeDialog(this.app, close)))] : []),
      new Button(X + 400, Y + 210, S.setup, () => (this.dialog = setupDialog(this.app, close))),
      new ListBox(X + 30, Y + 270, 200, 170, levels.map(l => l.name), sel, i => (sel = i)),
      new Button(X + 40, Y + 466, S.start, start),
      new Button(X + 140, Y + 466, S.cancel, () => this.open('none')),
    ];
    this.draws = [(g, t) => {
      profiles.forEach((p, i) => {
        const x = X + 34 + 130 * i;
        drawImage(g, 27, x, Y + 53, 0x80 / 255);
        drawAnim(g, heads[i], animFrame(heads[i], t), x + 10, Y + 68, p.color);
      });
      if (n === 1) label(g, S.gameType, X + 20, Y + 210);
      // single player is always time 150 s (FUN_00413620)
      const type = n === 1 ? 1 : c.type;
      label(g, S.typeDesc[type](n === 1 ? ROUND_S : c.limits[type]), X + 121, Y + 212, SMALL);
      label(g, S.levels, X + 20, Y + 244);
    }];
    this.onEnter = start;
  }

  /** The network lobby (CBulAnim 0x4104f0): a column per slot, only this machine's are editable and sent at once;
   *  the host picks the level and game type, the clients' Start opens after the host's with a blinking
   *  "Hra je vytvořena..."; chat at (240,244). */
  private buildNetLobby(net: NetClient): void {
    const X = 230;
    const Y = 50;
    const c = this.app.config;
    const levels = this.app.levels;
    const mine = net.mine;
    const heads = net.slots.map(() => 180 + Math.floor(Math.random() * 4));
    const close = () => (this.dialog = null);
    let ready = false;
    const sendSetup = () => {
      const type = c.type;
      net.send({ t: 'setup', setup: { level: list.selected, type, limit: type === 1 && this.app.devRound > 0 ? this.app.devRound : c.limits[type] } });
    };
    const colors: ColorSet[] = [];
    const names: Edit[] = [];
    const sendPlayer = (i: number) => net.send({ t: 'player', slot: i, name: names[i].value.trim(), color: colors[i].value });
    const columns = net.slots.flatMap((s, i) => {
      const x = X + 34 + 130 * i;
      const li = mine.indexOf(i);
      const p = li >= 0 ? c.profiles[profileOf(c.players, li)] : null;
      colors[i] = new ColorSet(x - 3, Y + 10, s.color, v => { p!.color = v; this.app.save(); sendPlayer(i); });
      names[i] = new Edit(x - 12, Y + 138, 100, s.name, NAME_MAX, v => { if (v.trim()) { p!.name = v; this.app.save(); sendPlayer(i); } });
      colors[i].enabled = names[i].enabled = p !== null;
      const keys = PROFILE_KEYSET[profileOf(c.players, li)];
      return [colors[i], names[i], ...(p ? [new Button(x - 3, Y + 170, S.controls, () => (this.dialog = controlsDialog(keys, close)))] : [])];
    });
    const list = new ListBox(X + 30, Y + 270, 200, 170, levels.map(l => l.name), net.isHost ? Math.max(0, levels.findIndex(l => l.name === c.lastLevel)) : net.setup.level, () => sendSetup());
    list.enabled = net.isHost;
    const start = () => {
      if (!startBtn.enabled) return;
      const dup = duplicateName(net.slots.map(s => s.name));
      if (dup !== null) {
        this.dialog = messageDialog(S.nameUsed(dup), close);
        return;
      }
      if (net.isHost) c.lastLevel = levels[list.selected].name, this.app.save();
      ready = true;
      sound(28);
      this.dialog = waitDialog(S.wait, null);
      this.app.playNet(net);
    };
    const startBtn = new Button(X + 40, Y + 466, S.start, start);
    const update = () => {
      net.slots.forEach((s, i) => {
        if (mine.includes(i)) return;
        colors[i].value = s.color;
        names[i].value = s.name;
      });
      if (!net.isHost) list.selected = net.setup.level;
      startBtn.enabled = !ready && (net.isHost || net.started);
    };
    update();
    net.listener = m => {
      if (m.t === 'lobby') update();
      else if (m.t === 'left') this.fail(net, S.someoneLeft);
    };
    net.onClose = () => this.fail(net, S.lost);
    if (net.isHost) sendSetup();
    const chat = chatBlock(net, X + 240, Y + 244);
    this.pageWidgets = [
      ...columns,
      ...(net.isHost ? [new Button(X + 31, Y + 208, S.gameTypeBtn, () => (this.dialog = gameTypeDialog(this.app, () => { close(); sendSetup(); })))] : []),
      new Button(X + 400, Y + 210, S.setup, () => (this.dialog = setupDialog(this.app, close))),
      list,
      ...chat.widgets,
      startBtn,
      new Button(X + 140, Y + 466, S.cancel, () => this.open('start')),
    ];
    this.draws = [(g, t) => {
      net.slots.forEach((s, i) => {
        const x = X + 34 + 130 * i;
        drawImage(g, 27, x, Y + 53, 0x80 / 255);
        drawAnim(g, heads[i], animFrame(heads[i], t), x + 10, Y + 68, s.color);
      });
      if (!net.isHost) label(g, S.gameType, X + 20, Y + 210);
      label(g, S.typeDesc[net.setup.type](net.setup.limit), X + 121, Y + 212, SMALL);
      label(g, S.levels, X + 20, Y + 244);
      if (!net.isHost && net.started && !ready && Math.floor(t / 500) % 2 === 0) label(g, S.created, X + 40, Y + 495, SMALL);
      chat.draw(g);
    }];
    this.onEnter = start;
  }

  /** CHistoryDlg (231,36): script pages 307-309, arrows first/prev/next/last at y=480. */
  private buildHistory(): void {
    const X = 231;
    const Y = 36;
    const n = this.app.history.length;
    const go = (p: number) => () => this.historyPage(p);
    this.pageWidgets = [
      new Icon(X + 39, Y + 480, [56, 55, 57], go(0)),
      new Icon(X + 56, Y + 480, [59, 58, 60], () => go(this.page - 1)()),
      new Icon(X + 72, Y + 480, [62, 61, 63], () => go(this.page + 1)()),
      new Icon(X + 91, Y + 480, [65, 64, 66], go(n - 1)),
      ...(this.app.history[this.page] ?? []).flatMap(it => (it.kind === 'movie' ? [new Movie(X + it.x, Y + it.y, it.res, it.poster, it.video)] : [])),
    ];
    this.draws = [g => {
      for (const it of this.app.history[this.page] ?? [])
        if (it.kind === 'text') label(g, it.text, X + it.x, Y + it.y, it.font, it.color === null ? TEXT : hex(it.color));
    }];
  }

  /** Another history page: its own films (CMovieView widgets). */
  private historyPage(p: number): void {
    this.page = Math.max(0, Math.min(this.app.history.length - 1, p));
    this.open('history');
  }

  /** CExitDlg (221,24): web links, the about text and "Konec hry" (here: back to the splash). */
  private buildExit(): void {
    const X = 221;
    const Y = 24;
    this.pageWidgets = [new Button(X + 49, Y + 492, S.quit, () => { sound(26); this.app.quit(); })];
    this.draws = [(g, t) => {
      drawAnim(g, 305, animFrame(305, t), X + 194, Y + 22);
      drawAnim(g, 306, animFrame(306, t), X + 313, Y + 282);
      label(g, S.about, X + 40, Y + 72, SMALL);
    }];
  }

  private onEnter: (() => void) | null = null;

  draw(g: CanvasRenderingContext2D, t: number): void {
    drawImage(g, 315, 0, 0);
    if (isNight(new Date().getHours())) drawImage(g, 313, 610, 0);
    // CRuch: four 1 px film scratches in 0x3f3f3f (ponytail: their motion is not decoded; they jump every 80 ms)
    if (t - this.scratchAt > 80) {
      this.scratchAt = t;
      this.scratches.forEach((_, i) => (this.scratches[i] = Math.random() < 0.5 ? Math.floor(Math.random() * 800) : -1));
    }
    g.fillStyle = '#3f3f3f';
    for (const x of this.scratches) if (x >= 0) g.fillRect(x, 0, 1, 600);
    this.poem.draw(g, t);
    label(g, S.version, 230, 575, TINY, '#808080');
    const corner = CORNER[this.sub];
    if (corner) drawImage(g, corner, 800 - 394, 600 - 261);
    for (const d of this.draws) d(g, t);
  }

  key(e: KeyboardEvent): boolean {
    if (this.dialog) {
      if (e.key === 'Escape') this.dialog = null;
      return true;
    }
    const k = e.key.toLowerCase();
    if (e.key === 'Escape' && this.sub !== 'none') this.open('none');
    else if (e.key === 'Enter' && this.sub === 'lobby') this.onEnter?.();
    else if (e.key === 'Enter' && this.sub === 'start') this.next();
    else if (k === 's' || k === 'h' || k === 'k') this.switches['shk'.indexOf(k)]?.click();
    else if (this.sub === 'history' && e.key === 'ArrowLeft') this.historyPage(this.page - 1);
    else if (this.sub === 'history' && e.key === 'ArrowRight') this.historyPage(this.page + 1);
    else return false;
    return true;
  }
}

/** CSetupDlg (290x140): the music/effects balance (CVolume -50..50), Ok / Zrušit. */
export function setupDialog(app: App, close: () => void): Dialog {
  const w = 290;
  const h = 140;
  const x = (800 - w) / 2;
  const y = (600 - h) / 2;
  const before = app.config.balance;
  const apply = (b: number) => {
    const v = balanceGains(b);
    app.audio.setVolumes(v.music, v.effects);
  };
  const slider = new Slider(x + 25, y + 42, 245, 38, before, b => { app.config.balance = b; apply(b); });
  return {
    x, y, w, h,
    widgets: [
      slider,
      new Button(x + 55, y + h - 50, S.ok, () => { app.save(); close(); }),
      new Button(x + 155, y + h - 50, S.cancel, () => { app.config.balance = before; apply(before); close(); }),
    ],
    draw: g => {
      const v = balanceGains(slider.value);
      label(g, S.balance(v.musicPct, v.effectsPct), x + 25, y + 15);
    },
  };
}

/** CMsgDialog: centred lines and Ok (or another button; none when `close` is null). */
function messageDialog(text: string, close: (() => void) | null, button = S.ok): Dialog {
  const lines = text.split('\n');
  const w = 360;
  const h = 70 + 16 * lines.length;
  const x = (800 - w) / 2;
  const y = (600 - h) / 2;
  return {
    x, y, w, h,
    widgets: close ? [new Button(x + (w - 82) / 2, y + h - 40, button, close)] : [],
    draw: g => lines.forEach((l, i) => centred(g, l, x + w / 2, y + 22 + 16 * i)),
  };
}

/** The wait box ("Čekám na zbytek hráčů...") with Zrušit. */
const waitDialog = (text: string, cancel: (() => void) | null) => messageDialog(text, cancel, S.cancel);

/** CTcpIpConfig (312x160 at x=300): the server address (empty = the default server), Ok / Zrušit. */
function addressDialog(ok: (addr: string) => void, cancel: () => void): Dialog {
  const w = 312;
  const h = 160;
  const x = 300;
  const y = (600 - h) / 2;
  const edit = new Edit(x + 20, y + 70, 272, '', 60, () => {}, () => { edit.blur(); ok(edit.value); });
  return {
    x, y, w, h,
    widgets: [edit, new Button(x + 73, y + 115, S.ok, () => { edit.blur(); ok(edit.value); }), new Button(x + 163, y + 115, S.cancel, () => { edit.blur(); cancel(); })],
    draw: g => label(g, S.address, x + 20, y + 20, SMALL),
  };
}

/** CColorSwitch: which local player speaks; a 7 px cell per player in its colour, the choice framed white. */
class Speaker extends Widget {
  selected = 0;

  constructor(x: number, y: number, private readonly colors: () => number[]) {
    super(x, y, 7 * colors().length + 1, 15);
  }

  draw(g: CanvasRenderingContext2D): void {
    this.colors().forEach((c, i) => {
      g.fillStyle = TEAM_RGB[c];
      g.fillRect(this.x + 1 + 7 * i, this.y + 1, 6, 13);
    });
    g.strokeStyle = '#ffffff';
    g.strokeRect(this.x + 7 * this.selected + 0.5, this.y + 0.5, 7, 14);
  }

  click(px: number): void {
    sound(14);
    this.selected = Math.min(this.colors().length - 1, Math.floor((px - this.x) / 7));
  }
}

/** The chat block (FUN_004102d0) at (X,Y): "Chat:", CChatList (X+10,Y+26)-(X+270,Y+166) with "name: text" rows,
 *  CChatEdit below (Enter sends) and the speaker switch with more local players. */
function chatBlock(net: NetClient, X: number, Y: number): { widgets: Widget[]; draw(g: CanvasRenderingContext2D): void } {
  const mine = net.mine;
  const speaker = mine.length > 1 ? new Speaker(X + 270 - (7 * mine.length + 1), Y + 178, () => mine.map(s => net.slots[s].color)) : null;
  const right = speaker ? speaker.x - 3 : X + 270;
  const edit: Edit = new Edit(X + 10, Y + 174, right - X - 10, '', CHAT_MAX, () => {}, () => {
    if (edit.value.trim()) net.send({ t: 'chat', slot: mine[speaker?.selected ?? 0], text: edit.value });
    edit.value = '';
  });
  const ROW = 15;
  return {
    widgets: [edit, ...(speaker ? [speaker] : [])],
    draw: g => {
      label(g, S.chat, X, Y);
      g.strokeStyle = '#606060';
      g.strokeRect(X + 10.5, Y + 26.5, 259, 139);
      g.save();
      g.beginPath();
      g.rect(X + 12, Y + 28, 256, 136);
      g.clip();
      net.chat.slice(-Math.floor(136 / ROW)).forEach((row, i) => label(g, row, X + 16, Y + 30 + ROW * i, SMALL));
      g.restore();
    },
  };
}

/** CGameTypeDlg (320x218): type radio at (40,45), the selected type's limit edit at (230,115) with its label at
 *  (20,118), Ok (55,168) disabled while the limit is out of range, Zrušit (180,168). The weapon mode stays hidden. */
export function gameTypeDialog(app: App, close: () => void): Dialog {
  const w = 320;
  const h = 218;
  const x = (800 - w) / 2;
  const y = (600 - h) / 2;
  const c = app.config;
  let type = c.type;
  const values = c.limits.map(String);
  const edit = new Edit(x + 230, y + 115, 58, values[type], 4, v => {
    edit.value = v.replace(/\D/g, '').slice(0, String(LIMITS[type][1]).length);
    values[type] = edit.value;
  });
  const valid = () => {
    const v = Number(values[type]);
    return values[type] !== '' && v >= LIMITS[type][0] && v <= LIMITS[type][1];
  };
  const radios = S.types.map((t, i) => new Radio(x + 40, y + 45 + 22 * i, t, i === type, () => {
    edit.blur();
    type = i;
    radios.forEach((r, k) => (r.checked = k === i));
    edit.value = values[i];
  }));
  const ok = new Button(x + 55, y + 168, S.ok, () => {
    if (!valid()) return;
    edit.blur();
    c.type = type;
    c.limits[type] = Number(values[type]);
    app.save();
    close();
  });
  return {
    x, y, w, h,
    widgets: [...radios, edit, ok, new Button(x + 180, y + 168, S.cancel, () => { edit.blur(); close(); })],
    draw: g => {
      ok.enabled = valid();
      label(g, S.gameType, x + 20, y + 20);
      label(g, S.limitLabel[type], x + 20, y + 118, SMALL);
    },
  };
}

/** CKeybShow: the player's key set (read-only) and Ok. */
export function controlsDialog(keyset: number, close: () => void): Dialog {
  const w = 300;
  const h = 170;
  const x = (800 - w) / 2;
  const y = (600 - h) / 2;
  return {
    x, y, w, h,
    widgets: [new Button(x + (w - 82) / 2, y + h - 38, S.ok, close)],
    draw: g => {
      label(g, S.keys, x + 25, y + 15, SMALL);
      label(g, KEYSET_NAMES[keyset], x + 140, y + 15, SMALL, '#ffffff');
    },
  };
}

/** CPauseDlg (306x90): "Hra je pozastavena"; Pokračuj, Nastavení, Konec hry (40 px from the bottom). */
export function pauseDialog(app: App, resume: () => void, end: () => void, setup: () => void, h = 90): Dialog {
  const w = 306;
  const x = (800 - w) / 2;
  const y = (600 - h) / 2;
  return {
    x, y, w, h,
    widgets: [
      new Button(x + 15, y + h - 40, S.resume, resume),
      new Button(x + 112, y + h - 40, S.setup, setup),
      new Button(x + 209, y + h - 40, S.quit, end),
    ],
    draw: g => centred(g, S.paused, x + w / 2, y + 22, BIG),
  };
}

/** CPauseDlg in a network game (306x290): the chat block at (15,40), the buttons at y = 250. */
export function netPauseDialog(app: App, net: NetClient, resume: () => void, end: () => void, setup: () => void): Dialog {
  const d = pauseDialog(app, resume, end, setup, 290);
  const chat = chatBlock(net, d.x + 15, d.y + 40);
  d.widgets.push(...chat.widgets);
  const title = d.draw!;
  d.draw = (g, t) => {
    title.call(d, g, t);
    chat.draw(g);
  };
  return d;
}

/** CScore (0x411010): the podium and, in single player, the level's highscore table. */
export class ScoreScreen extends Screen {
  private readonly places: ReturnType<typeof podium<PlayerResult>>;
  private readonly heads: number[];
  private readonly ranks: number[];

  constructor(private readonly r: { players: PlayerResult[]; table?: ScoreItem[]; row?: number }, private readonly done: () => void) {
    super('score');
    this.widgets = [new Anywhere(done)];
    this.places = podium(r.players);
    // head anim set 0x4ae748 by pose step (180-183 healthy .. 192-195 bandaged), random one of 4; single player
    // outside the top 6 forces step 3 for the head
    this.heads = this.places.map(p => 180 + 4 * (r.table && r.row! < 0 ? 3 : p.step) + Math.floor(Math.random() * 4));
    this.ranks = r.table ? scoreRanks(r.table) : [];
    sound(29);
  }

  draw(g: CanvasRenderingContext2D, t: number): void {
    drawImage(g, 164, 0, 0);
    drawAnim(g, 303, animFrame(303, t, false), 120, 50);
    this.places.forEach((p, i) => {
      // pillar 0x4ae708[place][step] at x = 0x4ae788[place], y = 229; head at (x + 33, 0x4ae798[step])
      const px = [136, 279, 423, 567][p.place];
      const cx = px + 118 / 2;
      drawImage(g, p.pillar, px, 229);
      const hy = 240 + 30 * ((this.heads[i] - 180) >> 2);
      drawAnim(g, this.heads[i], animFrame(this.heads[i], t), px + 33, hy, p.color);
      centred(g, p.name, cx, hy - 19, SMALL, '#ffffff');
      centred(g, S.killed(p.frags), cx, 471);
      centred(g, S.died(p.deaths), cx, 485);
      // victims: glyph 0x1f in the victim's colour and the count, from y = 452 upwards, 14 px apart
      // ponytail: the x of the list (x - 15 / x + 5) is taken from the pillar centre (G)
      let y = 452;
      p.kills.forEach((k, v) => {
        if (!k || v >= this.r.players.length) return;
        label(g, '\x1f', cx - 15, y, SMALL, TEAM_RGB[this.r.players[v].color]);
        label(g, String(k), cx + 5, y, SMALL);
        y -= 14;
      });
    });
    if (!this.r.table) return;

    // highscore grid image 149 at (330,190), alpha 0x80; 5 columns, rows 26 px apart
    drawImage(g, 149, 330, 190, 0x80 / 255);
    const cols = [[3, 49], [57, 150], [158, 217], [222, 281], [286, 345]];
    const cell = (c: number, row: number, s: string, color: string) =>
      centred(g, s, 330 + (cols[c][0] + cols[c][1]) / 2, 190 + 13 + row * 26, SMALL, color);
    S.table.forEach((s, c) => cell(c, 0, s, '#ffffff'));
    this.r.table.forEach((it, i) => {
      const color = i === this.r.row ? '#ffffff' : '#909090';
      [`${this.ranks[i]}.`, it.name, String(it.kills), String(it.deaths), String(it.kills - it.deaths)].forEach((s, c) => cell(c, i + 1, s, color));
    });
  }

  key(e: KeyboardEvent): boolean {
    if (e.key !== 'Escape' && e.key !== 'Enter' && e.key !== ' ') return false;
    this.done();
    return true;
  }
}
