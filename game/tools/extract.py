#!/usr/bin/env python3
"""Extract game assets from bulanci.exe (2006, MSVC 2005, custom "CDS" engine).

Layout (reverse engineered from the loader at 0x4356e0):
  exe overlay (right after PE sections):
    "GZIP" | u64 index_offset (relative to overlay start)
    chunks of 32 KiB each, zlib-compressed, or stored raw when compression did not help
    at index_offset: u64 unpacked_size | u32 index_len | zlib(u64 chunk_offsets[])
  unpacked stream = resource archive:
    u32 count | u32 ? | count * (u32 'Z', u16 id, u16 group (=1), u32 kind, u32 offset, u32 0, u32 size)
    resource data at 8 + count*24 + offset: u32 kind | payload (size bytes)
    code and scripts refer to resources by key = group << 16 | id (0x10035 = resource 53)

Usage: python3 extract.py [bulanci.exe] [out_dir]
"""
import json
import os
import struct
import sys
import zlib

KIND_JPEG, KIND_IMAGE, KIND_WAVBANK, KIND_MP3, KIND_ANIM, KIND_FONT = 21, 28, 43, 48, 52, 54
KIND_FILE, KIND_BANKINFO, KIND_VIDEO, KIND_LEVEL, KIND_TEXT, KIND_RICHTEXT = 58, 67, 76, 2026, 2043, 2050
KIND_NAMES = {KIND_JPEG: 'jpeg', KIND_IMAGE: 'images', KIND_WAVBANK: 'sounds', KIND_MP3: 'music',
              KIND_ANIM: 'anims', KIND_FONT: 'fonts', KIND_FILE: 'files', KIND_BANKINFO: 'soundbanks',
              KIND_VIDEO: 'videos', KIND_LEVEL: 'levels', KIND_TEXT: 'texts', KIND_RICHTEXT: 'texts'}


def unpack_overlay(exe):
    e_lfanew, = struct.unpack_from('<I', exe, 0x3c)
    nsec, = struct.unpack_from('<H', exe, e_lfanew + 6)
    opt_size, = struct.unpack_from('<H', exe, e_lfanew + 20)
    sec = e_lfanew + 24 + opt_size
    base = max(sum(struct.unpack_from('<II', exe, sec + i * 40 + 16)) for i in range(nsec))
    assert exe[base:base + 4] == b'GZIP', 'overlay not found'
    idx_off, = struct.unpack_from('<Q', exe, base + 4)
    size, idx_len = struct.unpack_from('<QI', exe, base + idx_off)
    idx = zlib.decompress(exe[base + idx_off + 12:base + idx_off + 12 + idx_len])
    offs = struct.unpack('<%dQ' % (len(idx) // 8), idx)
    out = bytearray()
    for a, b in zip(offs, offs[1:]):
        chunk = exe[base + a:base + b]
        # ponytail: a chunk exactly as long as the expected output is a stored one
        out += chunk if len(chunk) == min(32768, size - len(out)) else zlib.decompress(chunk)
        if len(out) >= size:
            break
    assert len(out) == size
    return bytes(out)


def resources(arc):
    n, = struct.unpack_from('<I', arc, 0)
    data = 8 + n * 24
    for i in range(n):
        _, rid, _, kind, off, _, size = struct.unpack_from('<IHHIIII', arc, 8 + i * 24)
        assert struct.unpack_from('<I', arc, data + off)[0] == kind
        yield rid, kind, arc[data + off + 4:data + off + 4 + size]


def png(w, h, rgba):
    def chunk(t, b):
        return struct.pack('>I', len(b)) + t + b + struct.pack('>I', zlib.crc32(t + b))
    rows = b''.join(b'\0' + rgba[y * w * 4:(y + 1) * w * 4] for y in range(h))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(rows, 6)) + chunk(b'IEND', b''))


