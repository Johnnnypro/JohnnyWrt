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
for(let name in ['network','dhcp','firewall','meowx','zerotier']) original[name]=readfile('/etc/config/'+name);
let u=cursor(),names={fixture_bridge:'johnny_bridge',fixture_lan:'johnny_lan',fixture_wan:'johnny_wan'};
u.foreach('network','device',s=>{if(s.name=='br-lan')names.fixture_bridge=s['.name'];});
u.foreach('firewall','zone',s=>{if(s.name=='lan')names.fixture_lan=s['.name'];if(s.name=='wan')names.fixture_wan=s['.name'];});
function port_signature(ports) { return join(',',sort(ports)); }
assert(port_signature(['eth1','eth0'])=='eth0,eth1','bridge comparison must produce a nonempty port list');
assert(port_signature(['eth0'])!=port_signature(['eth0','eth1']),'partial bridge must not equal restored bridge');
function runtime_state() {
    let lan=rpc('network.interface.lan','status',{});
    let interfaces=rpc('network.interface','dump',{}).interface;
    return {up:lan.up,pending:lan.pending,proto:lan.proto,
        wanPresent:length(filter(interfaces,i=>i.interface=='wan'||i.interface=='wan6'||i.interface=='wan_6'))>0,
        ports:port_signature(glob('/sys/class/net/br-lan/brif/*')),
        ipv6:trim(readfile('/proc/sys/net/ipv6/conf/br-lan/disable_ipv6')||''),
        wanIPv6:trim(readfile('/proc/sys/net/ipv6/conf/eth1/disable_ipv6')||'')};
}
function runtime_matches(state,expected) {
    return state.up&&!state.pending&&state.proto==expected.proto&&
        state.wanPresent==expected.wanPresent&&
        state.ports==expected.ports&&state.ipv6==expected.ipv6&&
        (expected.wanIPv6==null||state.wanIPv6==expected.wanIPv6);
}
let restored={up:true,pending:false,proto:'dhcp',ports:'eth0,eth1',ipv6:'0',wanPresent:false};
assert(!runtime_matches({...restored,wanPresent:true},restored),'rollback must reject a leftover WAN interface');
assert(!runtime_matches({...restored,wanPresent:true,wanIPv6:'0'},
    {...restored,wanPresent:true,wanIPv6:'1'}),'active WAN must obey its explicit IPv6 setting');
let baseline={proto:u.get('network','lan','proto'),
    ports:port_signature(map(u.get('network',names.fixture_bridge,'ports'),p=>'/sys/class/net/br-lan/brif/'+p)),
    ipv6:trim(readfile('/proc/sys/net/ipv6/conf/br-lan/disable_ipv6')),wanPresent:false};
