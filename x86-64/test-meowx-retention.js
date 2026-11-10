const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
test('firmware owns backup coverage for all whitelist data independently of vendor APK',()=>{
    const paths=fs.readFileSync(__dirname+'/johnny-meowx.keep','utf8').trim().split('\n');
    for(const path of ['/etc/config/meowx','/etc/meowx/po0.json','/etc/meowx/panel.json','/etc/meowx/mesh.json','/etc/tailscale/']) assert(paths.includes(path),path);
    assert(!paths.includes('/etc/meowx/'),'do not back up bundled UI/geodata or vendor scripts');
    assert.match(fs.readFileSync(__dirname+'/build25.sh','utf8'),/johnny-meowx.keep.*keep.d/);
});
