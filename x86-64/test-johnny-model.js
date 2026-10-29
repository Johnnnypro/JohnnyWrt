const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname, 'johnny-model.js');
const model = fs.existsSync(file) ? new Function('baseclass', fs.readFileSync(file, 'utf8'))({ extend: x => x }) : {};

test('LAN overview computes local subnet and counts only remote routed networks',()=>{
    const result=model.lanOverview({addresses:[{address:'192.168.50.1',mask:24}]},[{assignedAddresses:['10.147.0.2/24'],routes:[
        {target:'10.147.0.0/24'}, {target:'192.168.50.0/24',via:'10.147.0.2'},
        {target:'192.168.60.0/24',via:'10.147.0.3'}, {target:'0.0.0.0/0',via:'10.147.0.3'}]}]);
    assert.deepEqual(result,{local:['192.168.50.0/24'],remote:['192.168.60.0/24']});
});

test('unknown subscription quota stays unknown, not zero or unlimited', () => {
    assert.equal(typeof model.quota, 'function');
    assert.deepEqual(model.quota({}), { used: null, total: null, remaining: null, percent: null, expires: null, updated: null });
    assert.equal(model.quota({ used_bytes: 'invalid', total_bytes: '0' }).remaining, null);
});
test('quota uses provider accounting and clamps remaining after exceeding allowance', () => {
    assert.equal(typeof model.quota, 'function');
    assert.deepEqual(model.quota({ used_bytes: '386', total_bytes: '1000', expire_ts: '100', update_ts: '99' }),
        { used: 386, total: 1000, remaining: 614, percent: 38.6, expires: 100, updated: 99 });
    assert.equal(model.quota({ used_bytes: '1200', total_bytes: '1000' }).remaining, 0);
    assert.equal(model.quota({ total_bytes: '1000' }).percent, null);
});
test('rate calculation requires time and handles reboot or counter reset', () => {
    assert.equal(typeof model.rates, 'function');
    assert.deepEqual(model.rates(null, { time: 2, rx: 99, tx: 1 }), { rx: null, tx: null });
    assert.deepEqual(model.rates({ time: 1, rx: 100, tx: 50 }, { time: 3, rx: 300, tx: 90 }), { rx: 100, tx: 20 });
    assert.deepEqual(model.rates({ time: 3, rx: 300, tx: 90 }, { time: 2, rx: 20, tx: 2 }), { rx: null, tx: null });
    assert.deepEqual(model.rates({ time: 1, rx: 100, tx: 50 }, { time: 3, rx: 3, tx: 90 }), { rx: null, tx: 20 });
});
test('online node cannot bypass network authorization or IP assignment', () => {
    assert.equal(typeof model.ztState, 'function');
    assert.equal(model.ztState({ online: true }, { status: 'ACCESS_DENIED', assignedAddresses: [] }).state, 'denied');
    assert.equal(model.ztState({ online: true }, { status: 'OK', assignedAddresses: [] }).state, 'no_address');
    assert.equal(model.ztState({ online: false }, { status: 'OK', assignedAddresses: ['10.8.0.3/24'] }).state, 'offline');
    const ready = model.ztState({ online: true }, { status: 'OK', assignedAddresses: ['10.8.0.3/24'] });
    assert.equal(ready.state, 'ready');
    assert.equal(ready.lanReachable, null);
    assert.equal(model.ztState({}, null).state, 'not_joined');
});
test('disabled managed addressing stays authorized without claiming automatic readiness', () => {
    const network = { status: 'OK', assignedAddresses: ['10.8.0.3/24'], allowManaged: false };
    assert.deepEqual(model.ztState({ online: true }, network), { state: 'managed_disabled', authorized: true, lanReachable: null });
    assert.equal(model.ztState({ online: true }, { ...network, assignedAddresses: [] }).state, 'managed_disabled');
    assert.equal(model.ztState({ online: true }, { ...network, allowManaged: true }).state, 'ready');
    assert.equal(model.ztState({ online: false }, network).state, 'offline');
    assert.equal(model.ztState({ online: true }, { ...network, status: 'ACCESS_DENIED' }).state, 'denied');
});
const env = { ports: ['eth0', 'eth1'], bridge: 'br_lan', interfaces: ['loopback', 'lan', 'wan', 'wan6', 'zerotier'], pending: false };
const bypass = { role: 'bypass', lanPorts: ['eth0'], protocol: 'static', address: '192.168.50.5', mask: '255.255.255.0', gateway: '192.168.50.1', dns: ['1.1.1.1'] };
test('bypass plan preserves unrelated services and disables LAN DHCP', () => {
    assert.equal(typeof model.networkPlan, 'function');
    const result = model.networkPlan(bypass, env);
    const lan = result.updates.find(x => x.config === 'network' && x.section === 'lan');
    assert.equal(lan.values.ipaddr, '192.168.50.5');
    assert.equal(lan.values.gateway, '192.168.50.1');
    assert.equal(result.updates.find(x => x.config === 'dhcp').values.ignore, '1');
    assert.equal(result.updates.some(x => ['meowx', 'zerotier'].includes(x.config)), false);
    assert.equal(result.deletes.some(x => x.section === 'zerotier'), false);
});
test('DHCP bypass clears old static addressing instead of retaining stale gateway', () => {
    assert.equal(typeof model.networkPlan, 'function');
    const result = model.networkPlan({ ...bypass, protocol: 'dhcp' }, env);
    const lan = result.updates.find(x => x.config === 'network' && x.section === 'lan');
    assert.equal(lan.values.ipaddr, null);
    assert.equal(lan.values.gateway, null);
});
test('preview includes the gateway and static WAN address before applying',()=>{
    assert.match(model.networkPlan(bypass,env).summary.join('\n'),/网关：192\.168\.50\.1/);
    const result=model.networkPlan({...bypass,role:'main',wanPort:'eth1',wanAddress:'192.0.2.2',wanMask:'255.255.255.0',wanGateway:'192.0.2.1'},env);
    assert.match(result.summary.join('\n'),/192\.0\.2\.2.*255\.255\.255\.0/);
    assert.match(result.summary.join('\n'),/网关：192\.0\.2\.1/);
});
test('changing the main WAN moves the existing DHCPv6 interface with it',()=>{
    const result=model.networkPlan({...bypass,role:'main',wanPort:'eth1',protocol:'dhcp'},env);
    assert.equal(result.updates.find(x=>x.config==='network'&&x.section==='wan6')?.values.device,'@wan');
});
test('main router requires disjoint physical WAN and LAN and safe addressing', () => {
    assert.equal(typeof model.networkPlan, 'function');
    const main = { ...bypass, role: 'main', wanPort: 'eth1', protocol: 'dhcp', address: '192.168.50.1', dhcp: true };
    const result = model.networkPlan(main, env);
    assert.equal(result.updates.find(x => x.section === 'wan').values.device, 'eth1');
    assert.equal(result.updates.find(x => x.section === 'lan').values.proto, 'static');
    assert.equal(result.updates.find(x => x.config === 'dhcp').values.ignore, '0');
    assert.throws(() => model.networkPlan({ ...main, wanPort: 'eth0' }, env), /WAN.*LAN/);
    assert.throws(() => model.networkPlan({ ...main, lanPorts: ['ztfake'] }, env), /网口/);
    assert.throws(() => model.networkPlan({ ...main, lanPorts: ['eth0', 'eth0'] }, env), /网口/);
});
test('invalid masks, gateways, existing pending changes and custom topology are rejected', () => {
    assert.equal(typeof model.networkPlan, 'function');
    assert.throws(() => model.networkPlan({ ...bypass, mask: '255.0.255.0' }, env), /掩码/);
    assert.throws(() => model.networkPlan({ ...bypass, gateway: '192.168.51.1' }, env), /网关/);
    assert.throws(() => model.networkPlan({ ...bypass, address: '192.168.50.255' }, env), /地址/);
    assert.throws(() => model.networkPlan(bypass, { ...env, pending: true }), /未应用/);
    assert.throws(() => model.networkPlan(bypass, { ...env, interfaces: [...env.interfaces, 'guest'] }), /高级/);
});
test('PPPoE requires credentials but never includes the password in preview text', () => {
    assert.equal(typeof model.networkPlan, 'function');
    const ppp = { ...bypass, role: 'main', wanPort: 'eth1', protocol: 'pppoe', username: 'test-account', password: 'test-only-pass' };
    assert.throws(() => model.networkPlan({ ...ppp, password: '' }, env), /拨号/);
    const result = model.networkPlan(ppp, env);
    assert.equal(result.updates.find(x => x.section === 'wan').values.password, 'test-only-pass');
    assert.equal(JSON.stringify(result.summary).includes('test-only-pass'), false);
});
test('static WAN cannot overlap LAN subnet', () => {
    assert.equal(typeof model.networkPlan, 'function');
    assert.throws(() => model.networkPlan({ ...bypass, role: 'main', wanPort: 'eth1', wanAddress: '192.168.50.4', wanMask: '255.255.255.0', wanGateway: '192.168.50.1' }, env), /重叠/);
});
test('static addressing requires an explicit DNS server',()=>{
    assert.throws(()=>model.networkPlan({...bypass,dns:[]},env),/DNS/);
});
test('small LAN DHCP pool stays inside subnet and excludes router address', () => {
    const result = model.networkPlan({ ...bypass, role: 'main', wanPort: 'eth1', protocol: 'dhcp', address: '192.168.50.1', mask: '255.255.255.252' }, env);
    const dhcp = result.updates.find(x => x.config === 'dhcp').values;
    assert.equal(dhcp.start, '2');
    assert.equal(dhcp.limit, '1');
});
test('native network save delegates to LuCI rollback without committing individual configs',async()=>{
    const file=path.join(__dirname,'johnny-network.js');
    const calls=[];
    const uci={load:async()=>{},unload(){},sections:()=>[],changes:async()=>({}),get:()=>null,add:(...args)=>calls.push(['add',...args]),set:(...args)=>calls.push(['set',...args]),unset:(...args)=>calls.push(['unset',...args]),remove:(...args)=>calls.push(['remove',...args]),save:async()=>calls.push(['save'])};
    const page=new Function('view','rpc','uci','ui','model',fs.existsSync(file)?fs.readFileSync(file,'utf8'):'return {}')(
        {extend:x=>x},{declare:()=>async()=>({interfaces:env.ports.map(name=>({name,physical:true}))})},uci,{changes:{init:async()=>{},apply:async flag=>calls.push(['apply',flag])}},model);
    assert.equal(typeof page.applyPlan,'function');
    page.values=bypass;page.snapshot=page.networkSnapshot();
    await page.applyPlan(model.networkPlan(bypass,env));
    assert.deepEqual(calls.slice(-2),[['save'],['apply',true]]);
});
