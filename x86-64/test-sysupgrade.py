#!/usr/bin/env python3
"""Destructive upgrades ONLY inside a disposable QEMU guest, never a live router."""
import argparse
import functools
import gzip
import hashlib
import http.server
import json
import os
import re
from pathlib import Path
import selectors
import shutil
import socket
import subprocess
import sys
import threading
import time

import paramiko

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('base', type=Path)
parser.add_argument('image', type=Path)
parser.add_argument('--machine', choices=('pc', 'q35'), default='pc')
parser.add_argument('--accel', choices=('tcg', 'kvm'), default='tcg')
parser.add_argument('--reboot-only', action='store_true')
parser.add_argument('--package-migration-only', action='store_true')
parser.add_argument('--with-meowx-mesh', action='store_true')
parser.add_argument('--without-zerotier', action='store_true')
args = parser.parse_args()
base, image = args.base.resolve(), args.image.resolve()
disk = image.parent / 'upgrade-test.img'
shutil.copyfile(base, disk)
password = 'disposable-upgrade-test'
handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(image.parent))
httpd = http.server.ThreadingHTTPServer(('127.0.0.1', 33380), handler)
threading.Thread(target=httpd.serve_forever, daemon=True).start()
log = (image.parent / 'upgrade-test.log').open('wb')
monitor_path = image.parent / 'upgrade-monitor.sock'
completed = False
qemu = subprocess.Popen([
    'qemu-system-x86_64', '-accel', args.accel, '-machine', args.machine, '-m', '1024', '-smp', '2',
    # Match deployed i440FX/BIOS machines; smoke-test25 covers q35/UEFI.
    '-drive', f'file={disk},format=raw,if=virtio',
    '-netdev', 'user,id=lan,hostfwd=tcp:127.0.0.1:22222-:22',
    '-object', f'filter-dump,id=upgrade-network,netdev=lan,maxlen=512,file={image.parent / "upgrade-network.pcap"}',
    '-device', 'virtio-net-pci,netdev=lan', '-display', 'none',
    '-serial', 'stdio', '-monitor', 'none',
    '-qmp', f'unix:{monitor_path},server=on,wait=off'],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)


def connect():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect('127.0.0.1', port=22222, username='root', password=password,
                       timeout=4, auth_timeout=4, banner_timeout=4,
                       allow_agent=False, look_for_keys=False)
    except Exception:
        client.close()
        raise
    return client


def run(client, command, sensitive=False):
    _, out, err = client.exec_command(command, timeout=90)
    result = out.read().decode()
    errors = err.read().decode()
    if out.channel.recv_exit_status() != 0:
        detail = '' if sensitive else f'\n{result}\n{errors}'
        raise RuntimeError(f'Guest check failed: {command}{detail}')
    return result


def capture_failure_network(client):
    # Disposable guest only. Preserve the original failure even if collection fails.
    try:
        transport = client.get_transport() if client is not None else None
        if transport is None or not transport.is_active():
            return
        _, out, err = client.exec_command("""sh <<'DIAGNOSTIC' 2>&1
date -u
ip -4 addr; ip -6 addr
ip -4 rule; ip -6 rule
ip -4 route show table all; ip -6 route show table all
ubus -t 3 call network.interface dump
cat /etc/resolv.conf /tmp/resolv.conf.d/resolv.conf.auto
nft list ruleset
logread -l 100 | grep -E 'netifd|dnsmasq|udhcpc|odhcp6c'
for host in downloads.immortalwrt.org dl.miaomiaowux.com; do
    nslookup -timeout=4 -retry=1 -type=A "$host"
    nslookup -timeout=4 -retry=1 -type=AAAA "$host"
done
for family in 4 6; do
    curl -"$family" -v --connect-timeout 3 --max-time 7 https://downloads.immortalwrt.org/releases/25.12.2/targets/x86/64/packages/packages.adb -o /dev/null
done
DIAGNOSTIC""", timeout=45)
        evidence = out.read() + err.read()
        (image.parent / 'upgrade-network-failure.log').write_bytes(evidence)
    except Exception as error:
        print(f'Could not capture upgrade network evidence: {error}', flush=True)