def decode_image(d, app_palette=None):
    """CDS bitmap: w, h, fmt(0..3 = 1/2/4/8 bpp paletted, 5 = 24bpp BGR), pitch, colorkey,
    u8 ?, u32 palette_len, u8 has_alpha | BGRx palette | pixels | optional 8-bit alpha plane.
    An 8 bpp image without a palette uses the app palette (team ramp, e.g. the HUD picture 29) when given."""
    w, h, fmt, pitch, key = struct.unpack_from('<IIIII', d)
    pal_len, has_alpha = struct.unpack_from('<IB', d, 21)
    bpp = {0: 1, 1: 2, 2: 4, 3: 8, 5: 24}[fmt]
    p = 26
    if bpp <= 8:
        pal = [d[p + i * 4:p + i * 4 + 3][::-1] for i in range(pal_len)] or \
              (bpp == 8 and app_palette and [bytes(e[:3][::-1]) for e in app_palette]) or \
              [bytes([v * 255 // ((1 << bpp) - 1)] * 3) for v in range(1 << bpp)]  # no palette: grey
        pal += [b'\0\0\0'] * (256 - len(pal))
        p += pal_len * 4
    pix = d[p:p + pitch * h]
    p += pitch * h
    alpha = d[p:p + w * h] if has_alpha else None
    assert p + (w * h if has_alpha else 0) == len(d)
    out = bytearray()
    mask = (1 << bpp) - 1 if bpp <= 8 else 0
    for y in range(h):
        row = pix[y * pitch:(y + 1) * pitch]
        for x in range(w):
            if bpp == 24:
                rgb = row[x * 3:x * 3 + 3][::-1]
                transparent = key != 0xffffffff and rgb == struct.pack('<I', key)[:3][::-1]
            else:
                bit = x * bpp
                i = (row[bit >> 3] >> (8 - bpp - (bit & 7))) & mask
                rgb, transparent = pal[i], i == key
            a = 0 if transparent else alpha[y * w + x] if alpha else 255  # the key wins over the alpha plane (94, 95)
            out += rgb + bytes([a])
    return png(w, h, bytes(out))


def wav(pcm, channels, bits, rate):
    block = channels * bits // 8
    return (b'RIFF' + struct.pack('<I', 36 + len(pcm)) + b'WAVEfmt '
            + struct.pack('<IHHIIHH', 16, 1, channels, rate, rate * block, block, bits)
            + b'data' + struct.pack('<I', len(pcm)) + pcm)


def video_to_avi(d):
    """CDS video: u32 size, u32 w, u32 h, u32 ?, u32 duration_ms, u32 frames, u32 audio_bytes,
    u16 ch, u16 bits, u32 rate, then per frame: u32 len + JPEG, u32 len + PCM."""
    _, w, h, _, dur, nfr, _, ch, bits, rate = struct.unpack_from('<7IHHI', d)
    p, chunks = 36, []
    while p < len(d):
        ln, = struct.unpack_from('<I', d, p)
        chunks.append((b'00dc' if d[p + 4:p + 6] == b'\xff\xd8' else b'01wb', d[p + 4:p + 4 + ln]))
        p += 4 + ln
    us = dur * 1000 // nfr
    block = ch * bits // 8

    def ck(tag, data):
        return tag + struct.pack('<I', len(data)) + data + (b'\0' if len(data) & 1 else b'')

    def lst(tag, data):
        return ck(b'LIST', tag + data)

    vids = lst(b'strl', ck(b'strh', b'vidsMJPG' + struct.pack('<IHHIIIIIIIIhhhh', 0, 0, 0, 0, us, 1000000, 0, nfr,
                                                               0, 0xffffffff, 0, 0, 0, w, h))
               + ck(b'strf', struct.pack('<IiiHH4sIiiII', 40, w, h, 1, 24, b'MJPG', w * h * 3, 0, 0, 0, 0)))
    auds = lst(b'strl', ck(b'strh', b'auds\0\0\0\0' + struct.pack('<IHHIIIIIIIIhhhh', 0, 0, 0, 0, block, rate * block,
                                                                  0, 0, 0, 0xffffffff, block, 0, 0, 0, 0))
               + ck(b'strf', struct.pack('<HHIIHH', 1, ch, rate, rate * block, block, bits)))
    avih = ck(b'avih', struct.pack('<10I4I', us, 0, 0, 0x10, nfr, 0, 2, 0, w, h, 0, 0, 0, 0))
    movi, idx, pos = b'', b'', 4
    for tag, data in chunks:
        idx += tag + struct.pack('<III', 0x10, pos, len(data))
        c = ck(tag, data)
        movi += c
        pos += len(c)
    body = b'AVI ' + lst(b'hdrl', avih + vids + auds) + lst(b'movi', movi) + ck(b'idx1', idx)
    return b'RIFF' + struct.pack('<I', len(body)) + body


def font(d):
    """CDS font: CDS bitmap glyph strip, u32 max_width, u32 height,
    256 * (u16 x, u8 width, u8 top, u8 bottom) indexed by cp1250 code. A zero-width glyph advances by
    max_width / 4 (FUN_00437330); the CSV lists only the space that way, as x = -1 (nothing to draw)."""
    w, h, _, pitch = struct.unpack_from('<IIII', d)
    pal_len, has_alpha = struct.unpack_from('<IB', d, 21)
    end = 26 + pal_len * 4 + pitch * h + (w * h if has_alpha else 0)
    lines = ['code,char,x,width,top,bottom']
    max_width, = struct.unpack_from('<I', d, end)
    for i in range(256):
        x, wd, top, bottom = struct.unpack_from('<HBBB', d, end + 8 + i * 5)
        if wd:
            lines.append('%d,"%s",%d,%d,%d,%d' % (i, bytes([i]).decode('cp1250', 'replace').replace('"', '""'),
                                                  x, wd, top, bottom))
        elif i == 0x20:
            lines.append('32," ",-1,%d,0,0' % (max_width // 4))
    return decode_image(d[:end]), '\n'.join(lines).encode()


def rle_runs(src, dst):
    """Chunk 0/14 (FUN_00432740): n>0 -> n+1 x next byte, n==0 -> u16 count, then count+1 x next byte,
    n<0 -> -n literal bytes."""
    i = pos = 0
    while i < len(src):
        n = src[i]
        if n >= 0x80:
            cnt = 256 - n
            dst[pos:pos + cnt] = src[i + 1:i + 1 + cnt]
            i, pos = i + 1 + cnt, pos + cnt
        else:
            if n == 0:
                n, = struct.unpack_from('<H', src, i + 1)
                i += 2
            dst[pos:pos + n + 1] = bytes([src[i + 1]]) * (n + 1)
            i, pos = i + 2, pos + n + 1


def delta_runs(src, dst):
    """Chunk 4/15 (FUN_00432780): skip (u8, 0xff -> u16), then op: 0 -> another skip,
    1..127 -> n+1 x next byte, 0x80 -> s16 (>=0 run of n+1, <0 -n literals), other <0 -> -n literals."""
    i = pos = 0
    while i < len(src):
        skip = src[i]
        i += 1
        if skip == 0xff:
            skip, = struct.unpack_from('<H', src, i)
            i += 2
        pos += skip
        n = src[i]
        i += 1
        if n == 0:
            continue
        if n == 0x80:
            n, = struct.unpack_from('<h', src, i)
            i += 2
            if n >= 0:
                dst[pos:pos + n + 1] = bytes([src[i]]) * (n + 1)
                i, pos = i + 1, pos + n + 1
                continue
            n = -n
        elif n > 0x80:
            n = 256 - n
        else:
            dst[pos:pos + n + 1] = bytes([src[i]]) * (n + 1)
            i, pos = i + 1, pos + n + 1
            continue
        dst[pos:pos + n] = src[i:i + n]
        i, pos = i + n, pos + n


TEAM_COLORS = 0xaef24  # u32 0x00RRGGBB * 10, file offset of DAT_004aef24 (CColorSet colors)
BASE_PALETTE = 0xaeb20  # 256 * BGRx, file offset of DAT_004aeb20


def team_palette(exe, color_index=0):
    """FUN_00413220: base palette + team colour ramp, 112..126 white -> colour, 127 colour, 128..151 colour -> black."""
    pal = [bytearray(exe[BASE_PALETTE + i * 4:BASE_PALETTE + i * 4 + 4]) for i in range(256)]
    color, = struct.unpack_from('<I', exe, TEAM_COLORS + color_index * 4)
    bgr = [color & 0xff, color >> 8 & 0xff, color >> 16 & 0xff]
    for i in range(15):
        pal[0x70 + i][:3] = bytes((255 - c) * (15 - i) // 15 + c for c in bgr)
    pal[0x7f][:3] = bytes(bgr)
    for k in range(1, 25):
        pal[0x7f + k][:3] = bytes(c - c * k // 24 for c in bgr)
    return pal


def anim(d, palettes):
    """CDS FLX animation (CDSFlxFile::vfunction8 at 0x432c60).
    Header: u32 size, u32 max_frame, u32 first_frame, u32 colorkey, u32 w, u32 h, u32 fmt (3 = 8bpp),
            u32 duration_ms, u32 frames.
    Frame:  u32 size, u8 chunk_count, chunks: u32 size, u8 type, data. Buffers persist between frames.
    Like FLC, one extra "ring" frame follows the last one (delta back to frame 0, for looping); its image is
    dropped but its info (the walk offset) is kept as info['ring'].
    Anims without palette chunks are the team-coloured bulanci: one sheet per palette in `palettes`
    (otherwise only the first palette is used). Returns ([png, ...], info)."""
    _, _, _, key, w, h, fmt, duration, nfr = struct.unpack_from('<9I', d)
    assert fmt == 3
    pix, alpha = bytearray(w * h), None
    pal = [bytearray(e) for e in palettes[0]]
    frames, meta, p, opacity, team = [], [], 36, 255, True
    while p < len(d):
        fsize, nch = struct.unpack_from('<IB', d, p)
        c, info = p + 5, {}
        for _ in range(nch):
            csize, t = struct.unpack_from('<IB', d, c)
            data = d[c + 5:c + csize]
            if t == 0:
                rle_runs(data, pix)
            elif t == 4:
                delta_runs(data, pix)
            elif t == 8:
                pix[:len(data)] = data
            elif t == 9:  # palette update: (u8 skip, u8 count-1, count * BGR)
                team = False
                i = e = 0
                while i < len(data):
                    e += data[i]
                    for k in range(data[i + 1] + 1):
                        pal[e][:3] = data[i + 2 + k * 3:i + 5 + k * 3]
                        e += 1
                    i += 2 + (data[i + 1] + 1) * 3
            elif t == 10:
                info['offset'] = struct.unpack_from('<hh', data)
            elif t == 11:  # attachment points: (u8 id, s16 x, s16 y) * n
                info['points'] = [struct.unpack_from('<Bhh', data, i) for i in range(0, len(data), 5)]
            elif t == 12:
                info['event'], = struct.unpack_from('<H', data)
            elif t == 13:  # global opacity (CDSImage +0x18, 255 = opaque)
                opacity = info['opacity'] = data[0]
            elif t in (14, 15):
                alpha = alpha or bytearray(w * h)
                (rle_runs if t == 14 else delta_runs)(data, alpha)
            c += csize
        assert len(pix) == w * h and (alpha is None or len(alpha) == w * h)
        frames.append((bytes(pix), bytes(alpha) if alpha else None, opacity, [bytes(e) for e in pal]))
        meta.append(info)
        p += fsize
    assert len(frames) == nfr + 1 and frames[-1][:2] == frames[0][:2]
    ring, frames, meta = meta[nfr], frames[:nfr], meta[:nfr]
    # grid sheet, at most 4096 px wide (single rows of 25-29k px exceed the 16384 px texture limit of phone GPUs)
    cols = max(1, min(nfr, 4096 // w))
    rows = -(-nfr // cols)
    blank = bytes(w * 4)
    sheets = []
    for palette in (palettes if team else [None]):
        rgba = []
        for fp, fa, op, fpal in frames:
            lut = [bytes(e[2::-1]) for e in (palette or fpal)]
            out = bytearray()
            for i, v in enumerate(fp):
                a = 0 if v == key else (fa[i] if fa else 255) * op // 255  # alpha softens (shadows = 95)
                out += lut[v] + bytes([a])
            rgba.append(bytes(out))
        sheets.append(png(w * cols, h * rows, b''.join(
            b''.join(rgba[r * cols + c][y * w * 4:(y + 1) * w * 4] if r * cols + c < nfr else blank
                     for c in range(cols)) for r in range(rows) for y in range(h))))
    info = {'width': w, 'height': h, 'frames': nfr, 'cols': cols, 'duration_ms': duration, 'frame_info': meta,
            'ring': ring, 'team': team}
    return sheets, info


# CDSScript bytecode: a program is a sequence of expression trees, op byte + operands.
# Operand kinds: B u8, H u16, I u32, E nested expression. Handlers: decompiled/_script_ops.c.
# Base ops 0x00..0x2c (table 0x4b0118), then per script class 0x2d.. (level 0x4af018, help 0x4af2fc,
# history 0x4af7ac). Operand counts are checked against the machine code (tools/check_script_grammar.py).
BASE_OPS = [
    ('const', 'I'), ('rand', 'EE'), ('global', 'B'), ('local', 'B'), ('add', 'EE'), ('sub', 'EE'),
    ('mul', 'EE'), ('div', 'EE'), ('clamp', 'EEE'), ('min', 'EE'), ('max', 'EE'), ('set_global', 'BE'),
    ('set_local', 'BE'), ('goto', 'I'), ('call', None), ('argc', ''), ('arg', 'E'), ('return', 'E'),
    ('if_eq_goto', 'EEI'), ('if_lt_goto', 'EEI'), ('if_gt_goto', 'EEI'), ('if_le_goto', 'EEI'),
    ('if_ge_goto', 'EEI'), ('if_ne_goto', 'EEI'), ('switch_goto', None), ('lookup', None), ('strdup', 'E'),
    ('string', None), ('free', 'E'), ('strlen', 'E'), ('char_at', 'EE'), ('shr', 'EE'), ('shl', 'EE'),
    ('and', 'EE'), ('or', 'EE'), ('not', 'E'), ('neg', 'E'), ('mem_stream', 'EE'), ('release', 'E'),
    ('stream_write', 'EEE'), ('stream_read', 'EE'), ('stream_seek', 'EE'), ('stream_set_size', 'EE'),
    ('stream_vf20', 'E'), ('stream_vf1c', 'E'),
]
# Level opcodes (CLevelScript). "scene" = CGaming (script +0x458), objects live in its display list.
# Slots: scene keeps 128 named object slots (players are slots 0..n, extra bulanci 0x20..0x27).
LEVEL_OPS = {
    0x2d: ('new_anim', None),                 # x, y, u8 play flags, u8 n, n * res: CAnim with n sequences
    0x2e: ('new_bitmap', 'EEI'),              # x, y, res
    0x2f: ('new_obstacle', 'EEEE'),           # collision rect l, t, r, b (invisible CObstacle)
    0x30: ('set_collision_rect', 'EEEEE'),    # obj, l, t, r, b (+0x74..0x80) and enable collisions
    0x31: ('set_depth', 'EE'),                # obj, z: explicit depth for sorting in layer 1 (FUN_00418fe0)
    0x32: ('spawn_players', ''),              # one CBulanek per player, random position (FUN_004205a0)
    0x33: ('add', 'E'),                       # obj -> scene, into the current layer (FUN_0041a390)
    0x34: ('set_layer', 'E'),                 # 0 background, 1 depth-sorted middle, 2 foreground
    0x35: ('set_background', 'I'),            # res (scene +0x360)
    0x36: ('set_audio', 'II'),                # music res (scene +0x350), sound bank res (+0x80)
    0x37: ('set_solid', 'EE'),                # obj, bool (+0x69: collision queries skip non-solid objects)
    0x38: ('set_slot', 'EE'),                 # obj, slot (255 = free the slot)
    0x39: ('resort', 'E'),                    # obj: re-sort by depth
    0x3a: ('move_to', 'EEE'),                 # obj, x, y (keeps size)
    0x3b: ('show', 'E'), 0x3c: ('hide', 'E'),
    0x3d: ('first_of_3', 'EEE'),              # evaluates all three, returns the first (stub)
    0x3e: ('get_slot', 'E'),                  # slot -> obj
    0x3f: ('anim_play', 'EEE'),               # obj, sequence index, flags (1 autoplay, 2 loop; -1 keep)
    0x40: ('anim_stop', 'E'),
    0x41: ('play_sound', 'EE'),               # sound index in the level bank, slot of the source (stereo pan)
    0x42: ('anim_set_stop_frame', 'EE'),      # obj, frame where a non-looping play stops (default 0)
    0x43: ('fire', 'EEEEE'),                  # x, y, shot type, owner slot (255 = none), flags (CShot)
    0x44: ('timer_add', 'EEE'),               # id (-1 = new), interval ms, flags (1 paused, 2 timed) -> id
    0x45: ('timer_resume', 'E'), 0x46: ('timer_pause', 'E'), 0x47: ('timer_remove', 'E'),
    0x48: ('timer_set_interval', 'EE'),
    0x49: ('add_zone', 'EEEEE'),              # id, l, t, r, b: trigger area (scene +0x2d8)
    0x4a: ('is_master', ''),                  # true unless this is a network client (game +0x36)
    0x4b: ('net_send', 'E'),                  # stream -> all players (DirectPlay message 0x15)
    0x4c: ('net_set_stream', 'E'),            # stream that receives level messages (game +0x1ac)
    0x4d: ('net_mode', ''),                   # 0 no network, 1 network master, 2 network client
    0x4e: ('set_opacity', 'EE'),              # obj, 0..255
    0x4f: ('set_alpha_from', 'EI'),           # obj, res whose pixels become the obj's alpha plane
    0x50: ('anim_start', 'EE'),               # obj, loop: starts playback (sets play flags 1 | loop << 1)
    0x51: ('timer_set_value', 'EE'), 0x52: ('timer_get_value', 'E'),
    0x53: ('add_zone_flags', 'EEEEEE'),       # id, l, t, r, b, flags
    0x54: ('teleport', 'E'),                  # slot: bulanek to a random free spot (CTeleportPoint effect)
    0x55: ('teleport_to', 'EEEE'),            # slot, x, y, force
    0x56: ('remove', 'EE'),                   # obj, destroy
    0x57: ('anim_is_playing', 'E'),
    0x58: ('anim_set_frame', 'EE'),
    0x59: ('new_list', ''), 0x5a: ('list_count', 'E'),
    0x5b: ('list_resize', 'EEE'),             # list, size, destroy dropped items
    0x5c: ('list_get', 'EE'), 0x5d: ('list_set', 'EEE'),
    0x5e: ('list_remove', 'EEEE'),            # list, index, count, destroy
    0x5f: ('list_insert', 'EEE'),             # list, index (-1 = append), value
    0x60: ('delete', 'E'), 0x61: ('preload', 'I'),
    0x62: ('fire_ex', 'EEEEEE'),              # fire + extra CShot parameter
    0x63: ('set_shoot_through', 'EE'),        # obj, bool (+0x6a: shots ignore the object)
    0x64: ('spawn_extra', ''),                # bulanci in slots 0x20..0x23, all but the first hidden
    0x65: ('spawn_bot', 'EEEE'),              # position, CBulanek params (max 4, slots from 0x24)
    0x66: ('new_mine', 'EE'),
}
TEXT_OPS = {0x2d: ('text', 'EEEEI'), 0x2e: ('text_box', 'EEEEEEIE'), 0x2f: ('bitmap', 'EEI'),
            0x30: ('set_colors', None), 0x31: ('first_of_2', 'EE'), 0x32: ('set_opacity', 'EE'), 0x33: ('add', 'E')}
HELP_OPS = {**TEXT_OPS, 0x34: ('button', 'EEEE')}
HISTORY_OPS = {**TEXT_OPS, 0x34: ('movie', 'EEIEE')}


def jpeg_size(d):
    """Width and height from the first SOFn marker."""
    i = 2
    while i + 9 < len(d):
        marker, length = d[i + 1], struct.unpack_from('>H', d, i + 2)[0]
        if 0xc0 <= marker <= 0xcf and marker not in (0xc4, 0xc8, 0xcc):
            h, w = struct.unpack_from('>HH', d, i + 5)
            return w, h
        i += 2 + length
    raise ValueError('JPEG without SOF marker')


def disassemble(d, ext_ops, refs=None):
    """CDSScript::vfunction5: u32 code_len, u32 n_entries, u32 n_globals, code, n_entries * u32 entry offsets."""
    ops = dict(enumerate(BASE_OPS))
    ops.update(ext_ops)
    code_len, n_entries, n_globals = struct.unpack_from('<III', d)
    code = d[12:12 + code_len]
    entries = struct.unpack_from('<%dI' % n_entries, d, 12 + code_len)
    labels, calls = set(), set()

    def expr(p):
        op = code[p]
        name, grammar = ops[op]
        p += 1
        if op == 0x00:
            v, = struct.unpack_from('<i', code, p)
            return str(v), p + 4
        if op == 0x1b:
            e = p
            while code[e:e + 2] != b'\0\0':
                e += 2
            return json.dumps(code[p:e].decode('utf-16-le'), ensure_ascii=False), e + 2
        args = []
        if op == 0x0e:  # call: u32 target, u8 argc, argc * E
            target, n = struct.unpack_from('<IB', code, p)
            p += 5
            calls.add(target)
            args.append('func_%d' % target)
        elif op in (0x18, 0x19):  # switch_goto / lookup: E, u8 n, n * (u32 key, u32 target or value)
            x, p = expr(p)
            n = code[p]
            pairs = [struct.unpack_from('<iI', code, p + 1 + k * 8) for k in range(n)]
            if op == 0x18:
                labels.update(t for _, t in pairs)
            fmt = '%d: L%d' if op == 0x18 else '%d: %d'
            return '%s(%s, {%s})' % (name, x, ', '.join(fmt % pr for pr in pairs)), p + 1 + n * 8
        elif op == 0x2d and ext_ops is LEVEL_OPS:  # new_anim: E x, E y, u8 flags, u8 n, n * u32 resource ids
            for _ in range(2):
                x, p = expr(p)
                args.append(x)
            flags, n = code[p], code[p + 1]
            ids = struct.unpack_from('<%dI' % n, code, p + 2)
            if refs is not None:
                refs.update(i & 0xffff for i in ids)
            return '%s(%s, %d, [%s])' % (name, ', '.join(args), flags, ', '.join('res_%d' % (i & 0xffff) for i in ids)), \
                p + 2 + 4 * n
        elif op == 0x30 and ext_ops is not LEVEL_OPS:  # set_colors: E obj, u8 argc, argc * E
            x, p = expr(p)
            args.append(x)
            n = code[p]
            p += 1
        else:
            n = 0
        for t in grammar or 'E' * n:
            if t == 'E':
                x, p = expr(p)
            else:
                size = {'B': 1, 'H': 2, 'I': 4}[t]
                x = str(int.from_bytes(code[p:p + size], 'little'))
                if name.endswith('goto'):
                    labels.add(int(x))
                    x = 'L' + x
                elif t == 'I' and int(x) >> 16 == 1:  # resource key = id | group 1 << 16
                    if refs is not None:
                        refs.add(int(x) & 0xffff)
                    x = 'res_%d' % (int(x) & 0xffff)
                p += size
            args.append(x)
        return '%s(%s)' % (name, ', '.join(args)), p

    # Walk control flow from the entry points (gotos, branches, calls). Code nobody jumps to is a function
    # reached indirectly (its address passed as a value), so each uncovered gap is decoded as a function start.
    stmts, funcs, indirect, covered = {}, set(), set(), set()
    queue = [(e, True) for e in entries]
    while True:
        while queue:
            p, is_func = queue.pop()
            if p in covered or p >= code_len:
                continue
            if is_func:  # FUN_00438b30: every function starts with u8 local variable count
                funcs.add(p)
                stmts[p] = '.locals %d' % code[p]
                covered.add(p)
                p += 1
            while p < code_len and p not in covered:
                before = (set(labels), set(calls))
                try:
                    s, q = expr(p)
                except (KeyError, struct.error, IndexError):
                    stmts[p] = '.data ' + code[p:p + 16].hex(' ')
                    break
                stmts[p] = s
                covered.update(range(p, q))
                queue += [(t, False) for t in labels - before[0]] + [(t, True) for t in calls - before[1]]
                if code[p] in (0x0d, 0x11):  # goto / return
                    break
                p = q
        gap = next((i for i in range(code_len) if i not in covered and i not in stmts), None)
        if gap is None:
            break
        indirect.add(gap)
        queue.append((gap, True))
    names = {e: 'entry_%d' % i for i, e in enumerate(entries)}
    out = ['; %d bytes of code, %d entry points, %d globals' % (code_len, n_entries, n_globals)]
    for off in sorted(stmts):
        s = stmts[off]
        if off in funcs or off in labels:
            tags = [names.get(off), 'func_%d' % off if off in calls else None,
                    'indirect_func_%d' % off if off in indirect and off not in names else None,
                    'L%d' % off if off in labels else None]
            out.append('\n%s:' % ', '.join(t for t in tags if t))
        out.append('  %5d  %s' % (off, s))
    return '\n'.join(out) + '\n'


def main(argv=None):
    argv = sys.argv if argv is None else argv
    exe_path = argv[1] if len(argv) > 1 else 'bulanci.exe'
    out_dir = argv[2] if len(argv) > 2 else 'extracted'
    exe = open(exe_path, 'rb').read()
    arc = unpack_overlay(exe)
    palettes = [team_palette(exe, c) for c in range(8)]  # player colours 0..7
    res = list(resources(arc))
    banks = {}
    for rid, kind, d in res:
        if kind == KIND_BANKINFO:  # u16 bank_id, u16 1, u32 0, u32 n, n * u32 sample byte lengths
            bank, _, _, n = struct.unpack_from('<HHII', d)
            banks[bank] = struct.unpack_from('<%dI' % n, d, 12)

    manifest = {}
    for rid, kind, d in res:
        rel = '%s/%05d' % (KIND_NAMES.get(kind, 'unknown'), rid)
        os.makedirs(os.path.join(out_dir, os.path.dirname(rel)), exist_ok=True)
        files, entry = {}, {'kind': KIND_NAMES.get(kind, 'unknown')}
        if kind == KIND_JPEG:
            files['.jpg'] = d
            w, h = jpeg_size(d)
            entry = {'kind': 'image', 'width': w, 'height': h}
        elif kind == KIND_IMAGE:
            w, h, fmt = struct.unpack_from('<III', d)
            entry = {'kind': 'image', 'width': w, 'height': h}
            if fmt == 3 and struct.unpack_from('<I', d, 21)[0] == 0:  # app palette: one sheet per team colour
                files['.png'] = decode_image(d, palettes[0])
                for c in range(1, len(palettes)):
                    files['_c%d.png' % c] = decode_image(d, palettes[c])
                entry['colors'] = len(palettes)
            else:
                files['.png'] = decode_image(d)
        elif kind == KIND_MP3:  # u32 ?, u32 decoded_bytes, u16 ch, u16 bits, u32 rate, MPEG frames
            files['.mp3'] = d[16:]
            entry = {'kind': 'music'}
        elif kind == KIND_WAVBANK:  # u32 len, u16 ch, u16 bits, u32 rate, PCM
            ln, ch, bits, rate = struct.unpack_from('<IHHI', d)
            pcm = d[12:12 + ln]
            files['.wav'] = wav(pcm, ch, bits, rate)
            pos = 0
            for n, part in enumerate(banks.get(rid, [])):
                files['_%02d.wav' % n] = wav(pcm[pos:pos + part], ch, bits, rate)
                pos += part
            entry = {'kind': 'wavbank', 'samples': [rel + '_%02d.wav' % n for n in range(len(banks.get(rid, [])))],
                     'durations_ms': [part * 1000 // (rate * ch * bits // 8) for part in banks.get(rid, [])]}
        elif kind == KIND_BANKINFO:
            files['.bin'] = d
            entry = {'kind': 'soundbank', 'bank': struct.unpack_from('<H', d)[0]}
        elif kind == KIND_TEXT:  # u32 chars, UTF-16LE, 0x0001 = formatting mark
            ln, = struct.unpack_from('<I', d)
            files['.txt'] = d[4:4 + ln * 2].decode('utf-16-le').replace('\x01', '').encode()
        elif kind == KIND_LEVEL:
            refs = set()
            files['.asm'] = disassemble(d, LEVEL_OPS, refs).encode()
            files['.bin'] = d
            entry = {'kind': 'level', 'file': rel + '.bin', 'refs': sorted(refs)}
        elif kind == KIND_RICHTEXT:  # help and history pages differ only in op 0x34
            try:
                files['.asm'] = disassemble(d, HISTORY_OPS).encode()
            except (KeyError, struct.error, IndexError):
                files['.asm'] = disassemble(d, HELP_OPS).encode()
        elif kind == KIND_FILE:  # u32 name_len, name, u64 ?, u32 size, 8 bytes ?, file data
            ln, = struct.unpack_from('<I', d)
            fname = d[4:4 + ln].decode('ascii')
            size, = struct.unpack_from('<I', d, 4 + ln + 8)
            files['_' + fname + '.exe'] = d[4 + ln + 20:4 + ln + 20 + size]
        elif kind == KIND_VIDEO:
            files['.avi'] = video_to_avi(d)
        elif kind == KIND_FONT:
            files['.png'], files['.csv'] = font(d)
        elif kind == KIND_ANIM:
            sheets, info = anim(d, palettes)
            files['.png'], files['.json'] = sheets[0], json.dumps(info, indent=1).encode()
            for c, sheet in enumerate(sheets[1:], 1):  # team colours 1..7: <rel>_c<n>.png
                files['_c%d.png' % c] = sheet
            entry = {'kind': 'anim', 'width': info['width'], 'height': info['height'], 'frames': info['frames'],
                     'cols': info['cols'], 'duration_ms': info['duration_ms'],
                     'events': {str(i): f['event'] for i, f in enumerate(info['frame_info']) if 'event' in f}}
            offsets = [list(f.get('offset', (0, 0))) for f in info['frame_info'] + [info['ring']]]
            if any(o != [0, 0] for o in offsets):
                entry['offsets'] = offsets  # chunk 10 per frame, last = ring frame (walk distance)
            points = [f.get('points', []) for f in info['frame_info']]
            if any(points):
                entry['points'] = [[list(t) for t in fp] for fp in points]  # chunk 11 (id, x, y) per frame
            if len(sheets) > 1:
                entry['colors'] = len(sheets)
        else:
            files['.bin'] = d
        for ext, blob in files.items():
            with open(os.path.join(out_dir, rel + ext), 'wb') as f:
                f.write(blob)
        entry.setdefault('file', rel + next(iter(files)))
        entry['files'] = [rel + ext for ext in files]
        manifest[str(rid)] = entry
    with open(os.path.join(out_dir, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, separators=(',', ':'))
    print('%d resources -> %s' % (len(res), out_dir))


if __name__ == '__main__':
    main()
