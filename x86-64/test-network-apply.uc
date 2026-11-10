// Destructive network tests ONLY inside a disposable two-NIC firmware guest.
import { readfile, writefile, glob } from 'fs';
import { connect } from 'ubus';
import { cursor } from 'uci';
let c=connect();
function rpc(object,method,args) {
    let reply=c.call(object,method,args), error=c.error();
    assert(!error, object+'.'+method+': '+error);
    return reply;
}
let sid=rpc('session','create',{timeout:1200}).ubus_rpc_session;
rpc('session','grant',{ubus_rpc_session:sid,scope:'uci',objects:[['*','*']]});
function call(method,args) { return rpc('uci',method,{...args,ubus_rpc_session:sid}); }
let original={},saved;
for(let name in ['network','dhcp','firewall','meowx']) original[name]=readfile('/etc/config/'+name);
let u=cursor(),names={fixture_bridge:'johnny_bridge',fixture_lan:'johnny_lan',fixture_wan:'johnny_wan'};
u.foreach('network','device',s=>{if(s.name=='br-lan')names.fixture_bridge=s['.name'];});
u.foreach('firewall','zone',s=>{if(s.name=='lan')names.fixture_lan=s['.name'];if(s.name=='wan')names.fixture_wan=s['.name'];});
function port_signature(ports) { return join(',',sort(ports)); }
assert(port_signature(['eth1','eth0'])=='eth0,eth1','bridge comparison must produce a nonempty port list');
assert(port_signature(['eth0'])!=port_signature(['eth0','eth1']),'partial bridge must not equal restored bridge');
function runtime_state() {
    let lan=rpc('network.interface.lan','status',{});
    let dnsInstances=values(rpc('service','list',{name:'dnsmasq'}).dnsmasq?.instances||{});
    let dnsRunning=length(dnsInstances)>0&&length(filter(dnsInstances,i=>!i.running))==0;
    let dump=rpc('network.interface','dump',{}).interface,interfaces={},clients=[],dhcpClients=[];
    for(let name in ['wan','wan6','wan_6','lan6']) {
        let iface=filter(dump,i=>i.interface==name)[0];
        interfaces[name]=iface?{proto:iface.proto,device:iface.device,autostart:iface.autostart,up:iface.up,pending:iface.pending}:null;
    }
    for(let path in glob('/proc/[0-9]*/cmdline')) {
        let args=filter(split(readfile(path)||'','\x00'),s=>s!='');
        if(!match(args[0]||'',/(^|\/)(udhcpc|odhcp6c)$/))continue;
        let env=split(readfile(replace(path,/cmdline$/,'environ'))||'','\x00');
        if(match(args[0]||'',/(^|\/)udhcpc$/)&&index(env,'INTERFACE=lan')>=0)
            push(dhcpClients,{device:args[index(args,'-i')+1],hostname:filter(args,s=>match(s,/^hostname:/))[0]||''});
        if(!match(args[0]||'',/(^|\/)odhcp6c$/))continue;
        let name=filter(env,s=>substr(s,0,10)=='INTERFACE=')[0]||'INTERFACE=unknown';
        push(clients,substr(name,10)+':'+args[length(args)-1]);
    }
    let resolver=split(readfile('/tmp/resolv.conf.d/resolv.conf.auto')||'','\n');
    let dhcpReady=length(lan['ipv4-address']||[])>0&&
        length(filter(lan.route||[],r=>r.target=='0.0.0.0'&&r.mask==0&&r.nexthop))>0&&
        length(filter(lan['dns-server']||[],d=>index(resolver,'nameserver '+d)>=0))>0;
    return {up:lan.up,pending:lan.pending,proto:lan.proto,dhcpClients,dhcpReady,dnsRunning,
        interfaces,clients:port_signature(clients),
        ports:port_signature(glob('/sys/class/net/br-lan/brif/*')),
        ipv6:trim(readfile('/proc/sys/net/ipv6/conf/br-lan/disable_ipv6')||''),
        wanIPv6:trim(readfile('/proc/sys/net/ipv6/conf/eth1/disable_ipv6')||'')};
}
function runtime_matches(state,expected) {
    if(expected.dhcpHostname!=null&&(!state.dhcpReady||length(state.dhcpClients)!=1||
        state.dhcpClients[0].device!='br-lan'||state.dhcpClients[0].hostname!=expected.dhcpHostname))return false;
    for(let name,wanted in expected.interfaces) {
        let found=state.interfaces[name];
        if(type(wanted)=='bool') { if(!!found!=wanted)return false; }
        else if(wanted) {
            if(!found)return false;
            for(let key,value in wanted)if(found[key]!=value)return false;
        }
    }
    return state.up&&!state.pending&&state.dnsRunning&&state.proto==expected.proto&&
        state.clients==expected.clients&&
        state.ports==expected.ports&&state.ipv6==expected.ipv6&&
        (expected.wanIPv6==null||state.wanIPv6==expected.wanIPv6);
}
let restored={up:true,pending:false,dnsRunning:true,proto:'dhcp',ports:'eth0,eth1',ipv6:'0',clients:'',
    interfaces:{wan:null,wan6:null,wan_6:null,lan6:null}};
