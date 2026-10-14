"""Exercise the shipped manual detector with actual decoded video and D3D11 blur."""
import argparse
import ctypes as c
from ctypes import wintypes as w
import json
import os
from pathlib import Path
import subprocess
import time
from mpv_smoke import read_png


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dll', required=True)
    parser.add_argument('--ffmpeg', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    root = Path(__file__).resolve().parents[1]
    script = root / 'utils/mpv/anime4k/portable_config/scripts/fork_bar_detection.lua'
    flags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
    for name, source in {
        'letterbox': 'color=c=0x80A0C0:s=320x180:r=24:d=12,pad=320:240:0:30:black',
        'pillarbox': 'color=c=0x80A0C0:s=240x240:r=24:d=12,pad=320:240:40:0:black',
        'no-bars': 'color=c=0x80A0C0:s=320x240:r=24:d=12',
        'dark': 'color=c=black:s=320x240:r=24:d=12',
        'uneven': 'color=c=0x80A0C0:s=280x240:r=24:d=12,pad=320:240:40:0:black',
        'ten-bit': 'color=c=0x80A0C0:s=320x180:r=24:d=12,pad=320:240:0:30:black,format=yuv420p10le',
        'odd-letterbox': 'color=c=0x80A0C0:s=320x178:r=24:d=12,format=yuv444p,pad=320:240:0:31:black',
        'faint-seam': 'color=c=0x80A0C0:s=320x180:r=24:d=12,pad=320:240:0:30:black,drawbox=x=0:y=28:w=320:h=2:color=0x080808:t=fill',
        'faint-bottom': 'color=c=0x80A0C0:s=320x180:r=24:d=12,pad=320:240:0:30:black,drawbox=x=0:y=210:w=320:h=2:color=0x080808:t=fill',
        'faint-pillarbox': 'color=c=0x80A0C0:s=240x240:r=24:d=12,pad=320:240:40:0:black,drawbox=x=38:y=0:w=2:h=240:color=0x080808:t=fill',
        'faint-ten-bit': 'color=c=0x80A0C0:s=320x180:r=24:d=12,pad=320:240:0:30:black,drawbox=x=0:y=28:w=320:h=2:color=0x080808:t=fill,format=yuv420p10le',
        'no-bars-faint-edges': 'color=c=0x80A0C0:s=320x240:r=24:d=12,drawbox=x=0:y=0:w=320:h=2:color=0x080808:t=fill,drawbox=x=0:y=238:w=320:h=2:color=0x080808:t=fill',
        'dark-content-edge': 'color=c=0x80A0C0:s=320x180:r=24:d=12,pad=320:240:0:30:black,drawbox=x=0:y=30:w=320:h=4:color=0x080808:t=fill',
        'bar-text': 'color=c=0x80A0C0:s=320x180:r=24:d=12,pad=320:240:0:30:black,drawbox=x=80:y=225:w=160:h=8:color=white:t=fill',
    }.items():
        subprocess.run([str(Path(args.ffmpeg).resolve()), '-hide_banner', '-loglevel', 'error', '-y',
                        '-f', 'lavfi', '-i', source, '-c:v', 'ffv1', str(output / f'{name}.mkv')],
                       check=True, creationflags=flags)
    subprocess.run([str(Path(args.ffmpeg).resolve()), '-hide_banner', '-loglevel', 'error', '-y',
                    '-f', 'lavfi', '-i', 'color=c=0x80A0C0:s=320x180:r=24:d=3',
                    '-f', 'lavfi', '-i', 'color=c=0x80A0C0:s=320x240:r=24:d=9',
                    '-filter_complex', '[0:v]pad=320:240:0:30:black[a];[a][1:v]concat=n=2:v=1:a=0[v]',
                    '-map', '[v]', '-c:v', 'ffv1', str(output / 'changing.mkv')],
                   check=True, creationflags=flags)
    dll = c.CDLL(str(Path(args.dll).resolve()))
    dll.mpv_create.restype = c.c_void_p
    for name in ['mpv_initialize', 'mpv_terminate_destroy']:
        getattr(dll, name).argtypes = [c.c_void_p]
    for name in ['mpv_set_option_string', 'mpv_set_property_string']:
        getattr(dll, name).argtypes = [c.c_void_p, c.c_char_p, c.c_char_p]
    dll.mpv_get_property_string.argtypes = [c.c_void_p, c.c_char_p]
    dll.mpv_get_property_string.restype = c.c_void_p
    dll.mpv_free.argtypes = [c.c_void_p]
    dll.mpv_command.argtypes = [c.c_void_p, c.POINTER(c.c_char_p)]
    user32 = c.WinDLL('user32', use_last_error=True)
    user32.CreateWindowExW.argtypes = [w.DWORD, w.LPCWSTR, w.LPCWSTR, w.DWORD,
                                     c.c_int, c.c_int, c.c_int, c.c_int,
                                     w.HWND, w.HMENU, w.HINSTANCE, c.c_void_p]
    user32.CreateWindowExW.restype = w.HWND
    user32.DestroyWindow.argtypes = [w.HWND]
    user32.SetWindowPos.argtypes = [w.HWND, w.HWND, c.c_int, c.c_int, c.c_int, c.c_int, w.UINT]
    user32.PeekMessageW.argtypes = [c.POINTER(w.MSG), w.HWND, w.UINT, w.UINT, w.UINT]
    user32.DispatchMessageW.argtypes = [c.POINTER(w.MSG)]
    hwnd = user32.CreateWindowExW(0, 'STATIC', 'Manual bar detection test', 0x90000000,
                                 -32000, -32000, 800, 450, None, None, None, None)
    assert hwnd
    player = dll.mpv_create()

    def checked(code):
        assert code >= 0, f'mpv request failed: {code}'

    def prop(name):
        value = dll.mpv_get_property_string(player, name.encode())
        if not value:
            return ''
        result = c.string_at(value).decode()
        dll.mpv_free(value)
        return result

    def setprop(name, value):
        checked(dll.mpv_set_property_string(player, name.encode(), str(value).encode()))

    def command(*values):
        checked(dll.mpv_command(player, (c.c_char_p * (len(values) + 1))(
            *[str(v).encode() for v in values], None)))

    def pump(seconds):
        end = time.monotonic() + seconds
        message = w.MSG()
        while time.monotonic() < end:
            while user32.PeekMessageW(c.byref(message), None, 0, 0, 1):
                user32.DispatchMessageW(c.byref(message))
            time.sleep(0.01)

    def state():
        return json.loads(prop('user-data/stremio-bar-detection') or '{}').get('state')

    def wait(predicate, description, timeout=10):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            pump(0.05)
            if predicate():
                return
        raise AssertionError(f'{description}: status={prop("user-data/stremio-bar-detection")} crop={prop("video-crop")}')

    def load(name):
        command('loadfile', output / f'{name}.mkv')
        wait(lambda: prop('path').endswith(f'{name}.mkv') and float(prop('time-pos') or 0) >= 0.2,
             'New video must decode')
        assert not prop('video-crop'), 'Detected crop must reset for each new video'
        assert state() == 'idle', 'Detection must never start automatically'

    def detect():
        command('keypress', 'Ctrl+Shift+c')
        wait(lambda: state() != 'idle', 'Hotkey must reach the shipped script')
        wait(lambda: state() != 'detecting', 'Detection must finish')
        assert 'stremio-fork-black-bars' not in prop('vf'), 'Detector filter must be removed'

    try:
        for name, value in {'config': 'no', 'load-scripts': 'no', 'terminal': 'yes', 'ao': 'null',
                            'vo': 'gpu-next', 'gpu-api': 'd3d11', 'd3d11-warp': 'yes', 'wid': str(hwnd),
                            'input-conf': str(script.parent.parent / 'input.conf'),
                            'gpu-shader-cache-dir': str(output / 'shader-cache'),
                            'screenshot-high-bit-depth': 'no', 'border-background': 'color'}.items():
            checked(dll.mpv_set_option_string(player, name.encode(), value.encode()))
        checked(dll.mpv_initialize(player))
        command('load-script', script)
        wait(lambda: state() == 'idle', 'Script must initialize')
        shader_root = script.parent.parent / 'shaders'
        import re
        mode_a = re.findall(r'~~/shaders/([^;\"]+)', (script.parent.parent / 'input.conf').read_text().splitlines()[1])
        shader_sets = [[], ['FSR.glsl'], mode_a]
        clips = ['letterbox', 'odd-letterbox', 'ten-bit', 'faint-seam', 'faint-bottom', 'faint-pillarbox', 'faint-ten-bit']
        # Enable shaders after detecting too: the locked crop must remain safe.
        for index, clip in enumerate(clips):
            load(clip)
            detect()
            assert state() == 'locked', prop('user-data/stremio-bar-detection')
            locked = prop('video-crop')
            setprop('glsl-shaders', ';'.join(str(shader_root / name) for name in shader_sets[index % 3]))
            assert prop('video-crop') == locked, 'Shader changes cannot change locked framing'
            setprop('border-background', 'blur')
            setprop('scale', 'ewa_lanczos')
            setprop('cscale', 'ewa_lanczos')
            setprop('osd-level', '0')
            command('show-text', '')
            # Check both boundaries across resizes and fractional scaling.
            for size in [(800, 600), (801, 601)]:
                user32.SetWindowPos(hwnd, None, -32000, -32000, *size, 0)
                pump(1)
                picture = output / f'seam-{clip}-{size[0]}.png'
                command('screenshot-to-file', picture, 'window')
                width, height, pixel = read_png(picture)
                assert (width, height) == size, 'Screenshot must reflect the resized host'
                minimum = min(
                    [pixel(x, y)[1] for x in [width // 4, width // 2, 3 * width // 4] for y in range(10, height - 10)] +
                    [pixel(x, y)[1] for y in [height // 4, height // 2, 3 * height // 4] for x in range(10, width - 10)])
                assert minimum >= 135, f'{clip}: a dark seam remains between the flat-colored picture and blur ({minimum})'
                print('PASS: seam-free boundary', clip, prop('video-crop'), size, 'minimum green:', minimum)
        user32.SetWindowPos(hwnd, None, -32000, -32000, 800, 450, 0)
        setprop('border-background', 'color')
        setprop('glsl-shaders', '')
        load('dark-content-edge')
        detect()
        assert prop('video-crop') == '320x178+0+31', 'A larger dark picture band cannot be removed by edge refinement'
        load('changing')
        detect()
        assert state() == 'locked' and prop('video-crop') == '320x178+0+31', prop('video-crop')
        assert prop('border-background') == 'color', 'Detection cannot toggle blur'
        # Geometry, pause, seeking, and stream replacement must respect the lock.
        for property_name, value in [('panscan', '1'), ('keepaspect', 'no'), ('keepaspect', 'yes'), ('panscan', '0')]:
            setprop(property_name, value)
            assert prop('video-crop') == '320x178+0+31'
        command('seek', '5', 'absolute+exact')
        pump(0.3)
        assert prop('video-crop') == '320x178+0+31'
        setprop('pause', 'yes')
        pump(1)
        assert prop('video-crop') == '320x178+0+31'
        command('keypress', 'Ctrl+Shift+c')
        wait(lambda: state() == 'idle', 'Second hotkey must restore framing')
        assert not prop('video-crop')
        # Paused detection must preserve pause and full-frame geometry.
        command('keypress', 'Ctrl+Shift+c')
        pump(0.2)
        assert prop('pause') == 'yes' and not prop('video-crop')
        setprop('pause', 'no')
        load('pillarbox')
        shader = root / 'utils/mpv/anime4k/portable_config/shaders/FSR.glsl'
        assert shader.exists()
        setprop('glsl-shaders', shader)
        command('vf', 'add', '@unrelated:lavfi=[null]')
        detect()
        assert state() == 'locked' and prop('video-crop') == '238x240+41+0', prop('video-crop')
        assert 'unrelated' in prop('vf'), 'Preserve unrelated video filters'
        assert str(shader) in prop('glsl-shaders'), 'Preserve active shaders'
        command('vf', 'remove', '@unrelated')
        setprop('border-background', 'blur')
        pump(0.3)
        picture = output / 'encoded-bars-blurred.png'
        command('screenshot-to-file', picture, 'window')
        assert max(read_png(picture)[2](25, 225)) > 30, 'Blur must fill the newly exposed border'
        load('ten-bit')
        detect()
        assert state() == 'locked' and prop('video-crop') == '320x178+0+31', prop('video-crop')
        for name in ['no-bars', 'no-bars-faint-edges', 'dark', 'uneven', 'bar-text']:
            load(name)
            detect()
            assert state() in ('no-bars', 'uncertain') and not prop('video-crop'), name
            assert prop('border-background') == 'blur', 'Detection cannot change ambient blur preference'
        load('letterbox')
        command('vf', 'add', '@scale:lavfi=[scale=160:120]')
        detect()
        assert state() == 'uncertain' and not prop('video-crop'), 'Reject incompatible geometry filters'
        assert 'scale' in prop('vf'), 'Preserve the user geometry filter'
        command('vf', 'remove', '@scale')
        # Changing video during a sample cannot apply its old result to the new video.
        load('letterbox')
        command('script-message-to', 'fork_bar_detection', 'detect')
        wait(lambda: state() == 'detecting', 'Native bridge command must start detection')
        load('no-bars')
        pump(1)
        assert state() == 'idle' and not prop('video-crop')
        load('letterbox')
        command('script-message-to', 'fork_bar_detection', 'detect')
        wait(lambda: state() == 'detecting', 'Detection must start')
        setprop('pause', 'yes')
        wait(lambda: state() == 'cancelled', 'Pause must cancel an unfinished sample')
        assert prop('pause') == 'yes' and not prop('video-crop') and 'stremio-fork-black-bars' not in prop('vf')
        print('PASS: manual hotkey, no automatic crop, 8/10-bit letterbox/pillarbox, no-bar/dark/bar-text safety, per-video reset, changing-aspect/seek/pause lock, existing shaders/filters, and actual D3D11 ambient blur')
    finally:
        dll.mpv_terminate_destroy(player)
        user32.DestroyWindow(hwnd)


if __name__ == '__main__':
    main()
