const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
function setup(readonly=false){
    const nodes=[],writes=[];let saved='/* saved CSS */',fail=false;
    function E(tag,attrs={},children=[]){const n={tag,...attrs,children,textContent:typeof children==='string'?children:'',replaceChildren(...n){this.children=n;}};nodes.push(n);return n;}
    const view=new Function('view','fs','ui','E','L','document',fs.readFileSync(__dirname+'/johnny-theme.js','utf8'))(
        {extend:x=>x},{read:async()=>saved,write:async(path,css)=>{if(fail)throw Error('write failed');writes.push([path,css]);saved=css;}},
        {showModal:(_,content)=>nodes.push(...content),hideModal(){}},E,{hasViewPermission:()=>!readonly,resource:x=>x},{getElementById:()=>null});
    return {view,writes,nodes,fail:()=>fail=true,button:label=>nodes.findLast(n=>n.tag==='button'&&n.textContent===label)};
}
test('custom CSS editor loads existing text and writes only its fixed CSS path',async()=>{
    const t=setup();t.view.render(await t.view.load());assert.equal(t.view.editor.value,'/* saved CSS */');
    t.view.editor.value=':root { --example: 1; }';await t.button('保存并应用').click();
    assert.deepEqual(t.writes,[['/etc/johnny/theme.css',':root { --example: 1; }']]);
});
test('readonly theme cannot write; failed write never claims saved',async()=>{
    const r=setup(true);r.view.render(await r.view.load());await r.button('保存并应用').click();assert.equal(r.writes.length,0);
    const t=setup();t.view.render(await t.view.load());t.fail();await t.button('保存并应用').click();assert.match(t.view.notice.textContent,/保存失败/);
});
test('restoring CSS requires the explicit restore action and saves empty text',async()=>{
    const t=setup();t.view.render(await t.view.load());await t.button('恢复默认').click();assert.equal(t.writes.length,0);
    await t.button('确认恢复').click();assert.deepEqual(t.writes,[['/etc/johnny/theme.css','']]);
});
