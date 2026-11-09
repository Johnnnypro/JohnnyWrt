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
    def test_negative_signal_evidence_accepts_serial_noise_but_not_broken_proof(self):
        source = (root / 'test-procd-negative.py').read_text()
        parser = compile(source[source.index("log = (image.parent / 'boot-test.log')"):], 'negative-log-parser', 'exec')
        state = {'johnny-signal-test': {'instances': {'main': {'running': False, 'exit_code': 129}}}}
        proof = ('\nPROCD_SIGNAL_STATE_BEGIN\n' + json.dumps(state) + '\nPROCD_SIGNAL_STATE_END\n'
                 'Missing expected file: /tmp/johnny-signal-output/started\n'
                 'SigBlk:\t0000000000000000\nShdPnd:\t0000000000000001\n').encode()
        with tempfile.TemporaryDirectory() as directory:
            image = Path(directory) / 'firmware.img.gz'
            log = image.parent / 'boot-test.log'
            log.write_bytes(b'console echo \xef\n' + proof)
            namespace = dict(image=image, json=json, re=re, print=lambda *args: None)
            exec(parser, namespace)
            for broken in (proof.replace(b'129', b'0'), proof.replace(b'129', b'\xef129'),
                           proof.replace(b'PROCD_SIGNAL_STATE_END', b'PROCD_SIGNAL_STATE_\xefEND'),
                           proof.replace(b'0000000000000001', b'0000000000000000')):
                with self.subTest(proof=broken):
                    log.write_bytes(b'console echo \xef\n' + broken)
                    with self.assertRaises((AssertionError, ValueError)):
                        exec(parser, namespace)

    def test_dns_evidence_works_without_an_external_timeout_applet(self):
        source = (root / 'test-johnny-nat-diagnostics.sh').read_text()
        probe = re.search(r'for host in downloads\.immortalwrt\.org .*?\n            done', source, re.S).group(0)
        script = 'timeout() { return 127; }; nslookup() { echo LOOKUP "$@"; };\n' + probe
        result = subprocess.run(['sh', '-c', script], capture_output=True, text=True)
        self.assertEqual(result.stdout.count('LOOKUP'), 4, result.stderr)
        for line in result.stdout.splitlines():
            self.assertIn('-timeout=4 -retry=1', line)

    def test_connectivity_evidence_cannot_replace_test_status_when_tools_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            for name in ('ip', 'ubus', 'cat', 'uci', 'ps', 'grep', 'cut'):
                command = target / name
                command.write_text('#!/bin/sh\necho diagnostic-unavailable\nexit 7\n')
                command.chmod(0o755)
            source = (root / 'test-johnny-nat-diagnostics.sh').read_text()
            source = source.replace('/tmp/johnny-nat-diagnostics', str(target))
            script = 'set -e\n' + source + '\njohnny_connectivity_snapshot fixture\necho STILL_TESTING\nexit 23\n'
            result = subprocess.run(['sh', '-c', script], capture_output=True, text=True,
                                    env=dict(os.environ, PATH=str(target) + os.pathsep + os.environ['PATH']))
            self.assertEqual(result.returncode, 23, result.stderr)
            self.assertIn('STILL_TESTING', result.stdout)
            self.assertIn('diagnostic-unavailable', (target / 'connectivity-fixture.log').read_text())

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

    def test_traced_apk_keeps_failure_even_when_diagnostics_fail(self):
        source = (root / 'smoke-test25.py').read_text()
        trace = re.search(r'if strace -f .+?\nfi', source, re.S).group(0)
        trap = re.search(r"trap '(.+?)' EXIT", source, re.S).group(0)
        for status in (0, 8):
            script = (f'strace() {{ return {status}; }}; rm() {{ :; }}; '
                      'johnny_nat_diagnostics_dump() { return 9; };\n' + trap + '\n' + trace + '\nexit 0\n')
            result = subprocess.run(['sh', '-c', script], capture_output=True, text=True)
            self.assertEqual(result.returncode, status, result.stderr)

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
            self.assertEqual([(p['role'], p['protocol'], p.get('ipv6')) for p in json.loads(content)],
                             [(role, protocol, ipv6) for role, protocol in
                              [('bypass', 'dhcp'), ('bypass', 'static'), ('main', 'dhcp'),
                               ('main', 'static'), ('main', 'pppoe')] for ipv6 in [None, True, False]])

    def test_complete_smoke_input_without_building_or_booting(self):
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run([sys.executable, str(root / 'smoke-test25.py'),
                                     str(Path(directory) / 'not-built.img.gz'), '--check-input'],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('PASS: serial test input', result.stdout)

    def test_overlong_test_source_is_rejected_before_boot(self):
        for source in ('test-dashboard-api.sh', 'test-johnny-nat-diagnostics.sh', 'test-subscription-refresh.sh', 'test-dashboard-defaults.sh'):
            with self.subTest(source=source), tempfile.TemporaryDirectory() as directory:
                target = Path(directory)
                # Exercise the real source bundle, including newly added inputs.
                # A second hand-maintained dependency list can mask this guard.
                shutil.copytree(root, target, dirs_exist_ok=True, ignore=shutil.ignore_patterns('__pycache__'))
                with (target / source).open('a', encoding='utf-8') as output:
                    output.write('\n#' + 'x' * 500 + '\n')
                result = subprocess.run([sys.executable, str(target / 'smoke-test25.py'),
                                         str(target / 'not-built.img.gz'), '--check-input'],
                                        capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('exceeds 500 bytes', result.stderr)


if __name__ == '__main__':
    unittest.main()
