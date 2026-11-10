'use strict';
import { readfile, writefile, popen, glob, mkdir, rmdir } from 'fs';
import { cursor } from 'uci';
import { connect } from 'ubus';
import { load_profile } from '/etc/meowx/ucode/include.uc';

function quote(value) { return "'" + replace(`${value ?? ''}`, "'", "'\\''") + "'"; }
function command(cmd) {
    let p = popen(cmd + ' 2>/dev/null');
    if (!p) return null;
    let data = p.read('all');
    return p.close() == 0 ? data : null;
}
function decoded(cmd) {
    let text = command(cmd);
    try { return text ? json(text) : null; } catch (e) { return null; }
}
function bus(object, method, args) {
    let c = connect();
    if (!c) return null;
    let result = c.call(object, method, args || {});
    c.disconnect();
    return result;
}
function running(name) {
    let instances = bus('service', 'list', { name })?.[name]?.instances;
    for (let key, instance in instances || {}) if (instance.running) return true;
    return false;
}
function pending(config) {
    if (length(cursor().changes(config) || {})) return true;
    for (let path in glob('/var/run/rpcd/uci-*/' + config))
        if (length(trim(readfile(path) || ''))) return true;
    return false;
}
function meow() {
    let result = { running: running('meowx'), available: false, pending: pending('meowx') };
    try { result.operation = json(readfile('/tmp/johnny-meow-action.json') || 'null'); } catch (e) {}
    if (!result.running) return result;
    try {
        let profile = load_profile();
        let endpoint = profile['external-controller-tls'] ?? profile['external-controller'];
        // Only contact this router's local controller, never a subscription-supplied remote host.
        let address = match(endpoint || '', /^(127\.0\.0\.1|0\.0\.0\.0|localhost|\[::\]|\[::1\]):([0-9]+)$/);
        if (!address || int(address[2]) < 1 || int(address[2]) > 65535) return result;
        let protocol = profile['external-controller-tls'] ? 'https' : 'http';
        let data = decoded('curl -fsS --noproxy "*" --connect-timeout 1 --max-time 2 --max-filesize 2097152 --insecure '
            + '--oauth2-bearer ' + quote(profile.secret || '') + ' '
            + quote(`${protocol}://127.0.0.1:${address[2]}/connections`));
        if (!data) return result;
        result.available = true;
        result.mode = profile.mode;
        result.rx = data.downloadTotal;
        result.tx = data.uploadTotal;
        result.connections = length(data.connections || []);
    } catch (e) { /* A stopped/unconfigured core must not break the other cards. */ }
    return result;
}
function lan_support() {
    let lan = bus('network.interface.lan', 'status');
    return { up: lan?.up == true, addresses: lan?.['ipv4-address'] || [], device: lan?.l3_device };
}
function status() {
    let info = bus('system', 'info') || {}, board = bus('system', 'board') || {};
    let interfaces = [];
    for (let line in split(readfile('/proc/net/dev') || '', '\n')) {
        let name = trim(split(line, ':')[0]);
        if (!match(name, /^(eth[0-9]+|en[a-zA-Z0-9]+|br-lan)$/)) continue;
        let path = '/sys/class/net/' + name;
        push(interfaces, { name, state: trim(readfile(path + '/operstate') || ''),
            physical: readfile(path + '/device/uevent') != null,
            rx: int(readfile(path + '/statistics/rx_bytes')),
            tx: int(readfile(path + '/statistics/tx_bytes')) });
    }
    let cpu = map(split(trim(split(readfile('/proc/stat') || '', '\n')[0]), /\s+/), v => int(v));
    shift(cpu);
    let total = 0; for (let n in cpu) total += n;
    return { time: time(), pending_network: pending('network') || pending('dhcp') || pending('firewall'),
        system: { hostname: board.hostname, model: board.model,
        display_version: trim(readfile('/rom/etc/johnnywrt-version') || ''),
        release: board.release?.description, uptime: info.uptime, memory: info.memory, load: info.load,
        cpu: { total, idle: (cpu[3] || 0) + (cpu[4] || 0) },
        storage: trim(command('df -Pk /overlay | tail -1') || '') }, interfaces,
        meowx: meow(), lan: lan_support() };
}
return { 'luci.johnny': {
    status: { call: status },
    dashboard_defaults: { call: () => {
        let profile = load_profile();
        // Leave user-selected dashboard locations and dashboard types alone.
        let path = profile['external-ui'] || 'ui';
        if (index(['ui', '/etc/meowx/run/ui'], path) < 0 || profile['external-ui-name'])
            return { applied: false, reason: 'custom-dashboard' };
        if (system('ucode /usr/libexec/johnny-dashboard-defaults.uc') != 0)
            return { error: '面板已下载，但 Apple 测速设置未能应用，请检查面板版本后重试。' };
        return { applied: true };
    } },
    meow_action: { args: { action: '' }, call: req => {
        let action = req.args.action;
        if (index(['start', 'stop', 'restart', 'reload'], action) < 0) return { error: '不支持的服务操作' };
        let u = cursor();
        if (pending('meowx')) return { error: '请先处理 MeowX 未保存设置（包括其他登录页面）' };
        if (!mkdir('/tmp/johnny-meow-action.lock', 0700)) return { error: 'MeowX 正在处理上一项操作，请稍候' };
        if (action == 'start' || action == 'stop') {
            u.set('meowx', 'config', 'enabled', action == 'start' ? '1' : '0');
            if (!u.commit('meowx')) { rmdir('/tmp/johnny-meow-action.lock'); return { error: '保存 MeowX 配置失败' }; }
        }
        writefile('/tmp/johnny-meow-action.json', sprintf('%J', { action, state: 'running' }));
        system('(/usr/libexec/johnny-meow-action ' + action + ' >/dev/null 2>&1 &)');
        return { accepted: true };
    } }
} };
