/** DirectSound pan is in 1/100 dB: ±1500 attenuates the other channel by 15 dB, i.e. an equal-power pan of ±0.775. */
export function stereoPan(pan: number): number {
  return Math.max(-1, Math.min(1, pan / 1500)) * 0.775;
}

/** Capacitor iOS answers media files (mp3, wav) with a plain URLResponse, which fetch reports as status 0. */
export function fetchOk(res: Pick<Response, 'ok' | 'status'>): boolean {
  return res.ok || res.status === 0;
}

export class AudioOut {
  readonly ctx = new AudioContext();
  private readonly music = new Map<number, AudioBuffer>();
  private readonly banks = new Map<number, AudioBuffer[]>();
  private current: AudioBufferSourceNode | null = null;
  private playing = -1;
  private readonly musicGain = this.ctx.createGain();
  private readonly fxGain = this.ctx.createGain();

  constructor() {
    this.musicGain.connect(this.ctx.destination);
    this.fxGain.connect(this.ctx.destination);
  }

  /** CSetupDlg balance as two gains (core/menu balanceGains). */
  setVolumes(music: number, effects: number): void {
    this.musicGain.gain.value = music;
    this.fxGain.gain.value = effects;
  }

  /** Mobile browsers start audio only from a user gesture. */
  unlock(): Promise<void> {
    return this.ctx.resume();
  }

  async loadMusic(id: number, url: string): Promise<void> {
    if (!this.music.has(id)) this.music.set(id, await this.decode(url));
  }

  async loadBank(id: number, urls: string[]): Promise<void> {
    if (!this.banks.has(id)) this.banks.set(id, await Promise.all(urls.map(u => this.decode(u))));
  }

  /** Starts a looping track; the same track already playing keeps playing (menu screens share one). */
  playMusic(id: number): void {
    if (id === this.playing && this.current) return;
    this.stopMusic();
    this.playing = id;
    const buffer = this.music.get(id);
    if (!buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(this.musicGain);
    src.start();
    this.current = src;
  }

  stopMusic(): void {
    this.current?.stop();
    this.current = null;
    this.playing = -1;
  }

  playSound(bankId: number, index: number, pan: number): void {
    const buffer = this.banks.get(bankId)?.[index];
    if (!buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(new StereoPannerNode(this.ctx, { pan: stereoPan(pan) })).connect(this.fxGain);
    src.start();
  }

  /** 16-bit interleaved PCM (a film's sound track) as a buffer. */
  pcmBuffer(pcm: Int16Array, channels: number, rate: number): AudioBuffer {
    const n = Math.floor(pcm.length / channels);
    const b = this.ctx.createBuffer(channels, n, rate);
    for (let c = 0; c < channels; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = pcm[i * channels + c] / 32768;
    }
    return b;
  }

  /** Plays a buffer once at the effects volume; returns its stop. */
  playBuffer(buffer: AudioBuffer): () => void {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.fxGain);
    src.start();
    return () => src.stop();
  }

  private async decode(url: string): Promise<AudioBuffer> {
    const res = await fetch(url);
    if (!fetchOk(res)) throw new Error(`${url}: HTTP ${res.status}`);
    return this.ctx.decodeAudioData(await res.arrayBuffer());
  }
}
