// Destructive network tests ONLY inside a disposable two-NIC firmware guest.
import { readfile, writefile } from 'fs';
import { connect } from 'ubus';
import { cursor } from 'uci';
let c=connect();
function rpc(object,method,args) {
    let reply=c.call(object,method,args), error=c.error();
    assert(!error, object+'.'+method+': '+error);
    return reply;
}
let sid=rpc('session','create',{timeout:300}).ubus_rpc_session;
rpc('session','grant',{ubus_rpc_session:sid,scope:'uci',objects:[['*','*']]});
function call(method,args) { return rpc('uci',method,{...args,ubus_rpc_session:sid}); }
let saved={};
for(let name in ['network','dhcp','firewall','meowx','zerotier']) saved[name]=readfile('/etc/config/'+name);
let u=cursor(),names={fixture_bridge:'johnny_bridge',fixture_lan:'johnny_lan',fixture_wan:'johnny_wan'};
u.foreach('network','device',s=>{if(s.name=='br-lan')names.fixture_bridge=s['.name'];});
u.foreach('firewall','zone',s=>{if(s.name=='lan')names.fixture_lan=s['.name'];if(s.name=='wan')names.fixture_wan=s['.name'];});
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
    for(let plan in json(readfile('/tmp/johnny-network-plans.json'))) {
        printf('NETWORK_TEST_BEGIN %s/%s IPv6=%J\n',plan.role,plan.protocol,plan.ipv6);
        stage(plan);
        call('apply',{rollback:true,timeout:10});
        sleep(3000);
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
        sleep(9000);
        for(let name,text in saved) assert(readfile('/etc/config/'+name)==text,'rollback changed '+name);
        for(let name in ['network','dhcp','firewall'])call('revert',{config:name});
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
    for(let name,text in saved)writefile('/etc/config/'+name,text);
    rpc('session','destroy',{ubus_rpc_session:sid});
    rpc('uci','reload_config',{});
    c.disconnect();
}
assert(!failure, ''+failure);
