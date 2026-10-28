#!/usr/bin/env python3
"""Prepare offline synthetic previews of the real LuCI views and pinned Aurora CSS."""
from pathlib import Path
import re
import shutil
import sys
from urllib.request import urlopen

root = Path(__file__).resolve().parent
output = Path(sys.argv[1]).resolve()
output.mkdir(parents=True, exist_ok=True)
(output / 'source').mkdir(exist_ok=True)
base = 'https://raw.githubusercontent.com/eamonxg/luci-theme-aurora/84c27b66952e6fc4be60128067a6b88bfd34afb5/'
header = urlopen(base + 'ucode/template/themes/aurora/header.ut').read().decode()
theme = next(s for s in re.findall(r'<script>(.*?)</script>', header, re.S) if 'const setTheme' in s)
script = (root / 'ui-preview/fixture.js').read_text().replace('/* AURORA_THEME_SCRIPT */', theme)
(output / 'fixture.js').write_text(script)
(output / 'aurora.css').write_bytes(urlopen(base + 'htdocs/luci-static/aurora/main.css').read())
for name in ('index.html', 'mobile.html'):
    shutil.copyfile(root / 'ui-preview' / name, output / name)
for source in root.glob('johnny-*.js'):
    shutil.copyfile(source, output / 'source' / source.name)
shutil.copyfile(root / 'johnny.css', output / 'source/johnny.css')
shutil.copyfile(root / 'zerotier.png', output / 'zerotier.png')
print(f'Preview prepared: {output}. Serve this folder on 127.0.0.1 and open index.html or mobile.html.')
