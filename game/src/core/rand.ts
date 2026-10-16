/** MSVC CRT rand(): the original game's only source of randomness (seed 1 unless srand is called). */
export class MsvcRand {
  constructor(public state = 1) {} // state is read by Gaming.checksum

  next(): number {
    this.state = (Math.imul(this.state, 214013) + 2531011) >>> 0;
    return (this.state >>> 16) & 0x7fff;
  }
}
