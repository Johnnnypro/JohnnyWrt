#!/bin/sh
# Only in a disposable guest; restore its original unconfigured service.
set -eu
saved=$(mktemp -d)
cp /etc/config/meowx "$saved/config"
cleanup() {
    /etc/init.d/meowx stop >/dev/null 2>&1 || true
    cp "$saved/config" /etc/config/meowx
    rm -f /etc/meowx/profiles/johnny-test.yaml /tmp/johnny-meow-action.json
    rm -rf "$saved"
}
trap cleanup EXIT
mkdir -p /etc/meowx/profiles
cat > /etc/meowx/profiles/johnny-test.yaml <<'EOF'
mode: rule
mixed-port: 17890
external-controller: 127.0.0.1:9090
secret: disposable-test
rules:
  - MATCH,DIRECT
EOF
uci set meowx.config.profile='file:johnny-test.yaml'
uci set meowx.config.core_only=1
uci set meowx.mixin.api_listen='127.0.0.1:9090'
uci set meowx.mixin.api_secret='disposable-test'
uci set meowx.mixin.mixed_port=17890
uci set meowx.mixin.authentication=0
uci set meowx.config.auto_update_interval=0
uci commit meowx
act() {
    ubus call luci.johnny meow_action "{\"action\":\"$1\"}" | grep -q '"accepted": true'
    for attempt in $(seq 1 60); do
        state=$(jsonfilter -i /tmp/johnny-meow-action.json -e '@.state')
        [ "$state" != running ] && break
        sleep 1
    done
    echo "MeowX $1: expected $2, observed $state"
    test "$state" = "$2"
}
ubus call luci.johnny meow_action '{"action":"restart;touch /tmp/johnny-action-injection"}' | grep -q error
test ! -e /tmp/johnny-action-injection
act start done
ubus call luci.johnny status > /tmp/johnny-meow-status.json
test "$(jsonfilter -i /tmp/johnny-meow-status.json -e '@.meowx.available')" = true
curl -sS --max-time 10 --noproxy '' --proxy http://127.0.0.1:17890 http://127.0.0.1/cgi-bin/luci/ -o /dev/null
sleep 2
ubus call luci.johnny status > /tmp/johnny-meow-status.json
ucode -e 'import {readfile} from "fs";let m=json(readfile("/tmp/johnny-meow-status.json")).meowx;assert(m.rx>0);assert(m.tx>0);assert(m.mode=="rule");'
act reload done
act restart done
act stop done
test "$(uci get meowx.config.enabled)" = 0
uci set meowx.config.profile='file:missing-johnny-test.yaml'
uci commit meowx
act start failed
echo 'PASS: MeowX start/reload/restart/stop, rejected action, missing profile failure and real controller traffic'
