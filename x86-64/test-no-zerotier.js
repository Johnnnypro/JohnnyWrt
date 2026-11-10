const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
test('firmware no longer installs ZeroTier packages, UI, RPC or networking hooks',()=>{
    const build=fs.readFileSync(__dirname+'/build25.sh','utf8');
    assert.doesNotMatch(build,/CUSTOM_PACKAGES=.*zerotier/);
    assert.doesNotMatch(build,/cp custom25\/(31-zerotier|90-zerotier|30-johnny-zt)/);
    assert.doesNotMatch(build,/cp .*johnny-zt-nat/);
    assert.doesNotMatch(build,/for view in .*zerotier/);
    assert.doesNotMatch(fs.readFileSync(__dirname+'/johnny-menu.json','utf8'),/zerotier/);
    assert.doesNotMatch(fs.readFileSync(__dirname+'/johnny-dashboard.uc','utf8'),/zerotier|zt_api|join_network/);
    assert.doesNotMatch(fs.readFileSync(__dirname+'/johnny-dashboard-acl.json','utf8'),/zerotier|"join"|"probe"|"check"/);
});
test('network-mode regression expects the removed interface to stay absent',()=>{
    const source=fs.readFileSync(__dirname+'/test-network-apply.uc','utf8');
    assert.match(source,/assert\(!live.get\('network','zerotier'\)\)/);
    assert.doesNotMatch(source,/meowx','zerotier/);
});
