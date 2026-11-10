#!/usr/bin/env python3
"""Exercise current customizations on a disposable copy of a verified release.

No image is built or published. The normal smoke runner owns the copied disk,
serial transport, per-file validation, test assertions and cleanup.
"""
import base64
import hashlib
import io
from pathlib import Path
import sys
import tarfile
import textwrap

root = Path(__file__).parent
files = {
    'johnny-home.js': 'www/luci-static/resources/view/johnny/home.js',
    'johnny-network.js': 'www/luci-static/resources/view/johnny/network.js',
    'johnny-model.js': 'www/luci-static/resources/johnny/model.js',
    'johnny.css': 'www/luci-static/resources/johnny/johnny.css',
    'johnny-dashboard.uc': 'usr/share/rpcd/ucode/luci.johnny',
    'johnny-dashboard-acl.json': 'usr/share/rpcd/acl.d/johnny.json',
    'johnny-ui-layout.uc': 'usr/libexec/johnny-ui-layout.uc',
    'johnny-dashboard-defaults.uc': 'usr/libexec/johnny-dashboard-defaults.uc',
    'johnny-dashboard-defaults.js': 'usr/libexec/johnny-dashboard-defaults.js',
    'johnny-dashboard-worker.js': 'usr/libexec/johnny-dashboard-worker.js',
    'johnny-meowx-bridge.js': 'www/luci-static/resources/johnny/meowx-bridge.js',
    '99-zzz-johnnywrt': 'etc/uci-defaults/99-zzz-johnnywrt',
    'johnny-remove-zerotier': 'usr/libexec/johnny-remove-zerotier',
    'johnny-menu.json': 'usr/share/luci/menu.d/johnny.json',
    'johnny-meowx.keep': 'lib/upgrade/keep.d/johnny-meowx',
}
payload = io.BytesIO()
with tarfile.open(fileobj=payload, mode='w:gz') as archive:
    for source, destination in files.items():
        data = (root / source).read_bytes()
        info = tarfile.TarInfo(destination)
        info.size, info.mode = len(data), 0o644
        archive.addfile(info, io.BytesIO(data))
encoded = '\n'.join(textwrap.wrap(base64.b64encode(payload.getvalue()).decode(), 76))
inject = "set -ex\ncat > /tmp/apple-overlay.b64 <<'APPLE_EOF'\n" + encoded + '\nAPPLE_EOF\n'
inject += "ucode -e 'import {readfile,writefile} from \"fs\"; writefile(\"/tmp/apple-overlay.tgz\", b64dec(replace(readfile(\"/tmp/apple-overlay.b64\"), /\\s/g, \"\")));'\n"
inject += "echo '" + hashlib.sha256(payload.getvalue()).hexdigest() + "  /tmp/apple-overlay.tgz' | sha256sum -c -\n"
inject += 'tar xzf /tmp/apple-overlay.tgz -C /\napk update\napk upgrade meowx meowx-core luci-app-meowx luci-i18n-meowx-zh-cn\napk add tailscale\n'
inject += '/etc/init.d/zerotier stop\napk del luci-i18n-zerotier-zh-cn luci-app-zerotier zerotier\nrm -f /www/luci-static/resources/view/johnny/zerotier.js /usr/libexec/johnny-zt-nat /etc/hotplug.d/net/31-zerotier-interface /etc/hotplug.d/iface/90-zerotier-rebind /etc/nftables.d/30-johnny-zt-lan.nft /usr/share/nftables.d/chain-pre/srcnat/30-johnny-zt-lan.nft\nsh /etc/uci-defaults/99-zzz-johnnywrt\n/etc/init.d/rpcd restart\nsleep 2\n'
runner = root / 'smoke-test25.py'
source = runner.read_text().replace('sh /rom/etc/uci-defaults/99-zz-bypass', 'true').replace('sh /rom/etc/uci-defaults/99-zzz-johnnywrt', 'sh /etc/uci-defaults/99-zzz-johnnywrt')
anchor = "checks = 'set -e\\n' + checks"
assert source.count(anchor) == 1, 'Smoke runner changed; adapt the source overlay before testing'
source = source.replace(anchor, 'checks = ' + repr(inject) + ' + checks')
sys.argv[0] = str(runner)
exec(compile(source, str(runner), 'exec'), {'__name__': '__main__', '__file__': str(runner)})
