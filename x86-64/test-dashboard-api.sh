#!/bin/sh
# Run only in a disposable guest.
set -eu
trap 'uci -q revert network; rm -rf /var/run/rpcd/uci-johnny-test' EXIT
mkdir -p /var/run/rpcd/uci-johnny-test
printf "meowx.config.profile='file:pending-test.yaml'\n" > /var/run/rpcd/uci-johnny-test/meowx
test "$(ubus call luci.johnny status | jsonfilter -e '@.meowx.pending')" = true
rm /var/run/rpcd/uci-johnny-test/meowx
test "$(ubus call luci.johnny status | jsonfilter -e '@.meowx.pending')" = false
printf "network.lan.hostname='pending-browser-test'\n" > /var/run/rpcd/uci-johnny-test/network
test "$(ubus call luci.johnny status | jsonfilter -e '@.pending_network')" = true
rm -rf /var/run/rpcd/uci-johnny-test
uci set network.lan.johnny_pending_test=1
test "$(ubus call luci.johnny status | jsonfilter -e '@.pending_network')" = true
uci revert network
ubus call luci.johnny status > /tmp/johnny-api-status.json
ucode -e '
import {readfile} from "fs";
let s=json(readfile("/tmp/johnny-api-status.json"));
assert(s.system.uptime>0 && length(s.interfaces)>0);
assert(type(s.lan.addresses)=="array");
assert(!s.zerotier);
let acl=json(readfile("/usr/share/rpcd/acl.d/johnny.json"))["luci-app-johnny"];
for(let method in ["join","check","probe"]) {
    assert(index(acl.read.ubus["luci.johnny"],method)<0);
    assert(index(acl.write.ubus["luci.johnny"],method)<0);
}
'
echo 'PASS: dashboard status, global/session pending configuration and removed ZeroTier RPCs'
