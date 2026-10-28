const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const load = name => fs.existsSync(`${__dirname}/${name}`) ? fs.readFileSync(`${__dirname}/${name}`, 'utf8') : 'return {}';
const model = new Function('baseclass', load('johnny-model.js'))({ extend: x => x });
function setup(file, readonly = false) {
    const nodes = [], calls = [], polls = [], modals = [], notifications=[];
    let account={logged_in:false};
    let status = {time:1, system:{}, interfaces:[], meowx:{running:true}, zerotier:{node:{online:true},networks:[],lan:{}}};
    function E(tag, attrs = {}, children = []) {
        const node = {tag, ...attrs, children, textContent:typeof children === 'string' ? children : '',
            replaceChildren(...children) { this.children=children; }, appendChild(n) { this.children.push(n); },
            classList:{add(){},remove(){}}, style:{}, setAttribute(k,v){this[k]=v;}};
        if ('disabled' in attrs) node.disabled=attrs.disabled!=null;
        nodes.push(node); return node;
    }
    const rpc = {declare: spec => async (...args) => {calls.push([spec.method,...args]); if(status instanceof Error) throw status;
        if(spec.method==='status') return status;
        if(spec.method==='panel_status') {if(account instanceof Error)throw account;return account;}
        if(spec.method==='check') return {running:status.zerotier.running,node:status.zerotier.node,network:status.zerotier.networks[0],lan:{}};
        return {accepted:true};}};
    const ui = {changes:{init:async()=>{},apply:async()=>{}},addNotification:(_,node)=>notifications.push(node.textContent),showModal:(title,content)=>modals.push([title,content]),hideModal(){}};
    const uci = {load:async()=>{},unload(){},get:()=>null,sections:()=>[],changes:async()=>({})};
    const meowx = {panelStatus:async()=>({logged_in:false}),panelProfile:async()=>({}),subscriptionName:s=>s.name,openDashboard:async()=>{}};
    const view = new Function('view','rpc','uci','ui','poll','meowx','model','E','L','navigator','document',load(file))(
        {extend:x=>x},rpc,uci,ui,{add:fn=>polls.push(fn),remove:fn=>polls.splice(polls.indexOf(fn),1)},meowx,model,E,
        {hasViewPermission:()=>!readonly,resource:x=>x,url:(...x)=>x.join('/')},{clipboard:{writeText:async()=>{}}},{createElementNS:(_,tag)=>E(tag)});
    return {view,nodes,calls,polls,modals,uci,meowx,notifications,setAccount:a=>{account=a;meowx.panelStatus=async()=>a;},setStatus:s=>status=s,button:label=>nodes.findLast(n=>n.tag==='button' && n.textContent===label)};
}
test('homepage renders without account and keeps unavailable telemetry unknown', async()=>{
    const t=setup('johnny-home.js'); assert.equal(typeof t.view.render,'function');
    await t.view.render(await t.view.load());
    assert(t.nodes.some(n=>n.textContent.includes('尚未登录订阅账户')));
    assert(t.nodes.some(n=>n.textContent==='暂无订阅用量信息'));
});
test('homepage stop and restart need explicit confirmation',async()=>{
    const t=setup('johnny-home.js'); assert.equal(typeof t.view.render,'function'); await t.view.render(await t.view.load());
    await t.button('关闭').click(); assert.equal(t.modals.length,1);
    assert(!t.calls.some(x=>x[0]==='meow_action'));
    await t.button('确认关闭').click(); assert(t.calls.some(x=>x[0]==='meow_action'&&x[1]==='stop'));
});
test('service operation reports completion or failure from the backend',async()=>{
    const t=setup('johnny-home.js'); await t.view.render(await t.view.load());
    await t.view.serviceAction('reload');
    t.setStatus({system:{},interfaces:[],meowx:{running:true,operation:{action:'reload',state:'failed'}},zerotier:{}});
    await t.view.refresh();
    assert.match(t.view.notice,/失败/);
    t.setStatus({system:{},interfaces:[],meowx:{running:true,operation:{action:'reload',state:'done'}},zerotier:{}});
    await t.view.refresh();
    assert.match(t.view.notice,/已完成/);
});
test('unjoined ZeroTier still refreshes its service and node status',async()=>{
    const t=setup('johnny-zerotier.js');await t.view.render(await t.view.load());
    t.setStatus({zerotier:{running:false,node:{online:false},networks:[],lan:{}}});
    await t.view.inspect(); assert.equal(t.view.running,false);assert.equal(t.view.node.online,false);
});
test('readonly homepage cannot mutate services',async()=>{
    const t=setup('johnny-home.js',true); assert.equal(typeof t.view.render,'function'); await t.view.render(await t.view.load());
    assert(t.button('关闭').disabled); assert(t.button('重载').disabled); assert(t.button('重启').disabled);
});
test('writable homepage leaves service buttons enabled',async()=>{
    const t=setup('johnny-home.js'); await t.view.render(await t.view.load());
    assert.equal(t.button('关闭').disabled,false);
    assert.equal(t.button('重启').disabled,false);
});
test('homepage status failure disables controls and duplicate rendering replaces polling',async()=>{
    const t=setup('johnny-home.js'); assert.equal(typeof t.view.render,'function'); await t.view.render(await t.view.load());
    await t.view.render(await t.view.load()); assert.equal(t.polls.length,1);
    t.setStatus(new Error('offline')); await t.polls[0]();
    assert(t.button('开启').disabled); assert(t.nodes.some(n=>n.textContent.includes('状态读取失败')));
});
test('ZeroTier authorization button only checks actual state and never fakes readiness',async()=>{
    const t=setup('johnny-zerotier.js'); assert.equal(typeof t.view.render,'function');
    t.setStatus({zerotier:{node:{online:true},networks:[{id:'0123456789abcdef',status:'ACCESS_DENIED'}],lan:{}}});
    await t.view.render(await t.view.load()); await t.button('我已授权，立即检测').click();
    assert(t.calls.some(x=>x[0]==='check')); assert(!t.nodes.some(n=>n.textContent==='已连接'));
    assert(t.nodes.some(n=>n.textContent==='请自行打开 ZeroTier 授权面板，授权此设备。'));
});
test('ZeroTier refresh tracks service changes and clears stale success on failure',async()=>{
    const t=setup('johnny-zerotier.js');
    t.setStatus({zerotier:{running:false,node:{online:false},networks:[{id:'0123456789abcdef',status:'REQUESTING_CONFIGURATION'}],lan:{}}});
    await t.view.render(await t.view.load());
    t.setStatus({zerotier:{running:true,node:{online:true},networks:[{id:'0123456789abcdef',status:'OK',assignedAddresses:['10.147.0.2/24']}],lan:{}}});
    await t.polls[0]();
    assert.equal(t.view.running,true);
    assert.equal(t.view.node.online,true);
    t.setStatus(new Error('unreachable')); await t.polls[0]();
    assert.notEqual(t.view.running,true);
    assert.notEqual(t.view.node.online,true);
    assert.equal(t.view.network,null);
});
test('network wizard previews bypass settings without applying and preserves fields on back',async()=>{
    const t=setup('johnny-network.js');
    t.uci.sections=(config,type)=>config==='network'&&type==='device'?[{'.name':'bridge',name:'br-lan',type:'bridge',ports:['eth0']}]:[];
    t.uci.get=(config,section,key)=>section==='bridge'&&key==='ports'?['eth0']:null;
    t.setStatus({interfaces:[{name:'eth0',physical:true,state:'up'},{name:'eth1',physical:true,state:'up'}],zerotier:{lan:{addresses:[{address:'10.147.0.2',mask:24}]}}});
    await t.view.render(await t.view.load());
    let applied=false;t.view.applyPlan=async()=>{applied=true;};
    await t.button('下一步 →').click();
    t.nodes.findLast(n=>n.tag==='input'&&n.value==='static'&&n.type==='radio').change({target:{checked:true}});
    for(const [label,value] of [['管理 IP 地址','10.147.0.3'],['主路由网关','10.147.0.1'],['首选 DNS','1.1.1.1']])
        t.nodes.findLast(n=>n.tag==='input'&&n['aria-label']===label).input({target:{value}});
    await t.button('预览变更 →').click();
    assert.equal(t.view.step,2);assert.equal(applied,false);
    assert(t.view.plan.summary.some(s=>s.includes('10.147.0.3')));
    await t.button('上一步').click();assert.equal(t.view.values.address,'10.147.0.3');
});
test('main router selection immediately separates WAN from the displayed LAN ports',async()=>{
    const t=setup('johnny-network.js');
    t.setStatus({interfaces:[{name:'eth0',physical:true},{name:'eth1',physical:true}],zerotier:{lan:{}}});
    await t.view.render(await t.view.load());
    t.view.values.lanPorts=['eth0','eth1'];
    t.nodes.findLast(n=>n.tag==='input'&&n.value==='main').change();
    assert.deepEqual(t.view.values.lanPorts,['eth0']);
});
test('network wizard starts with the existing WAN mode and DHCP setting',async()=>{
    const t=setup('johnny-network.js');
    const values={'network.wan.device':'eth1','network.wan.proto':'static','network.wan.ipaddr':'192.0.2.2','network.wan.netmask':'255.255.255.0','network.wan.gateway':'192.0.2.1','network.wan.dns':['9.9.9.9'],'network.lan.ipaddr':'192.168.50.1','network.lan.netmask':'255.255.255.0','dhcp.lan.ignore':'1'};
    t.uci.get=(...keys)=>values[keys.join('.')];
    await t.view.render({status:{interfaces:[{name:'eth0',physical:true},{name:'eth1',physical:true}],zerotier:{lan:{}}},changes:{}});
    assert.equal(t.view.values.protocol,'static');assert.equal(t.view.values.wanAddress,'192.0.2.2');assert.equal(t.view.values.wanGateway,'192.0.2.1');assert.equal(t.view.values.dnsPrimary,'9.9.9.9');assert.equal(t.view.values.dhcp,false);
});
test('network wizard accepts and preserves native WAN deny policies',()=>{
    for(const policy of ['DROP','REJECT']){
        const t=setup('johnny-network.js');
        t.uci.sections=(config,type)=>config==='firewall'&&type==='zone'?[{'.name':'wan_zone',name:'wan',network:['wan','wan6'],input:'REJECT',output:'ACCEPT',forward:policy}]:[];
        const env=t.view.environment({status:{interfaces:[{name:'eth0',physical:true},{name:'eth1',physical:true}]},changes:{}});
        assert.equal(env.complex,false,policy);
        const plan=model.networkPlan({role:'main',wanPort:'eth1',lanPorts:['eth0'],protocol:'dhcp',address:'192.168.50.1',mask:'255.255.255.0',dhcp:true},env);
        const wan=plan.updates.find(s=>s.config==='firewall'&&s.section==='wan_zone');
        for(const key of ['input','output','forward'])assert.equal(Object.hasOwn(wan.values,key),false,key);
    }
});

