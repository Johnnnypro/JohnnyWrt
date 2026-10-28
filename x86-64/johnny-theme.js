'use strict';
'require view';
'require fs';
'require ui';

return view.extend({
    load:function(){return fs.read('/etc/johnny/theme.css');},
    save:async function(css){
        if(!L.hasViewPermission()||this.busy)return;
        if(new TextEncoder().encode(css).length>32768){this.notice.textContent='样式最多 32 KB';return;}
        this.busy=true;this.saveButton.disabled=true;this.resetButton.disabled=true;
        try{
            await fs.write('/etc/johnny/theme.css',css);this.editor.value=css;
            const link=document.getElementById('johnny-custom-style');
            if(link)link.href=L.resource('johnny/custom.css')+'?v='+Date.now();
            this.notice.textContent=css?'已保存。打开其他页面查看效果，已打开的页面请刷新。':'已恢复默认样式。';
        }catch(e){this.notice.textContent='保存失败：'+(e.message||String(e));}
        finally{this.busy=false;this.saveButton.disabled=false;this.resetButton.disabled=false;}
    },
    render:function(css){
        const readonly=!L.hasViewPermission();
        this.editor=E('textarea',{class:'jw-css-editor',rows:18,spellcheck:false,readonly:readonly||null,value:css,'aria-label':'自定义 CSS'});
        this.notice=E('p',{class:'jw-subtle','aria-live':'polite'});
        this.saveButton=E('button',{type:'button',class:'cbi-button cbi-button-action',disabled:readonly||null,click:()=>this.save(this.editor.value)},'保存并应用');
        this.resetButton=E('button',{type:'button',class:'cbi-button',disabled:readonly||null,click:()=>{
            if(readonly||this.busy)return;
            ui.showModal('恢复默认样式',[E('p',{},'将清空保存的自定义 CSS。'),E('div',{class:'jw-actions'},[
                E('button',{type:'button',class:'cbi-button',click:()=>ui.hideModal()},'取消'),
                E('button',{type:'button',class:'cbi-button',click:async()=>{ui.hideModal();await this.save('');}},'确认恢复')])]);
        }},'恢复默认');
        return E('div',{class:'jw-page jw-theme-editor'},[
            E('link',{rel:'stylesheet',href:L.resource('johnny/johnny.css')}),E('header',{class:'jw-header'},[E('h2',{},'自定义主题')]),
            E('section',{class:'jw-card'},[E('h3',{},'主题代码（CSS）'),
                E('p',{class:'jw-subtle'},'页脚可选择跟随系统、浅色或深色。这里的样式会覆盖管理页面外观，并随保留配置升级保留。'),
                E('p',{class:'jw-subtle'},'本编辑页不加载自定义样式，方便随时恢复。修改颜色时，请同时检查浅色和深色的文字可读性。'),
                this.editor,E('div',{class:'jw-actions'},[this.saveButton,this.resetButton]),this.notice,
                E('details',{},[E('summary',{},'查看深浅色写法示例'),E('pre',{class:'jw-css-example'},
                    '/* 浅色：首页与向导 */\n:root[data-darkmode="false"] .jw-page {\n  --jw-text: #172334;\n  --jw-surface: #ffffff;\n}\n\n/* 深色：首页与向导 */\n:root[data-darkmode="true"] .jw-page {\n  --jw-text: #edf2fa;\n  --jw-surface: #18212e;\n}')])])]);
    },handleSaveApply:null,handleSave:null,handleReset:null
});