def wait_ssh(previous_boot=None):
    started = time.monotonic()
    # TCG must write a 1 GiB image before booting; 240s was marginal in CI.
    deadline = started + 600
    next_report = started + 30
    last_status = 'No successful SSH connection yet'
    while time.monotonic() < deadline:
        if qemu.poll() is not None:
            raise RuntimeError('QEMU stopped unexpectedly')
        client = None
        try:
            client = connect()
            boot = run(client, 'cat /proc/sys/kernel/random/boot_id').strip()
            state = run(client, 'readlink /overlay/.fs_state').strip()
            ports = run(client, 'uci -q get network.@device[0].ports').split()
            pending = run(client, 'uci changes network', sensitive=True).strip()
            quickstart = bool(run(client, 'test ! -x /usr/sbin/quickstart || echo present').strip())
            lan = json.loads(run(client, 'ubus -t 3 call network.interface.lan status'))
            dns = json.loads(run(client, 'ubus -t 3 call service list \'{"name":"dnsmasq"}\''))
            instances = dns.get('dnsmasq', {}).get('instances', {})
            resolvers = run(client, "awk '/^nameserver / {print $2}' /tmp/resolv.conf.d/resolv.conf.auto").split()
            # These disposable upgrade fixtures use DHCP LAN for Internet access.
            network_ready = (lan.get('up') is True and lan.get('pending') is False
                             and bool(lan.get('ipv4-address'))
                             and any(route.get('target') == '0.0.0.0' and route.get('mask') == 0
                                     and route.get('nexthop') for route in lan.get('route', []))
                             and bool(lan.get('dns-server')) and set(lan['dns-server']).issubset(resolvers)
                             and bool(instances) and all(instance.get('running') is True for instance in instances.values())
                             and not pending and (not quickstart or 'dheth0' in ports))
            last_status = f'boot changed={boot != previous_boot}, overlay state={state}, network ready={network_ready}'
            # S95done marks FS_STATE_READY=2 after initial filesystem setup.
            # Rebooting earlier lets fstools clear the pending overlay next boot.
            # QuickStart commits its DHCP helper bridge port after overlay setup.
            # The old fixture needs this guard; new firmware has no QuickStart.
            if (previous_boot is None or boot != previous_boot) and state == '2' and network_ready:
                # Exercise the local listener without warming a public download name.
                run(client, 'nslookup -timeout=1 -retry=1 -type=A localhost 127.0.0.1 >/dev/null')
                run(client, 'sync')
                print(f'PASS: SSH, overlay and network ready after {time.monotonic() - started:.0f}s', flush=True)
                return client
            client.close()
        except (OSError, EOFError, paramiko.SSHException, RuntimeError) as error:
            last_status = f'{type(error).__name__}: {error}'
            if client is not None:
                client.close()
        if time.monotonic() >= next_report:
            print(f'Waiting for guest ({time.monotonic() - started:.0f}s): {last_status}', flush=True)
            next_report = time.monotonic() + 30
        time.sleep(3)
    raise RuntimeError('SSH, overlay and network did not become ready: ' + last_status)


def verify_package_versions(client):
    expected = json.loads(Path(__file__).with_name('meowx-versions.json').read_text())
    actual = set(run(client, 'apk info -e -v ' + ' '.join(expected)).splitlines())
    assert actual == {name + '-' + version for name, version in expected.items()}, 'Installed MeowX versions differ: ' + repr(actual)
    print('PASS: installed MeowX versions match the pinned manifest', flush=True)


def verify_mesh_dependency(client):
    run(client, r'''set -e
apk info -e tailscale >/dev/null
test -x /usr/sbin/tailscale
test -x /usr/sbin/tailscaled
/etc/init.d/tailscale enabled
/etc/init.d/tailscale running
case "$(/usr/sbin/tailscale status --json | jsonfilter -e '@.BackendState')" in
    Stopped|NeedsLogin) ;; *) exit 1;;
esac
test "$(/usr/sbin/tailscale debug prefs | jsonfilter -e '@.WantRunning')" = false
test "$(uci get tailscale.settings.state_file)" = /etc/tailscale/tailscaled.state
jsonfilter -i /etc/tailscale/tailscaled.state -e '@._machinekey' | grep -q .
''', sensitive=True)
    print('PASS: native Mesh dependency, saved identity and enabled service are present', flush=True)


