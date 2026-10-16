/** Player keys; the values are the original action codes (0-3 = directions L, R, U, D as in FUN_004174a0). */
export enum Key {
  Left,
  Right,
  Up,
  Down,
  Fire,
  Switch,
}

/** A key press (down) or release edge from CDirectKeyb; Gaming.step routes it to the player's bulanek
 *  (FUN_004174a0 filter, FUN_00420910 action). */
export interface KeyEdge {
  key: Key;
  down: boolean;
  player?: number; // slot of the local player (default 0)
}

/** Key sets 0x4ae5ec (DIK scancodes as KeyboardEvent.code), order Left, Right, Up, Down, Fire, Switch, and their
 *  names for CKeybShow. */
export const KEYSETS: readonly (readonly string[])[] = [
  ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyC'],
  ['KeyS', 'KeyF', 'KeyE', 'KeyD', 'KeyA', 'KeyQ'],
  ['KeyJ', 'KeyL', 'KeyI', 'KeyK', 'KeyM', 'KeyN'],
  ['Numpad4', 'Numpad6', 'Numpad8', 'Numpad5', 'Numpad0', 'Numpad1'],
];
export const KEYSET_NAMES: readonly string[] = [
  'šipka vlevo\nšipka vpravo\nšipka nahoru\nšipka dolů\nmezerník\nC',
  'S\nF\nE\nD\nA\nQ',
  'J\nL\nI\nK\nM\nN',
  'num 4\nnum 6\nnum 8\nnum 5\nnum 0\nnum 1',
];
