"""Check the exact serial test input before spending time building firmware."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

root = Path(__file__).parent


class SmokeInputTest(unittest.TestCase):
    def run_zerotier_readiness(self, ready_after, api_after):
        # Execute the real precondition before the test captures/mutates config.
        source = (root / 'test-dashboard-api.sh').read_text().split('saved=$(mktemp -d)', 1)[0]
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            identity = target / 'identity.secret'
            source = source.replace('/etc/zerotier/identity.secret', str(identity))
            source += f'\ntest -s "{identity}"\n'
            scripts = {
                'date': 'cat "$FIXTURE/ticks"',
                'sleep': 'n=$(cat "$FIXTURE/ticks"); n=$((n+2)); echo "$n" > "$FIXTURE/ticks"; '
                         'if [ "$n" -ge "$IDENTITY_AFTER" ]; then echo disposable > "$FIXTURE/identity.secret"; fi',
                'ubus': 'n=$(cat "$FIXTURE/ticks"); [ "$n" -ge "$API_AFTER" ] || exit 1; '
                        "echo '{\"node\":{\"address\":\"0123456789\"}}'",
                'jsonfilter': 'input=$(cat); [ -n "$input" ] || exit 1; echo 0123456789',
            }
            for name, body in scripts.items():
                path = target / name
                path.write_text('#!/bin/sh\n' + body + '\n')
                path.chmod(0o755)
            (target / 'ticks').write_text('0\n')
            if ready_after == 0:
                identity.write_text('disposable\n')
            env = dict(os.environ, PATH=str(target) + os.pathsep + os.environ['PATH'],
                       FIXTURE=str(target), IDENTITY_AFTER=str(ready_after), API_AFTER=str(api_after))
            result = subprocess.run(['sh', '-c', source], env=env, capture_output=True, text=True, timeout=5)
            return result, int((target / 'ticks').read_text())

    def test_waits_for_delayed_zerotier_identity_and_api(self):
        result, elapsed = self.run_zerotier_readiness(4, 8)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertGreaterEqual(elapsed, 8)

    def test_zerotier_missing_identity_still_fails_with_deadline(self):
        result, elapsed = self.run_zerotier_readiness(999, 0)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('ZeroTier startup not ready', result.stderr)
        self.assertLessEqual(elapsed, 180)

    def test_zerotier_file_without_responsive_api_is_not_ready(self):
        result, elapsed = self.run_zerotier_readiness(0, 999)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('ZeroTier startup not ready', result.stderr)
        self.assertLessEqual(elapsed, 180)

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
                         'test-network-apply.uc', 'test-johnny-probe.sh',
                         'test-johnny-probe.uc', 'test-quickstart.sh'):
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
