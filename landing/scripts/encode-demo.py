"""Trims and encodes the raw demo recordings for the landing page.

  python3 scripts/encode-demo.py dark.json light.json public/videos

Each input line is {"name","theme","file","start","end"} from record-demo.cjs.
For every clip this writes <name>-<theme>.webm (VP9), .mp4 (H.264, for Safari)
and .jpg (the poster, taken 1.5 s before the end so it shows the result).
1920x1080 is recorded and scaled to 1280x720 so CLI text stays sharp.
Needs ffmpeg on PATH.
"""
import json
import subprocess
import sys
from pathlib import Path

VF = 'fps=24,scale=1280:720:flags=lanczos'


def ffmpeg(*args: str) -> None:
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', *args], check=True)


def main() -> None:
    *inputs, out = sys.argv[1:]
    if not inputs:
        sys.exit(__doc__)
    out_dir = Path(out)
    out_dir.mkdir(parents=True, exist_ok=True)
    for path in inputs:
        for line in Path(path).read_text().splitlines():
            if not line.strip():
                continue
            c = json.loads(line)
            start, length = float(c['start']), float(c['end']) - float(c['start'])
            base = out_dir / f"{c['name']}-{c['theme']}"
            trim = ['-ss', f'{start:.3f}', '-t', f'{length:.3f}', '-i', c['file'], '-vf', VF, '-an']
            ffmpeg(*trim, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '42', '-row-mt', '1',
                   '-deadline', 'good', '-cpu-used', '4', f'{base}.webm')
            ffmpeg(*trim, '-c:v', 'libx264', '-crf', '28', '-preset', 'slow', '-pix_fmt', 'yuv420p',
                   '-movflags', '+faststart', f'{base}.mp4')
            ffmpeg('-ss', f'{start + length - 1.5:.3f}', '-i', c['file'], '-frames:v', '1',
                   '-vf', 'scale=1280:720:flags=lanczos', '-q:v', '3', f'{base}.jpg')
            print('wrote', base)


if __name__ == '__main__':
    main()
