const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const apple='https://captive.apple.com/hotspot-detect.html';
const google='https://www.gstatic.com/generate_204';
const key='config/speedtest-url';
function preference(values={}) {
    const data=new Map(Object.entries(values));
    const context={localStorage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)}};
    const run=()=>vm.runInNewContext(fs.readFileSync(__dirname+'/johnny-dashboard-defaults.js','utf8'),context);
    return {data,run};
}
test('fresh and upstream Google preferences become Apple, custom URLs survive',()=>{
    for(const before of [null,google,'https://example.com/check']) {
        const p=preference(before?{[key]:before}:{});p.run();
        assert.equal(p.data.get(key),before==='https://example.com/check'?before:apple);
        p.run();assert.equal(p.data.get(key),before==='https://example.com/check'?before:apple);
    }
});
test('a later explicit Google choice survives updates; clearing the preference restores Apple',()=>{
    const p=preference();p.run();p.data.set(key,google);p.run();assert.equal(p.data.get(key),google);
    p.data.delete(key);p.run();assert.equal(p.data.get(key),apple);
});
test('unavailable browser storage does not stop the dashboard script',()=>{
    vm.runInNewContext(fs.readFileSync(__dirname+'/johnny-dashboard-defaults.js','utf8'),{
        localStorage:{getItem(){throw new Error('blocked');}}
    });
});
async function bridge({downloadError,patchError,readOnly,response={}}={}) {
    const events=[];
    const meow={updateDashboard:async function(){assert.equal(this,meow);events.push('download');if(downloadError)throw new Error('download failed');return response;},
        dashboardURL:async()=>{events.push('url');return 'http://localhost:9090/ui/';}};
    const rpc={declare(spec){assert.equal(spec.object,'luci.johnny');assert.equal(spec.method,'dashboard_defaults');return async()=>{events.push('defaults');return patchError?{error:'patch failed'}:{applied:true};};}};
    const L={env:{sessionid:'synthetic-test-session'},hasViewPermission:()=>!readOnly,require:async name=>name==='tools.meowx'?meow:rpc};
    const done=vm.runInNewContext(fs.readFileSync(__dirname+'/johnny-meowx-bridge.js','utf8'),{L,console});
    await done;
    return {events,meow};
}
test('native update completes and defaults are installed before success',async()=>{
    const {events,meow}=await bridge();assert.deepEqual(await meow.updateDashboard(),{});
    assert.deepEqual(events,['download','defaults']);
});
test('opening a panel repairs defaults before returning its URL',async()=>{
    const {events,meow}=await bridge();assert.equal(await meow.dashboardURL(),'http://localhost:9090/ui/');
    assert.deepEqual(events,['url','defaults']);
});
test('failed native download never runs the patch; patch errors cannot report success',async()=>{
    let b=await bridge({downloadError:true});await assert.rejects(b.meow.updateDashboard(),/download failed/);assert.deepEqual(b.events,['download']);
    b=await bridge({patchError:true});await assert.rejects(b.meow.updateDashboard(),/patch failed/);assert.deepEqual(b.events,['download','defaults']);
});
test('read-only users can still open the installed dashboard without a write RPC',async()=>{
    const {events,meow}=await bridge({readOnly:true});
    assert.equal(await meow.dashboardURL(),'http://localhost:9090/ui/');
    assert.deepEqual(events,['url']);
});
test('native structured or empty failures retain their cause without running repair',async()=>{
    for(const response of [{message:'download unavailable'},null]) {
        const {events,meow}=await bridge({response,patchError:true});
        assert.deepEqual(await meow.updateDashboard(),response);
        assert.deepEqual(events,['download']);
    }
});
test('activation reloads controlled cached pages only after claiming them',async()=>{
    const events=[],handlers={};let finished;
    const self={addEventListener:(type,handler)=>handlers[type]=handler,clients:{
        claim:async()=>events.push('claim'),matchAll:async options=>{assert.equal(options.type,'window');events.push('list');
            return [{url:'https://router/ui/#/settings',navigate:async url=>events.push(url)},
                {url:'https://router/ui/closed',navigate:async()=>{throw new Error('tab closed');}}];}
    }};
    vm.runInNewContext(fs.readFileSync(__dirname+'/johnny-dashboard-worker.js','utf8'),{self,Promise});
    handlers.activate({waitUntil:promise=>finished=promise});await finished;
    assert.deepEqual(events,['claim','list','https://router/ui/#/settings']);
});
