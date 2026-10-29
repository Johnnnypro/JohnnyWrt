#!/bin/sh
# Test-only instrumentation for smoke-test25.py's disposable guest. Keep the
# production helper unchanged in a copy; wrappers preserve its data and status.
johnny_nat_diagnostics_start() {
    mkdir -p /tmp/johnny-nat-diagnostics/bin
    cp /usr/libexec/johnny-zt-nat /tmp/johnny-nat-diagnostics/original-helper
    sha256sum /usr/libexec/johnny-zt-nat /tmp/johnny-nat-diagnostics/original-helper > /tmp/johnny-nat-diagnostics/helper-sha256.txt
    command -v ubus > /tmp/johnny-nat-diagnostics/real-ubus
    command -v nft > /tmp/johnny-nat-diagnostics/real-nft
    cat > /tmp/johnny-nat-diagnostics/bin/ubus <<'UBUS_EOF'
#!/bin/sh
dir=/tmp/johnny-nat-diagnostics
real=$(cat "$dir/real-ubus")
[ "$*" = 'call network.interface dump' ] || exec "$real" "$@"
"$real" "$@" > "$dir/query.$JOHNNY_NAT_DIAG_PID.json"
query_status=$?
printf 'UBUS time=%s pid=%s rc=%s\n' "$(date +%s)" "$JOHNNY_NAT_DIAG_PID" "$query_status" >> "$dir/calls.log"
cat "$dir/query.$JOHNNY_NAT_DIAG_PID.json"
exit "$query_status"
UBUS_EOF
    cat > /tmp/johnny-nat-diagnostics/bin/nft <<'NFT_EOF'
#!/bin/sh
dir=/tmp/johnny-nat-diagnostics
real=$(cat "$dir/real-nft")
[ "$*" = '-f -' ] || exec "$real" "$@"
cat > "$dir/batch.$JOHNNY_NAT_DIAG_PID.nft"
"$real" "$@" < "$dir/batch.$JOHNNY_NAT_DIAG_PID.nft"
nft_status=$?
printf 'NFT time=%s pid=%s rc=%s\n' "$(date +%s)" "$JOHNNY_NAT_DIAG_PID" "$nft_status" >> "$dir/calls.log"
exit "$nft_status"
NFT_EOF
    cat > /usr/libexec/johnny-zt-nat <<'HELPER_EOF'
#!/bin/sh
dir=/tmp/johnny-nat-diagnostics
export JOHNNY_NAT_DIAG_PID=$$
export PATH="$dir/bin:$PATH"
printf 'START time=%s pid=%s ppid=%s action=%s interface=%s\n' "$(date +%s)" "$$" "$PPID" "${ACTION:-}" "${INTERFACE:-}" >> "$dir/calls.log"
. "$dir/original-helper"
helper_status=$?
printf 'END time=%s pid=%s rc=%s subnets=<%s>\n' "$(date +%s)" "$$" "$helper_status" "${subnets:-}" >> "$dir/calls.log"
exit "$helper_status"
HELPER_EOF
    chmod +x /tmp/johnny-nat-diagnostics/bin/* /usr/libexec/johnny-zt-nat
    nft monitor > /tmp/johnny-nat-diagnostics/monitor.log 2>&1 &
    johnny_nat_monitor_pid=$!
}

johnny_nat_diagnostics_dump() {
    # The caller saves the smoke exit code before invoking this best-effort dump.
    # Disable xtrace so it cannot be interleaved with exported JSON or nft input.
    set +x
    kill "$johnny_nat_monitor_pid" 2>/dev/null || true
    wait "$johnny_nat_monitor_pid" 2>/dev/null || true
    cat /var/run/fw4.state > /tmp/johnny-nat-diagnostics/fw4-state.json
    ubus call network.interface dump > /tmp/johnny-nat-diagnostics/network.json
    nft list ruleset > /tmp/johnny-nat-diagnostics/ruleset.txt
    ip -4 addr; ip route; ip neigh
    ip netns exec johnny_remote ip route
    ip netns exec johnny_nas ip route
    ip netns exec johnny_nas ip neigh
    cat /proc/net/nf_conntrack
    logread | grep -E 'firewall|netifd' > /tmp/johnny-nat-diagnostics/events.log
    echo JOHNNY_NAT_DIAGNOSTICS_BEGIN
    for file in /tmp/johnny-nat-diagnostics/*.log /tmp/johnny-nat-diagnostics/*.json /tmp/johnny-nat-diagnostics/*.nft /tmp/johnny-nat-diagnostics/*.txt; do
        [ -f "$file" ] || continue
        echo "JOHNNY_NAT_FILE_BEGIN $file"
        cat "$file"
        echo
        echo "JOHNNY_NAT_FILE_END $file"
    done
    tail -200 /tmp/johnny-nat-packets.log 2>/dev/null || true
    [ ! -f /tmp/johnny-nat-diagnostics/original-helper ] || cp /tmp/johnny-nat-diagnostics/original-helper /usr/libexec/johnny-zt-nat
    echo JOHNNY_NAT_DIAGNOSTICS_END
}
