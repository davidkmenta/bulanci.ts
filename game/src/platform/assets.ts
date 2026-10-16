import { Level } from '../core/level';
import { DEFAULT_SOUND_BANK, Manifest, bankSamples, levelIds, metaOf } from '../core/manifest';
import { MsvcRand } from '../core/rand';
import type { AudioOut } from './audio';

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
/** Resources the game core and the HUD use beyond a level's own refs (core report: walk anims, weapons, shots,
 *  items, bonuses, mine, explosion, teleport, deaths, soul; HUD panel, frame, picture, counters, icons, fonts;
 *  sound banks 3 and 4). */
const GAME_RES = [
  ...range(196, 211), ...range(269, 302), 177, 178, 179, 218, 219, 220, 221, 222, 268, 304,
  ...range(23, 26), ...range(49, 52), ...range(79, 82), ...range(109, 112),
  117, 128, 29, 78, 165, 166, 124, 108, ...range(160, 163), ...range(167, 172), 118, 33, 174, 175, 3, 4,
];

/** Menu, lobby, dialogs, countdown, podium and highscore table kept across level switches. */
export const MENU_RES = [
  313, 314, 315, 316, 317, 318, 212, 213, 147, 148, 67, 68, 75, 76, 30, 31, 32, ...range(119, 123), 19, 27, 34, 35, 36,
  149, ...range(150, 159), 164, ...range(180, 195), 303, 305, 306, ...range(54, 66), 69, 77, 116, 174, 175, 176, 329, 330, DEFAULT_SOUND_BANK,
];

export interface Glyph {
  x: number;
  w: number;
}
export interface Font {
  img: HTMLImageElement;
  glyphs: Map<string, Glyph>;
}

/** Font CSV rows: code,"char",x,width,top,bottom (the char field is CSV-quoted and may itself be a comma or quote);
 *  x = -1 is an advance with nothing to draw (the space). */
function parseFont(img: HTMLImageElement, csv: string): Font {
  const glyphs = new Map<string, Glyph>();
  for (const line of csv.split('\n').slice(1)) {
    const m = /^\d+,"((?:[^"]|"")*)",(-?\d+),(\d+),/.exec(line);
    if (m) glyphs.set(m[1].replace(/""/g, '"'), { x: +m[2], w: +m[3] });
  }
  return { img, glyphs };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = url;
  return img.decode().then(() => img, () => { throw new Error(`cannot load ${url}`); });
}

export class Assets {
  readonly images = new Map<number, HTMLImageElement>();
  /** Team colour sheets 1..7, keyed `<res>_c<n>`; colour 0 is the base sheet in `images`. */
  private readonly colored = new Map<string, HTMLImageElement>();
  private readonly loading = new Set<string>();
  private readonly pinned = new Set<number>();
  readonly fonts = new Map<number, Font>();

  private constructor(readonly base: string, readonly manifest: Manifest) {}

  static async load(base = 'data/'): Promise<Assets> {
    const res = await fetch(base + 'manifest.json');
    // a dev server falls back to index.html (HTTP 200) for a missing file, so check the content type too
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) throw new Error(`manifest: HTTP ${res.status} (run npm run assets)`);
    return new Assets(base, await res.json());
  }

  /** Drops the decoded images of the previous level so they do not pile up across level switches. */
  releaseImages(): void {
    for (const id of this.images.keys()) if (!this.pinned.has(id)) this.images.delete(id);
    this.colored.clear();
  }

  /** Loads the menu resources once; releaseImages keeps them. */
  async preloadMenu(audio: AudioOut): Promise<void> {
    MENU_RES.forEach(r => this.pinned.add(r));
    await Promise.all(MENU_RES.map(r => this.preload(r, audio)));
  }

  /** A text resource as extracted (poems .txt, history pages .asm). */
  async text(id: number): Promise<string> {
    const r = metaOf(this.manifest, id);
    const res = await fetch(this.base + r.file);
    if (!res.ok) throw new Error(`text ${id}: HTTP ${res.status}`);
    return res.text();
  }

  /** Loads the team sheets of the colours in play for the loaded resources (the bulanek poses), so a pose first
   *  shown mid-round (shot, hit, death) does not flash the base sheet while its colour sheet loads. */
  async preloadColors(colors: Iterable<number>): Promise<void> {
    const jobs: Promise<HTMLImageElement>[] = [];
    for (const c of new Set(colors)) {
      for (const id of this.images.keys()) {
        const r = this.manifest[String(id)] as { colors?: number; file: string };
        if (!c || !r.colors || c >= r.colors || this.colored.has(`${id}_c${c}`)) continue;
        jobs.push(loadImage(this.base + r.file.replace(/\.png$/, `_c${c}.png`)).then(i => (this.colored.set(`${id}_c${c}`, i), i)));
      }
    }
    await Promise.all(jobs);
  }

  /** The image for (res, team colour). Colour sheets load on first use; until then the base sheet stands in. */
  image(res: number, color = 0): HTMLImageElement | undefined {
    if (color) {
      const key = `${res}_c${color}`;
      const img = this.colored.get(key);
      if (img) return img;
      const r = this.manifest[String(res)] as { colors?: number; file: string } | undefined;
      if (r?.colors && color < r.colors && !this.loading.has(key)) {
        this.loading.add(key);
        loadImage(this.base + r.file.replace(/\.png$/, `_c${color}.png`))
          .then(i => this.colored.set(key, i), () => {})
          .finally(() => this.loading.delete(key));
      }
    }
    return this.images.get(res);
  }

  async levelBytes(id: number): Promise<Uint8Array> {
    const res = await fetch(this.base + metaOf(this.manifest, id).file);
    if (!res.ok) throw new Error(`level ${id}: HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  /** Czech names from script entry 0, in the original order (global 1). */
  async levelList(): Promise<{ id: number; name: string }[]> {
    const list = await Promise.all(levelIds(this.manifest).map(async id => {
      const info = new Level(id, await this.levelBytes(id), this.manifest, new MsvcRand(1)).info(1);
      return { id, name: info.name, order: info.order };
    }));
    return list.sort((a, b) => a.order - b.order).map(({ id, name }) => ({ id, name }));
  }

  /** Loads everything the level's bytecode refers to (refs come from extract.py), so the VM can stay synchronous. */
  async preloadLevel(id: number, audio: AudioOut): Promise<void> {
    const level = metaOf(this.manifest, id) as { refs: number[] };
    await Promise.all([...new Set([...level.refs, DEFAULT_SOUND_BANK, ...GAME_RES])].map(r => this.preload(r, audio)));
  }

  private async preload(id: number, audio: AudioOut): Promise<void> {
    const r = this.manifest[String(id)];
    if (!r) throw new Error(`level refers to unknown resource ${id}`);
    if ((r.kind === 'image' || r.kind === 'anim') && !this.images.has(id)) this.images.set(id, await loadImage(this.base + r.file));
    else if (r.kind === 'fonts' && !this.fonts.has(id)) {
      const csv = await fetch(this.base + r.file.replace(/\.png$/, '.csv')).then(res => res.text());
      this.fonts.set(id, parseFont(await loadImage(this.base + r.file), csv));
    }
    else if (r.kind === 'music') await audio.loadMusic(id, this.base + r.file);
    else if (r.kind === 'soundbank') await audio.loadBank(id, bankSamples(this.manifest, id).map(f => this.base + f));
  }
}
