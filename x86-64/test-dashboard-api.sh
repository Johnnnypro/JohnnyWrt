#!/bin/sh
# Run only in the disposable firmware guest. Never source on a deployed router.
set -eu
saved=$(mktemp -d)
cp /etc/config/zerotier "$saved/zerotier"
cleanup() {
    uci -q revert network
    cp "$saved/zerotier" /etc/config/zerotier
    zerotier-cli leave 0123456789abcdef >/dev/null 2>&1 || true
    rm -rf /var/run/rpcd/uci-johnny-test
    rm -rf "$saved"
}
trap cleanup EXIT
before=$(sha256sum /etc/config/zerotier)
ubus call luci.johnny join '{"id":"bad;touch /tmp/johnny-injection"}' | grep -q error
ubus call luci.johnny probe '{"id":"bad","ip":"127.0.0.1","port":80}' | grep -q error
ubus call luci.johnny probe '{"id":"0123456789abcdef","ip":"localhost","port":80}' | grep -q error
test ! -e /tmp/johnny-injection
test "$before" = "$(sha256sum /etc/config/zerotier)"
mkdir -p /var/run/rpcd/uci-johnny-test
printf "network.lan.hostname='pending-browser-test'\n" > /var/run/rpcd/uci-johnny-test/network
test "$(ubus call luci.johnny status | jsonfilter -e '@.pending_network')" = true
ubus call luci.johnny join '{"id":"0123456789abcdef"}' | grep -q error
rm -rf /var/run/rpcd/uci-johnny-test
test "$before" = "$(sha256sum /etc/config/zerotier)"
uci set network.lan.johnny_pending_test=1
test "$(ubus call luci.johnny status | jsonfilter -e '@.pending_network')" = true
ubus call luci.johnny join '{"id":"0123456789abcdef"}' | grep -q error
uci revert network
test "$before" = "$(sha256sum /etc/config/zerotier)"
identity=$(sha256sum /etc/zerotier/identity.secret)
uci set zerotier.existing=network
uci set zerotier.existing.id=0123456789abcdef
uci set zerotier.existing.allow_dns=1
uci set zerotier.existing.allow_default=0
uci set zerotier.sibling=network
uci set zerotier.sibling.id=fedcba9876543210
uci set zerotier.sibling.enabled=0
uci commit zerotier
for attempt in 1 2; do
    ubus call luci.johnny join '{"id":"0123456789ABCDEF"}' | grep -q '"accepted": true'
    test "$(uci get zerotier.existing.allow_dns)" = 1
    test "$(uci get zerotier.sibling.enabled)" = 0
    test "$(uci show zerotier | grep -c 'id=.0123456789abcdef')" = 1
    test "$identity" = "$(sha256sum /etc/zerotier/identity.secret)"
done
started=$(date +%s)
ubus call luci.johnny status > /tmp/johnny-api-status.json
test $(( $(date +%s) - started )) -le 10
ucode -e 'import {readfile} from "fs"; let t=readfile("/tmp/johnny-api-status.json"); let s=json(t); assert(s.system.uptime>0); assert(length(s.interfaces)>0); assert(s.zerotier.node.address); assert(s.zerotier.lan.end_to_end=="unverified"); assert(index(t,trim(readfile("/var/lib/zerotier-one/authtoken.secret")))<0);'
ubus call luci.johnny check '{"id":"0123456789abcdef"}' > /tmp/johnny-api-check.json
ucode -e 'import {readfile} from "fs"; let s=json(readfile("/tmp/johnny-api-check.json")); assert(type(s.running)=="bool"); assert(s.node.address); assert(s.lan.end_to_end=="unverified");'
echo 'PASS: bounded status, invalid IDs, pending settings, repeated join, identity and unrelated networks'
ucode -e '
import { readfile } from "fs";
let s = json(readfile("/tmp/johnny-api-status.json"));
let c = json(readfile("/tmp/johnny-api-check.json"));
assert(length(s.zerotier.boot) > 0 && s.zerotier.boot == c.boot);
let acl = json(readfile("/usr/share/rpcd/acl.d/johnny.json"))["luci-app-johnny"];
assert(index(acl.read.ubus["luci.johnny"], "probe") < 0);
assert(index(acl.write.ubus["luci.johnny"], "probe") >= 0);
'
