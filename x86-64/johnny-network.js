'use strict';
'require view';
'require rpc';
'require uci';
'require ui';
'require johnny.model as model';

const getStatus=rpc.declare({object:'luci.johnny',method:'status',expect:{'':{}}});
function list(value){return Array.isArray(value)?value:String(value||'').split(/\s+/).filter(Boolean);}
function field(label,input){return E('label',{class:'jw-field'},[E('span',{},label),input]);}
function row(label,value){return E('div',{class:'jw-row'},[E('span',{},label),E('strong',{},value||'—')]);}
function icon(name){
    const paths={globe:'<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 6h14M5 18h14"/>',
        router:'<rect x="3" y="13" width="18" height="7" rx="2"/><path d="M6 13V7m12 6V7M8 4q4-4 8 0M10 7q2-2 4 0M7 17h1m3 0h1"/>',
        computer:'<rect x="4" y="3" width="16" height="13" rx="1"/><path d="M2 20h20M9 16v4m6-4v4"/>',
        shield:'<path d="M12 2 4 6v6c0 5 8 10 8 10s8-5 8-10V6zM8 12l3 3 5-6"/>'};
    return E('img',{alt:'',class:'jw-net-icon',src:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" color="#147eff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+paths[name]+'</svg>')});
}
return view.extend({
    load:async function(){
        const values=await Promise.all([getStatus(),uci.load('network'),uci.load('dhcp'),uci.load('firewall'),uci.changes()]);
        return {status:values[0],changes:values[4]};
    },
    environment:function(data){
        const devices=uci.sections('network','device'),interfaces=uci.sections('network','interface');
        const bridge=devices.find(s=>s.name==='br-lan'),zones=uci.sections('firewall','zone');
        const lanZone=zones.find(s=>s.name==='lan'),wanZone=zones.find(s=>s.name==='wan');
        const ports=(data.status.interfaces||[]).filter(x=>x.physical).map(x=>x.name);
        const wan=uci.get('network','wan','device')||uci.get('network','wan','ifname');
        const lan=list(uci.get('network','lan','device')||uci.get('network','lan','ifname'));
        const forwarding=uci.sections('firewall','forwarding');
        const complex=devices.some(s=>s!==bridge&&s.type&&s.type!=='ethernet')
            || (bridge&&bridge.type!=='bridge')
            || (bridge&&list(bridge.ports).some(p=>!ports.includes(p)&&p!=='dheth0'))
            || list(uci.get('network','lan','ipaddr')).length>1
            || list(lanZone?.network).some(n=>n!=='lan')
            || list(wanZone?.network).some(n=>!['wan','wan6'].includes(n))
            || (lanZone&&['input','output','forward'].some(key=>lanZone[key]!=='ACCEPT'))
            || (wanZone&&(wanZone.output!=='ACCEPT'||['input','forward'].some(key=>!['REJECT','DROP'].includes(wanZone[key]))))
            || zones.some(s=>s!==lanZone&&s!==wanZone&&list(s.network).some(n=>['lan','wan','wan6'].includes(n)))
            || zones.filter(s=>s.name==='lan').length>1 || zones.filter(s=>s.name==='wan').length>1
            || forwarding.some(s=>s.src==='lan'&&s.dest==='wan'&&s.enabled==='0')
            || lan.some(p=>p!=='br-lan'&&!ports.includes(p)) || (lan.includes('br-lan')&&!bridge)
            || (wan&&!ports.includes(wan))
            || (uci.get('network','wan6','proto')&&!['dhcpv6','none'].includes(uci.get('network','wan6','proto')))
            || uci.sections('network','bridge-vlan').length>0;
        return {ports,bridge:bridge?.['.name'],interfaces:interfaces.map(s=>s['.name']),complex,
            pending:!!data.status.pending_network||Object.values(data.changes||{}).some(x=>x.length),
            lanZone:lanZone?.['.name'],wanZone:wanZone?.['.name'],
            lanWanForward:uci.sections('firewall','forwarding').some(s=>s.src==='lan'&&s.dest==='wan'&&s.enabled!=='0')};
    },
    networkSnapshot:function(){return JSON.stringify(['network','dhcp','firewall'].map(c=>uci.sections(c)));},
    applyPlan:async function(plan){
        const changes=await uci.changes();
        if(Object.values(changes||{}).some(x=>x.length))throw new Error('检测到新的未应用设置，请先处理后重新打开向导');
        const status=await getStatus();
        if(status.pending_network)throw new Error('检测到其他页面或后台的未应用设置，请先处理后重新打开向导');
        await Promise.all(['network','dhcp','firewall'].map(c=>{uci.unload(c);return uci.load(c);}));
        if(this.snapshot!==this.networkSnapshot())throw new Error('网络配置已变化，请重新打开向导确认');
        plan=model.networkPlan(this.values,this.environment({status,changes:await uci.changes()}));
        for(const item of plan.deletes) if(uci.get(item.config,item.section))uci.remove(item.config,item.section);
        for(const item of plan.updates){
            if(!uci.get(item.config,item.section))uci.add(item.config,item.type,item.section);
            for(const [key,value] of Object.entries(item.values)){
                if(value==null)uci.unset(item.config,item.section,key);
                else uci.set(item.config,item.section,key,value);
            }
        }
        await uci.save();
        await ui.changes.init();
        return ui.changes.apply(true);
    },
    input:function(key,label,type='text'){
        const el=E('input',{type,value:this.values[key]||'','aria-label':label,autocomplete:type==='password'?'new-password':'off',
            input:ev=>{this.values[key]=ev.target.value;}});
        return el;
    },
    select:function(key,options){return E('select',{value:this.values[key],change:ev=>{
        this.values[key]=ev.target.value;
        if(key==='wanPort')this.values.lanPorts=this.values.lanPorts.filter(p=>p!==this.values.wanPort);
        this.draw();}},
        options.map(([value,label])=>E('option',{value,selected:value===this.values[key]||null},label)));},
    choices:function(key,options){return E('div',{class:'jw-choice-grid'},options.map(([value,label,description])=>E('label',{class:'jw-choice '+(this.values[key]===value?'jw-choice-selected':'')},[
        E('input',{type:'radio',name:key,value,checked:this.values[key]===value||null,change:()=>{
            this.values[key]=value;
            if(key==='role'&&value==='main')this.values.lanPorts=this.values.lanPorts.filter(p=>p!==this.values.wanPort);
            this.draw();}}),
        E('span',{},[E('strong',{},label),E('small',{},description)])])));},
    button:function(label,handler,disabled){return E('button',{type:'button',class:'cbi-button',disabled:disabled||null,click:async()=>{
        if(disabled||this.busy)return;
        try{await handler();}catch(e){ui.addNotification(null,E('p',{},e.message||String(e)),'error');}
    }},label);},
    draw:function(){
        const v=this.values,main=v.role==='main',readonly=!L.hasViewPermission();let contents=[];
        const titles=['接入网口','地址与 DNS','确认应用'];
        const portInfo=E('div',{class:'jw-port-summary'},[icon('router'),E('span',{},(main?'WAN '+v.wanPort+' · LAN ':'接入网口 ')+v.lanPorts.join('、')),
            ...(this.step?[this.button('更改',()=>{this.step=0;this.draw();})]:[])]);
        contents.push(E('div',{class:'jw-net-title'},[icon(this.step===1?'globe':'router'),E('div',{},[E('h3',{},titles[this.step]),E('p',{},this.step===1?'设置 JohnnyWrt 的管理地址和 DNS 服务器。':'设置路由模式与物理网口，应用前可预览变更。')]),
            E('span',{class:'jw-role-badge'},main?'主路由':'旁路由')]),portInfo);
        if(this.step===0){
            contents.push(this.choices('role',[
                ['bypass','旁路由','接入已有主路由，默认关闭 DHCP 服务。'],['main','主路由','作为上网网关，使用独立 WAN 和 LAN 网口。']]),E('hr'));
            if(main)contents.push(field('WAN 上网网口',this.select('wanPort',this.env.ports.map(p=>[p,p]))));
            contents.push(E('h4',{},main?'LAN 内网网口':'接入网口'),E('div',{class:'jw-port-options'},this.env.ports.map(p=>E('label',{class:'jw-port-option'},[
                E('input',{type:'checkbox',checked:v.lanPorts.includes(p)||null,disabled:main&&p===v.wanPort||null,change:ev=>{
                    v.lanPorts=ev.target.checked?[...v.lanPorts.filter(x=>x!==p),p]:v.lanPorts.filter(x=>x!==p);
                    this.draw();
                }}),icon('router'),E('strong',{},p),E('small',{},this.data.status.interfaces.find(x=>x.name===p)?.state==='up'?'已连接':'未连接')]))));
            if(main&&this.env.ports.length<2)contents.push(E('p',{class:'alert-message warning'},'主路由需要独立 WAN 和 LAN 网口。单网口 VLAN 方案请使用高级设置。'));
            contents.push(E('p',{class:'jw-subtle'},'ZeroTier 接口及内网转发在两种模式下均保留。复杂 VLAN 和 IPv6 可在原生网络设置中管理。'));
        }else if(this.step===1){
            if(main)contents.push(E('h4',{},'WAN 上网方式'));
            contents.push(this.choices('protocol',[
                ['dhcp','自动获取（DHCP）','从上级路由获取地址。'],['static','固定地址',main?'使用指定的 WAN 地址。':'使用指定管理地址。'],
                ...(main?[['pppoe','宽带拨号（PPPoE）','输入运营商提供的账号与密码。']]:[])]));
            if(main&&v.protocol==='static')contents.push(field('WAN IP 地址',this.input('wanAddress','WAN IP 地址')),field('WAN 子网掩码',this.input('wanMask','WAN 子网掩码')),field('WAN 网关',this.input('wanGateway','WAN 网关')));
            if(main&&v.protocol==='pppoe')contents.push(field('拨号账号',this.input('username','拨号账号')),field('拨号密码',this.input('password','拨号密码','password')));
            if(main||v.protocol==='static')contents.push(field(main?'LAN 管理 IP':'管理 IP 地址',this.input('address','管理 IP 地址')),field('子网掩码',this.input('mask','子网掩码')));
            if(!main&&v.protocol==='static')contents.push(field('主路由网关',this.input('gateway','主路由网关')));
            contents.push(E('div',{class:'jw-field'},[E('span',{},'DNS 服务器'),E('div',{class:'jw-dns-inputs'},[this.input('dnsPrimary','首选 DNS'),this.input('dnsOther','备用 DNS')])]),
                E('p',{class:'jw-field-hint'},v.protocol==='static'?'请填写 DNS，并选择未被其他设备使用的地址。':'DNS 可留空，自动使用上级网络下发的设置。'),E('hr'));
            const toggle=this.button(main&&v.dhcp?'关闭 DHCP':'开启 DHCP',()=>{v.dhcp=!v.dhcp;this.draw();},!main||readonly);
            toggle.className='jw-toggle'+(main&&v.dhcp?' jw-toggle-on':'');toggle.setAttribute('role','switch');toggle.setAttribute('aria-checked',String(main&&v.dhcp));
            contents.push(E('div',{class:'jw-field'},[E('strong',{},'DHCP 服务'),E('div',{class:'jw-dhcp-control'},[toggle,E('span',{},main&&v.dhcp?'已开启':'已关闭')])]),
                E('p',{class:'jw-field-hint'},main?'为 LAN 内网设备自动分配地址。':'由主路由分配地址，避免冲突。'));
        }else{
            contents.push(E('div',{class:'jw-plan-summary'},this.plan.summary.map(s=>E('p',{},[E('span',{},'✓'),s]))),
                E('p',{},'应用后网络会暂时断开。请按 LuCI 的提示重新连接并确认，超时未确认将自动恢复。'),
                E('p',{class:'jw-subtle'},'保留 ZeroTier 网络、设备身份和 MeowX 订阅。'));
        }
        contents.push(E('div',{class:'jw-network-footer'},[
            E('a',{href:L.url('admin','network','network')},'打开原生网络设置 ↗'),E('div',{class:'jw-actions'},[
            this.button('上一步',()=>{this.step--;this.draw();},this.step===0),
            this.step<2?this.button(this.step===1?'预览变更 →':'下一步 →',()=>{
                if(this.step===0){
                    if(main)v.lanPorts=v.lanPorts.filter(p=>p!==v.wanPort);
                    if(!v.lanPorts.length)throw new Error('请选择 LAN 网口，WAN 与 LAN 必须分开');
                    if(!main&&v.protocol==='pppoe')v.protocol='dhcp';
                }
                if(this.step===1){v.dns=(v.dnsPrimary+' '+v.dnsOther).trim().split(/\s+/).filter(Boolean);this.plan=model.networkPlan(v,this.env);}
                this.step++;this.draw();
            },readonly||this.env.pending||this.env.complex):this.button('应用并确认连接',async()=>{
                this.busy=true;try{await this.applyPlan(this.plan);}finally{this.busy=false;}
            },readonly)])]));
        this.content.replaceChildren(...contents);
        this.steps.replaceChildren(...titles.map((s,i)=>E('div',{class:'jw-network-step '+(i<=this.step?'jw-network-step-active ':'')+(i<this.step?'jw-network-step-done':'')},[
            E('span',{class:'jw-step-circle'},i<this.step?'✓':String(i+1)),E('strong',{},s)])));
    },
    render:function(data){
        this.data=data;this.env=this.environment(data);this.step=0;
        this.snapshot=this.networkSnapshot();
        const wan=uci.get('network','wan','device')||uci.get('network','wan','ifname');
        const dns=list(uci.get('network',wan?'wan':'lan','dns'));
        this.values={role:wan?'main':'bypass',wanPort:wan||this.env.ports[1]||this.env.ports[0],
            lanPorts:list(uci.get('network',this.env.bridge,'ports')).filter(p=>this.env.ports.includes(p)),protocol:uci.get('network',wan?'wan':'lan','proto')||'dhcp',
            address:uci.get('network','lan','ipaddr')||'192.168.1.1',mask:uci.get('network','lan','netmask')||'255.255.255.0',
            gateway:uci.get('network','lan','gateway')||'',wanAddress:uci.get('network','wan','ipaddr')||'',wanMask:uci.get('network','wan','netmask')||'255.255.255.0',wanGateway:uci.get('network','wan','gateway')||'',
            username:uci.get('network','wan','username')||'',password:uci.get('network','wan','password')||'',
            dnsPrimary:dns[0]||'',dnsOther:dns.slice(1).join(' '),dhcp:uci.get('dhcp','lan','ignore')!=='1'};
        this.content=E('section',{class:'jw-card jw-network-form'});this.steps=E('div',{class:'jw-network-progress'});this.draw();
        const lan=data.status.zerotier?.lan||{},currentPorts=this.values.lanPorts.join('、');
        const sidebar=E('aside',{class:'jw-network-sidebar'},[
            E('section',{class:'jw-card'},[E('div',{class:'jw-between'},[E('h3',{},'当前连接'),E('span',{class:'jw-badge '+(lan.up?'jw-good':'jw-muted')},lan.up?'已连接':'待检查')]),
                E('div',{class:'jw-connection-diagram'},[E('div',{},[icon('computer'),E('span',{},'终端')]),E('i'),E('div',{},[icon('router'),E('span',{},wan?'JohnnyWrt':'主路由')]),E('i'),E('div',{},[icon('router'),E('span',{},wan?'上级网络':'JohnnyWrt')])]),
                row('接入网口',currentPorts),row('当前获取方式',({dhcp:'自动获取',static:'固定地址',pppoe:'宽带拨号'}[uci.get('network','lan','proto')]||'待获取')),
                row('当前管理地址',(lan.addresses||[]).map(a=>a.address).join('、'))]),
            E('section',{class:'jw-card jw-protection'},[E('h3',{},[icon('shield'),'应用保护']),
                ...[['先预览变更内容','在应用前显示将要修改的设置。'],['应用后确认连接','应用后按页面提示重新连接并确认。'],['未确认则恢复原设置','若在限定时间内未确认，将自动恢复原来的网络设置。']].map(([title,text])=>E('div',{},[
                    E('span',{class:'jw-step-circle'},'✓'),E('div',{},[E('strong',{},title),E('p',{},text)])]))])]);
        return E('div',{class:'jw-page jw-network-wizard'},[E('link',{rel:'stylesheet',href:L.resource('johnny/johnny.css')+'?v='+encodeURIComponent(L.env?.resource_version||'development')}),
            E('div',{class:'jw-header'},[E('div',{},[E('h2',{},'网络向导'),E('p',{},'设置主路由或旁路由的接入网口、管理地址和 DNS。')])]),
            ...(this.env.pending||this.env.complex?[E('p',{class:'alert-message warning'},this.env.pending?'请先应用或撤销已有设置，再重新打开向导。':'检测到自定义网络结构，请使用高级网络设置，以保留 VLAN 和现有接口。')]:[]),
            this.steps,E('div',{class:'jw-network-layout'},[this.content,sidebar])]);
    },handleSaveApply:null,handleSave:null,handleReset:null
});
