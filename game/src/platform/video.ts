/** A history film as the extractor writes it (extract.py video_to_avi): 16-bit PCM and MJPEG, one JPEG per frame. */
export interface Avi {
  usPerFrame: number;
  channels: number;
  rate: number;
  frames: Uint8Array[]; // JPEG files
  pcm: Int16Array; // interleaved
}

/** Walks the RIFF tree: avih (frame time), the audio strf (WAVEFORMAT, 16 bytes; the video one is 40), and the movi
 *  chunks 00dc (a JPEG frame) and 01wb (a PCM block). All four films are 16-bit, so the bit depth is not read. */
export function parseAvi(buf: Uint8Array): Avi {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (p: number) => String.fromCharCode(...buf.subarray(p, p + 4));
  const avi: Avi = { usPerFrame: 0, channels: 1, rate: 22050, frames: [], pcm: new Int16Array() };
  const blocks: Uint8Array[] = [];
  const walk = (p: number, end: number) => {
    while (p + 8 <= end) {
      const t = tag(p);
      const n = v.getUint32(p + 4, true);
      const d = p + 8;
      if (t === 'RIFF' || t === 'LIST') walk(d + 4, d + n);
      else if (t === 'avih') avi.usPerFrame = v.getUint32(d, true);
      else if (t === 'strf' && n === 16) (avi.channels = v.getUint16(d + 2, true)), (avi.rate = v.getUint32(d + 4, true));
      else if (t === '00dc') avi.frames.push(buf.subarray(d, d + n));
      else if (t === '01wb') blocks.push(buf.subarray(d, d + n));
      p = d + n + (n & 1);
    }
  };
  walk(0, buf.length);
  const bytes = new Uint8Array(blocks.reduce((s, b) => s + b.length, 0));
  blocks.reduce((at, b) => (bytes.set(b, at), at + b.length), 0);
  avi.pcm = new Int16Array(bytes.buffer, 0, bytes.length >> 1);
  return avi;
}
