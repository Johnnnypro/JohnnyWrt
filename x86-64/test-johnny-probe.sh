#!/bin/sh
# Only run in the disposable firmware guest.
set -eu
cleanup() {
    ip netns pids jw_probe | xargs -r kill 2>/dev/null || true
    ip netns del jw_probe 2>/dev/null || true
    ip link del ztprobe0 2>/dev/null || true
}
trap cleanup EXIT
ip netns add jw_probe
ip link add ztprobe0 type veth peer name jwpeer0
ip link set jwpeer0 netns jw_probe
ip addr add 198.18.55.1/30 dev ztprobe0
ip -6 addr add fd42:55::1/64 dev ztprobe0 nodad
ip link set ztprobe0 up
ip netns exec jw_probe ip link set lo up
ip netns exec jw_probe ip link set jwpeer0 up
ip netns exec jw_probe ip addr add 198.18.55.2/30 dev jwpeer0
ip netns exec jw_probe ip -6 addr add fd42:55::2/64 dev jwpeer0 nodad
ip netns exec jw_probe nft 'add table inet probe'
ip netns exec jw_probe nft 'add chain inet probe input { type filter hook input priority 0; policy accept; }'
ip netns exec jw_probe nft 'add rule inet probe input tcp dport 4445 drop'
ip netns exec jw_probe ucode -e '
import * as s from "socket";
let server = s.listen("::", 4444);
assert(server, s.error());
while (true) { let client = server.accept(); if (client) client.close(); }
' &
sleep 1
ucode /tmp/test-johnny-probe.uc
test ! -e /tmp/probe-injection