test('network wizard refuses restrictive firewall policy and disabled forwarding',()=>{
    for(const restriction of ['policy','forwarding','zone-owner']){
        const t=setup('johnny-network.js');
        t.uci.sections=(config,type)=>config==='firewall'&&type==='zone'?[{'.name':'lan_zone',name:'lan',network:['lan'],input:restriction==='policy'?'DROP':'ACCEPT',forward:'ACCEPT',output:'ACCEPT'},...(restriction==='zone-owner'?[{'.name':'custom',name:'isolated',network:['lan']}]:[])]:config==='firewall'&&type==='forwarding'&&restriction==='forwarding'?[{src:'lan',dest:'wan',enabled:'0'}]:[];
        assert.equal(t.view.environment({status:{interfaces:[{name:'eth0',physical:true}]},changes:{}}).complex,true,restriction);
    }
});
test('network wizard refuses implicit LAN VLAN and other-session pending configuration',()=>{
    const t=setup('johnny-network.js');t.uci.get=(c,s,o)=>c==='network'&&s==='lan'&&o==='device'?'eth0.10':null;
    assert.equal(t.view.environment({status:{interfaces:[{name:'eth0',physical:true}]},changes:{}}).complex,true);
    t.uci.get=()=>null;
    assert.equal(t.view.environment({status:{interfaces:[],pending_network:true},changes:{}}).pending,true);
});
test('network apply refuses newly staged work and changed configuration before any write',async()=>{
    for(const changed of ['pending','topology']){
        const t=setup('johnny-network.js');let saved=false;
        t.uci.save=async()=>{saved=true;};
        const status={interfaces:[{name:'eth0',physical:true}],zerotier:{lan:{}}};
        t.setStatus(status);await t.view.render({status,changes:{}});
        if(changed==='pending')t.setStatus({...status,pending_network:true});
        else t.uci.sections=()=>[{'.name':'custom',name:'custom'}];
        await assert.rejects(()=>t.view.applyPlan({updates:[],deletes:[]}),/未应用|变化/);
        assert.equal(saved,false);
    }
});
test('account refresh reports server failures and labels the cached account',async()=>{
    const t=setup('johnny-home.js');t.setAccount({logged_in:true,username:'Test account'});
    t.meowx.panelProfile=async()=>({success:false,error:'controller offline'});
    await t.view.render(await t.view.load());await t.button('刷新账户').click();
    assert(t.notifications.some(s=>s.includes('controller offline')));
    assert(t.nodes.some(n=>n.textContent.includes('上次获取')));
});
test('account status transport failure is not treated as confirmed logout',async()=>{
    const t=setup('johnny-home.js');t.setAccount(new Error('offline'));
    await t.view.render(await t.view.load());
    assert(t.nodes.some(n=>n.textContent==='账户状态暂不可用'));
});
test('subscription switching is serialized and reports failure',async()=>{
    const t=setup('johnny-home.js');let finish,count=0;
    t.meowx.switchProfile=()=>{count++;return new Promise(resolve=>{finish=resolve;});};
    await t.view.render(await t.view.load());
    const select=t.nodes.findLast(n=>n.tag==='select'&&n['aria-label']==='当前订阅');
    const first=select.change({target:{value:'subscription:one'}});
    await Promise.resolve();
    const second=select.change({target:{value:'subscription:two'}});
    assert.equal(count,1);
    finish({success:false,error:'invalid subscription'});await Promise.all([first,second]);
    assert(t.notifications.some(s=>s.includes('invalid subscription')));
});
