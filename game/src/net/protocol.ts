/** Network game protocol (JSON over WebSocket), shared by the game and server/. The server relays key edges in
 *  sealed ticks; every client simulates the whole game (input lockstep). No imports: the server runs this file
 *  with Node's type stripping (no enums, no parameter properties). */

export const PROTOCOL = 1;
export const PORT = 8787;
export const TICK_MS = 20; // one net tick = 2 simulation steps
export const STEPS_PER_TICK = 2;
export const DELAY = 4; // ticks a client keeps buffered
export const COUNTDOWN = 250; // ticks of CGameCounter before the round: 4 lights 1 s apart, then the start
export const HASH_EVERY = 50; // ticks between state checksums (1 s)
export const MAX_PLAYERS = 4;
export const CHAT_MAX = 80;
export const CHAT_GAP_MS = 500;
export const NAME_MAX = 12;
export const MAX_ROOMS = 32;
export const DEAD_MS = 5000; // no pong for this long = the machine left

export interface NetPlayer {
  name: string;
  color: number; // 0..7
}

export interface Slot extends NetPlayer {
  machine: number;
}

export interface GameSetup {
  level: number; // index into the level list (the same build everywhere)
  type: number;
  limit: number;
}

/** A key edge of a global player slot. */
export interface NetEdge {
  key: number;
  down: boolean;
  player: number;
}

export type TickEvent = { left: number } | { pause: number; on: boolean };

export interface Tick {
  t: 'tick';
  n: number;
  edges: NetEdge[];
  events: TickEvent[];
}

export type ClientMsg =
  | { t: 'hello'; v: number }
  | { t: 'list' }
  | { t: 'create'; total: number; players: NetPlayer[] }
  | { t: 'join'; id: number; players: NetPlayer[] }
  | { t: 'player'; slot: number; name: string; color: number }
  | { t: 'setup'; setup: GameSetup }
  | { t: 'chat'; slot: number; text: string }
  | { t: 'start' }
  | { t: 'input'; edges: NetEdge[] }
  | { t: 'hash'; n: number; crc: number }
  | { t: 'pause'; on: boolean };

export type Refusal = 'running' | 'full' | 'version' | 'gone' | 'busy';

export type ServerMsg =
  | { t: 'sessions'; list: { id: number; name: string }[] }
  | { t: 'refused'; reason: Refusal }
  | { t: 'waiting'; joined: number; total: number }
  | { t: 'lobby'; slots: Slot[]; host: number; you: number; setup: GameSetup; started: boolean }
  | { t: 'chat'; slot: number; text: string }
  | { t: 'go'; seed: number; setup: GameSetup; slots: Slot[] }
  | Tick
  | { t: 'left' }
  | { t: 'kicked' }
  | { t: 'ended' };
