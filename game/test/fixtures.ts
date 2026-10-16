import { readFileSync } from 'node:fs';

const DATA = new URL('../public/data/', import.meta.url);

export const LEVEL_IDS = [319, 320, 321, 322, 323, 324];

export function readAsset(path: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(path, DATA)));
}

export function readText(path: string): string {
  return readFileSync(new URL(path, DATA), 'utf8');
}

export function loadManifest() {
  return JSON.parse(readText('manifest.json'));
}
