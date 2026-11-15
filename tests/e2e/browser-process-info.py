"""Read real argv boundaries for candidate PIDs; never signal or modify processes."""
import ctypes
import errno
import json
import os
from pathlib import Path
import struct
import sys

MAX_BYTES = 4 * 1024 * 1024
MAX_ARGS = 4096


def darwin_arguments(data):
    if len(data) < 5:
        raise ValueError('truncated process arguments')
    argc = struct.unpack_from('=i', data)[0]
    if not 1 <= argc <= MAX_ARGS:
        raise ValueError('invalid argument count')
    end = data.find(b'\0', 4)
    if end <= 4:
        raise ValueError('missing executable path')
    executable = os.fsdecode(data[4:end])
    offset = end
    while offset < len(data) and data[offset] == 0:
        offset += 1
    argv = []
    for _ in range(argc):
        end = data.find(b'\0', offset)
        if end < 0:
            raise ValueError('truncated argv entry')
        argv.append(os.fsdecode(data[offset:end]))
        offset = end + 1
    if not argv[0]:
        raise ValueError('missing argv zero')
    return executable, argv


def native_arguments(pid):
    if sys.platform == 'darwin':
        libc = ctypes.CDLL(None, use_errno=True)
        libc.sysctl.argtypes = [ctypes.POINTER(ctypes.c_int), ctypes.c_uint,
                                ctypes.c_void_p, ctypes.POINTER(ctypes.c_size_t),
                                ctypes.c_void_p, ctypes.c_size_t]
        libc.sysctl.restype = ctypes.c_int
        mib = (ctypes.c_int * 3)(1, 49, pid)  # CTL_KERN, KERN_PROCARGS2, PID
        size = ctypes.c_size_t()
        if libc.sysctl(mib, 3, None, ctypes.byref(size), None, 0):
            raise OSError(ctypes.get_errno(), 'process argument size unavailable')
        if not 5 <= size.value <= MAX_BYTES:
            raise ValueError('process argument size out of bounds')
        buffer = ctypes.create_string_buffer(size.value)
        if libc.sysctl(mib, 3, buffer, ctypes.byref(size), None, 0):
            raise OSError(ctypes.get_errno(), 'process arguments unavailable')
        return darwin_arguments(buffer.raw[:size.value])
    if sys.platform.startswith('linux'):
        root = Path('/proc') / str(pid)
        executable = os.readlink(root / 'exe')
        with (root / 'cmdline').open('rb') as handle:
            data = handle.read(MAX_BYTES + 1)
        if not data or len(data) > MAX_BYTES or not data.endswith(b'\0'):
            raise ValueError('incomplete process arguments')
        argv = [os.fsdecode(arg) for arg in data[:-1].split(b'\0')]
        if not argv[0] or len(argv) > MAX_ARGS:
            raise ValueError('invalid process arguments')
        return executable, argv
    raise ValueError('native process arguments unsupported')


def inspect(pid, expected):
    try:
        executable, argv = native_arguments(pid)
        if os.path.realpath(executable) != expected:
            return {'status': 'different-executable', 'argv': argv}
        return {'status': 'verified', 'argv': argv}
    except OSError as error:
        return {'status': 'gone' if error.errno in (errno.ESRCH, errno.ENOENT) else 'unavailable'}
    except ValueError:
        return {'status': 'unavailable'}


def main():
    if len(sys.argv) < 3 or not os.path.isabs(sys.argv[1]):
        raise ValueError('absolute expected browser executable required')
    expected = os.path.realpath(sys.argv[1])
    pids = [int(value) for value in sys.argv[2:]]
    if len(pids) > 4096 or any(pid <= 0 for pid in pids):
        raise ValueError('invalid candidate PIDs')
    print(json.dumps({str(pid): inspect(pid, expected) for pid in pids}))


if __name__ == '__main__':
    main()
