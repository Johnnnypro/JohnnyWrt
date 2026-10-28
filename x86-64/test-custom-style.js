const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('custom CSS is last, excluded from recovery editor, and follows SPA route changes',()=>{
    const children=[],links=[];let changed;
    const body={dataset:{page:'admin-johnny-home'},appendChild:n=>children.push(n)};
    const document={body,createElement:()=>({style:{},setAttribute(k,v){this[k]=v;}}),querySelector:()=>({appendChild:n=>links.push(n)})};
    function MutationObserver(callback){changed=callback;this.observe=()=>{};}
    new Function('document','MutationObserver','L',fs.readFileSync(__dirname+'/johnny-custom-style.js','utf8'))(document,MutationObserver,{resource:p=>'/assets/'+p,url:(...p)=>'/'+p.join('/')});
    assert.equal(children.length,1);assert.match(children[0].href,/custom.css\?v=/);assert.equal(children[0].disabled,false);
    assert.equal(children[0]['data-luci-shell'],'','Aurora must recognize this persistent shell stylesheet');
    assert.equal(links[0].textContent,'自定义主题');assert.equal(links[0].href,'/admin/system/johnny-theme');
    body.dataset.page='admin-system-johnny-theme';changed();assert.equal(children[0].disabled,true);
    body.dataset.page='admin-services-zerotier-setup';changed();assert.equal(children[0].disabled,false);
});
