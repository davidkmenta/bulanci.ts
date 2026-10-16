/** Player profile, settings and per-level highscores (the original kept them in the registry value
 *  HKLM\Software\SleepTeam\Bulanci\Config, FUN_00409cd0 / FUN_0040a440; here JSON in localStorage). */

export interface ScoreItem {
  name: string;
  kills: number;
  deaths: number;
}

export interface Profile {
  name: string;
  color: number; // 0..7 (the picker offers 8 of the 10 team colours)
}

export interface Config {
  profiles: Profile[]; // 6 profiles: 0 = 1P, 1-2 = 2P, 3-5 = 3P (FUN_00412640)
  players: number; // CStartGame1: 1..3 humans on this computer
  total: number; // CStartGame1: players in total, 1..4; more than `players` = network game
  type: number; // CGameTypeDlg: 0 hits, 1 time, 2 lives (multiplayer; single player is always time 150 s)
  limits: number[]; // per type: hits, seconds, lives
  balance: number; // CVolume -50..50: music/effects balance
  lastLevel: string; // level name (the original stores the level GUID)
  scores: Record<string, ScoreItem[]>; // CLevelScore chain, keyed by level name
}

export const NAME_MAX = 12; // ponytail: CEdit limit not decoded; 12 fits the ~100 px name box in font 175
export const SCORE_ROWS = 6;
/** FUN_00409b10: the table a level starts with on its first insert. */
export const DEFAULT_SCORES: readonly ScoreItem[] = [
  { name: 'Žezlík', kills: 30, deaths: 10 },
  { name: 'Kapslík', kills: 25, deaths: 10 },
  { name: 'Čmelík', kills: 20, deaths: 10 },
  { name: 'Uhlík', kills: 15, deaths: 10 },
  { name: 'Terčík', kills: 10, deaths: 10 },
  { name: 'Cvalík', kills: 5, deaths: 10 },
];

/** Profile defaults 0x4ae604 (colours) / 0x4ae614 (names); key sets 0x4ae60c are fixed per profile. */
const DEFAULT_PROFILES: readonly Profile[] = [
  { name: 'Bulík', color: 0 }, { name: 'Bulík', color: 0 }, { name: 'Uzlík', color: 2 },
  { name: 'Bulík', color: 0 }, { name: 'Uzlík', color: 2 }, { name: 'Mazlík', color: 4 },
];
export const PROFILE_KEYSET = [0, 1, 3, 1, 2, 3];
/** CGameTypeDlg CNumEdit ranges per type (hits, seconds, lives). */
export const LIMITS: readonly [number, number][] = [[5, 999], [10, 9999], [5, 999]];

/** The profile of local player i when `players` humans play (FUN_00412640: base 0 / 1 / 3). */
export const profileOf = (players: number, i: number) => [0, 0, 1, 3][players] + i;

/** FUN_0040a290 defaults: time, hits 30 / 180 s / lives 30 (the original starts at 3 players; the port at 1). */
export function defaultConfig(): Config {
  return { profiles: DEFAULT_PROFILES.map(p => ({ ...p })), players: 1, total: 1, type: 1, limits: [30, 180, 30], balance: 0, lastLevel: '', scores: {} };
}

const int = (v: unknown, lo: number, hi: number, def: number) =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : def;
const str = (v: unknown, def: string) => (typeof v === 'string' ? v : def);
const isItem = (v: unknown): v is ScoreItem => {
  const i = v as ScoreItem;
  return typeof i?.name === 'string' && Number.isInteger(i.kills) && Number.isInteger(i.deaths);
};

/** Stored JSON may be missing, foreign or hand-edited: anything invalid falls back to the default field. */
export function parseConfig(json: string | null): Config {
  const d = defaultConfig();
  let raw: Partial<Config> & { name?: unknown; color?: unknown };
  try {
    raw = JSON.parse(json ?? '{}') ?? {};
  } catch {
    return d;
  }
  const scores: Record<string, ScoreItem[]> = {};
  if (raw.scores && typeof raw.scores === 'object') {
    for (const [k, v] of Object.entries(raw.scores)) {
      if (Array.isArray(v) && v.every(isItem)) scores[k] = v.slice(0, SCORE_ROWS).map(({ name, kills, deaths }) => ({ name, kills, deaths }));
    }
  }
  const rp: unknown[] = Array.isArray(raw.profiles) ? raw.profiles : [{ name: raw.name, color: raw.color }]; // M3 stored profile 0 flat
  const profiles = d.profiles.map((p, i) => {
    const r = rp[i] as Partial<Profile> | undefined;
    return { name: str(r?.name, p.name).slice(0, NAME_MAX) || p.name, color: int(r?.color, 0, 7, p.color) };
  });
  const limits = LIMITS.map(([lo, hi], i) => int(Array.isArray(raw.limits) ? raw.limits[i] : undefined, lo, hi, d.limits[i]));
  const players = int(raw.players, 1, 3, d.players);
  return {
    profiles,
    players,
    total: int(raw.total, players, 4, players),
    type: int(raw.type, 0, 2, d.type),
    limits,
    balance: int(raw.balance, -50, 50, d.balance),
    lastLevel: str(raw.lastLevel, d.lastLevel),
    scores,
  };
}

