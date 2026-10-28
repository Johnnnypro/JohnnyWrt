'use strict';
'require baseclass';

const key='johnny-connectivity-v1';
let memory={};
let memoryOnly=false;
function records(){
    if(!memoryOnly)try {const value=JSON.parse(localStorage.getItem(key)||'{}');if(value&&typeof value==='object'&&!Array.isArray(value))memory=value;}catch(e){}
    return memory;
}
function write(id,value){const all=records();all[id]=value;try{localStorage.setItem(key,JSON.stringify(all));}catch(e){memoryOnly=true;}}
function valid(target){
    const ip=String(target?.ip||''),port=String(target?.port||'');
    if(!/^\d{1,5}$/.test(port)||+port<1||+port>65535)return false;
    if(/^\d{1,3}(\.\d{1,3}){3}$/.test(ip))return ip.split('.').every(n=>+n<=255&&String(+n)===n);
    if(!/^[a-f\d:]+$/i.test(ip)||!ip.includes(':'))return false;
    try{return !!new URL('http://['+ip+']/').hostname;}catch(e){return false;}
}
function read(id){
    const value=records()[id];
    if(!valid(value?.target))return {};
    const r=value.result;
    return {target:value.target,...(r&&typeof r.outcome==='string'&&Number.isFinite(r.timestamp)&&typeof r.context==='string'?{result:r}:{})};
}
function fingerprint(c){
    const n=c.network||{};
    if(!c.boot||!c.running||!c.node?.online||n.status!=='OK')return null;
    return JSON.stringify([c.boot,c.node.address,n.id,n.portDeviceName,
        [...(n.assignedAddresses||[])].sort(),(n.routes||[]).map(r=>JSON.stringify(r)).sort(),
        (c.lan?.addresses||[]).map(a=>JSON.stringify(a)).sort()]);
}
function same(a,b){return a?.ip===b?.ip&&String(a?.port)===String(b?.port);}
return baseclass.extend({
    valid,read,fingerprint,
    target:function(id,target){const old=read(id);write(id,same(old.target,target)?old:{target});},
    result:function(context,target,result){
        const id=context.network?.id||context.id,old=read(id),stamp=fingerprint(context);
        if(!stamp||!same(old.target,target))return false;
        write(id,{target,result:{...result,context:stamp}});return true;
    },
    summary:function(context,now=Date.now()/1000){
        const id=context.network?.id||context.id,old=read(id),r=old.result;
        if(!r)return {label:'尚未检测',tone:'neutral',target:old.target};
        if(r.stale||r.context!==fingerprint(context)){
            if(!r.stale)write(id,{...old,result:{...r,stale:true}});
            return {label:'网络状态已变化，需重新检测',tone:'neutral',target:old.target,result:r};
        }
        const minutes=Math.max(0,Math.floor((now-r.timestamp)/60));
        const age=minutes<1?'刚刚':minutes<60?minutes+' 分钟前':minutes<1440?Math.floor(minutes/60)+' 小时前':Math.floor(minutes/1440)+' 天前';
        return {label:(r.outcome==='passed'?'上次检测通过':'上次检测失败')+' · '+age,
            tone:r.outcome==='passed'?'good':'warning',target:old.target,result:r};
    }
});
