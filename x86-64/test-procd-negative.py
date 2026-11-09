#!/usr/bin/env python3
"""Require the original stable package to fail the precise startup-HUP probe."""
import json
import os
from pathlib import Path
import re
import sys

assert os.environ.get('PROCD_TEST_BINARY'), 'The compiled VM probe is required'
image = Path(sys.argv[1])
runner = Path(__file__).with_name('smoke-test25.py')
source = runner.read_text()
anchor = "plans = image.parent / 'network-test-plans.json'"
assert source.count(anchor) == 1
checks = '''set -ex
test "$(apk info -e -v procd)" = procd-2026.03.13~58eb263d-r1
test "$(apk info -e -v procd-ujail)" = procd-ujail-2026.03.13~58eb263d-r1
sh /tmp/test-procd-startup.sh
echo JOHNNY_BOOT_TEST_PASSED
echo JOHNNY_NAT_DIAGNOSTICS_END
'''
source = source.replace(anchor, 'checks = ' + repr(checks) + '\n' + anchor)
failed = False
try:
    exec(compile(source, str(runner), 'exec'), {'__name__': '__main__', '__file__': str(runner)})
except SystemExit as exc:
    assert str(exc) == 'Boot checks failed or timed out; see boot-test.log', str(exc)
    failed = True
assert failed, 'Original package unexpectedly survived the early HUP'
log = (image.parent / 'boot-test.log').read_text().replace('\r', '')
states = re.findall(r'\nPROCD_SIGNAL_STATE_BEGIN\n(.*?)\nPROCD_SIGNAL_STATE_END\n', log, re.S)
assert len(states) == 1, 'The native exit state is missing'
instance = json.loads(states[0])['johnny-signal-test']['instances']['main']
assert instance['running'] is False and instance['exit_code'] == 129, instance
assert 'Missing expected file: /tmp/johnny-signal-output/started' in log
assert re.search(r'^SigBlk:\s+0000000000000000$', log, re.M)
assert re.search(r'^ShdPnd:\s+0000000000000001$', log, re.M)
print('PASS: original ujail killed by native startup HUP, exit 129, payload never started')
