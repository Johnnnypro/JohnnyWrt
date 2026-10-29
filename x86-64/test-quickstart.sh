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
 option netmask '255.255.0.0'
 option gateway '192.168.2.254'
 list dns '9.9.9.9'
 option peerdns '1'
 option hostname 'keep-host'
 option ip6assign '64'
config device
 option name 'br-lan'
 option type 'bridge'
 list ports 'eth0'
 list ports 'eth2'
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
 option ndp 'relay'
config dhcp 'guest'
 option interface 'guest'
 option ignore '1'
CONFIG
cp "$root/config/network" "$root/original-network"
cp "$root/config/dhcp" "$root/original-dhcp"
unchanged() { cmp "$root/original-network" "$root/config/network"; cmp "$root/original-dhcp" "$root/config/dhcp"; test ! -e "$root/reloaded"; }
# Option 3 and a blank choice exit immediately, even if more input follows.
printf '3\ny\n' | sh "$script" > "$root/output"
unchanged
printf '\n2\n192.168.0.1\n\n192.168.0.254\n\ny\n' | sh "$script" > "$root/output"
unchanged
# Read-only display and the menu must be usable on an ASCII-only console.
printf '1\n3\n' | sh "$script" > "$root/output"
unchanged
grep -q '1. Show network settings' "$root/output"
grep -q '2. Set IP address, gateway and DNS' "$root/output"
grep -q '3. Exit' "$root/output"
grep -q 'Subnet mask: 255.255.0.0' "$root/output"
if LC_ALL=C grep -q '[^[:print:][:space:]]' "$root/output"; then
 echo 'FAIL: non-ASCII console output'; exit 1
fi
# EOF at every prompt or declined/blank confirmation leaves byte-identical originals.
for input in '' '2\n' '2\n192.168.0.1\n' '2\n192.168.0.1\n\n' '2\n192.168.0.1\n\n192.168.0.254\n' '2\n192.168.0.1\n\n192.168.0.254\n\n'; do
 printf '%b' "$input" | sh "$script" > "$root/output"
 unchanged
done
for answer in n ''; do
 printf '2\n192.168.0.1\n\n192.168.0.254\n\n%s\n3\n' "$answer" | sh "$script" > "$root/output"
 unchanged
 grep -q 'Save and apply? \[y/N\]' "$root/output"
 grep -q 'Cancelled' "$root/output"
done
for bad in '999.1.1.1' '127.0.0.1' '192.168.0.0' '192.168.0.255' '224.0.0.1'; do
 printf '2\n%s\n255.255.255.0\n-\n1.1.1.1\ny\n3\n' "$bad" | sh "$script" > "$root/output"
 unchanged
done
# IP and gateway are required, and invalid masks/gateways/DNS are rejected.
for values in '|255.255.255.0|192.168.2.254|1.1.1.1' '192.168.2.2|255.255.255.0||1.1.1.1' '192.168.0.1|255.0.255.0|-|1.1.1.1' '192.168.0.1|255.255.255.0|192.168.2.1|1.1.1.1' '192.168.0.1|255.255.255.0|-|bad-dns'; do
 { printf '2\n'; printf '%s\n' "$values" | tr '|' '\n'; printf 'y\n3\n'; } | sh "$script" > "$root/output"
 unchanged
done
for setting in network.wan.hostname dhcp.lan.start; do
 uci set "$setting=pending"
 if printf '2\n192.168.0.1\n\n192.168.0.254\n\ny\n' | sh "$script" > "$root/output"; then
  echo 'FAIL: pending changes were accepted'; exit 1
 fi
 unchanged
 test "$(uci get "$setting")" = pending
 uci revert "${setting%%.*}"
done
# Compare every unrelated UCI setting, including bridge ports, WAN and IPv6.
unrelated_network() { uci show network | sed '/^network\.lan\.\(proto\|ipaddr\|netmask\|gateway\|dns\|peerdns\)=/d'; }
unrelated_network > "$root/unrelated-network"
for mode in defaults explicit none; do
 cp "$root/original-network" "$root/config/network"
 case "$mode" in
  defaults) printf '2\n192.168.0.1\n\n192.168.0.254\n\ny\n' ;;
  explicit) printf '2\n192.168.0.1\n255.255.254.0\n192.168.1.254\n1.1.1.1 8.8.8.8\ny\n' ;;
  none) printf '2\n192.168.0.1\n\n-\n-\ny\n' ;;
 esac | sh "$script" > "$root/output"
 test "$(uci get network.lan.proto)" = static
 test "$(uci get network.lan.ipaddr)" = 192.168.0.1
 test "$(uci get network.lan.peerdns)" = 0
 case "$mode" in
  defaults)
   test "$(uci get network.lan.netmask)" = 255.255.255.0
   test "$(uci get network.lan.gateway)" = 192.168.0.254
   test "$(uci get network.lan.dns)" = 223.5.5.5
   grep -q 'Subnet mask \[255.255.255.0\]' "$root/output"
   grep -q 'DNS server \[223.5.5.5\]' "$root/output"
   ;;
  explicit)
   test "$(uci get network.lan.netmask)" = 255.255.254.0
   test "$(uci get network.lan.gateway)" = 192.168.1.254
   test "$(uci get network.lan.dns)" = '1.1.1.1 8.8.8.8'
   ;;
  none)
   test -z "$(uci -q get network.lan.gateway)"
   test -z "$(uci -q get network.lan.dns)"
   ;;
 esac
 unrelated_network > "$root/after-network"
 cmp "$root/unrelated-network" "$root/after-network"
 cmp "$root/original-dhcp" "$root/config/dhcp"
 grep -q 'disconnect' "$root/output"
 grep -q 'no automatic rollback' "$root/output"
 grep -q 'http://192.168.0.1' "$root/output"
 test -z "$(uci changes)"
 sleep 3
 test -e "$root/reloaded"
 rm "$root/reloaded"
done
echo 'PASS: English console, exit/defaults/overrides, validation, cancel/EOF, pending changes and preserved settings'
