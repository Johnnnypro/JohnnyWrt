#!/bin/sh
# Run only in a disposable guest. Exercise the vendor RPC with a local fixture.
set -eu
saved=$(mktemp -d)
cp /etc/config/meowx "$saved/config"
was_running=0
/etc/init.d/meowx running >/dev/null 2>&1 && was_running=1
cleanup() {
    /etc/init.d/meowx stop >/dev/null 2>&1 || true
    cp "$saved/config" /etc/config/meowx
    rm -f /www/cgi-bin/johnny-subscription-test
    rm -f /etc/meowx/subscriptions/johnny_refresh_test.yaml
    rm -f /tmp/johnny-subscription-mode /tmp/johnny-subscription-lock-ready
    [ "$was_running" = 0 ] || /etc/init.d/meowx start >/dev/null 2>&1
    rm -rf "$saved"
}
trap cleanup EXIT
/etc/init.d/meowx stop >/dev/null 2>&1
cat > /www/cgi-bin/johnny-subscription-test <<'EOF'
#!/bin/sh
mode=$(cat /tmp/johnny-subscription-mode)
download=2147483648
[ "$mode" != updated ] || download=3221225472
printf 'Content-Type: text/yaml\r\n'
printf 'Subscription-Userinfo: upload=1073741824; download=%s; total=10737418240; expire=4102358400\r\n\r\n' "$download"
if [ "$mode" = invalid ]; then
    echo 'proxies: null'
    exit 0
fi
cat <<'YAML'
mode: rule
mixed-port: 17890
external-controller: 127.0.0.1:9090
secret: disposable-test
proxies:
  - name: unused-test-proxy
    type: http
    server: 127.0.0.1
    port: 9
rules:
  - MATCH,DIRECT
YAML
EOF
chmod 755 /www/cgi-bin/johnny-subscription-test
echo valid > /tmp/johnny-subscription-mode
uci set meowx.johnny_refresh_test=subscription
uci set meowx.johnny_refresh_test.name='Disposable subscription'
uci set meowx.johnny_refresh_test.url='http://127.0.0.1/cgi-bin/johnny-subscription-test'
uci set meowx.config.profile='subscription:johnny_refresh_test'
uci set meowx.config.core_only=1
uci set meowx.config.auto_update_interval=0
uci set meowx.mixin.api_listen='127.0.0.1:9090'
uci set meowx.mixin.api_secret='disposable-test'
uci set meowx.mixin.mixed_port=17890
uci set meowx.mixin.authentication=0
uci commit meowx
refresh() {
    ubus -t 180 call luci.meowx refresh_subscription '{"section_id":"johnny_refresh_test"}' > "$saved/result.json"
    cat "$saved/result.json"
}
field() { jsonfilter -i "$saved/result.json" -e "@.$1"; }
refresh
test "$(field success)" = true
test -z "$(field applied)"
test "$(uci get meowx.johnny_refresh_test.used_bytes)" = 3221225472
test "$(uci get meowx.johnny_refresh_test.total_bytes)" = 10737418240
test "$(uci get meowx.johnny_refresh_test.expire_ts)" = 4102358400
test -s /etc/meowx/subscriptions/johnny_refresh_test.yaml
uci set meowx.config.enabled=1
uci commit meowx
/etc/init.d/meowx start
ready=0
for attempt in $(seq 1 30); do
    if curl -fsS --max-time 2 -H 'Authorization: Bearer disposable-test' http://127.0.0.1:9090/version >/dev/null; then
        ready=1
        break
    fi
    sleep 1
done
test "$ready" = 1
echo updated > /tmp/johnny-subscription-mode
refresh
test "$(field success)" = true
test "$(field applied)" = true
test "$(uci get meowx.johnny_refresh_test.used_bytes)" = 4294967296
sha256sum /etc/meowx/subscriptions/johnny_refresh_test.yaml > "$saved/cache.sha256"
uci get meowx.johnny_refresh_test.update_ts > "$saved/updated"
echo invalid > /tmp/johnny-subscription-mode
refresh
test "$(field success)" = false
test "$(field error_type)" = invalid
sha256sum -c "$saved/cache.sha256"
test "$(uci get meowx.johnny_refresh_test.used_bytes)" = 4294967296
test "$(uci get meowx.johnny_refresh_test.update_ts)" = "$(cat "$saved/updated")"
flock /var/run/meowx/subscription.johnny_refresh_test.lock sh -c 'touch /tmp/johnny-subscription-lock-ready; sleep 5' &
lock_pid=$!
for attempt in $(seq 1 10); do
    [ ! -e /tmp/johnny-subscription-lock-ready ] || break
    sleep 1
done
test -e /tmp/johnny-subscription-lock-ready
refresh
test "$(field busy)" = true
test "$(field success)" = false
wait "$lock_pid"
sha256sum -c "$saved/cache.sha256"
echo 'PASS: native subscription RPC updates quota and expiry, applies active profile, preserves cache/usage on invalid input, rejects concurrent refresh'
