"""Check the exact serial test input before spending time building firmware."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

root = Path(__file__).parent


class SmokeInputTest(unittest.TestCase):
    def test_nat_diagnostics_do_not_replace_smoke_exit_status(self):
        source = (root / 'smoke-test25.py').read_text()
        trap = re.search(r"trap '(.+?)' EXIT", source, re.S).group(0)
        for status in (0, 7):
            with self.subTest(status=status):
                script = ('johnny_nat_diagnostics_dump() { echo NAT_DIAGNOSTICS; return 9; }; '
                          'nft() { :; }; ip() { :; }; cat() { :; }; tail() { :; };\n' +
                          trap + f'\nexit {status}\n')
                result = subprocess.run(['sh', '-c', script], capture_output=True, text=True)
                self.assertEqual(result.returncode, status, result.stderr)
                self.assertIn('NAT_DIAGNOSTICS', result.stdout)

    def test_nat_recording_preserves_helper_input_output_and_failure(self):
        diagnostic = root / 'test-johnny-nat-diagnostics.sh'
        self.assertTrue(diagnostic.is_file(), 'NAT recording script is missing')
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            helper = target / 'helper'
            original = ('#!/bin/sh\nubus call network.interface dump\n'
                        'subnets=198.19.0.1/24\n'
                        "printf 'flush set inet fw4 johnny_lan4\\n' | nft -f -\n")
            helper.write_text(original)
            helper.chmod(0o755)
            for name, body in {
                'ubus': "printf '%s\\n' '{\"interface\":[]}'",
                'nft': 'if [ "$*" = "-f -" ]; then cat > "$FIXTURE/batch"; exit 7; fi; echo nft-state',
                'ip': 'echo route-state',
                'logread': 'echo firewall-event',
            }.items():
                command = target / name
                command.write_text('#!/bin/sh\n' + body + '\n')
                command.chmod(0o755)
            script = diagnostic.read_text().replace('/tmp/johnny-nat-diagnostics', str(target / 'evidence'))
            script = script.replace('/usr/libexec/johnny-zt-nat', str(helper))
            script += ('\njohnny_nat_diagnostics_start\n' + f'ACTION=includes {helper}\n'
                       'saved_status=$?\njohnny_nat_diagnostics_dump\nexit "$saved_status"\n')
            env = dict(os.environ, PATH=str(target) + os.pathsep + os.environ['PATH'], FIXTURE=str(target))
            result = subprocess.run(['sh', '-c', script], env=env, capture_output=True, text=True, timeout=5)
            self.assertEqual(result.returncode, 7, result.stderr)
            self.assertEqual((target / 'batch').read_text(), 'flush set inet fw4 johnny_lan4\n')
            self.assertEqual((target / 'evidence/original-helper').read_text(), original)
            self.assertEqual(helper.read_text(), original)
            self.assertIn('{"interface":[]}', result.stdout)
            self.assertIn('action=includes', result.stdout)
            self.assertIn('subnets=<198.19.0.1/24>', result.stdout)
            self.assertIn('rc=7', result.stdout)
            self.assertIn('JOHNNY_NAT_DIAGNOSTICS_END', result.stdout)

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
        for source in ('test-dashboard-api.sh', 'test-johnny-nat-diagnostics.sh', 'test-subscription-refresh.sh'):
            with self.subTest(source=source), tempfile.TemporaryDirectory() as directory:
                target = Path(directory)
                for name in ('smoke-test25.py', 'network-test-plans.js', 'johnny-model.js',
                             'test-ui-layout.sh', 'test-dashboard-api.sh', 'test-meow-actions.sh',
                             'test-network-apply.uc', 'test-johnny-probe.sh',
                             'test-johnny-probe.uc', 'test-quickstart.sh', 'test-johnny-nat-diagnostics.sh',
                             'test-subscription-refresh.sh'):
                    shutil.copyfile(root / name, target / name)
                with (target / source).open('a', encoding='utf-8') as output:
                    output.write('\n#' + 'x' * 500 + '\n')
                result = subprocess.run([sys.executable, str(target / 'smoke-test25.py'),
                                         str(target / 'not-built.img.gz'), '--check-input'],
                                        capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('exceeds 500 bytes', result.stderr)


if __name__ == '__main__':
    unittest.main()