let restoredExpected={...restored,interfaces:{wan:false,wan6:false,wan_6:false,lan6:false}};
let dhcpRestored={...restored,dhcpReady:true,dhcpClients:[{device:'br-lan',hostname:'hostname:original'}]};
let dhcpExpected={...restoredExpected,dhcpHostname:'hostname:original'};
assert(runtime_matches(dhcpRestored,dhcpExpected),'restored DHCP client and resolver must be accepted');
assert(!runtime_matches({...dhcpRestored,dnsRunning:false},dhcpExpected),'missing DNS service must fail despite valid interfaces and resolver files');
for(let dhcpClients in [[],[...dhcpRestored.dhcpClients,...dhcpRestored.dhcpClients],
    [{device:'eth1',hostname:'hostname:original'}],[{device:'br-lan',hostname:'hostname:johnny-confirm-test'}]])
    assert(!runtime_matches({...dhcpRestored,dhcpClients},dhcpExpected),'old, missing, duplicate or wrong DHCP client must fail');
assert(!runtime_matches({...dhcpRestored,dhcpReady:false},dhcpExpected),'missing DHCP lease, route or resolver must fail');
for(let name in keys(restored.interfaces))
    assert(!runtime_matches({...restored,interfaces:{...restored.interfaces,[name]:{proto:'dhcpv6'}}},restoredExpected),'rollback must reject leftover '+name);
assert(!runtime_matches({...restored,wanIPv6:'0'},{...restoredExpected,wanIPv6:'1'}),'active WAN must obey its explicit IPv6 setting');
assert(!runtime_matches({...restored,clients:'lan6:br-lan'},restoredExpected),'rollback must reject a leftover DHCPv6 client');
let active={...restored,clients:'wan6:eth1',interfaces:{...restored.interfaces,
    wan:{proto:'dhcp'},wan6:{proto:'dhcpv6',device:'eth1',autostart:true}}};
let activeExpected={...restoredExpected,clients:'wan6:eth1',interfaces:{...restoredExpected.interfaces,wan:true,wan6:active.interfaces.wan6}};
assert(runtime_matches(active,activeExpected),'active WAN6 and its client must be accepted');
for(let wan6 in [null,{...active.interfaces.wan6,proto:'none'},{...active.interfaces.wan6,device:'br-lan'},{...active.interfaces.wan6,autostart:false}])
    assert(!runtime_matches({...active,interfaces:{...active.interfaces,wan6}},activeExpected),'missing or incorrect WAN6 must fail');
for(let clients in ['', 'wan6:br-lan', 'wan6:eth1,wan_6:eth1'])
    assert(!runtime_matches({...active,clients},activeExpected),'missing, wrong or duplicate DHCPv6 client must fail');
let baseline={proto:u.get('network','lan','proto'),
    ports:port_signature(map(u.get('network',names.fixture_bridge,'ports'),p=>'/sys/class/net/br-lan/brif/'+p)),
    ipv6:trim(readfile('/proc/sys/net/ipv6/conf/br-lan/disable_ipv6')),
    interfaces:{wan:false,wan6:false,wan_6:false,lan6:false},clients:''};
