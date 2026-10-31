#!/usr/bin/env python3
"""Reject drift between the preflight vendor feed and the final package manifest."""
import json
from pathlib import Path
import sys

expected = json.loads(Path(__file__).with_name('meowx-versions.json').read_text())
source = Path(sys.argv[1])
if source.suffix == '.json':
    feed = json.loads(source.read_text())
    assert feed['architecture'] == 'x86_64', 'Wrong vendor feed architecture'
    actual = feed['packages']
else:
    actual = dict(line.split(' - ', 1) for line in source.read_text().splitlines() if ' - ' in line)
for package, version in expected.items():
    assert actual.get(package) == version, f'{package}: expected {version}, got {actual.get(package)}'
print('PASS: official MeowX package versions match:', expected)