def firewall_migration_hashes(config, fields):
    # These vendor scripts recreate their exact default includes at EOF.
    # Unknown includes could change rule precedence when crossed: reject them.
    names = ('zerotier_input', 'zerotier_srcnat', 'zerotier_forward', 'meowx', 'johnny_zt_nat')
    includes = {key for key, value in fields.items() if key.startswith('firewall.')
                and value == hashlib.sha256(b'include').hexdigest()}
    if includes != {'firewall.' + name for name in names}:
        return None
    blocks = [("config include 'zerotier_%s'\n\toption type 'nftables'\n"
               "\toption path '/var/run/zerotier-one/_fw4/%s.nft'\n"
               "\toption position 'chain-pre'\n\toption chain '%s'\n\n").encode() % (c, c, c)
              for c in (b'input', b'srcnat', b'forward')]
    script = b"config include '%s'\n\toption type 'script'\n\toption path '%s'\n\toption fw4_compatible '1'\n\n"
    blocks.append(script % (b'meowx', b'/etc/meowx/scripts/firewall_include.sh'))
    own = script % (b'johnny_zt_nat', b'/usr/libexec/johnny-zt-nat')
    parts = re.split(b'(?m)(?=^(?:config |#))', config)
    if any(parts.count(block) != 1 for block in blocks + [own]):
        return None
    positions = [config.index(block) for block in blocks]
    if positions != sorted(positions) or config.index(own) > positions[-1]:
        return None  # Preserve the ordering between the two script includes.
    targets = {
        'meowx_only': b''.join(part for part in parts if part != blocks[-1]) + blocks[-1],
        'zerotier_then_meowx': b''.join(part for part in parts if part not in blocks) + b''.join(blocks),
    }
    return {name: hashlib.sha256(data).hexdigest() for name, data in targets.items()}


def zerotier_removal_targets(network, firewall):
    names = ('johnny_zerotier', 'zerotier_to_lan', 'lan_to_zerotier', 'johnny_zt_nat',
             'zerotier_input', 'zerotier_srcnat', 'zerotier_forward')
    def removed(data, names):
        parts = re.split(rb'(?m)(?=^config\s)', data)
        result = []
        for part in parts:
            header = re.match(rb'config\s+\S+\s+[\x27\x22]?([^\s\x27\x22]+)', part)
            if not header or header[1].decode() not in names:
                result.append(part)
        return result
    network = b''.join(removed(network, ('zerotier',)))
    parts = removed(firewall, names)
    meowx = [part for part in parts if re.match(rb"config include ['\"]meowx['\"]\s*\n", part)]
    variants = [b''.join(parts)]
    if len(meowx) == 1:
        variants.append(b''.join(part for part in parts if part != meowx[0]) + meowx[0])
    return {'/etc/config/network': [hashlib.sha256(network).hexdigest()],
            '/etc/config/firewall': [hashlib.sha256(data).hexdigest() for data in variants]}


def retention_snapshot(client, paths, phase):
    sums = dict(line.split(maxsplit=1)[::-1] for line in run(client, 'sha256sum ' + ' '.join(paths)).splitlines())
    config = run(client, 'cat /etc/config/meowx', sensitive=True).encode()
    # Only these exact vendor defaults may be appended; hash every original byte.
    defaults = {'ggy': ['enabled'], 'akile': ['enabled'], 'mesh': ['enabled', 'force_map', 'router_access']}
    prefixes = {}
    for mask in range(1, 8):
        names = [name for i, name in enumerate(defaults) if mask & (1 << i)]
        addition = ''.join("config %s '%s'\n" % (name, name) +
                           ''.join("\toption %s '0'\n" % key for key in defaults[name]) + '\n' for name in names).encode()
        if config.endswith(addition):
            prefixes[','.join(names)] = hashlib.sha256(config[:-len(addition)]).hexdigest()
    # Record names and hashes only: never put passwords or identity keys in logs.
    fields = {}
    for line in run(client, 'uci -q show network; uci -q show dhcp; uci -q show firewall; uci -q show meowx; test ! -f /etc/config/zerotier || uci -q show zerotier', sensitive=True).splitlines():
        if '=' not in line or not line.startswith(('network.', 'dhcp.', 'firewall.', 'meowx.', 'zerotier.')):
            continue
        name, _, value = line.partition('=')
        fields[name] = hashlib.sha256(value.encode()).hexdigest()
    accounts = {}
    for line in run(client, 'cat /etc/shadow', sensitive=True).splitlines():
        name, _, value = line.partition(':')
        accounts[name] = hashlib.sha256(value.encode()).hexdigest()
    snapshot = {'files': sums, 'uci_fields': fields, 'shadow_accounts': accounts,
                'meowx_before_defaults': prefixes,
                'firewall_after_vendor_defaults': firewall_migration_hashes(run(client, 'cat /etc/config/firewall', sensitive=True).encode(), fields),
                'uptime': run(client, 'cut -d " " -f 1 /proc/uptime').strip(),
                'file_metadata': run(client, 'ls -ln ' + ' '.join(paths)).splitlines(),
                'pending_uci_keys': [line.partition('=')[0] for line in run(client, 'uci changes', sensitive=True).splitlines()
                                     if line.lstrip('-').startswith(('network.', 'dhcp.', 'firewall.', 'meowx.', 'zerotier.'))]}
    (image.parent / f'retention-{phase}.json').write_text(json.dumps(snapshot, indent=2))
    return snapshot


