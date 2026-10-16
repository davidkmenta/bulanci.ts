import type { AnimMeta } from './scene/anim';

interface Base {
  file: string;
  files: string[];
}

export type ResourceMeta = Base & (
  | { kind: 'image'; width: number; height: number }
  | { kind: 'anim'; width: number; height: number; frames: number; duration_ms: number; events: Record<string, number> }
  | { kind: 'music' }
  | { kind: 'soundbank'; bank: number }
  | { kind: 'wavbank'; samples: string[] }
  | { kind: 'level'; refs: number[] }
  | { kind: string }
);

export type Manifest = Record<string, ResourceMeta>;

/** Default sound bank of the app (g_app +0x4c0 = resource 0x10004 -> wav bank 338). */
export const DEFAULT_SOUND_BANK = 4;

export function metaOf(m: Manifest, id: number): ResourceMeta {
  const r = m[String(id)];
  if (!r) throw new Error(`unknown resource ${id}`);
  return r;
}

export function imageSize(m: Manifest, id: number): { width: number; height: number } {
  const r = metaOf(m, id);
  if (r.kind !== 'image' && r.kind !== 'anim') throw new Error(`resource ${id} is ${r.kind}, not an image`);
  const { width, height } = r as { width: number; height: number };
  return { width, height };
}

export function animMeta(m: Manifest, id: number): AnimMeta {
  const r = metaOf(m, id) as ResourceMeta & { kind: 'anim'; width: number; height: number; frames: number; duration_ms: number; events: Record<string, number> };
  if (r.kind !== 'anim') throw new Error(`resource ${id} is ${r.kind}, not an animation`);
  const events = Object.fromEntries(Object.entries(r.events).map(([k, v]) => [Number(k), v]));
  return { width: r.width, height: r.height, frames: r.frames, durationMs: r.duration_ms, events };
}

/** Per-frame chunk-10 offsets (frames + 1 entries, the last = ring frame) and chunk-11 points [[id, x, y], ...]. */
export function animFrameData(m: Manifest, id: number): { offsets?: [number, number][]; points?: [number, number, number][][] } {
  const r = metaOf(m, id) as ResourceMeta & { offsets?: [number, number][]; points?: [number, number, number][][] };
  return { offsets: r.offsets, points: r.points };
}

export function bankSamples(m: Manifest, bankRes: number): string[] {
  const info = metaOf(m, bankRes) as ResourceMeta & { bank: number };
  const wav = metaOf(m, info.bank) as ResourceMeta & { samples: string[] };
  return wav.samples;
}

/** Sample length in ms (sound-end events: CBulanek message 1). */
export function sampleMs(m: Manifest, bankRes: number, index: number): number {
  const info = metaOf(m, bankRes) as ResourceMeta & { bank: number };
  return (metaOf(m, info.bank) as ResourceMeta & { durations_ms: number[] }).durations_ms[index] ?? 0;
}

export function levelIds(m: Manifest): number[] {
  return Object.entries(m).filter(([, r]) => r.kind === 'level').map(([k]) => Number(k)).sort((a, b) => a - b);
}
