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
footer = urlopen(base + 'ucode/template/themes/aurora/footer.ut').read().decode()
desktop = re.search(r'<div class="theme-switcher">.*?</div>', footer, re.S).group()
mobile = re.search(r'<div class="theme-switcher mobile">.*?</div>', header, re.S).group()
(output / 'controls.html').write_text('''<!doctype html><html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Aurora native theme controls</title><link rel="stylesheet" href="aurora.css">
<style>body{padding:24px;background:var(--bg);color:var(--text)}section{margin:24px 0}</style>
<script>''' + theme + '''</script></head><body data-page="admin-johnny-home">
<h1>原生主题栏回归检查</h1><section class="mobile-nav-footer"><p>手机菜单主题栏</p>'''
    + mobile + '</section><footer><span>桌面页脚主题栏</span>' + desktop + '''</footer>
</body></html>''')
for name in ('index.html', 'mobile.html'):
    shutil.copyfile(root / 'ui-preview' / name, output / name)
(output / 'controls-mobile.html').write_text((root / 'ui-preview/mobile.html').read_text().replace('index.html', 'controls.html'))
for source in root.glob('johnny-*.js'):
    shutil.copyfile(source, output / 'source' / source.name)
shutil.copyfile(root / 'johnny.css', output / 'source/johnny.css')
shutil.copyfile(root / 'zerotier.png', output / 'zerotier.png')
print(f'Preview prepared: {output}. Serve this folder on 127.0.0.1 and open index.html or mobile.html.')