def assert_retained(baseline, current):
    meowx = '/etc/config/meowx'
    changed = [path for path in baseline['files'].keys() | current['files'].keys()
               if current['files'].get(path) != baseline['files'].get(path)]
    expected_fields = dict(baseline['uci_fields'])
    defaults = {'ggy': ['enabled'], 'akile': ['enabled'], 'mesh': ['enabled', 'force_map', 'router_access']}
    migrated = False
    removal = baseline.get('without_zerotier')
    if removal and all(current['files'].get(path) in hashes for path, hashes in removal.items()):
        changed = [path for path in changed if path not in removal]
        names = ('network.zerotier', 'firewall.johnny_zerotier', 'firewall.zerotier_to_lan',
                 'firewall.lan_to_zerotier', 'firewall.johnny_zt_nat', 'firewall.zerotier_input',
                 'firewall.zerotier_srcnat', 'firewall.zerotier_forward')
        expected_fields = {key: value for key, value in expected_fields.items()
                           if not key.startswith('zerotier.') and not any(key == name or key.startswith(name + '.') for name in names)}
        migrated = True
    for mask in range(1, 8):
        names = [name for i, name in enumerate(defaults) if mask & (1 << i)]
        if meowx not in changed or current.get('meowx_before_defaults', {}).get(','.join(names)) != baseline['files'][meowx]:
            continue
        if any(k == 'meowx.' + name or k.startswith('meowx.' + name + '.') for name in names for k in expected_fields):
            continue
        changed.remove(meowx)
        for name in names:
            expected_fields['meowx.' + name] = hashlib.sha256(name.encode()).hexdigest()
            expected_fields.update({'meowx.' + name + '.' + key: hashlib.sha256(b"'0'").hexdigest() for key in defaults[name]})
        migrated = True
        break
    firewall = '/etc/config/firewall'
    expected_firewall = baseline.get('firewall_after_vendor_defaults')
    if firewall in changed and expected_firewall and current['files'].get(firewall) in expected_firewall.values():
        changed.remove(firewall)
        migrated = True
    assert not changed, 'Retained settings changed: ' + ', '.join(changed)
    assert current['uci_fields'] == expected_fields, 'Retained UCI fields changed beyond the known disabled vendor defaults'
    assert current['shadow_accounts'] == baseline['shadow_accounts'], 'Retained account hashes changed'
    assert not current['pending_uci_keys'], 'Pending configuration changes'
    return migrated


