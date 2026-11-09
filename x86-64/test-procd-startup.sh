#!/bin/sh
# Destructive service tests ONLY in a disposable firmware VM.
set -eu
cmp /proc/1/exe /sbin/procd
probe=/tmp/test-startup-signal
result=/tmp/johnny-signal-output
mkdir -p "$result"
tracer=
trap '
    status=$?
    set +e
    [ -z "$tracer" ] || kill "$tracer" 2>/dev/null
    [ -z "$tracer" ] || wait "$tracer" 2>/dev/null
    echo PROCD_SIGNAL_STATE_BEGIN
    ubus -t 3 call service list '\''{"name":"johnny-signal-test"}'\''
    echo PROCD_SIGNAL_STATE_END
    ubus -t 3 call service delete '\''{"name":"johnny-signal-test"}'\'' >/dev/null 2>&1
    ubus -t 3 call service delete '\''{"name":"johnny-signal-background"}'\'' >/dev/null 2>&1
    for log in /tmp/johnny-signal-*.log; do echo "SIGNAL_LOG $log"; cat "$log"; done
    exit "$status"
' EXIT
cat > /etc/init.d/johnny-signal-test <<'INIT'
#!/bin/sh /etc/rc.common
USE_PROCD=1
start_service() {
    procd_open_instance main
    procd_set_param command /tmp/test-startup-signal payload /tmp/johnny-signal-output
    procd_set_param term_timeout 5
    procd_add_jail johnny-signal-test log procfs requirejail
    procd_add_jail_mount_rw /tmp/johnny-signal-output
    procd_close_instance
}
INIT
chmod 755 /etc/init.d/johnny-signal-test "$probe"
wait_file() {
    count=0
    while [ "$count" -lt 100 ]; do
        [ -s "$1" ] && return 0
        ucode -e 'sleep(100);'
        count=$((count+1))
    done
    echo "Missing expected file: $1" >&2
    return 1
}
running() {
    state=$(ubus -t 3 call service list '{"name":"johnny-signal-test"}')
    [ "$(printf '%s' "$state" | jsonfilter -e '@["johnny-signal-test"].instances.main.running')" = true ]
}
no_payload() {
    ucode -e '
        import {glob,readfile} from "fs";
        for(let path in glob("/proc/[0-9]*/cmdline")) {
            let args=split(readfile(path)||"","\x00");
            if(args[0]=="/tmp/test-startup-signal"&&args[1]=="payload")exit(1);
        }
    '
}
deleted() {
    ubus -t 3 call service list '{"name":"johnny-signal-test"}' > /tmp/johnny-signal-service.json || return 2
    ucode -e 'import {readfile} from "fs"; let s=json(readfile("/tmp/johnny-signal-service.json")); exit(s["johnny-signal-test"]?1:0);'
}
wait_stopped() {
    count=0
    while [ "$count" -lt 100 ]; do
        if [ ! -d "/proc/$held_pid" ] && deleted && no_payload; then return 0; fi
        ucode -e 'sleep(100);'
        count=$((count+1))
    done
    echo 'Test service or its payload did not stop' >&2
    return 1
}
for action in HUP TERM; do
    rm -f "$result/started" "$result/reloaded" /tmp/johnny-signal-ready /tmp/johnny-signal-go
    "$probe" johnny-signal-test /tmp/johnny-signal-ready /tmp/johnny-signal-go > "/tmp/johnny-signal-$action.log" 2>&1 &
    tracer=$!
    count=0
    until grep -q '^Attached procd$' "/tmp/johnny-signal-$action.log"; do
        kill -0 "$tracer"
        [ "$count" -lt 100 ]
        ucode -e 'sleep(100);'
        count=$((count+1))
    done
    /etc/init.d/johnny-signal-test start
    wait_file /tmp/johnny-signal-ready
    held_pid=$(cat /tmp/johnny-signal-ready)
    test ! -e "$result/started"
    # Force another PID1 fork while the target waits: the tracer must not deadlock it.
    ubus -t 3 call service set '{"name":"johnny-signal-background","instances":{"main":{"command":["/bin/sleep","60"]}}}'
    ubus -t 3 call service delete '{"name":"johnny-signal-background"}'
    if [ "$action" = HUP ]; then
        ubus -t 3 call service signal '{"name":"johnny-signal-test","instance":"main","signal":1}'
    else
        ubus -t 3 call service delete '{"name":"johnny-signal-test"}'
    fi
    touch /tmp/johnny-signal-go
    wait "$tracer"
    tracer=
    if [ "$action" = HUP ]; then
        wait_file "$result/started"
        running
        previous_bytes=$(wc -c < "$result/reloaded")
        ubus -t 3 call service signal '{"name":"johnny-signal-test","instance":"main","signal":1}'
        count=0
        until [ "$(wc -c < "$result/reloaded")" -gt "$previous_bytes" ]; do
            [ "$count" -lt 100 ]
            ucode -e 'sleep(100);'
            count=$((count+1))
        done
        running
        ubus -t 3 call service delete '{"name":"johnny-signal-test"}'
    fi
    wait_stopped
    if [ "$action" = TERM ]; then test ! -e "$result/started"; fi
    echo "PASS: startup $action and native service lifecycle"
done
