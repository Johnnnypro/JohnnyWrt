'use strict';
'require view';
'require rpc';
'require ui';
'require poll';
'require johnny.model as model';
'require johnny.connectivity as connectivity';

const getStatus=rpc.declare({object:'luci.johnny',method:'status',expect:{'':{}}});
const join=rpc.declare({object:'luci.johnny',method:'join',params:['id'],expect:{'':{}}});
const check=rpc.declare({object:'luci.johnny',method:'check',params:['id'],expect:{'':{}}});
const probe=rpc.declare({object:'luci.johnny',method:'probe',params:['id','ip','port'],expect:{'':{}}});
const labels={ready:'已连接',denied:'等待授权',no_address:'已授权，等待分配 IP',offline:'节点离线',pending:'正在请求网络配置',not_found:'网络不存在，请核对 ID',port_error:'虚拟接口异常',not_joined:'尚未加入网络'};
function row(label,text){return E('div',{class:'jw-row'},[E('span',{},label),E('strong',{},text||'—')]);}
function indicator(label,ok){return E('div',{class:'jw-checkline'},[E('span',{class:'jw-checkdot '+(ok?'jw-check-ok':'')},ok?'✓':'•'),E('span',{},label)]);}
return view.extend({
    context:function(){return {id:this.id,boot:this.boot,running:this.running,node:this.node,network:this.network,lan:this.lan};},
    targetChanged:function(){
        connectivity.target(this.id,{ip:this.probeIP.value.trim(),port:this.probePort.value.trim()});
        this.probeError=null;this.drawProbe();
    },
    runProbe:async function(){
        if(this.probing||!L.hasViewPermission()||model.ztState(this.node,this.network).state!=='ready')return;
        const target={ip:this.probeIP.value.trim(),port:this.probePort.value.trim()},context=this.context();
        if(!connectivity.valid(target)){this.probeError='请输入有效的 IP 地址和 1–65535 的 TCP 端口';this.drawProbe();return;}
        connectivity.target(this.id,target);this.probing=true;this.probeError=null;this.drawProbe();
        try{
            const result=await probe(this.id,target.ip,+target.port);
            if(result.error)throw new Error(result.error);
            if(connectivity.fingerprint(context)!==connectivity.fingerprint(this.context()))
                throw new Error('网络状态已变化，请重新检测');
            connectivity.result(context,target,result);
        }catch(e){this.probeError='检测未完成：'+(e.message||String(e));}
        finally{this.probing=false;this.drawProbe();}
    },
    drawProbe:function(){
        if(!this.probeStatus)return;
        const summary=connectivity.summary(this.context()),r=summary.result;
        const messages={passed:'TCP 连接已建立',refused:'目标拒绝连接，请检查端口服务',timeout:'连接超时，请检查路由、防火墙及目标状态',unreachable:'目标不可达，请检查路由与链路',wrong_route:'目标路由未经过所选 ZeroTier 网络',error:'连接失败，请重试或检查服务'};
        this.probeButton.disabled=!!this.probing||!L.hasViewPermission()||model.ztState(this.node,this.network).state!=='ready';
        this.probeButton.textContent=this.probing?'检测中…':'开始检测';
        this.probeStatus.className='jw-probe-status jw-'+(this.probing?'neutral':summary.tone);
        this.probeStatus.replaceChildren(E('strong',{},this.probing?'检测中，TCP 超时 5 秒…':summary.label),
            ...(this.probeError?[E('p',{},this.probeError)]:[]),
            ...(r?[E('p',{},(messages[r.outcome]||'检测未通过')+' · '+new Date(r.timestamp*1000).toLocaleString()),
                E('small',{},'本路由器 → '+summary.target.ip+' : '+summary.target.port+' / TCP'+(r.device?' · '+r.device:'')+(r.elapsed_ms!=null?' · '+r.elapsed_ms+' ms':''))]:[]));
    },
    load:function(){return getStatus().catch(()=>({zerotier:{node:{},networks:[],lan:{},error:true}}));},
    button:function(label,handler,disabled){return E('button',{type:'button',class:'cbi-button',disabled:disabled||null,click:async()=>{
        if(disabled||this.busy)return;this.busy=true;
        try{await handler();}catch(e){ui.addNotification(null,E('p',{},e.message||String(e)),'error');}
        finally{this.busy=false;this.draw();}
    }},label);},
    inspect:async function(){
        try{
            const result=this.id?await check(this.id):(await getStatus()).zerotier;
            if(result.error)throw new Error(result.error);
            this.boot=result.boot;this.running=result.running;this.node=result.node||{};this.network=result.network;this.lan=result.lan||{};this.error=null;
        }catch(e){this.error='状态读取失败，请检查服务与网络连接';this.running=null;this.node={};this.network=null;this.lan={};}
        this.draw();
    },
    draw:function(){
        const state=model.ztState(this.node||{},this.network),readonly=!L.hasViewPermission()||this.busy;
        const authorized=state.authorized,ready=state.state==='ready',lan=this.lan||{};
        const subnets=model.lanOverview(lan,this.network?[this.network]:[]);
        const step=!this.id?0:authorized?2:1;
        this.progress.replaceChildren(...['加入网络','面板授权','状态检查'].map((label,i)=>
            E('div',{class:'jw-wizard-step '+(i<=step?'jw-wizard-active ':'')+(i<step?'jw-wizard-done':'')},[
                E('span',{class:'jw-step-circle'},i<step?'✓':String(i+1)),E('span',{},(i+1)+'. '+label)])));
        this.banner.replaceChildren(E('p',{class:'jw-info-banner'},authorized?'已确认当前网络已加入并授权，直接检查连接。':'填写网络 ID 后，自行到授权面板授权；本页自动检查连接状态。'));
        const nodeInput=E('input',{class:'jw-node-id',readonly:true,value:this.node?.address||'等待服务启动','aria-label':'本机节点 ID'});
        const copy=async()=>{
            if(navigator.clipboard?.writeText)return navigator.clipboard.writeText(this.node.address);
            nodeInput.select();
            if(!document.execCommand('copy'))throw new Error('请选中节点 ID 后手动复制');
        };
        this.authorization.replaceChildren(E('h3',{},'2. 面板授权'),
                E('p',{},'请自行打开 ZeroTier 授权面板，授权此设备。'),
                E('div',{class:'jw-id-row'},[E('span',{},'本机节点 ID'),nodeInput,this.button('复制节点 ID',copy,!this.node?.address),
                    E('span',{class:'jw-badge '+(authorized?'jw-good':'jw-muted')},authorized?'已授权':'等待授权')]),
                E('p',{class:'jw-subtle'},authorized?'授权状态已自动确认。':'支持第三方控制器。找到本机节点 ID 并勾选授权，本页会自动继续检测。'),
                ...(!authorized?[this.button('我已授权，立即检测',()=>this.inspect(),!this.id||this.busy)]:[]));
        this.identitySummary.textContent=authorized?'连接设置 · 已加入并授权':'连接设置 · 加入与授权';
        this.details.replaceChildren(
            ...(this.error?[E('p',{class:'alert-message warning'},this.error)]:[]),
            E('section',{class:'jw-card'},[E('h3',{},'3. 状态检查'),E('div',{class:'jw-checkgrid'},[
                E('div',{class:'jw-check-panel'},[E('h4',{},'基础连接'),
                    indicator(this.running?'服务运行正常':'服务状态待检查',this.running),
                    indicator(this.node?.online?'节点在线':'节点尚未在线',this.node?.online===true),
                    indicator(authorized?'网络授权通过':labels[state.state],authorized),
                    indicator(ready?'虚拟 IP 已获取':'等待控制器分配虚拟 IP',ready),E('hr'),
                    row('网络名称',this.network?.name||'尚未加入网络'),row('本机虚拟 IP',(this.network?.assignedAddresses||[]).join('、')||'等待自动获取')]),
                E('div',{class:'jw-check-panel'},[E('h4',{},'内网互访'),
                    indicator((lan.addresses||[]).length?'本地地址已识别':'等待本地网络',!!(lan.addresses||[]).length),
                    indicator(lan.to_lan&&lan.from_lan?'内网转发已配置':'内网转发待检查',lan.to_lan&&lan.from_lan),
                    indicator((this.network?.routes||[]).length?'控制器路由已收到':'等待控制器下发路由',!!(this.network?.routes||[]).length),
                    E('hr'),
                    row('本地内网',subnets.local.join('、')),
                    row('远端内网',subnets.remote.join('、')||'等待控制器下发')])]),
                E('div',{class:'jw-warning'},[E('strong',{},ready?'基础连接已就绪，内网设备互访仍需实际验证。':'等待加入、授权和地址分配完成后继续检查。')]),
                E('div',{class:'jw-actions jw-check-actions'},[this.button('重新检查',()=>this.inspect(),!this.id||this.busy),
                    E('a',{class:'cbi-button',href:L.url('admin','services','zerotier','interface')},'查看接口信息')]),
                E('p',{class:'jw-subtle jw-centered'},'地址与路由由现有配置自动读取，无需手动填写。'),
                E('p',{class:'jw-subtle jw-centered'},'访问远端内网仍需控制器下发相应路由，并允许两端转发。')])
        );
        this.joinButton.disabled=readonly;
        this.joinState.textContent=this.network?'已加入':'待加入';
        this.joinState.className='jw-badge '+(this.network?'jw-good':'jw-muted');
        this.drawProbe();
    },
    render:function(data){
        const zt=data.zerotier||{};this.boot=zt.boot;this.running=zt.running;this.node=zt.node||{};this.network=(zt.networks||[])[0];this.lan=zt.lan||{};this.id=this.network?.id||'';
        const saved=connectivity.read(this.id).target||{};
        this.probeIP=E('input',{type:'text',value:saved.ip||'',placeholder:'例如 192.168.8.10','aria-label':'目标 IP',input:()=>this.targetChanged()});
        this.probePort=E('input',{type:'number',min:1,max:65535,value:saved.port||'',placeholder:'例如 443','aria-label':'TCP 端口',input:()=>this.targetChanged()});
        this.probeButton=E('button',{type:'button',class:'cbi-button cbi-button-action',click:()=>this.runProbe()},'开始检测');
        this.probeStatus=E('div',{'aria-live':'polite'});
        const probeCard=E('section',{class:'jw-card jw-probe',id:'connectivity'},[E('h3',{},'目标连通性检测'),
            E('p',{class:'jw-subtle'},'填写远端设备的 IP 与实际开放的 TCP 端口，点击后检测一次。'),
            E('div',{class:'jw-probe-fields'},[E('label',{},[E('span',{},'目标 IP'),this.probeIP]),E('label',{},[E('span',{},'TCP 端口'),this.probePort]),this.probeButton]),this.probeStatus,
            E('p',{class:'jw-subtle'},'检测方向：本路由器 → 目标设备。结果不代表两端内网设备均可互访。'),
            E('p',{class:'jw-subtle'},'目标和上次结果保存在当前浏览器；不自动发起检测，重启或网络变化后需要重测。')]);
        this.input=E('input',{type:'text',maxlength:16,placeholder:'16 位网络 ID',value:this.id,'aria-label':'ZeroTier 网络 ID'});
        this.progress=E('div',{class:'jw-wizard-progress'});this.details=E('div',{class:'jw-zt-details'});this.banner=E('div');this.joinState=E('span');
        this.authorization=E('div',{class:'jw-authorization'});this.identitySummary=E('summary');
        this.joinButton=this.button('加入网络',async()=>{
            const id=this.input.value.trim().toLowerCase();
            if(!/^[0-9a-f]{16}$/.test(id))throw new Error('请输入 16 位十六进制网络 ID');
            const result=await join(id);if(!result.accepted)throw new Error(result.error||'加入请求失败');
            this.id=id;const target=connectivity.read(id).target||{};this.probeIP.value=target.ip||'';this.probePort.value=target.port||'';await this.inspect();
        },!L.hasViewPermission());
        if(this.poller)poll.remove(this.poller);this.poller=()=>this.inspect();poll.add(this.poller,5);this.draw();
        return E('div',{class:'jw-page jw-zt-wizard'},[
            E('link',{rel:'stylesheet',href:L.resource('johnny/johnny.css')+'?v='+encodeURIComponent(L.env?.resource_version||'development')}),
            E('div',{class:'jw-zt-header'},[E('img',{src:L.resource('johnny/zerotier.png'),class:'jw-logo',alt:''}),
                E('div',{},[E('h2',{},'ZeroTier'),E('p',{},'家庭与公司内网互联 · 地址和路由自动读取。')])]),this.banner,this.progress,
            E('details',{class:'jw-card jw-identity',open:!model.ztState(this.node,this.network).authorized||null},[this.identitySummary,E('h3',{},'1. 加入网络'),
                E('div',{class:'jw-id-row'},[E('span',{},'网络 ID'),this.input,this.joinState,this.joinButton]),
                E('p',{class:'jw-subtle'},'已有网络与设备身份会保留。只需输入网络 ID，无需重复填写 IP。'),this.authorization]),this.details,probeCard]);
    },handleSaveApply:null,handleSave:null,handleReset:null
});
