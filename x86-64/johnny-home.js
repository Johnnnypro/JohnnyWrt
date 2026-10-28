'use strict';
'require view';
'require rpc';
'require uci';
'require ui';
'require poll';
'require tools.meowx as meowx';
'require johnny.model as model';

const getStatus = rpc.declare({object:'luci.johnny',method:'status',expect:{'':{}}});
const getAccount = rpc.declare({object:'luci.meowx',method:'panel_status',expect:{'':{}}});
const action = rpc.declare({object:'luci.johnny',method:'meow_action',params:['action'],expect:{'':{}}});
const statusNames = {ready:'已连接',denied:'等待授权',no_address:'等待分配 IP',offline:'节点离线',pending:'正在请求配置',not_found:'网络不存在',port_error:'接口异常',not_joined:'尚未加入网络'};
function bytes(n) {
    if (n == null || !Number.isFinite(+n)) return '—';
    const units=['B','KB','MB','GB','TB']; let i=0;
    while(n>=1024 && i<4){n/=1024;i++;}
    return Number(n).toFixed(i ? 1 : 0)+' '+units[i];
}
function link(label, ...path) {return E('a',{class:'cbi-button',href:L.url(...path)},label);}
function row(label,value) {return E('div',{class:'jw-row'},[E('span',{},label),E('strong',{},value == null ? '—' : String(value))]);}
function badge(text,ok) {return E('span',{class:'jw-badge '+(ok?'jw-good':'jw-muted')},text);}
function icon(name){
    const paths={cpu:'<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M8 2v3m8-3v3M8 19v3m8-3v3M2 8h3m-3 8h3m14-8h3m-3 8h3"/>',
        memory:'<rect x="2" y="5" width="20" height="13" rx="2"/><path d="M6 9v5m4-5v5m4-5v5m4-5v5M6 18v3m4-3v3m4-3v3m4-3v3"/>',
        disk:'<path d="m5 3-3 14v4h20v-4L19 3zM2 17h20M6 9h12"/><circle cx="17" cy="19" r=".6"/>',
        clock:'<circle cx="12" cy="12" r="10"/><path d="M12 5v7l5 3"/>',
        router:'<rect x="3" y="13" width="18" height="7" rx="2"/><path d="M6 13V7m12 6V7M8 4q4-4 8 0M10 7q2-2 4 0M7 17h1m3 0h1"/>'};
    return E('img',{class:'jw-ui-icon',alt:'',src:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1685ee" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+paths[name]+'</svg>')});
}
function statTitle(name,label){return E('span',{class:'jw-stat-title'},[E('span',{class:'jw-stat-icon'},[icon(name)]),E('span',{},label)]);}
function shortcut(label,description,symbol,...path){return link(E('span',{class:'jw-shortcut-content'},[icon(symbol),E('span',{},[E('strong',{},label),E('small',{},description)])]),...path);}
function card(title,children,logo,extra) {return E('section',{class:'jw-card'+(logo?' jw-service':'')},[
    E('div',{class:'jw-card-title'},[...(logo?[E('img',{src:L.resource(logo),alt:'',class:'jw-logo'})]:[]),E('h3',{},title),...(extra?[extra]:[])]),...children]);}
function graph(samples,keys=['rx','tx'],mini=false) {
    const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
    svg.setAttribute('viewBox','0 0 600 150');svg.setAttribute('preserveAspectRatio','none');svg.setAttribute('aria-hidden','true');
    svg.setAttribute('class',mini?'jw-spark':'jw-graph');
    if(samples.length<2)return svg;
    const peak=Math.max(1,...samples.flatMap(s=>keys.map(k=>Number(s[k])||0)))*1.15;
    keys.forEach((key,index)=>{
        const points=samples.map((s,i)=>[(i/(samples.length-1)*600).toFixed(1),(145-(Number(s[key])||0)/peak*135).toFixed(1)]);
        const d='M'+points.map(p=>p.join(',')).join(' L');
        const fill=document.createElementNS(ns,'path'),line=document.createElementNS(ns,'path');
        fill.setAttribute('d',d+' L600,150 L0,150 Z');fill.setAttribute('fill',index?'#9970ff22':'#19b8fa28');
        line.setAttribute('d',d);line.setAttribute('fill','none');line.setAttribute('stroke',index?'#915dff':'#00a9f5');line.setAttribute('stroke-width','2.5');line.setAttribute('vector-effect','non-scaling-stroke');
        svg.appendChild(fill);svg.appendChild(line);
    });return svg;
}

return view.extend({
    load: async function() {
        const results=await Promise.allSettled([getStatus(),uci.load('meowx'),getAccount()]);
        return {status:results[0].status==='fulfilled'?results[0].value:null,
            account:results[2].status==='fulfilled'?results[2].value:null};
    },
    button: function(label,handler,disabled) {
        return E('button',{type:'button',class:'cbi-button',disabled:disabled||null,click:()=>{if(!disabled)return this.perform(handler);}},label);
    },
    perform:async function(handler){
        if(this.busy)return;
        this.busy=true;this.draw();
        try {await handler();} catch(e) {ui.addNotification(null,E('p',{},e.message || String(e)),'error');}
        finally {this.busy=false;await this.refresh();}
    },
    serviceAction: function(verb) {
        const execute=async()=>{
            const pending=await uci.changes();
            if(pending.meowx?.length) throw new Error('请先应用或撤销 MeowX 未保存设置');
            const result=await action(verb);
            if(!result.accepted) throw new Error(result.error || '服务操作未成功');
            this.notice='操作已提交，正在读取服务状态…';
        };
        if(verb==='stop' || verb==='restart') {
            const label=verb==='stop'?'关闭':'重启';
            ui.showModal('确认'+label+' MeowX',[E('p',{},'代理连接会暂时中断。'),
                E('div',{class:'jw-actions'},[this.button('取消',async()=>ui.hideModal(),false),
                    this.button('确认'+label,async()=>{ui.hideModal();await execute();},!L.hasViewPermission())])]);
            return;
        }
        return execute();
    },
    refresh: async function() {
        try {
            const next=await getStatus();
            this.previous=this.data; this.data=next;
            const operation=next.meowx?.operation;
            if(operation) this.notice=operation.state==='done'?'MeowX 操作已完成':operation.state==='failed'?'MeowX 操作失败，请查看服务日志':'MeowX 正在处理，请稍候…';
            this.failure=null;
        } catch(e) {this.data=null;this.failure='状态读取失败，请检查连接后重试';}
        this.draw();
    },
    draw: function() {
        const data=this.data||{}, system=data.system||{}, mx=data.meowx||{}, zt=data.zerotier||{};
        const readonly=!L.hasViewPermission() || !this.data || this.busy || mx.operation?.state==='running';
        const current=uci.get('meowx','config','profile')||'';
        const subscriptions=uci.sections('meowx','subscription');
        const subscription=subscriptions.find(s=>'subscription:'+s['.name']===current);
        const quota=model.quota(subscription||{}), account=this.account;
        const mxRate=model.rates(this.previous && {...this.previous.meowx,time:this.previous.time},
            {...mx,time:data.time});
        const profile=E('select',{'aria-label':'当前订阅',disabled:readonly||null,change:ev=>{
            if(readonly)return;
            const value=ev.target.value;
            return this.perform(async()=>{
                const result=await meowx.switchProfile(value);
                if(!result?.success)throw new Error(result?.error||'切换订阅失败');
                uci.unload('meowx');await uci.load('meowx');
            });
        }},[E('option',{value:current},subscription?meowx.subscriptionName(subscription):(current?'本地配置':'尚未选择订阅')),
            ...subscriptions.filter(s=>s!==subscription).map(s=>E('option',{value:'subscription:'+s['.name']},meowx.subscriptionName(s)))]);
        const accountNodes=account?.logged_in ? [
            ...(typeof account.avatar==='string' && /^https:\/\//.test(account.avatar)
                ? [E('img',{class:'jw-avatar',src:account.avatar,alt:'订阅账户头像',referrerpolicy:'no-referrer'})] : []),
            E('strong',{},account.username||'订阅账户'),
            this.button('刷新账户',async()=>{
                this.accountError='刷新未完成，显示上次获取的账户信息';
                const result=await meowx.panelProfile();
                if(!result?.success)throw new Error(result?.error||'账户刷新失败');
                this.account=await getAccount();uci.unload('meowx');await uci.load('meowx');this.accountError=null;
            },readonly),
            ...(this.accountError?[E('small',{},this.accountError)]:[])
        ] : [E('span',{},account ? '尚未登录订阅账户' : '账户状态暂不可用'),link('登录／订阅设置','admin','services','meowx')];
        const toggle=this.button(mx.running?'关闭':'开启',()=>this.serviceAction(mx.running?'stop':'start'),readonly);
        toggle.className='jw-toggle'+(mx.running?' jw-toggle-on':'');toggle.setAttribute('role','switch');toggle.setAttribute('aria-checked',String(!!mx.running));
        const meowCard=card('MeowX',[
            E('div',{class:'jw-service-meta'},[badge(mx.running?'核心运行中':'核心未运行',mx.running),
                E('span',{},({rule:'规则模式',global:'全局模式',direct:'直连模式'}[mx.mode]||'模式待获取')),
                E('span',{},mx.connections==null?'连接待获取':mx.connections+' 个连接')]),
            E('div',{class:'jw-subscription'},[
                E('div',{class:'jw-account'},accountNodes),
                E('div',{class:'jw-row'},[E('strong',{},'当前订阅'),profile]),
                E('div',{class:'jw-quota'},[
                E('p',{},quota.used!=null && quota.total!=null ? bytes(quota.used)+' / '+bytes(quota.total) : '暂无订阅用量信息'),
                E('div',{class:'jw-meter'},[E('span',{style:'width:'+(quota.percent||0)+'%'})]),
                E('p',{class:'jw-subtle'},'剩余 '+bytes(quota.remaining)+' · '+(quota.expires?'到期 '+new Date(quota.expires*1000).toLocaleDateString():'到期时间未知')),
                E('p',{class:'jw-subtle'},quota.updated?'用量更新于 '+new Date(quota.updated*1000).toLocaleString():'用量等待订阅提供方返回')])]),
            E('h4',{class:'jw-traffic-label'},'实时流量'),
            E('div',{class:'jw-rates jw-proxy-rates'},[
                E('div',{},[row('↓ 下载',bytes(mxRate.rx)+'/s'),graph(this.proxyHistory,['rx'],true)]),
                E('div',{},[row('↑ 上传',bytes(mxRate.tx)+'/s'),graph(this.proxyHistory,['tx'],true)])]),
            E('div',{class:'jw-actions jw-service-actions'},[
                this.button('打开面板',()=>meowx.openDashboard(),readonly||!mx.running),
                this.button('重载',()=>this.serviceAction('reload'),readonly||!mx.running),
                this.button('重启',()=>this.serviceAction('restart'),readonly),
                link('服务设置','admin','services','meowx')])
        ],'view/meowx/logo-light.png',E('div',{class:'jw-switch'},[E('span',{},'服务开关'),toggle,E('span',{},mx.running?'已开启':'已关闭')]));
        const networks=zt.networks||[], node=zt.node||{},lan=model.lanOverview(zt.lan||{},networks);
        const ztCard=card('ZeroTier',[
            E('div',{class:'jw-row'},[E('span',{},'服务状态'),badge(zt.running?'运行中':this.data?'未运行':'未知',zt.running)]),
            ...(networks.length?networks:[null]).map(n=>E('div',{class:'jw-network'},[
                row('网络名称',n?.name||n?.id||'尚未加入网络'),
                E('div',{class:'jw-row'},[E('span',{},'网络授权'),badge(n?(model.ztState(node,n).authorized?'已授权':statusNames[model.ztState(node,n).state]):'等待加入',model.ztState(node,n).authorized)]),
                row('本机虚拟 IP',(n?.assignedAddresses||[]).join('、')||'等待自动获取')])),
            E('div',{class:'jw-lan-panel'},[E('h4',{},'内网互访'),E('div',{class:'jw-lan-diagram'},[
                E('span',{},[icon('router'),E('span',{},'本地内网')]),E('strong',{},'⇄'),E('span',{},[icon('router'),E('span',{},'远端内网')])]),
                row('本地网段',lan.local.join('、')||'待获取'),
                row('远端网段',lan.remote.length?'已识别 '+lan.remote.length+' 个':'等待控制器下发'),
                row('内网路由',lan.remote.length?'已收到':'等待获取')]),
            E('div',{class:'jw-warning'},[E('strong',{},'跨网连通性'),E('span',{},'尚未验证')]),
            E('p',{class:'jw-subtle'},'已有地址与路由自动获取，无需重复填写。'),
            E('div',{class:'jw-actions jw-service-actions'},[link('设置向导','admin','services','zerotier','setup'),link('网络详情','admin','services','zerotier','interface')]),
            E('a',{class:'jw-zt-settings',href:L.url('admin','services','zerotier','config')},'⚙ 服务设置 ›')
        ],'johnny/zerotier.png',badge(node.online===true?'节点在线':'节点离线',node.online===true));
        let cpu=null;
        const a=this.previous?.system?.cpu,b=system.cpu;
        if(a&&b&&b.total>a.total&&b.idle>=a.idle) cpu=Math.max(0,Math.min(100,100*(1-(b.idle-a.idle)/(b.total-a.total))));
        const memory=system.memory||{}, used=memory.total!=null?memory.total-(memory.available??memory.free??0):null;
        const disk=String(system.storage||'').trim().split(/\s+/);
        if(data.time!==this.statsTime&&cpu!=null){this.statHistory.push({cpu,memory:used});this.statHistory=this.statHistory.slice(-30);this.statsTime=data.time;}
        const stats=E('div',{class:'jw-stats'},[
            card(statTitle('cpu','CPU 使用率'),[E('strong',{class:'jw-number'},cpu==null?'—':cpu.toFixed(1)+'%'),graph(this.statHistory,['cpu'],true),E('p',{class:'jw-subtle'},system.model||'读取中')]),
            card(statTitle('memory','内存'),[E('strong',{class:'jw-number'},bytes(used)),graph(this.statHistory,['memory'],true),E('p',{class:'jw-subtle'},'共 '+bytes(memory.total)+' · 使用 '+(memory.total?(used/memory.total*100).toFixed(0)+'%':'—'))]),
            card(statTitle('disk','系统存储'),[E('strong',{class:'jw-number'},disk.length>4?bytes(+disk[2]*1024):'—'),E('div',{class:'jw-meter jw-storage-meter'},[E('span',{style:'width:'+(parseFloat(disk[4])||0)+'%'})]),E('p',{class:'jw-subtle'},disk.length>4?'共 '+bytes(+disk[1]*1024)+' · 使用 '+disk[4]:'读取中')]),
            card(statTitle('clock','运行时间'),[E('strong',{class:'jw-number'},system.uptime==null?'—':Math.floor(system.uptime/86400)+' 天 '+Math.floor(system.uptime%86400/3600)+' 小时'),E('p',{class:'jw-subtle'},system.uptime==null?'读取中':'设备正在运行')])]);
        const iface=(data.interfaces||[]).find(x=>x.name===this.interface)|| (data.interfaces||[]).find(x=>x.physical);
        if(iface) this.interface=iface.name;
        const last=(this.previous?.interfaces||[]).find(x=>x.name===iface?.name);
        const rates=model.rates(last&&{...last,time:this.previous.time},iface&&{...iface,time:data.time});
        if(rates.rx!=null && data.time!==this.historyTime){this.history.push(rates);this.history=this.history.slice(-40);this.historyTime=data.time;}
        if(mxRate.rx!=null&&data.time!==this.proxyTime){this.proxyHistory.push(mxRate);this.proxyHistory=this.proxyHistory.slice(-30);this.proxyTime=data.time;}
        const traffic=card('网络流量',[
            E('select',{'aria-label':'流量网口',change:ev=>{this.interface=ev.target.value;this.history=[];this.draw();}},(data.interfaces||[]).filter(x=>x.physical).map(x=>E('option',{value:x.name,selected:x.name===this.interface||null},x.name))),
            E('div',{class:'jw-rates'},[row('↓ 接收',bytes(rates.rx)+'/s'),row('↑ 发送',bytes(rates.tx)+'/s')]),
            E('div',{class:'jw-chart','aria-label':'最近流量记录'},[graph(this.history)]),
            E('p',{class:'jw-subtle'},'按所选网口实时采样；订阅用量以提供方记录为准。')]);
        const interfaces=card('网络接口',(data.interfaces||[]).map(x=>row(x.name,x.state==='up'?'已连接':x.state||'未知')));
        this.content.replaceChildren(
            ...(this.failure?[E('p',{class:'alert-message warning'},this.failure)]:[]),
            ...(this.notice?[E('p',{class:'jw-subtle'},this.notice)]:[]),stats,
            E('div',{class:'jw-grid'},[meowCard,ztCard]),E('div',{class:'jw-grid'},[traffic,interfaces]),
            E('div',{class:'jw-shortcuts'},[shortcut('网络向导','设置地址与 DNS','router','admin','johnny-network'),shortcut('网络设置','高级网络配置','router','admin','network','network'),shortcut('日志查看','系统与服务日志','memory','admin','status','syslog'),shortcut('备份与更新','固件备份与系统更新','disk','admin','system','flash')])
        );
    },
    render: function(initial) {
        this.data=initial.status;this.account=initial.account;this.history=[];this.proxyHistory=[];this.statHistory=[];this.content=E('div');
        if(this.poller) poll.remove(this.poller);
        this.poller=()=>this.refresh();poll.add(this.poller,5);this.draw();
        return E('div',{class:'jw-page'},[E('link',{rel:'stylesheet',href:L.resource('johnny/johnny.css')}),
            E('header',{class:'jw-header'},[E('div',{},[E('h2',{},'设备概览'),E('p',{},'JohnnyWrt · ImmortalWrt 25.12 · x86/64')]),link('网络向导','admin','johnny-network')]),this.content]);
    },
    handleSaveApply:null,handleSave:null,handleReset:null
});
