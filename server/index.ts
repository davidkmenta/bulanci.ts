import { WebSocketServer } from 'ws';
import { PORT } from '../game/src/net/protocol.ts';
import { Hub } from './hub.ts';

const port = Number(process.env.PORT ?? PORT);
const hub = new Hub(() => performance.now());
const wss = new WebSocketServer({ port, maxPayload: 4096 });

wss.on('connection', ws => {
  const c = hub.connect(m => ws.send(JSON.stringify(m)), () => ws.terminate());
  ws.on('message', data => {
    let m: unknown;
    try {
      m = JSON.parse(String(data));
    } catch {
      return ws.terminate();
    }
    c.message(m);
  });
  ws.on('pong', () => c.alive());
  ws.on('close', () => c.closed());
});
setInterval(() => { for (const ws of wss.clients) ws.ping(); }, 1000); // browsers answer pings even in a background tab
setInterval(() => hub.update(), 4);
console.log(`Bulánci server on ws://0.0.0.0:${port}`);
