/** Operand grammar: B u8, H u16, I u32, E nested expression; null = variable layout handled in exprEnd. */
export interface OpInfo {
  name: string;
  grammar: string | null;
}

const op = (name: string, grammar: string | null): OpInfo => ({ name, grammar });

/** Base opcodes 0x00..0x2c (table 0x4b0118); must match extract.BASE_OPS. */
export const BASE_OPS: OpInfo[] = [
  op('const', 'I'), op('rand', 'EE'), op('global', 'B'), op('local', 'B'), op('add', 'EE'), op('sub', 'EE'),
  op('mul', 'EE'), op('div', 'EE'), op('clamp', 'EEE'), op('min', 'EE'), op('max', 'EE'), op('set_global', 'BE'),
  op('set_local', 'BE'), op('goto', 'I'), op('call', null), op('argc', ''), op('arg', 'E'), op('return', 'E'),
  op('if_eq_goto', 'EEI'), op('if_lt_goto', 'EEI'), op('if_gt_goto', 'EEI'), op('if_le_goto', 'EEI'),
  op('if_ge_goto', 'EEI'), op('if_ne_goto', 'EEI'), op('switch_goto', null), op('lookup', null), op('strdup', 'E'),
  op('string', null), op('free', 'E'), op('strlen', 'E'), op('char_at', 'EE'), op('shr', 'EE'), op('shl', 'EE'),
  op('and', 'EE'), op('or', 'EE'), op('not', 'E'), op('neg', 'E'), op('mem_stream', 'EE'), op('release', 'E'),
  op('stream_write', 'EEE'), op('stream_read', 'EE'), op('stream_seek', 'EE'), op('stream_set_size', 'EE'),
  op('stream_vf20', 'E'), op('stream_vf1c', 'E'),
];

/** Level opcodes 0x2d..0x66 (CLevelScript, table 0x4af018); must match extract.LEVEL_OPS. */
export const LEVEL_OPS: Record<number, OpInfo> = {
  0x2d: op('new_anim', null), 0x2e: op('new_bitmap', 'EEI'), 0x2f: op('new_obstacle', 'EEEE'),
  0x30: op('set_collision_rect', 'EEEEE'), 0x31: op('set_depth', 'EE'), 0x32: op('spawn_players', ''),
  0x33: op('add', 'E'), 0x34: op('set_layer', 'E'), 0x35: op('set_background', 'I'), 0x36: op('set_audio', 'II'),
  0x37: op('set_solid', 'EE'), 0x38: op('set_slot', 'EE'), 0x39: op('resort', 'E'), 0x3a: op('move_to', 'EEE'),
  0x3b: op('show', 'E'), 0x3c: op('hide', 'E'), 0x3d: op('first_of_3', 'EEE'), 0x3e: op('get_slot', 'E'),
  0x3f: op('anim_play', 'EEE'), 0x40: op('anim_stop', 'E'), 0x41: op('play_sound', 'EE'),
  0x42: op('anim_set_stop_frame', 'EE'), 0x43: op('fire', 'EEEEE'), 0x44: op('timer_add', 'EEE'),
  0x45: op('timer_resume', 'E'), 0x46: op('timer_pause', 'E'), 0x47: op('timer_remove', 'E'),
  0x48: op('timer_set_interval', 'EE'), 0x49: op('add_zone', 'EEEEE'), 0x4a: op('is_master', ''),
  0x4b: op('net_send', 'E'), 0x4c: op('net_set_stream', 'E'), 0x4d: op('net_mode', ''), 0x4e: op('set_opacity', 'EE'),
  0x4f: op('set_alpha_from', 'EI'), 0x50: op('anim_start', 'EE'), 0x51: op('timer_set_value', 'EE'),
  0x52: op('timer_get_value', 'E'), 0x53: op('add_zone_flags', 'EEEEEE'), 0x54: op('teleport', 'E'),
  0x55: op('teleport_to', 'EEEE'), 0x56: op('remove', 'EE'), 0x57: op('anim_is_playing', 'E'),
  0x58: op('anim_set_frame', 'EE'), 0x59: op('new_list', ''), 0x5a: op('list_count', 'E'),
  0x5b: op('list_resize', 'EEE'), 0x5c: op('list_get', 'EE'), 0x5d: op('list_set', 'EEE'),
  0x5e: op('list_remove', 'EEEE'), 0x5f: op('list_insert', 'EEE'), 0x60: op('delete', 'E'), 0x61: op('preload', 'I'),
  0x62: op('fire_ex', 'EEEEEE'), 0x63: op('set_shoot_through', 'EE'), 0x64: op('spawn_extra', ''),
  0x65: op('spawn_bot', 'EEEE'), 0x66: op('new_mine', 'EE'),
};

export function levelOpTable(): OpInfo[] {
  const table = [...BASE_OPS];
  for (const [k, v] of Object.entries(LEVEL_OPS)) table[Number(k)] = v;
  return table;
}

/** Offset just after the expression starting at pc (no evaluation). */
export function exprEnd(code: Uint8Array, pc: number, table: OpInfo[]): number {
  const op = code[pc];
  const info = table[op];
  if (!info) throw new Error(`unknown opcode 0x${op?.toString(16)} at ${pc}`);
  pc += 1;
  switch (op) {
    case 0x0e: { // call: u32 target, u8 argc, argc * E
      const n = code[pc + 4];
      pc += 5;
      for (let i = 0; i < n; i++) pc = exprEnd(code, pc, table);
      return pc;
    }
    case 0x18: case 0x19: { // switch_goto / lookup: E, u8 n, n * (u32, u32)
      pc = exprEnd(code, pc, table);
      return pc + 1 + 8 * code[pc];
    }
    case 0x1b: { // string literal: UTF-16LE up to u16 0
      while (code[pc] | code[pc + 1]) pc += 2;
      return pc + 2;
    }
  }
  if (info.name === 'new_anim') { // E x, E y, u8 flags, u8 n, n * u32 resource keys
    pc = exprEnd(code, exprEnd(code, pc, table), table);
    return pc + 2 + 4 * code[pc + 1];
  }
  for (const t of info.grammar ?? '') {
    if (t === 'E') pc = exprEnd(code, pc, table);
    else pc += { B: 1, H: 2, I: 4 }[t]!;
  }
  return pc;
}
