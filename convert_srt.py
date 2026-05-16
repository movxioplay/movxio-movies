#!/usr/bin/env python3
"""
convert_srt.py — SRT to WebVTT converter
Usage: python3 convert_srt.py input.srt output.vtt

Fixes:
  - Converts SRT comma decimals  00:01:16,535  →  00:01:16.535
  - Pads missing hours            01:16.535     →  00:01:16.535
  - Ensures HH:MM:SS.mmm format  (required by browsers)
  - Strips SRT cue numbers
  - Cleans BOM and Windows line endings
"""

import re
import sys

def fix_timestamp(ts):
    ts = ts.strip()
    # SRT uses comma: 00:01:16,535 → 00:01:16.535
    ts = ts.replace(',', '.')
    # Already correct: HH:MM:SS.mmm
    if re.match(r'^\d{2}:\d{2}:\d{2}\.\d+$', ts):
        return ts
    # Missing hours: MM:SS.mmm → 00:MM:SS.mmm
    if re.match(r'^\d{2}:\d{2}\.\d+$', ts):
        return '00:' + ts
    return ts

def convert(src, dst):
    with open(src, 'r', encoding='utf-8-sig') as f:
        content = f.read()

    # Normalize line endings
    content = content.replace('\r\n', '\n').replace('\r', '\n')

    lines = content.strip().split('\n')
    out   = ['WEBVTT', '']

    i = 0
    while i < len(lines):
        line = lines[i].strip()

        # Skip pure cue-number lines (SRT sequence numbers)
        if re.match(r'^\d+$', line):
            i += 1
            continue

        # Timing line
        if '-->' in line:
            parts = line.split('-->')
            t1 = fix_timestamp(parts[0])
            t2 = fix_timestamp(parts[1].split()[0])  # ignore trailing position tags
            out.append(f'{t1} --> {t2}')
            i += 1
            # Collect cue text lines until blank line or end
            while i < len(lines) and lines[i].strip() != '':
                out.append(lines[i].rstrip())
                i += 1
            out.append('')
            continue

        i += 1

    with open(dst, 'w', encoding='utf-8') as f:
        f.write('\n'.join(out))

    print(f'Done → {dst}')

if __name__ == '__main__':
    if len(sys.argv) != 3:
        print('Usage: python3 convert_srt.py input.srt output.vtt')
        sys.exit(1)
    convert(sys.argv[1], sys.argv[2])
