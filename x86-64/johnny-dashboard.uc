'use strict';
import { readfile, writefile, popen, glob, mkdir, rmdir } from 'fs';
import { cursor } from 'uci';
import { connect } from 'ubus';
import { load_profile } from '/etc/meowx/ucode/include.uc';
import { probe } from '/usr/libexec/johnny-probe.uc';

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
function zt_api(path, body) {
    let root = '/var/lib/zerotier-one/';
    let port = int(readfile(root + 'zerotier-one.port'));
    let token = trim(readfile(root + 'authtoken.secret') || '');
    if (!token || port < 1 || port > 65535) return null;
    return decoded('curl -fsS --noproxy "*" --connect-timeout 1 --max-time 3 --max-filesize 1048576 '
        + '-H ' + quote('X-ZT1-Auth: ' + token)
        + (body ? ' -H "Content-Type: application/json" --data ' + quote(sprintf('%J', body)) : '')
        + ' ' + quote(`http://127.0.0.1:${port}${path}`));
}
function node() {
    let data = zt_api('/status');
    return data ? { address: data.address, online: data.online, version: data.version } : {};
}
function networks() { return zt_api('/network') || []; }
function boot() { return trim(readfile('/proc/sys/kernel/random/boot_id') || ''); }
function valid_id(id) { return type(id) == 'string' && match(id, /^[0-9a-fA-F]{16}$/); }
function pending(config) {
    if (length(cursor().changes(config) || {})) return true;
    for (let path in glob('/var/run/rpcd/uci-*/' + config))
        if (length(trim(readfile(path) || ''))) return true;
    return false;
}
function meow() {
    let result = { running: running('meowx'), available: false };
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
    let u = cursor(), zt_zone, lan_zone, to_lan = false, from_lan = false;
    u.foreach('firewall', 'zone', s => {
        let nets = type(s.network) == 'array' ? s.network : split(s.network || '', ' ');
        if (index(nets, 'zerotier') >= 0) zt_zone = s.name;
        if (index(nets, 'lan') >= 0) lan_zone = s.name;
    });
    u.foreach('firewall', 'forwarding', s => {
        if (s.enabled == '0') return;
        if (s.src == zt_zone && s.dest == lan_zone) to_lan = true;
        if (s.src == lan_zone && s.dest == zt_zone) from_lan = true;
    });
    let lan = bus('network.interface.lan', 'status');
    return { up: lan?.up == true, addresses: lan?.['ipv4-address'] || [],
        device: lan?.l3_device, to_lan, from_lan,
        attached: bus('network.interface.zerotier', 'status')?.up == true,
        return_nat: command('nft list chain inet fw4 johnny_zt_lan') != null,
        end_to_end: 'unverified' };
}
function status() {
    let info = bus('system', 'info') || {}, board = bus('system', 'board') || {};
    let interfaces = [];
    for (let line in split(readfile('/proc/net/dev') || '', '\n')) {
        let name = trim(split(line, ':')[0]);
        if (!match(name, /^(eth[0-9]+|en[a-zA-Z0-9]+|br-lan|zt[a-zA-Z0-9]+)$/)) continue;
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
        release: board.release?.description, uptime: info.uptime, memory: info.memory, load: info.load,
        cpu: { total, idle: (cpu[3] || 0) + (cpu[4] || 0) },
        storage: trim(command('df -Pk /overlay | tail -1') || '') }, interfaces,
        meowx: meow(), zerotier: { boot: boot(), running: running('zerotier'), node: node(), networks: networks(), lan: lan_support() } };
}
function join_network(id) {
    if (!valid_id(id)) return { error: '网络 ID 必须是 16 位十六进制字符' };
    id = lc(id);
    let u = cursor();
    for (let config in ['zerotier', 'network', 'firewall'])
        if (pending(config)) return { error: '请先应用或撤销已有的未保存设置（包括其他登录页面）' };
    let section;
    u.foreach('zerotier', 'network', s => { if (lc(s.id || '') == id) section = s['.name']; });
    if (!section) {
        section = 'johnny_' + id;
        u.set('zerotier', section, 'network');
        u.set('zerotier', section, 'id', id);
        for (let key, value in { allow_managed: '1', allow_global: '0', allow_default: '0', allow_dns: '0' })
            u.set('zerotier', section, key, value);
    }
    u.set('zerotier', section, 'enabled', '1');
    u.set('zerotier', 'global', 'enabled', '1');
    if (!u.commit('zerotier')) return { error: '保存 ZeroTier 配置失败' };
    if (running('zerotier')) {
        let result = zt_api('/network/' + id, {
            allowManaged: u.get('zerotier', section, 'allow_managed') != '0',
            allowGlobal: u.get('zerotier', section, 'allow_global') == '1',
            allowDefault: u.get('zerotier', section, 'allow_default') == '1',
            allowDNS: u.get('zerotier', section, 'allow_dns') == '1'
        });
        if (result == null)
            return { error: '配置已保存，但加入请求失败，请检查 ZeroTier 服务后重试' };
    } else system('(/etc/init.d/zerotier start >/dev/null 2>&1 &)');
    return { accepted: true, id };
}

return { 'luci.johnny': {
    status: { call: status },
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
    } },
    join: { args: { id: '' }, call: req => join_network(req.args.id) },
    probe: { args: { id: '', ip: '', port: 0 }, call: req => {
        if (!valid_id(req.args.id)) return { error: '无效的网络 ID' };
        let found = filter(networks(), n => lc(n.id || '') == lc(req.args.id));
        return probe(found[0], req.args.ip, req.args.port);
    } },
    check: { args: { id: '' }, call: req => {
        if (!valid_id(req.args.id)) return { error: '无效的网络 ID' };
        let found = filter(networks(), n => lc(n.id || '') == lc(req.args.id));
        return { boot: boot(), running: running('zerotier'), node: node(), network: found[0], lan: lan_support() };
    } }
} };
