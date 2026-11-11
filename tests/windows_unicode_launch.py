"""Verify that a second launch forwards an existing Unicode file path unchanged."""

import ctypes as c
from ctypes import wintypes as w
from pathlib import Path
import subprocess
import sys
import time


user = c.WinDLL('user32', use_last_error=True)
kernel = c.WinDLL('kernel32', use_last_error=True)


def bind(dll, name, result, *args):
    function = getattr(dll, name)
    function.restype = result
    function.argtypes = args
    return function


WindowProc = c.WINFUNCTYPE(w.LPARAM, w.HWND, w.UINT, w.WPARAM, w.LPARAM)


class WindowClass(c.Structure):
    _fields_ = [('style', w.UINT), ('proc', WindowProc), ('class_extra', c.c_int),
                ('window_extra', c.c_int), ('instance', w.HINSTANCE), ('icon', w.HICON),
                ('cursor', w.HANDLE), ('background', w.HBRUSH), ('menu', w.LPCWSTR), ('name', w.LPCWSTR)]


class CopyData(c.Structure):
    _fields_ = [('kind', w.WPARAM), ('size', w.DWORD), ('data', c.c_void_p)]


def test_forward(app):
    received = []
    default_proc = bind(user, 'DefWindowProcW', w.LPARAM, w.HWND, w.UINT, w.WPARAM, w.LPARAM)

    @WindowProc
    def receive(hwnd, message, source, param):
        if message == 0x004A:  # WM_COPYDATA
            payload = c.cast(param, c.POINTER(CopyData)).contents
            if payload.kind == 1:
                received.append(c.string_at(payload.data, payload.size).decode('utf-16-le'))
                return 1
        return default_proc(hwnd, message, source, param)

    instance = bind(kernel, 'GetModuleHandleW', w.HINSTANCE, w.LPCWSTR)(None)
    register = bind(user, 'RegisterClassW', w.ATOM, c.POINTER(WindowClass))
    if not register(c.byref(WindowClass(0, receive, 0, 0, instance, None, None, None, None, 'Stremio'))):
        raise c.WinError(c.get_last_error())
    create_window = bind(user, 'CreateWindowExW', w.HWND, w.DWORD, w.LPCWSTR, w.LPCWSTR, w.DWORD,
                         c.c_int, c.c_int, c.c_int, c.c_int, w.HWND, w.HMENU, w.HINSTANCE, c.c_void_p)
    hwnd = create_window(0, 'Stremio', 'Unicode forwarding test', 0, 0, 0, 1, 1, None, None, instance, None)
    if not hwnd:
        raise c.WinError(c.get_last_error())
    peek = bind(user, 'PeekMessageW', w.BOOL, c.POINTER(w.MSG), w.HWND, w.UINT, w.UINT, w.UINT)
    dispatch = bind(user, 'DispatchMessageW', w.LPARAM, c.POINTER(w.MSG))
    try:
        for name in ('plain file.mkv', 'café 日本語 🎞.mkv'):
            video = app.parent / name
            video.touch()
            with subprocess.Popen([app, video], cwd=app.parent) as child:
                deadline = time.monotonic() + 10
                message = w.MSG()
                while child.poll() is None and time.monotonic() < deadline:
                    while peek(c.byref(message), None, 0, 0, 1):
                        dispatch(c.byref(message))
                    time.sleep(0.01)
                if child.poll() is None:
                    child.kill()
                    raise AssertionError('Second launch did not exit')
                assert child.returncode == 0, child.returncode
            assert received and received.pop(0) == str(video), f'Wrong forwarded file path: {name!r}'
    finally:
        bind(user, 'DestroyWindow', w.BOOL, w.HWND)(hwnd)
    print('ASCII and Unicode local file paths survive single-instance forwarding.')


if __name__ == '__main__':
    test_forward(Path(sys.argv[1]).resolve(strict=True))
