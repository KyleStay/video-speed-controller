"""Offline native argv framing/executable tests; no process is inspected or signaled."""
import errno
import importlib.util
from pathlib import Path
import struct
import sys
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
source = Path(__file__).resolve().parents[2] / 'e2e/browser-process-info.py'
spec = importlib.util.spec_from_file_location('browser_info', source)
info = importlib.util.module_from_spec(spec)
spec.loader.exec_module(info)


def frame(args, executable='/owned/Chrome', environment=()):
    return (struct.pack('=i', len(args)) + executable.encode() + b'\0\0\0'
            + b'\0'.join(arg.encode() for arg in args) + b'\0'
            + b'\0'.join(arg.encode() for arg in environment) + b'\0')


class NativeArgumentTests(unittest.TestCase):
    def test_preserves_whitespace_quotes_and_empty_argument_boundaries(self):
        args = ['/owned/Chrome', '--message=reviewing --user-data-dir=/tmp/QA --headless',
                '', '"literal quotes"', '-profile /tmp/QA']
        self.assertEqual(info.darwin_arguments(frame(args)), ('/owned/Chrome', args))

    def test_stops_before_environment_even_when_it_mentions_profile(self):
        args = ['/owned/Chrome', '--headless']
        self.assertEqual(info.darwin_arguments(frame(args, environment=['NOTE=--user-data-dir=/tmp/QA'])),
                         ('/owned/Chrome', args))

    def test_rejects_malformed_or_truncated_frames(self):
        for data in [b'', b'1234', struct.pack('=i', 0)+b'/owned/Chrome\0',
                     struct.pack('=i', 999999)+b'/owned/Chrome\0',
                     struct.pack('=i', 2)+b'/owned/Chrome\0\0argv0\0unfinished']:
            with self.subTest(data=data), self.assertRaises(ValueError):
                info.darwin_arguments(data)

    def test_argv_zero_cannot_spoof_the_os_executable_path(self):
        with patch.object(info, 'native_arguments', return_value=('/unrelated/node', ['/owned/Chrome', '--user-data-dir=/tmp/QA'])):
            self.assertEqual(info.inspect(123, '/owned/Chrome'), {'status': 'different-executable'})

    def test_exact_os_executable_and_argv_are_returned(self):
        args = ['/owned/Chrome', '--user-data-dir=/tmp/QA']
        with patch.object(info, 'native_arguments', return_value=('/owned/Chrome', args)):
            self.assertEqual(info.inspect(123, '/owned/Chrome'), {'status': 'verified', 'argv': args})

    def test_denial_and_malformed_data_are_unavailable_not_absent(self):
        for error in [PermissionError(errno.EPERM, 'fixture denied'), ValueError('fixture malformed')]:
            with self.subTest(error=error), patch.object(info, 'native_arguments', side_effect=error):
                self.assertEqual(info.inspect(123, '/owned/Chrome'), {'status': 'unavailable'})

    def test_only_a_proven_missing_process_is_gone(self):
        with patch.object(info, 'native_arguments', side_effect=ProcessLookupError(errno.ESRCH, 'fixture gone')):
            self.assertEqual(info.inspect(123, '/owned/Chrome'), {'status': 'gone'})


if __name__ == '__main__':
    unittest.main()