try:
    # Configure a test-only password through the serial console of the old image.
    selector = selectors.DefaultSelector()
    selector.register(qemu.stdout, selectors.EVENT_READ)
    start = time.monotonic()
    output = b''
    activated = False
    while time.monotonic() - start < 180:
        for key, _ in selector.select(timeout=1):
            data = os.read(key.fileobj.fileno(), 65536)
            if not data:
                raise RuntimeError('Guest exited during initial boot')
            log.write(data)
            log.flush()
            output += data
        if not activated and time.monotonic() - start > 65 and b'Please press Enter' in output:
            qemu.stdin.write(b'\n')
            qemu.stdin.flush()
            activated = True
        if activated and b'root@johnnywrt:~# ' in output.lower():
            qemu.stdin.write(f"printf '{password}\\n{password}\\n' | passwd root\n".encode())
            qemu.stdin.flush()
            break
    else:
        raise RuntimeError('Initial guest console not ready')
    selector.close()
    # Drain serial output continuously so a full pipe cannot block an upgrade.
    def drain():
        while data := qemu.stdout.read(4096):
            log.write(data)
            log.flush()
    reader = threading.Thread(target=drain, daemon=True)
    reader.start()
    client = wait_ssh()
    # Prove this virtual hardware can reboot before testing any firmware update.
    boot = run(client, 'cat /proc/sys/kernel/random/boot_id').strip()
    run(client, "(trap '' HUP; sleep 2; reboot) >/tmp/reboot-test.log 2>&1 </dev/null &")
    client.close()
    client = wait_ssh(boot)
    print(f'PASS: baseline BIOS reboot and SSH authentication ({args.machine})', flush=True)
    if args.reboot_only:
        client.close()
        completed = True
        sys.exit(0)
    if args.with_meowx_mesh:
        print(run(client, 'apk update && apk upgrade meowx meowx-core luci-app-meowx luci-i18n-meowx-zh-cn && apk add tailscale'), flush=True)
        verify_package_versions(client)
        run(client, r'''set -e
/etc/init.d/tailscale enable
/etc/init.d/tailscale start
for attempt in $(seq 1 30); do
    /usr/sbin/tailscale status --json >/tmp/tailscale-status.json 2>/dev/null && break
    sleep 1
done
# Generate a disposable native identity without contacting any real controller.
if /usr/sbin/tailscale up --login-server=http://127.0.0.1:9 --accept-dns=false --accept-routes=false --netfilter-mode=off --timeout=3s >/tmp/tailscale-up.log 2>&1; then exit 1; fi
/usr/sbin/tailscale down
sync
''')
        verify_mesh_dependency(client)
    run(client, r'''set -e
/etc/init.d/zerotier stop
uci set zerotier.global.enabled='0'
uci set system.@system[0].hostname='upgrade-check'
uci set network.lan.hostname='retained-test'
uci set network.lan.ipv6='0'
uci set dhcp.lan.ra='disabled'
uci set dhcp.lan.dhcpv6='disabled'
for name in first second; do
    uci set firewall.upgrade_keep_$name='rule'
    uci set firewall.upgrade_keep_$name.name="upgrade-keep-$name"
    uci set firewall.upgrade_keep_$name.src='wan'
    uci set firewall.upgrade_keep_$name.src_ip='192.0.2.123'
    uci set firewall.upgrade_keep_$name.target='DROP'
done
uci commit
mkdir -p /etc/meowx/subscriptions /etc/zerotier/networks.d
printf 'rules:\n  - MATCH,DIRECT\n' > /etc/meowx/subscriptions/upgrade-test.yaml
printf 'allowDefault=0\nallowDNS=0\n' > /etc/zerotier/networks.d/0123456789abcdef.local.conf
test -s /etc/zerotier/identity.secret
''')
    retained = ['/etc/config/network', '/etc/config/dhcp', '/etc/config/firewall', '/etc/config/meowx', '/etc/config/zerotier',
                '/etc/shadow', '/etc/dropbear/dropbear_ed25519_host_key',
                '/etc/zerotier/identity.secret',
                '/etc/zerotier/networks.d/0123456789abcdef.local.conf',
                '/etc/meowx/subscriptions/upgrade-test.yaml']
    if args.with_meowx_mesh:
        retained += ['/etc/config/tailscale', '/etc/tailscale/tailscaled.state']
        backup_list = run(client, 'sysupgrade -l').splitlines()
        for path in retained:
            assert path in backup_list, f'Not preserved by sysupgrade: {path}'
    run(client, r'''set -e
uci set meowx.config.enabled=0
uci set meowx.ggy=ggy
uci set meowx.ggy.enabled=1
uci add_list meowx.ggy.token='SYNTHETIC_GGY_KEEP'
uci set meowx.akile=akile
uci set meowx.akile.enabled=1
uci set meowx.akile.key='ak_SYNTHETIC_KEEP'
uci add_list meowx.akile.node='SYNTHETIC_NODE_KEEP'
uci commit meowx
printf '%s\n' '{"enabled":true,"manual":[{"address":"127.0.0.1:9","token":"pgnfw_SYNTHETIC_KEEP"}],"report_urls":["https://127.0.0.1:9/api/firewall/pgnfw_SYNTHETIC_KEEP"]}' > /etc/meowx/po0.json
touch /etc/sysupgrade.conf
grep -qxF /etc/meowx/po0.json /etc/sysupgrade.conf || echo /etc/meowx/po0.json >> /etc/sysupgrade.conf
''', sensitive=True)
    retained += ['/etc/meowx/po0.json', '/etc/sysupgrade.conf']
    if args.without_zerotier:
        retained = [path for path in retained if 'zerotier' not in path]
    baseline = retention_snapshot(client, retained, 'baseline')
    if args.without_zerotier:
        baseline['without_zerotier'] = zerotier_removal_targets(
            run(client, 'cat /etc/config/network', sensitive=True).encode(),
            run(client, 'cat /etc/config/firewall', sensitive=True).encode())
        (image.parent / 'retention-baseline.json').write_text(json.dumps(baseline, indent=2))
    if args.package_migration_only:
        print(run(client, 'apk update && apk upgrade meowx meowx-core luci-app-meowx luci-i18n-meowx-zh-cn'), flush=True)
        verify_package_versions(client)
        assert_retained(baseline, retention_snapshot(client, retained, 'after-packages'))
        boot = run(client, 'cat /proc/sys/kernel/random/boot_id').strip()
        run(client, "(trap '' HUP; sleep 2; reboot) >/tmp/migration-reboot.log 2>&1 </dev/null &")
        client.close()
        client = wait_ssh(boot)
        if args.with_meowx_mesh:
            verify_mesh_dependency(client)
        assert_retained(baseline, retention_snapshot(client, retained, 'after-reboot'))
        verify_package_versions(client)
        print('PASS: original settings preserved after official MeowX package migration and reboot', flush=True)
        client.close()
        completed = True
        sys.exit(0)
    baseline_repository = json.loads(run(client, '/usr/libexec/johnny-update status'))['repository'].removesuffix('/releases')
    assert baseline_repository in ('https://github.com/Johnnnypro/JohnnyWrt', 'https://github.com/Johnnnnnnnyx/ImmortalWrt-ImageBuilder')
    with client.open_sftp() as sftp:
        sftp.put(str(Path(__file__).with_name('test-update-metadata.sh')), '/tmp/test-update-metadata.sh')
    # Round 1 validates old -> new; round 2 validates the new upgrade baseline.
    for round_number in (1, 2):
        backup_list = run(client, 'sysupgrade -l').splitlines()
        for path in retained:
            assert path in backup_list, f'Not preserved by sysupgrade: {path}'
        run(client, f'curl -fsS http://10.0.2.2:33380/{image.name} -o /tmp/upgrade.img.gz')
        expected_repository = baseline_repository if round_number == 1 else 'https://github.com/Johnnnypro/JohnnyWrt'
        run(client, 'sh /tmp/test-update-metadata.sh /usr/libexec/johnny-update /tmp/upgrade.img.gz ' + expected_repository)
        run(client, 'sysupgrade -T /tmp/upgrade.img.gz')
        before = retention_snapshot(client, retained, f'round-{round_number}-before')
        assert_retained(baseline, before)
        boot = run(client, 'cat /proc/sys/kernel/random/boot_id').strip()
        run(client, "(trap '' HUP; sleep 2; sysupgrade /tmp/upgrade.img.gz) >/tmp/upgrade.log 2>&1 </dev/null &")
        client.close()
        client = wait_ssh(boot)
        if args.with_meowx_mesh:
            verify_mesh_dependency(client)
        actual = retention_snapshot(client, retained, f'round-{round_number}-after')
        if assert_retained(baseline, actual):
            print('PASS: only verified vendor default additions/include relocation occurred; original configuration is retained', flush=True)
        with client.open_sftp() as sftp:
            sftp.put(str(Path(__file__).with_name('test-update-metadata.sh')), '/tmp/test-update-metadata.sh')
            sftp.put(str(Path(__file__).with_name('test-ui-layout.sh' if args.without_zerotier else 'test-legacy-ui-layout.sh')), '/tmp/test-ui-layout.sh')
        run(client, 'sh /tmp/test-update-metadata.sh')
        run(client, 'sh /tmp/test-ui-layout.sh')
        menu_fixture = image.parent / 'luci-menu-test'
        menu_fixture.mkdir(exist_ok=True)
        with client.open_sftp() as sftp:
            sftp.get('/www/luci-static/resources/ui.js', str(menu_fixture / 'ui.js'))
            for name in sftp.listdir('/usr/share/luci/menu.d'):
                if name.endswith('.json'):
                    sftp.get('/usr/share/luci/menu.d/' + name, str(menu_fixture / name))
        subprocess.run(['node', str(Path(__file__).with_name('test-luci-menu.js' if args.without_zerotier else 'test-legacy-luci-menu.js')), str(menu_fixture)], check=True)
        status = json.loads(run(client, '/usr/libexec/johnny-update status'))
        assert status['state'] == 'idle' and status['current'].startswith('Johnnywrt-ISO-')
        assert status['repository'] == 'https://github.com/Johnnnypro/JohnnyWrt/releases'
        run(client, r'''set -e
test "$(uci get system.@system[0].hostname)" = upgrade-check
grep -F ' -F -z -P ' /etc/init.d/dropbear
pid=$(cat /var/run/dropbear.*.pid | head -1)
tr '\0' ' ' < "/proc/$pid/cmdline" | grep ' -z '
test ! -e /usr/sbin/quickstart
test -x /usr/bin/quickstart
test ! -e /www/luci-static/resources/johnny/custom-style.js
test -s /usr/share/rpcd/ucode/luci.johnny
for page in home network; do test -s /www/luci-static/resources/view/johnny/$page.js; done
ubus call luci.johnny status > /tmp/dashboard-status.json
test -n "$(jsonfilter -i /tmp/dashboard-status.json -e '@.system.uptime')"
test -s /etc/johnnywrt-build
test -s /usr/share/rpcd/acl.d/johnny-update.json
test -s /www/luci-static/resources/johnny/update.js
grep -q johnny_online_update /www/luci-static/resources/view/system/flash.js
/usr/bin/meowx-core -t -d /etc/meowx/run -f /etc/meowx/subscriptions/upgrade-test.yaml
fw4 check
''')
        if args.without_zerotier:
            run(client, 'test ! -e /etc/init.d/zerotier && test ! -e /usr/share/luci/menu.d/luci-app-zerotier.json && test ! -e /usr/libexec/johnny-zt-nat && test -z "$(uci -q get network.zerotier)"')
            verify_package_versions(client)
            run(client, r'''set -e
# Prove keep.d works independently of the one-time preparation on old firmware.
saved=$(mktemp)
cp /etc/sysupgrade.conf "$saved"
trap 'cp "$saved" /etc/sysupgrade.conf; rm -f "$saved" /tmp/whitelist-backup.tgz' EXIT
sed '\|^/etc/meowx/po0.json$|d' "$saved" > /etc/sysupgrade.conf
sysupgrade -l | grep -qxF /etc/meowx/po0.json
sysupgrade -b /tmp/whitelist-backup.tgz >/dev/null
expected=$(sha256sum /etc/meowx/po0.json | cut -d ' ' -f1)
actual=$(tar -xzOf /tmp/whitelist-backup.tgz etc/meowx/po0.json | sha256sum | cut -d ' ' -f1)
test "$actual" = "$expected"
''', sensitive=True)
            assert_retained(baseline, retention_snapshot(client, retained, f'round-{round_number}-after-backup-check'))
        print(f'PASS: upgrade round {round_number}, SSH authentication, retained settings and service checks', flush=True)
    client.close()
    completed = True