/** FUN_00414280: insert player 0's result, sort by kills - deaths descending (comparator 0x408fd0), keep 6.
 *  Returns the new table and the row of the new entry (-1 = it did not make the table). Ties keep the older entry
 *  first (stable sort; the original's tie order is not decoded). */
export function insertScore(table: readonly ScoreItem[] | undefined, item: ScoreItem): { table: ScoreItem[]; row: number } {
  const all = [...(table ?? DEFAULT_SCORES), item];
  all.sort((a, b) => b.kills - b.deaths - (a.kills - a.deaths));
  const row = all.indexOf(item);
  return { table: all.slice(0, SCORE_ROWS), row: row < SCORE_ROWS ? row : -1 };
}

/** "Pořadí" column: equal kills - deaths share a rank (1-based). */
export function scoreRanks(table: readonly ScoreItem[]): number[] {
  const ranks: number[] = [];
  table.forEach((t, i) => {
    ranks.push(i > 0 && t.kills - t.deaths === table[i - 1].kills - table[i - 1].deaths ? ranks[i - 1] : i + 1);
  });
  return ranks;
}

/** Lobby Start (vfunction14 0x40f610): the first name used twice ("Jméno "%s" je již použito."), else null.
 *  ponytail: the original's case rules are not decoded; names differing only in case count as the same. */
export function duplicateName(names: readonly string[]): string | null {
  const seen = new Set<string>();
  for (const n of names) {
    const k = n.trim().toLocaleLowerCase('cs');
    if (seen.has(k)) return n;
    seen.add(k);
  }
  return null;
}

/** CScore (0x411010): places by score descending (stable here; the original qsort is not), pose step +1 on each
 *  strictly lower score, pillar image 0x4ae708[place * 4 + step]. */
export function podium<T extends { score: number }>(results: readonly T[]): (T & { place: number; step: number; pillar: number })[] {
  const sorted = [...results].sort((a, b) => b.score - a.score);
  let step = 0;
  return sorted.map((r, place) => {
    if (place > 0 && r.score < sorted[place - 1].score) step++;
    return { ...r, place, step, pillar: 150 + (place * (place + 1)) / 2 + step };
  });
}

/** Night (FUN_00425400): local hour < 6 or >= 22 switches the menu music and shows the SleepTeam logo. */
export const isNight = (hour: number) => hour < 6 || hour >= 22;

/** CSetupDlg text "Vyvážení: %d%% hudby a %d%% efektů" and the resulting gains (ponytail: FUN_004223e0 not decoded;
 *  the centre plays both at full volume and the slider attenuates the other side). */
export function balanceGains(balance: number): { music: number; effects: number; musicPct: number; effectsPct: number } {
  const musicPct = 50 - balance;
  const effectsPct = 50 + balance;
  return { musicPct, effectsPct, music: Math.min(1, musicPct / 50), effects: Math.min(1, effectsPct / 50) };
}

export type PageItem =
  | { kind: 'text'; x: number; y: number; text: string; font: number; color: number | null }
  | { kind: 'movie'; x: number; y: number; res: number; poster: number; video: number };

/** History pages (CHistoryDlg, kind 2050 scripts 307-309) are straight-line `add(...)` calls, so the extractor's
 *  disassembly is read directly instead of running a second VM: text(x, y, "s", 2, font), optionally wrapped in
 *  set_colors(…, 0, rgb, …), and movie(x, y, still image, poster key, video key) (CMovieView). */
export function parseHistoryPage(asm: string): PageItem[] {
  const items: PageItem[] = [];
  for (const line of asm.split('\n')) {
    const t = /text\((\d+), (\d+), ("(?:[^"\\]|\\.)*"), \d+, res_(\d+)\)(?:, 0, (\d+))?/.exec(line);
    if (t) items.push({ kind: 'text', x: +t[1], y: +t[2], text: JSON.parse(t[3]), font: +t[4], color: t[5] === undefined ? null : +t[5] });
    const m = /movie\((\d+), (\d+), res_(\d+), (\d+), (\d+)\)/.exec(line);
    if (m) items.push({ kind: 'movie', x: +m[1], y: +m[2], res: +m[3], poster: +m[4] & 0xffff, video: +m[5] & 0xffff });
  }
  return items;
}
