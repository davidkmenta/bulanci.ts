import { describe, expect, it } from 'vitest';
import { parseAvi } from '../src/platform/video';
import { readAsset } from './fixtures';

describe('parseAvi', () => {
  it('reads the frames, frame time and sound of a history film', () => {
    const a = parseAvi(readAsset('videos/12291.avi'));
    expect([a.frames.length, a.usPerFrame, a.channels, a.rate]).toEqual([149, 83328, 2, 44100]);
    expect(a.frames.every(f => f[0] === 0xff && f[1] === 0xd8)).toBe(true); // JPEG SOI
    // the sound track lasts as long as the picture (within a frame)
    const s = a.pcm.length / a.channels / a.rate;
    expect(Math.abs(s - (a.frames.length * a.usPerFrame) / 1e6)).toBeLessThan(a.usPerFrame / 1e6);
  });

  it('a mono film', () => {
    const a = parseAvi(readAsset('videos/12295.avi'));
    expect([a.frames.length, a.channels, a.rate]).toEqual([396, 1, 22050]);
  });
});
