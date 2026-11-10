#!/bin/sh
set -eu
root=$(mktemp -d)
trap 'rm -rf "$root"' EXIT
mkdir -p "$root/etc/config"
cat > "$root/etc/config/network" <<'EOF'
# Keep the user's LAN exactly.
config interface 'lan'
	option proto 'static'
	option ipaddr '192.0.2.1'

config interface 'zerotier'
	option proto 'none'

config interface 'custom'
	option proto 'none'

EOF
cat > "$root/etc/config/firewall" <<'EOF'
config rule 'keep_before'
	option name 'keep-before'
	option target 'DROP'

config zone 'johnny_zerotier'
	option name 'zerotier'

config include 'zerotier_input'
	option path '/var/run/zerotier-one/_fw4/input.nft'

config include 'johnny_zt_nat'
	option path '/usr/libexec/johnny-zt-nat'

config rule 'keep_after'
	option target 'ACCEPT'

EOF
printf 'private identity\n' > "$root/etc/config/zerotier"
cp "$root/etc/config/network" "$root/network.before"
cp "$root/etc/config/firewall" "$root/firewall.before"
sh x86-64/johnny-remove-zerotier "$root"
! grep -q zerotier "$root/etc/config/network"
! grep -qE 'zerotier|johnny_zt_nat' "$root/etc/config/firewall"
test ! -e "$root/etc/config/zerotier"
sed '/^config interface .zerotier./,/^$/d' "$root/network.before" > "$root/network.expected"
sed -e '/^config zone .johnny_zerotier./,/^$/d' -e '/^config include .zerotier_input./,/^$/d' -e '/^config include .johnny_zt_nat./,/^$/d' "$root/firewall.before" > "$root/firewall.expected"
cmp "$root/network.expected" "$root/etc/config/network"
cmp "$root/firewall.expected" "$root/etc/config/firewall"
cp "$root/etc/config/network" "$root/network.once"
cp "$root/etc/config/firewall" "$root/firewall.once"
sh x86-64/johnny-remove-zerotier "$root"
cmp "$root/network.once" "$root/etc/config/network"
cmp "$root/firewall.once" "$root/etc/config/firewall"
echo 'PASS: ZeroTier removal preserves unrelated bytes and is idempotent'
