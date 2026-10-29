#!/bin/sh
# Only run in a disposable guest. UCI is real, configuration and reload are isolated.
set -eu
script=${1:-/usr/bin/quickstart}
test -f "$script"
root=$(mktemp -d)
trap 'rm -rf "$root"' EXIT
mkdir -p "$root/bin" "$root/config" "$root/delta"
export QUICKSTART_FIXTURE="$root"
real_uci=$(command -v uci)
printf '#!/bin/sh\nexec %s -c "$QUICKSTART_FIXTURE/config" -t "$QUICKSTART_FIXTURE/delta" "$@"\n' "$real_uci" > "$root/bin/uci"
printf '#!/bin/sh\ntouch "$QUICKSTART_FIXTURE/reloaded"\n' > "$root/bin/reload_config"
chmod +x "$root/bin/"*
export PATH="$root/bin:$PATH"
cat > "$root/config/network" <<'CONFIG'
config interface 'lan'
 option proto 'static'
 option device 'br-lan'
 option ipaddr '192.168.2.1'
 option netmask '255.255.255.0'
 option hostname 'keep-host'
 option ip6assign '64'
config interface 'wan'
 option proto 'dhcp'
 option device 'eth1'
CONFIG
cat > "$root/config/dhcp" <<'CONFIG'
config dhcp 'lan'
 option interface 'lan'
 option start '100'
 option limit '150'
 option ignore '0'
 option ra 'server'
 option dhcpv6 'server'
CONFIG
cp "$root/config/network" "$root/original-network"
cp "$root/config/dhcp" "$root/original-dhcp"
unchanged() { cmp "$root/original-network" "$root/config/network"; cmp "$root/original-dhcp" "$root/config/dhcp"; test ! -e "$root/reloaded"; }
# EOF or declined confirmation must leave byte-identical originals.
printf '0\n' | sh "$script" > "$root/output"
unchanged
printf '2\n192.168.0.1\n255.255.255.0\n-\n1.1.1.1\nn\n0\n' | sh "$script" > "$root/output"
unchanged
printf '2\n192.168.0.1\n' | sh "$script" > "$root/output"
unchanged
for bad in '999.1.1.1' '127.0.0.1' '192.168.0.0' '192.168.0.255' '224.0.0.1'; do
 printf '2\n%s\n255.255.255.0\n-\n1.1.1.1\ny\n0\n' "$bad" | sh "$script" > "$root/output"
 unchanged
done
for values in '192.168.0.1|255.0.255.0|-|1.1.1.1' '192.168.0.1|255.255.255.0|192.168.2.1|1.1.1.1' '192.168.0.1|255.255.255.0|-|bad-dns'; do
 { printf '2\n'; printf '%s\n' "$values" | tr '|' '\n'; printf 'y\n0\n'; } | sh "$script" > "$root/output"
 unchanged
done
uci set network.wan.hostname=pending
printf '2\n192.168.0.1\n255.255.255.0\n-\n1.1.1.1\ny\n' | sh "$script" > "$root/output" || true
unchanged
test "$(uci get network.wan.hostname)" = pending
uci revert network
# Retained/custom DHCP mappings must not disable another interface or leave LAN serving.
for mapping in mismatch duplicate; do
 if [ "$mapping" = mismatch ]; then
  uci set dhcp.lan.interface=guest
 else
  uci set dhcp.extra=dhcp
  uci set dhcp.extra.interface=lan
 fi
 uci commit dhcp
 cp "$root/config/dhcp" "$root/unsupported-dhcp"
 printf '3\ny\n' | sh "$script" > "$root/output" || true
 cmp "$root/original-network" "$root/config/network"
 cmp "$root/unsupported-dhcp" "$root/config/dhcp"
 test ! -e "$root/reloaded"
 cp "$root/original-dhcp" "$root/config/dhcp"
done
# Good input changes only the requested LAN values, with a visible preview.
printf '2\n192.168.0.1\n255.255.255.0\n192.168.0.254\n1.1.1.1 8.8.8.8\ny\n' | sh "$script" > "$root/output"
test "$(uci get network.lan.ipaddr)" = 192.168.0.1
test "$(uci get network.lan.gateway)" = 192.168.0.254
test "$(uci get network.lan.dns)" = '1.1.1.1 8.8.8.8'
test "$(uci get network.lan.hostname)" = keep-host
test "$(uci get network.lan.ip6assign)" = 64
test "$(uci get network.wan.device)" = eth1
cmp "$root/original-dhcp" "$root/config/dhcp"
grep -q 'http://192.168.0.1' "$root/output"
sleep 3
test -e "$root/reloaded"
rm "$root/reloaded"
printf '3\ny\n' | sh "$script" > "$root/output"
test "$(uci get network.lan.proto)" = dhcp
test -z "$(uci -q get network.lan.ipaddr)"
test -z "$(uci -q get network.lan.dns)"
test "$(uci get network.lan.peerdns)" = 1
test "$(uci get dhcp.lan.ignore)" = 1
test "$(uci get dhcp.lan.ra)" = disabled
test "$(uci get dhcp.lan.dhcpv6)" = disabled
test "$(uci get dhcp.lan.start)" = 100
test -z "$(uci changes)"
sleep 3
test -e "$root/reloaded"
echo 'PASS: console static/DHCP, validation, cancel/EOF, pending changes and unrelated settings'
