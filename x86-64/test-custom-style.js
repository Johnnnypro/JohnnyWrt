const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('custom CSS is last, excluded from recovery editor, and follows SPA route changes',()=>{
    const children=[],wrappers=[];let changed;
    const body={dataset:{page:'admin-johnny-home'},appendChild:n=>children.push(n)};
    const switchers=[{children:['device','light','dark']},{children:['device','light','dark']}];
    switchers.forEach(s=>{s.before=n=>wrappers.push(n);s.appendChild=n=>s.children.push(n);});
    const document={body,createElement:()=>({style:{},children:[],appendChild(n){this.children.push(n);},setAttribute(k,v){this[k]=v;}}),querySelector:()=>switchers[0],querySelectorAll:()=>switchers};
    function MutationObserver(callback){changed=callback;this.observe=()=>{};}
    new Function('document','MutationObserver','L',fs.readFileSync(__dirname+'/johnny-custom-style.js','utf8'))(document,MutationObserver,{resource:p=>'/assets/'+p,url:(...p)=>'/'+p.join('/')});
    assert.equal(children.length,1);assert.match(children[0].href,/custom.css\?v=/);assert.equal(children[0].disabled,false);
    assert.equal(children[0]['data-luci-shell'],'','Aurora must recognize this persistent shell stylesheet');
    assert.equal(wrappers.length,2,'desktop and mobile controls both need an entry');
    for(let i=0;i<2;i++){
        assert.equal(wrappers[i].children[0],switchers[i]);
        assert.deepEqual(switchers[i].children,['device','light','dark'],'preserve Aurora thirds-based indicator geometry');
        const entry=wrappers[i].children[1];assert.equal(entry.textContent,'自定义主题');assert.equal(entry.href,'/admin/system/johnny-theme');
    }
    body.dataset.page='admin-system-johnny-theme';changed();assert.equal(children[0].disabled,true);
    body.dataset.page='admin-services-zerotier-setup';changed();assert.equal(children[0].disabled,false);
});
