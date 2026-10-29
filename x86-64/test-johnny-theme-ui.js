const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const load=()=>new Function('baseclass',fs.readFileSync(__dirname+'/johnny-appearance.js','utf8'))({extend:x=>x});
test('installed theme choices retain names and group Bootstrap appearance variants',()=>{
 const m=load(),choices=m.choices({Aurora:'/luci-static/aurora',Argon:'/luci-static/argon',Bootstrap:'/luci-static/bootstrap',BootstrapDark:'/luci-static/bootstrap-dark',BootstrapLight:'/luci-static/bootstrap-light',Other:'/luci-static/other'});
 assert.deepEqual(choices.map(x=>x.value),['/luci-static/aurora','/luci-static/argon','/luci-static/bootstrap','/luci-static/other']);
 assert.equal(choices[1].label,'Argon');
});
test('every bundled theme resolves auto/light/dark without overriding explicit light',()=>{
 const m=load();
 for(const mode of ['auto','light','dark']){
  assert.deepEqual(m.target('/luci-static/bootstrap',mode),{media:'/luci-static/bootstrap'+(mode==='auto'?'':'-'+mode)});
  assert.deepEqual(m.target('/luci-static/argon',mode),{media:'/luci-static/argon',argon:mode==='auto'?'normal':mode});
  assert.deepEqual(m.target('/luci-static/aurora',mode),{media:'/luci-static/aurora',aurora:mode==='auto'?'device':mode});
 }
 assert.equal(m.current('/luci-static/bootstrap-light','dark','dark'),'light');
 assert.equal(m.current('/luci-static/argon','light','dark'),'light');
 assert.equal(m.current('/luci-static/aurora','dark','light'),'light');
 assert.throws(()=>m.target('/luci-static/argon','bad'));
});
test('injected Argon bridge follows live OS changes only in automatic mode',()=>{
 const source=fs.readFileSync(__dirname+'/johnny-ui-layout.uc','utf8');
 const script=[...source.matchAll(/\bbridge \+?= ('(?:\\.|[^'])*');/g)].map(m=>new Function('return '+m[1])()).join('').replace(/<\/?script[^>]*>/g,'');
 assert(script.includes('matchMedia'));
 for(const mode of ['normal','light','dark'])for(const initial of [false,true]){
  let resolved,listener;
  const query={matches:initial,addEventListener:(event,fn)=>{assert.equal(event,'change');listener=fn;}};
  require('node:vm').runInNewContext(script.replace('{{ mode }}',mode),{matchMedia:()=>query,document:{documentElement:{setAttribute:(name,value)=>{assert.equal(name,'data-darkmode');resolved=value;}}}});
  assert.equal(resolved,mode==='dark'||(mode==='normal'&&initial));
  query.matches=!initial;if(listener)listener();
  assert.equal(resolved,mode==='dark'||(mode==='normal'&&!initial));
 }
});
test('theme page has no custom CSS access and reuses Argon only through an explicit modal',()=>{
 const source=fs.readFileSync(__dirname+'/johnny-theme.js','utf8');
 assert(!source.includes('theme.css'));assert(!source.includes('textarea'));
 assert.match(source,/showModal/);assert.match(source,/johnny.argon-config/);assert.match(source,/hasViewPermission/);
 const acl=JSON.parse(fs.readFileSync(__dirname+'/johnny-theme-acl.json'));
 const text=JSON.stringify(acl);assert(!text.includes('file'));assert(text.includes('luci'));assert(text.includes('argon'));
});
function page(readonly=false){
 const values={luci:{main:{mediaurlbase:'/luci-static/aurora'},themes:{Aurora:'/luci-static/aurora',Argon:'/luci-static/argon',Bootstrap:'/luci-static/bootstrap'}},argon:{global:{mode:'normal'}}},calls=[],storage={};
 const uci={load:async()=>{},get:(c,s,k)=>k?values[c]?.[s]?.[k]:values[c]?.[s],sections:()=>[{'.name':'global'}],set:(c,s,k,v)=>{calls.push([c,s,k,v]);values[c][s][k]=v;},save:async()=>{if(uci.fail)throw Error('save error');},changes:async()=>({luci:[['set','main','mediaurlbase']]})};
 function E(tag,attrs={},children=[]){return {tag,...attrs,children,textContent:typeof children==='string'?children:'',value:attrs.value||''};}
 const window={location:{}},ui={changes:{apply:async()=>calls.push('apply')},showModal:(title)=>calls.push(title),addNotification:()=>calls.push('error')};
 const v=new Function('view','uci','ui','appearance','E','L','localStorage','window',fs.readFileSync(__dirname+'/johnny-theme.js','utf8'))({extend:x=>x},uci,ui,load(),E,{hasViewPermission:()=>!readonly,resource:x=>x,url:()=>'/theme',require:async()=>({load:async()=>[],render:async()=>E('div')})},{getItem:k=>storage[k],setItem:(k,v)=>storage[k]=v},window);
 v.render();return {v,calls,uci,window,storage};
}
test('Argon details appear only when selected; readonly controls do not save',async()=>{
 const t=page();assert.equal(t.v.argonButton.hidden,true);
 t.v.theme.value='/luci-static/argon';t.v.refreshOptions();assert.equal(t.v.argonButton.hidden,false);
 await t.v.openArgon();assert(t.calls.includes('Argon 详细设置'));
 t.v.theme.value='/luci-static/bootstrap';t.v.refreshOptions();assert.equal(t.v.argonButton.hidden,true);
 const r=page(true);await r.v.save();assert.equal(r.calls.length,0);assert(r.v.mode.disabled);
 r.v.theme.value='/luci-static/argon';r.v.refreshOptions();await r.v.openArgon();
 assert(r.v.argonButton.disabled);assert(!r.calls.includes('Argon 详细设置'),'read-only users cannot enter the editing modal');
});
test('save applies the chosen installed theme and mode, failures stay visible',async()=>{
 const t=page();t.v.theme.value='/luci-static/argon';t.v.mode.value='light';await t.v.save();
 assert(t.calls.some(x=>Array.isArray(x)&&x.join('/')==='argon/global/mode/light'));assert(t.calls.includes('apply'));assert.equal(t.window.location.href,undefined,'native apply must finish before any navigation');
 const f=page();f.uci.fail=true;await f.v.save();assert.match(f.v.notice.textContent,/保存失败/);assert(!f.calls.includes('apply'));assert.equal(f.window.location.href,undefined);
});
