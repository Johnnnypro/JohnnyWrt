import subprocess
import sys
import unittest
from pathlib import Path

script = Path(__file__).with_name('release-version.py')
class ReleaseVersion(unittest.TestCase):
    def run_version(self, *args):
        return subprocess.run([sys.executable, str(script), *args], capture_output=True, text=True)
    def test_requested_date(self):
        result = self.run_version('26.11.10')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), '26.11.10')
    def test_invalid_dates_and_shell_text(self):
        for value in ['26.02.30', '2026.11.10', '26.1.1', '26.11.10;echo nope', '26.13.10']:
            self.assertNotEqual(self.run_version(value).returncode, 0, value)
    def test_future_default_is_shanghai_date(self):
        from datetime import datetime
        from zoneinfo import ZoneInfo
        result = self.run_version()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), datetime.now(ZoneInfo('Asia/Shanghai')).strftime('%y.%m.%d'))
if __name__ == '__main__': unittest.main()
