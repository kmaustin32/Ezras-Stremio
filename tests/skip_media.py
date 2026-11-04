"""Verify MPV chapter boundaries, exact seeks, and the normal end-file event."""
import argparse
import ctypes as c
import pathlib
import subprocess
import time


class Event(c.Structure):
    _fields_ = [('id', c.c_int), ('error', c.c_int), ('reply', c.c_uint64), ('data', c.c_void_p)]


def main():
    parser = argparse.ArgumentParser()
    for flag in ('dll', 'ffmpeg', 'output'):
        parser.add_argument(f'--{flag}', type=pathlib.Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    chapters = args.output / 'chapters.txt'
    chapters.write_text(';FFMETADATA1\n' + ''.join(
        f'[CHAPTER]\nTIMEBASE=1/1000\nSTART={start}\nEND={end}\ntitle={title}\n'
        for start, end, title in [(0, 1500, 'Opening Credits'), (1500, 4500, 'Episode'),
                                  (4500, 6000, 'End Credits')]), encoding='ascii')
    video = args.output / 'chapters.mkv'
    subprocess.run([str(args.ffmpeg.resolve()), '-hide_banner', '-loglevel', 'error', '-y',
                    '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=25:duration=6',
                    '-f', 'ffmetadata', '-i', str(chapters), '-map', '0:v', '-map_chapters', '1',
                    '-c:v', 'ffv1', str(video)], check=True)

    mpv = c.CDLL(str(args.dll.resolve()))
    mpv.mpv_create.restype = c.c_void_p
    mpv.mpv_initialize.argtypes = [c.c_void_p]
    mpv.mpv_set_option_string.argtypes = [c.c_void_p, c.c_char_p, c.c_char_p]
    mpv.mpv_set_property_async.argtypes = [c.c_void_p, c.c_uint64, c.c_char_p, c.c_int, c.c_void_p]
    mpv.mpv_command_async.argtypes = [c.c_void_p, c.c_uint64, c.POINTER(c.c_char_p)]
    mpv.mpv_wait_event.argtypes = [c.c_void_p, c.c_double]
    mpv.mpv_wait_event.restype = c.POINTER(Event)
    mpv.mpv_get_property_string.argtypes = [c.c_void_p, c.c_char_p]
    mpv.mpv_get_property_string.restype = c.c_void_p
    mpv.mpv_free.argtypes = [c.c_void_p]
    mpv.mpv_terminate_destroy.argtypes = [c.c_void_p]
    for paused in (True, False):
        player = mpv.mpv_create()
        assert player

        def command(*values):
            argv = (c.c_char_p * (len(values) + 1))(*(v.encode('utf-8') for v in values), None)
            assert mpv.mpv_command_async(player, 0, argv) >= 0

        def prop(name):
            value = mpv.mpv_get_property_string(player, name.encode())
            assert value, name
            try:
                return c.string_at(value).decode()
            finally:
                mpv.mpv_free(value)

        def wait_event(event_id):
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                event = mpv.mpv_wait_event(player, .1).contents
                assert event.error >= 0, event.error
                if event.id == event_id:
                    return event
            raise AssertionError(f'Missing MPV event {event_id}, paused={paused}')

        try:
            for key, value in {'config': 'no', 'vo': 'null', 'ao': 'null', 'pause': 'yes' if paused else 'no'}.items():
                assert mpv.mpv_set_option_string(player, key.encode(), value.encode()) >= 0
            assert mpv.mpv_initialize(player) >= 0
            command('loadfile', str(video.resolve()))
            wait_event(8)  # MPV_EVENT_FILE_LOADED
            assert prop('seekable') == 'yes'
            assert prop('chapter-list/0/title') == 'Opening Credits'
            assert prop('chapter-list/2/title') == 'End Credits'
            command('seek', prop('chapter-list/1/time'), 'absolute+exact')
            wait_event(20)  # MPV_EVENT_SEEK
            wait_event(21)  # MPV_EVENT_PLAYBACK_RESTART
            assert 1.5 <= float(prop('time-pos')) < 2
            assert prop('pause') == ('yes' if paused else 'no')
            command('seek', prop('duration'), 'absolute+exact')
            playing = c.c_int(0)
            assert mpv.mpv_set_property_async(player, 0, b'pause', 3, c.byref(playing)) >= 0  # MPV_FORMAT_FLAG
            end = wait_event(7)  # MPV_EVENT_END_FILE
            assert c.cast(end.data, c.POINTER(c.c_int))[0] == 0  # MPV_END_FILE_REASON_EOF
        finally:
            mpv.mpv_terminate_destroy(player)
    print('Chapter seeks preserve pause, and skipping to the end emits normal EOF during playback and pause.')


if __name__ == '__main__':
    main()
