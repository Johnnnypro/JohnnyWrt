'use strict';
'require baseclass';

return baseclass.extend({
    choices:function(themes){
        const result=[];
        Object.keys(themes||{}).forEach(name=>{
            const value=themes[name];
            if(name[0]==='.'||typeof value!=='string'||/\/bootstrap-(dark|light)$/.test(value))return;
            result.push({value:value,label:name});
        });
        return result;
    },
    current:function(media,argon,aurora){
        if(media==='/luci-static/argon')return ['light','dark'].includes(argon)?argon:'auto';
        if(media==='/luci-static/aurora')return ['light','dark'].includes(aurora)?aurora:'auto';
        return /\/bootstrap-(dark|light)$/.test(media)?media.split('-').pop():'auto';
    },
    target:function(media,mode){
        if(!['auto','light','dark'].includes(mode))throw Error('无效的外观模式');
        if(media==='/luci-static/bootstrap')return {media:media+(mode==='auto'?'':'-'+mode)};
        if(media==='/luci-static/argon')return {media:media,argon:mode==='auto'?'normal':mode};
        if(media==='/luci-static/aurora')return {media:media,aurora:mode==='auto'?'device':mode};
        return {media:media};
    }
});
