const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const timeout='tailscale up 失败：Warning: netfilter=off; configure iptables yourself.\ntimeout waiting for Tailscale service to enter a Running state; check health with "tailscale status"';
async function run(result,action='status') {
    const calls=[];
    const meow={mesh:async function(...args){assert.equal(this,meow);calls.push(args);return result;},updateDashboard:async()=>({}),dashboardURL:async()=>''};
    const L={env:{sessionid:'fixture'},require:async()=>meow};
    await vm.runInNewContext(fs.readFileSync(__dirname+'/johnny-meowx-bridge.js','utf8'),{L});
    return {value:await meow.mesh(action),calls};
}
test('Mesh timeout explains background retry without claiming completed application',async()=>{
    const original={backend:'NeedsLogin',daemon:true,settings:{enabled:true},state:{error:timeout}};
    const {value,calls}=await run(original);
    assert.match(value.state.error,/后台.*重试/);
    assert.match(value.state.error,/保存并应用/);
    assert.equal(original.state.error,timeout);
    assert.deepEqual(calls,[['status']]);
});
test('Running after timeout still requires completion of routes and firewall',async()=>{
    const {value}=await run({backend:'Running',self:{online:true},state:{error:timeout}});
    assert.match(value.state.error,/连接已恢复/);
    assert.match(value.state.error,/未完整应用/);
    assert.match(value.state.error,/保存并应用/);
});
test('offline, stopped daemon and unrelated errors are not described as healthy',async()=>{
    for(const before of [{backend:'Running',self:{online:false},state:{error:timeout}},
        {backend:'Stopped',daemon:false,state:{error:timeout}}]) {
        assert.doesNotMatch((await run(before)).value.state.error,/连接已恢复/);
    }
    for(const value of [{state:{error:'防火墙重载失败'}},{backend:'Running',state:{error:null}},null]) {
        assert.equal((await run(value)).value,value);
    }
    const failure={success:false,error:timeout};
    assert.equal((await run(failure,'apply')).value,failure);
});