assert(type(baseline.ports)=='string'&&length(baseline.ports)>0,'baseline bridge ports are unavailable');
function wait_runtime(expected,label,seconds) {
    let stable=0;
    let previous;
    for (let i=0;i<seconds*2;i++) {
        let state=runtime_state(),encoded=sprintf('%J',state);
        if(encoded!=previous)printf('NETWORK_RUNTIME %s elapsed=%.1f actual=%s expected=%J\n',label,i/2,encoded,expected);
        previous=encoded;
        stable=runtime_matches(state,expected)?stable+1:0;
        if(stable==2)return;
        sleep(500);
    }
    assert(false,label+' runtime did not reach expected LAN, bridge ports and IPv6 within '+seconds+' seconds');
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
    // Test explicit enable overriding a pre-existing physical-device disable.
    // After rollback eth1 is a bridge member, not a WAN L3 interface: require
    // WAN/WAN6 removal and restored br-lan IPv6, not a derived member flag.
    assert(!u.get('network','fixture_wan_device'),'unexpected fixture device already exists');
    u.set('network','fixture_wan_device','device');
    u.set('network','fixture_wan_device','name','eth1');
    u.set('network','fixture_wan_device','ipv6','0');
    u.commit('network');
    rpc('network','reload',{});
    saved={};
    for(let name in keys(original))saved[name]=readfile('/etc/config/'+name);
    wait_runtime(baseline,'initial',30);
    for(let plan in json(readfile('/tmp/johnny-network-plans.json'))) {
        printf('NETWORK_TEST_BEGIN %s/%s IPv6=%J\n',plan.role,plan.protocol,plan.ipv6);
        stage(plan);
        call('apply',{rollback:true,timeout:20});
        let bridge=filter(plan.updates,item=>item.config=='network'&&item.section=='fixture_bridge')[0];
        let expected={proto:plan.role=='main'?'static':plan.protocol,wanPresent:plan.role=='main',
            ports:port_signature(map(bridge.values.ports,p=>'/sys/class/net/br-lan/brif/'+p)),
            ipv6:type(plan.ipv6)=='bool'?(plan.ipv6?'0':'1'):baseline.ipv6};
        if(plan.role=='main'&&type(plan.ipv6)=='bool')expected.wanIPv6=expected.ipv6;
        wait_runtime(expected,'applied',15);
        let live=cursor();
        assert(live.get('network','lan','proto')==(plan.role=='main'?'static':plan.protocol));
        assert(live.get('dhcp','lan','ignore')==(plan.role=='main'?'0':'1'));
        assert(live.get('network','zerotier','proto')=='none');
        if(plan.role=='main') {
            assert(live.get('network','wan','device')=='eth1');
            assert(live.get('network','wan','proto')==plan.protocol);
            assert(system('fw4 check >/dev/null 2>&1')==0);
        }
        if (type(plan.ipv6)=='bool') {
            let enabled=plan.ipv6, main=plan.role=='main';
            assert(live.get('network','lan','ipv6')==(enabled?'1':'0'),'LAN UCI IPv6='+live.get('network','lan','ipv6'));
            assert(trim(readfile('/proc/sys/net/ipv6/conf/br-lan/disable_ipv6'))==(enabled?'0':'1'),'br-lan disable_ipv6='+readfile('/proc/sys/net/ipv6/conf/br-lan/disable_ipv6'));
            assert(live.get('dhcp','lan','ra')==(enabled&&main?'server':'disabled'));
            assert(live.get('dhcp','lan','dhcpv6')==(enabled&&main?'server':'disabled'));
            if (main) {
                assert(live.get('network','wan6','device')=='@wan');
                assert(live.get('network','wan6','auto')==(enabled?'1':'0'));
                assert(live.get('network','wan','ipv6')==(enabled?'1':'0'));
                assert(trim(readfile('/proc/sys/net/ipv6/conf/eth1/disable_ipv6'))==(enabled?'0':'1'));
                if (enabled) {
                    assert(live.get('network','wan6','delegate')=='1');
                    assert(live.get('network','wan6','reqprefix')=='auto');
                }
            } else if (enabled) {
                assert(live.get('network','lan6','device')=='@lan');
                assert(live.get('network','lan6','reqprefix')=='no');
            } else assert(!live.get('network','lan6'));
            assert(system('fw4 check')==0,'IPv6 firewall validation failed');
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
        printf('PASS: %s/%s IPv6=%J native apply and automatic rollback\n',plan.role,plan.protocol,plan.ipv6);
    }
    call('set',{config:'network',section:'lan',values:{hostname:'johnny-confirm-test'}});
    call('apply',{rollback:true,timeout:6});
    call('confirm',{});
    sleep(7000);
    assert(cursor().get('network','lan','hostname')=='johnny-confirm-test');
    print('PASS: confirmed network change survives rollback timeout\n');
} catch(e) { printf('NETWORK_TEST_FAILURE %J\n',e); failure=e; }
{
    for(let name,text in original)writefile('/etc/config/'+name,text);
    rpc('session','destroy',{ubus_rpc_session:sid});
    rpc('uci','reload_config',{});
    c.disconnect();
}
assert(!failure, ''+failure);
