#!/usr/bin/env python3
"""Install the verified backport into a disposable image for a separate next boot.

This does not build a release image. The original compressed input stays intact.
The resulting overlay image is only a diagnostic fixture, never a sysupgrade file.
"""
import base64
import hashlib
import io
from pathlib import Path
import sys
import tarfile
import textwrap

image, packages = map(Path, sys.argv[1:])
version = '2026.03.13~58eb263d-r2'
names = [f'{name}-{version}.apk' for name in ('procd', 'procd-ujail', 'procd-seccomp')]
names += ['packages.adb', 'keys/johnny-procd.pem']
hashes = dict(line.split(None, 1)[::-1] for line in (packages / 'SHA256SUMS').read_text().splitlines())
payload = io.BytesIO()
with tarfile.open(fileobj=payload, mode='w:gz') as archive:
    for name in names:
        data = (packages / name).read_bytes()
        assert hashlib.sha256(data).hexdigest() == hashes[name], f'Package artifact changed: {name}'
        info = tarfile.TarInfo(name)
        info.size, info.mode = len(data), 0o644
        archive.addfile(info, io.BytesIO(data))
encoded = '\n'.join(textwrap.wrap(base64.b64encode(payload.getvalue()).decode(), 76))
checks = "set -ex\ncat > /tmp/procd-packages.b64 <<'PROCD_EOF'\n" + encoded + '\nPROCD_EOF\n'
checks += "ucode -e 'import {readfile,writefile} from \"fs\"; writefile(\"/tmp/procd-packages.tgz\", b64dec(replace(readfile(\"/tmp/procd-packages.b64\"), /\\s/g, \"\")));'\n"
checks += "echo '" + hashlib.sha256(payload.getvalue()).hexdigest() + "  /tmp/procd-packages.tgz' | sha256sum -c -\n"
checks += 'mkdir /tmp/johnny-procd\ntar xzf /tmp/procd-packages.tgz -C /tmp/johnny-procd\n'
checks += 'cp /tmp/johnny-procd/keys/johnny-procd.pem /etc/apk/keys/\n'
checks += 'apk --no-network --repository /tmp/johnny-procd/packages.adb add ' + ' '.join(f'{name}={version}' for name in ('procd', 'procd-ujail', 'procd-seccomp')) + '\n'
for name in ('procd', 'procd-ujail', 'procd-seccomp'):
    checks += f'test "$(apk info -e -v {name})" = {name}-{version}\n'
checks += '''
count=0
while [ "$(readlink /overlay/.fs_state)" != 2 ]; do
    test "$count" -lt 60
    sleep 1
    count=$((count+1))
done
sha256sum /sbin/procd /sbin/ujail /lib/libpreload-seccomp.so
sync
echo JOHNNY_BOOT_TEST_PASSED
echo JOHNNY_NAT_DIAGNOSTICS_END
'''
runner = Path(__file__).with_name('smoke-test25.py')
source = runner.read_text()
anchor = r"checks = 'set -e\n' + checks"
assert source.count(anchor) == 1
source = source.replace(anchor, 'checks = ' + repr(checks))
anchor = '    disk.unlink(missing_ok=True)'
assert source.count(anchor) == 1
source = source.replace(anchor, '''    if passed:
        with disk.open('rb') as source, gzip.open(image.parent / 'procd-installed.img.gz', 'wb', compresslevel=1) as target:
            shutil.copyfileobj(source, target)
''' + anchor)
source = source.replace('PASS: boot, branding, APK kernel feed, offline MeowX, device rebinding and scoped ZeroTier return-path NAT',
                        'PASS: package overlay prepared; running PID1 and behavior require the separate next boot')
sys.argv = [str(runner), str(image)]
exec(compile(source, str(runner), 'exec'), {'__name__': '__main__', '__file__': str(runner)})
