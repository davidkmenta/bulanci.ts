/// <reference types="vite/client" />
import { ClientMsg, GameSetup, PORT, PROTOCOL, ServerMsg, Slot } from './protocol';

/** The server address from CTcpIpConfig: empty = the default server (VITE_NET_URL, else this host), a bare host gets
 *  the default port, ws:// or wss:// URLs are kept. */
export function serverUrl(addr: string, env = import.meta.env?.VITE_NET_URL as string | undefined, page = globalThis.location): string {
  const a = addr.trim();
  const scheme = page?.protocol === 'https:' ? 'wss' : 'ws';
  if (!a) return env || `${scheme}://${page?.hostname || 'localhost'}:${PORT}`;
  if (/^wss?:\/\//.test(a)) return a;
  return `${scheme}://${/:\d+$/.test(a) ? a : `${a}:${PORT}`}`;
}

const CHAT_ROWS = 50;

/** A connection to the server with the room state the screens show: slots, setup, chat. The current screen
 *  listens through `listener`; the state is updated before it is called. */
export class NetClient {
  slots: Slot[] = [];
  you = -1;
  host = -1;
  setup: GameSetup = { level: 0, type: 1, limit: 180 };
  started = false;
  readonly chat: string[] = [];
  listener: (m: ServerMsg) => void = () => {};
  onClose: () => void = () => {};
  private closing = false;

  private constructor(private readonly ws: WebSocket) {
    ws.onmessage = e => {
      let m: ServerMsg;
      try {
        m = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (m.t === 'lobby') ({ slots: this.slots, you: this.you, host: this.host, setup: this.setup, started: this.started } = m);
      else if (m.t === 'chat') {
        this.chat.push(`${this.slots[m.slot]?.name ?? '?'}: ${m.text}`);
        this.chat.splice(0, this.chat.length - CHAT_ROWS);
      }
      this.listener(m);
    };
    ws.onclose = () => {
      if (!this.closing) this.onClose();
    };
  }

  static connect(url: string): Promise<NetClient> {
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        return reject(e);
      }
      ws.onopen = () => {
        const c = new NetClient(ws);
        c.send({ t: 'hello', v: PROTOCOL });
        resolve(c);
      };
      ws.onerror = () => reject(new Error(url));
    });
  }

  get isHost(): boolean {
    return this.you === this.host;
  }

  /** Global slots of this machine's players, in local order. */
  get mine(): number[] {
    return this.slots.flatMap((s, i) => (s.machine === this.you ? [i] : []));
  }

  send(m: ClientMsg): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  close(): void {
    this.closing = true;
    this.ws.close();
  }
}
