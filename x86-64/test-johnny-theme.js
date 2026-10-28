const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const css=fs.readFileSync(process.env.JOHNNY_CSS||__dirname+'/johnny.css','utf8');
function luminance(hex){
    if(hex.length===3)hex=hex.split('').map(x=>x+x).join('');
    return hex.match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4)
        .reduce((sum,x,i)=>sum+x*[.2126,.7152,.0722][i],0);
}
function contrast(a,b){a=luminance(a);b=luminance(b);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);}
test('normal text and semantic notices meet 4.5:1 in both resolved themes',()=>{
    const blocks=[...css.matchAll(/[^{}]*\{([^{}]*--jw-text:[^{}]*)\}/g)].map(m=>Object.fromEntries([...m[1].matchAll(/--jw-([\w-]+):#([a-f\d]+)\b/g)].map(m=>[m[1],m[2]])));
    assert.equal(blocks.length,2,'both light and dark palettes are required');
    const light=blocks[0],dark={...light,...blocks[1]};
    for(const [name,p]of [['light',light],['dark',dark]]){
        for(const background of ['surface','input','neutral-bg','blue-bg','pink-bg','good-bg','warning-bg','purple-bg'])
            for(const foreground of ['text','muted'])assert(contrast(p[foreground],p[background])>=4.5,`${name} ${foreground}/${background}`);
        for(const [foreground,background]of [['blue','blue-bg'],['rx','surface'],['tx','surface'],['pink','pink-bg'],['good','good-bg'],['warning','warning-bg']])
            assert(contrast(p[foreground],p[background])>=4.5,`${name} ${foreground}/${background}`);
        assert(contrast('fff',p.primary)>=4.5,`${name} primary button`);
    }
});
test('custom pages follow Aurora resolved appearance and cannot override manual choice using OS media',()=>{
    assert.match(css,/:root\[data-darkmode="true"\] \.jw-page/);
    assert(!css.includes('prefers-color-scheme'));
    assert(!css.includes('--text-color')&&!css.includes('--background-color'));
});
