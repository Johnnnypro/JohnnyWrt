"""Check the exact serial test input before spending time building firmware."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

root = Path(__file__).parent


class SmokeInputTest(unittest.TestCase):
    def test_network_plans_fit_guest_console_lines(self):
        with tempfile.TemporaryDirectory() as directory:
            plans = Path(directory) / 'plans.json'
            subprocess.run(['node', str(root / 'network-test-plans.js'), str(plans)], check=True)
            content = plans.read_bytes()
            self.assertLessEqual(max(map(len, content.splitlines())), 500)
            self.assertEqual([(p['role'], p['protocol']) for p in json.loads(content)],
                             [('bypass', 'dhcp'), ('bypass', 'static'), ('main', 'dhcp'),
                              ('main', 'static'), ('main', 'pppoe')])

    def test_complete_smoke_input_without_building_or_booting(self):
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run([sys.executable, str(root / 'smoke-test25.py'),
                                     str(Path(directory) / 'not-built.img.gz'), '--check-input'],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('PASS: serial test input', result.stdout)

    def test_overlong_test_source_is_rejected_before_boot(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            for name in ('smoke-test25.py', 'network-test-plans.js', 'johnny-model.js',
                         'test-ui-layout.sh', 'test-dashboard-api.sh', 'test-meow-actions.sh',
                         'test-network-apply.uc'):
                shutil.copyfile(root / name, target / name)
            with (target / 'test-dashboard-api.sh').open('a', encoding='utf-8') as output:
                output.write('\n#' + 'x' * 500 + '\n')
            result = subprocess.run([sys.executable, str(target / 'smoke-test25.py'),
                                     str(target / 'not-built.img.gz'), '--check-input'],
                                    capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('exceeds 500 bytes', result.stderr)


if __name__ == '__main__':
    unittest.main()
