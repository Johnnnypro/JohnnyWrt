const fs=require('node:fs'),path=require('node:path');
const root=__dirname;
for(const name of fs.readdirSync(root)){
    if(!/^(johnny-|99-|90-|31-|30-|test-|network-test-plans|smoke-test|build25|geodata|imm25)/.test(name))continue;
    const file=path.join(root,name),data=fs.readFileSync(file);
    if(data.includes(13))throw new Error(`${name}: Linux source must use LF line endings`);
    if(name.endsWith('.json'))JSON.parse(data);
    if(name.endsWith('.js'))new Function(data.toString());
}
console.log('PASS: Linux line endings, JSON and JavaScript syntax');