assert(type(baseline.ports)=='string'&&length(baseline.ports)>0,'baseline bridge ports are unavailable');
let originalDhcp=runtime_state().dhcpClients;
assert(length(originalDhcp)==1&&originalDhcp[0].device=='br-lan','original LAN DHCP client is unavailable');
let originalHostname=originalDhcp[0].hostname;
assert(originalHostname!='hostname:johnny-confirm-test','confirmation marker already exists');
function wait_runtime(expected,label,seconds) {
    function milliseconds() { let t=clock(true); return t[0]*1000+int(t[1]/1000000); }
    let start=milliseconds(),deadline=start+seconds*1000;
    let stable=0;
    let previous;
    while(milliseconds()<deadline) {
        let state=runtime_state(),encoded=sprintf('%J',state);
        if(encoded!=previous)printf('NETWORK_RUNTIME %s elapsed=%.1f actual=%s expected=%J\n',label,(milliseconds()-start)/1000,encoded,expected);
        previous=encoded;
        stable=runtime_matches(state,expected)?stable+1:0;
        if(stable>=2) {
            // Query the local server even for the PPPoE fixture without an ISP.
            // Files and a live ujail alone cannot prove DNS is answering.
            let ok=system('nslookup -timeout=1 -retry=1 -type=A localhost 127.0.0.1 > /tmp/johnny-network-dns.log 2>&1')==0;
            if(ok&&milliseconds()<deadline) {
                printf('NETWORK_DNS_PASS %s localhost via 127.0.0.1\n',label);
                return;
            }
            printf('NETWORK_DNS_FAILURE %s %s\n',label,readfile('/tmp/johnny-network-dns.log'));
            stable=0;
        }
        sleep(500);
    }
    assert(false,label+' runtime did not reach expected network and working local DNS within '+seconds+' seconds');
}
function stage(plan) {
    for(let item in plan.deletes) {
        let values=call('get',{config:item.config}).values;
        if(values[item.section])call('delete',{config:item.config,section:item.section});
    }
    for(let item in plan.updates) {
        let section=names[item.section]||item.section;
        let values=call('get',{config:item.config}).values;
        if(!values[section])call('add',{config:item.config,type:item.type,name:section});
        let set={},remove=[];
        for(let key,value in item.values) {if(value==null)push(remove,key);else set[key]=value;}
        call('set',{config:item.config,section,values:set});
        remove=filter(remove,key=>values[section]?.[key]!=null);
        if(length(remove))call('delete',{config:item.config,section,options:remove});
    }
}
let failure;
try {
    saved={};
    for(let name in keys(original))saved[name]=readfile('/etc/config/'+name);
    wait_runtime(baseline,'initial',30);
    for(let plan in json(readfile('/tmp/johnny-network-plans.json'))) {
        printf('NETWORK_TEST_BEGIN %s/%s\n',plan.role,plan.protocol);
        stage(plan);
        call('apply',{rollback:true,timeout:20});
        let bridge=filter(plan.updates,item=>item.config=='network'&&item.section=='fixture_bridge')[0];
        let main=plan.role=='main';
        let expected={proto:main?'static':plan.protocol,
            interfaces:{wan:main,wan6:main?null:false,wan_6:false,lan6:false},clients:'',
            ports:port_signature(map(bridge.values.ports,p=>'/sys/class/net/br-lan/brif/'+p)),
            ipv6:baseline.ipv6};
        wait_runtime(expected,'applied',15);
        let live=cursor();
        assert(live.get('network','lan','proto')==(plan.role=='main'?'static':plan.protocol));
        assert(live.get('dhcp','lan','ignore')==(plan.role=='main'?'0':'1'));
        assert(!live.get('network','zerotier'));
        if(plan.role=='main') {
            assert(live.get('network','wan','device')=='eth1');
            assert(live.get('network','wan','proto')==plan.protocol);
            assert(system('fw4 check >/dev/null 2>&1')==0);
        }
        // Deliberately do not confirm: native rpcd must restore the exact files.
        for(let i=0;i<60;i++) {
            if(length(filter(keys(saved),name=>readfile('/etc/config/'+name)!=saved[name]))==0)break;
            sleep(500);
        }
        for(let name,text in saved) assert(readfile('/etc/config/'+name)==text,'rollback changed '+name);
        for(let name in ['network','dhcp','firewall'])call('revert',{config:name});
        // Restored UCI files do not mean netifd has finished rebuilding the bridge.
        wait_runtime(baseline,'rollback',30);
        printf('PASS: %s/%s native apply and automatic rollback\n',plan.role,plan.protocol);
    }
    call('set',{config:'network',section:'lan',values:{hostname:'johnny-confirm-test'}});
    call('apply',{rollback:true,timeout:6});
    call('confirm',{});
    sleep(7000);
    assert(cursor().get('network','lan','hostname')=='johnny-confirm-test');
    wait_runtime({...baseline,dhcpHostname:'hostname:johnny-confirm-test'},'confirmed',30);
    print('PASS: confirmed network change survives rollback timeout\n');
} catch(e) { printf('NETWORK_TEST_FAILURE %J\n',e); failure=e; }
{
    try { printf('NETWORK_CLEANUP_BEGIN %J\n',runtime_state()); }
    catch(e) { printf('NETWORK_CLEANUP_SNAPSHOT_ERROR before %J\n',e); }
    rpc('session','destroy',{ubus_rpc_session:sid});
    // Destroying an unconfirmed session rolls back; restore cleanup files after it.
    let changed=[];
    for(let name,text in original) {
        if(readfile('/etc/config/'+name)!=text)push(changed,name);
        writefile('/etc/config/'+name,text);
    }
    // Native apply emits config.change directly. Its changes are not tracked by
    // reload_config's old MD5 snapshot, which can mistake restored files for a no-op.
    for(let name in changed)rpc('service','event',{type:'config.change',data:{package:name}});
    if(!failure) {
        // The restored DHCP hostname proves this cleanup has reached netifd.
        wait_runtime({...baseline,dhcpHostname:originalHostname},'cleanup',30);
        for(let name,text in original)assert(readfile('/etc/config/'+name)==text,'cleanup changed '+name);
        assert(system('test -z "$(uci changes)"')==0,'cleanup left pending UCI changes');
    }
    try { printf('NETWORK_CLEANUP_RETURN %J\n',runtime_state()); }
    catch(e) { printf('NETWORK_CLEANUP_SNAPSHOT_ERROR after %J\n',e); }
    c.disconnect();
}
assert(!failure, ''+failure);