finally:
    if not completed and qemu.poll() is None:
        capture_failure_network(locals().get('client'))
        # Capture BIOS/GRUB errors that are visible only on the VGA console.
        try:
            with socket.socket(socket.AF_UNIX) as monitor:
                monitor.settimeout(5)
                monitor.connect(str(monitor_path))
                stream = monitor.makefile('rwb', buffering=0)
                stream.readline()  # QMP greeting
                for command, arguments in [('qmp_capabilities', {}), ('query-status', {}),
                        ('screendump', {'filename': str(image.parent / 'upgrade-test-screen.ppm')})]:
                    stream.write((json.dumps({'execute': command, 'arguments': arguments, 'id': command}) + '\n').encode())
                    while response := stream.readline():
                        response = json.loads(response)
                        if response.get('id') == command:
                            print(f'Upgrade diagnostic {command}: {response}', flush=True)
                            break
        except (OSError, ValueError) as error:
            print(f'Could not capture upgrade screen: {error}', flush=True)
    qemu.terminate()
    try:
        qemu.wait(timeout=10)
    except subprocess.TimeoutExpired:
        qemu.kill()
        qemu.wait()
    httpd.shutdown()
    if 'reader' in locals():
        reader.join(timeout=5)
    log.close()
    if not completed:
        with disk.open('rb') as source, gzip.open(image.parent / 'upgrade-failed.img.gz', 'wb', compresslevel=1) as target:
            shutil.copyfileobj(source, target)
    monitor_path.unlink(missing_ok=True)
    disk.unlink(missing_ok=True)
