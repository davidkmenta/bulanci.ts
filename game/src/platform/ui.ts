import { buttonSprite, caption, Pal } from './touch';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}) =>
  Object.assign(document.createElement(tag), props);

/** DOM overlay: errors, the touch pause button, the debug panel and the hidden text field behind canvas Edits. */
export class Ui {
  private readonly root = document.getElementById('ui')!;
  private readonly debug = document.getElementById('debug') as HTMLPreElement;
  readonly input: HTMLInputElement = document.createElement('input');

  constructor() {
    Object.assign(this.input, { id: 'edit', type: 'text', hidden: true, autocomplete: 'off' });
    document.body.append(this.input);
  }

  /** An error over the menu (null clears it). */
  showError(text: string | null): void {
    this.root.className = text ? 'error' : '';
    this.root.replaceChildren(...(text ? [el('p', { textContent: text })] : []));
  }

  /** The in-game "Pauza" button for touch screens (no Esc key), a pixel push button like the touch controls; null
   *  removes it. */
  showPause(onClick: (() => void) | null): void {
    this.root.className = onClick ? 'hud' : '';
    this.root.replaceChildren(...(onClick ? [pauseButton(onClick)] : []));
  }

  get pauseShown(): boolean {
    return this.root.className === 'hud';
  }

  toggleDebug(): void {
    this.debug.hidden = !this.debug.hidden;
  }

  setDebug(lines: string[]): void {
    if (!this.debug.hidden) this.debug.textContent = lines.join('\n');
  }
}

const GREY: Pal = { hi: '#f4f4f8', c: '#b8b8c4', lo: '#6a6a78' };

function pauseButton(onClick: () => void): HTMLElement {
  const c = el('div', { id: 'pause', className: 'ctl' });
  const b = el('div', { className: 'btn' });
  for (const down of [false, true]) {
    const s = buttonSprite(GREY, down);
    const g = s.getContext('2d')!;
    g.fillStyle = '#000';
    g.fillRect(11, 11, 4, 10); // the pause sign, two bars
    g.fillRect(17, 11, 4, 10);
    s.className = down ? 'down' : 'up';
    b.append(s);
  }
  const cap = caption('PAUZA');
  cap.className = 'cap';
  c.append(b, cap);
  c.addEventListener('pointerdown', () => c.classList.add('on'));
  c.addEventListener('pointerleave', () => c.classList.remove('on'));
  c.addEventListener('pointerup', () => {
    if (c.classList.contains('on')) onClick();
    c.classList.remove('on');
  });
  return c;
}
