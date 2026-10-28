const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
function setup(storage={}) {
    const localStorage={getItem:k=>storage[k]||null,setItem:(k,v)=>storage[k]=v};
    const helper=new Function('baseclass','localStorage',fs.readFileSync(__dirname+'/johnny-connectivity.js','utf8'))({extend:x=>x},localStorage);
    return {helper,storage};
}
const context={boot:'boot-1',running:true,node:{online:true,address:'node-1'},network:{id:'abcdef0123456789',status:'OK',portDeviceName:'zt123',assignedAddresses:['10.0.0.2/24'],routes:[{target:'192.168.8.0/24',via:'10.0.0.3'}]},lan:{addresses:[{address:'192.168.2.1',mask:24}]}};
test('target persists but starts without a result',()=>{
    const {helper:h,storage}=setup();h.target(context.network.id,{ip:'192.168.8.2',port:'443'});
    assert.equal(setup(storage).helper.read(context.network.id).target.ip,'192.168.8.2');
    assert.equal(h.summary(context).label,'尚未检测');
});
test('success is historical and changing target clears it',()=>{
    const {helper:h}=setup(),id=context.network.id,target={ip:'192.168.8.2',port:'443'};
    h.target(id,target);h.result(context,target,{outcome:'passed',timestamp:100,elapsed_ms:12,device:'zt123'});
    assert.match(h.summary(context,160).label,/上次检测通过/);
    assert.match(h.summary(context,160).label,/1 分钟前/);
    h.target(id,{...target,port:'80'});assert.equal(h.summary(context).label,'尚未检测');
});
test('boot, routes, identity or unavailable status invalidates prior result',()=>{
    const {helper:h}=setup(),target={ip:'192.168.8.2',port:'443'};
    h.target(context.network.id,target);h.result(context,target,{outcome:'passed',timestamp:100});
    for(const next of [{...context,boot:'boot-2'},{...context,running:false},{...context,node:{}},{...context,network:{...context.network,routes:[]}}])
        assert.match(h.summary(next).label,/需重新检测/);
    assert.match(h.summary(context).label,/需重新检测/,'a stale success cannot become valid again');
});
test('late results never overwrite an edited target',()=>{
    const {helper:h}=setup(),target={ip:'192.168.8.2',port:'443'};
    h.target(context.network.id,target);h.target(context.network.id,{...target,ip:'192.168.8.3'});
    assert.equal(h.result(context,target,{outcome:'passed',timestamp:100}),false);
    assert.equal(h.read(context.network.id).result,undefined);
});
test('malformed or unavailable browser storage does not break a page',()=>{
    const {helper:h}=setup({'johnny-connectivity-v1':'{bad'});assert.equal(h.summary(context).label,'尚未检测');
    const bad={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}};
    const helper=new Function('baseclass','localStorage',fs.readFileSync(__dirname+'/johnny-connectivity.js','utf8'))({extend:x=>x},bad);
    assert.doesNotThrow(()=>helper.target(context.network.id,{ip:'192.168.8.2',port:'443'}));
});
test('readable but unwritable storage keeps edits and invalidation authoritative in memory',()=>{
    const {helper:seed,storage}=setup(),id=context.network.id,target={ip:'192.168.8.2',port:'443'};
    seed.target(id,target);seed.result(context,target,{outcome:'passed',timestamp:100});
    const create=()=>new Function('baseclass','localStorage',fs.readFileSync(__dirname+'/johnny-connectivity.js','utf8'))({extend:x=>x},{getItem:k=>storage[k],setItem(){throw Error('QuotaExceededError');}});
    const edited=create();edited.target(id,{...target,ip:'192.168.8.3'});
    assert.equal(edited.summary(context).label,'尚未检测');
    assert.equal(edited.read(id).target.ip,'192.168.8.3');
    const stale=create();stale.summary({...context,running:false});
    assert.match(stale.summary(context).label,/需重新检测/);
});
test('network keys and target formats stay distinct and corrupt result is ignored',()=>{
    const {helper:h}=setup({'johnny-connectivity-v1':'{"abcdef0123456789":{"target":{},"result":{"outcome":"passed"}}}'});
    assert.equal(h.summary(context).label,'尚未检测');
    assert.equal(h.valid({ip:'192.168.8.2',port:'443'}),true);
    for(const target of [{ip:'host.test',port:'80'},{ip:'127.0.0.1;touch x',port:'80'},{ip:'10.0.0.2',port:'80x'},{ip:'10.0.0.2',port:'0'},{ip:'10.0.0.2',port:'65536'}]) assert.equal(h.valid(target),false);
});
