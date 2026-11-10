'use strict';
'require baseclass';

function number(value) {
    if (value == null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
}
function ipv4(value) {
    const parts = String(value || '').split('.');
    if (parts.length !== 4 || parts.some(x => !/^\d{1,3}$/.test(x) || +x > 255)) throw new Error('请输入有效的 IPv4 地址');
    return parts.reduce((n, p) => n * 256 + Number(p), 0) >>> 0;
}
function subnet(address, mask) {
    const ip = ipv4(address), m = ipv4(mask), inverted = (~m) >>> 0;
    if (m === 0 || inverted < 3 || (inverted & (inverted + 1)) !== 0) throw new Error('请输入连续且适用于局域网的子网掩码');
    const start = (ip & m) >>> 0, end = (start | inverted) >>> 0;
    if (ip === start || ip === end || ip >= 0xe0000000 || ip < 0x01000000 || (ip >>> 24) === 127) throw new Error('管理地址不能是网络、广播或保留地址');
    return { ip, start, end };
}
function gateway(value, net) {
    const ip = ipv4(value);
    if (ip <= net.start || ip >= net.end || ip === net.ip) throw new Error('网关必须在相同网段，且不能与本机地址相同');
}

return baseclass.extend({
    lanOverview: function(lan, networks) {
        const local=(lan.addresses||[]).map(a=>{
            const mask=a.mask===0?0:(0xffffffff<<(32-a.mask))>>>0,net=(ipv4(a.address)&mask)>>>0;
            return [net>>>24,(net>>>16)&255,(net>>>8)&255,net&255].join('.')+'/'+a.mask;
        });
        const own=networks.flatMap(n=>(n.assignedAddresses||[]).map(a=>a.split('/')[0]));
        const remote=[...new Set(networks.flatMap(n=>n.routes||[]).filter(r=>r.via&&!own.includes(r.via)&&!local.includes(r.target)&&r.target!=='0.0.0.0/0'&&r.target!=='::/0').map(r=>r.target))];
        return {local,remote};
    },
    quota: function (section) {
        const used = number(section.used_bytes), rawTotal = number(section.total_bytes);
        const total = rawTotal > 0 ? rawTotal : null;
        return { used, total, remaining: total != null && used != null ? Math.max(0, total - used) : null,
            percent: total != null && used != null ? Math.min(100, used / total * 100) : null,
            expires: number(section.expire_ts) || null, updated: number(section.update_ts) || null };
    },
    rates: function (before, after) {
        const result = { rx: null, tx: null };
        if (!before || !after || !(after.time > before.time)) return result;
        for (const key of ['rx', 'tx']) {
            if (number(before[key]) != null && number(after[key]) != null && after[key] >= before[key])
                result[key] = (after[key] - before[key]) / (after.time - before.time);
        }
        return result;
    },
    ztState: function (node, network) {
        let state = 'not_joined';
        if (network) {
            if (node.online !== true) state = 'offline';
            else if (network.status === 'ACCESS_DENIED') state = 'denied';
            else if (network.status === 'OK') state = network.allowManaged === false ? 'managed_disabled' : (network.assignedAddresses || []).length ? 'ready' : 'no_address';
            else if (network.status === 'NOT_FOUND') state = 'not_found';
            else if (network.status === 'PORT_ERROR') state = 'port_error';
            else state = 'pending';
        }
        return { state, authorized: network?.status === 'OK', lanReachable: null };
    },
    networkPlan: function (input, env) {
        if (env.pending) throw new Error('请先处理已有的未应用网络设置');
        if (env.complex || (env.interfaces || []).some(x => !['loopback', 'lan', 'wan', 'wan6', 'zerotier'].includes(x)))
            throw new Error('检测到自定义接口或 VLAN，请使用高级网络设置');
        const main = input.role === 'main';
        if (!main && input.role !== 'bypass') throw new Error('请选择主路由或旁路由');
        const ports = input.lanPorts || [];
        if (!ports.length || new Set(ports).size !== ports.length || ports.some(x => !(env.ports || []).includes(x)))
            throw new Error('请选择有效且不重复的 LAN 网口');
        if (main && (ports.includes(input.wanPort) || !env.ports.includes(input.wanPort))) throw new Error('WAN 和 LAN 必须使用不同的物理网口');
        if (!['dhcp', 'static', ...(main ? ['pppoe'] : [])].includes(input.protocol)) throw new Error('不支持的地址获取方式');
        const dns = input.dns || [];
        if (!Array.isArray(dns) || dns.length > 3) throw new Error('DNS 地址最多填写三个');
        dns.forEach(ipv4);
        if (input.protocol === 'static' && !dns.length) throw new Error('静态地址模式请填写 DNS 服务器');
        let local;
        if (main || input.protocol === 'static') local = subnet(input.address, input.mask);
        if (!main && input.protocol === 'static') gateway(input.gateway, local);
        if (main && input.protocol === 'static') {
            const wan = subnet(input.wanAddress, input.wanMask);
            gateway(input.wanGateway, wan);
            if (wan.start <= local.end && local.start <= wan.end) throw new Error('WAN 与 LAN 网段不能重叠');
        }
        if (main && input.protocol === 'pppoe' && (!String(input.username || '').trim() || !input.password)) throw new Error('请填写完整的拨号账号和密码');
        const updates = [], deletes = [];
        // Pick the larger usable range on either side of the router address.
        const pool = local && (local.ip - local.start > local.end - local.ip
            ? { start: 1, limit: local.ip - local.start - 1 }
            : { start: local.ip - local.start + 1, limit: local.end - local.ip - 1 });
        const put = (config, section, type, values) => updates.push({ config, section, type, values });
        put('network', env.bridge || 'johnny_bridge', 'device', { name: 'br-lan', type: 'bridge', ports });
        const staticLan = main || input.protocol === 'static';
        put('network', 'lan', 'interface', { proto: staticLan ? 'static' : 'dhcp', device: 'br-lan', ifname: null,
            ipaddr: staticLan ? input.address : null, netmask: staticLan ? input.mask : null,
            gateway: !main && staticLan ? input.gateway : null,
            dns: !main && dns.length ? dns : null, peerdns: !main && dns.length ? '0' : null });
        put('dhcp', 'lan', 'dhcp', { interface: 'lan', ignore: main && input.dhcp !== false ? '0' : '1',
            ...(main ? { start: String(pool.start), limit: String(Math.min(150, pool.limit)), leasetime: '12h' }
                : { ra: 'disabled', dhcpv6: 'disabled', ndp: 'disabled' }) });
        if (main) {
            if ((env.interfaces || []).includes('wan6'))
                put('network', 'wan6', 'interface', { device: '@wan', ifname: null });
            put('network', 'wan', 'interface', { proto: input.protocol, device: input.wanPort, ifname: null,
                ipaddr: input.protocol === 'static' ? input.wanAddress : null,
                netmask: input.protocol === 'static' ? input.wanMask : null,
                gateway: input.protocol === 'static' ? input.wanGateway : null,
                username: input.protocol === 'pppoe' ? input.username : null,
                password: input.protocol === 'pppoe' ? input.password : null,
                dns: dns.length ? dns : null, peerdns: dns.length ? '0' : '1' });
            put('firewall', env.wanZone || 'johnny_wan', 'zone', { name: 'wan', network: ['wan', 'wan6'], ...(!env.wanZone ? { input: 'REJECT', output: 'ACCEPT', forward: 'REJECT' } : {}), masq: '1', mtu_fix: '1' });
            put('firewall', env.lanZone || 'johnny_lan', 'zone', { name: 'lan', network: ['lan'], input: 'ACCEPT', output: 'ACCEPT', forward: 'ACCEPT' });
            if (!env.lanWanForward) put('firewall', 'johnny_lan_wan', 'forwarding', { src: 'lan', dest: 'wan' });
        } else {
            deletes.push({ config: 'network', section: 'wan' }, { config: 'network', section: 'wan6' });
        }
        const summary = [main ? '主路由' : '旁路由', 'LAN：' + ports.join('、'),
            staticLan ? '管理地址：' + input.address + ' / ' + input.mask : '管理地址：自动获取',
            'DHCP 服务：' + (main && input.dhcp !== false ? '开启' : '关闭')];
        if (main) summary.push('WAN：' + input.wanPort + ' / ' + input.protocol);
        if (input.protocol === 'static') {
            if (main) summary.push('WAN 地址：' + input.wanAddress + ' / ' + input.wanMask);
            summary.push('网关：' + (main ? input.wanGateway : input.gateway));
        }
        if (main && input.protocol === 'pppoe') summary.push('拨号账号：' + input.username);
        if (dns.length) summary.push('DNS：' + dns.join('、'));
        return { updates, deletes, summary };
    }
});
