'use strict';
'require view';
'require uci';
'require ui';
'require johnny.appearance as appearance';

return view.extend({
    load:function(){return Promise.all([uci.load('luci'),uci.load('argon')]);},
    refreshOptions:function(){
        const media=this.theme.value;
        this.argonButton.hidden=media!=='/luci-static/argon';
        this.mode.disabled=!L.hasViewPermission()||!['/luci-static/aurora','/luci-static/argon','/luci-static/bootstrap'].includes(media);
        this.mode.value=appearance.current(media,uci.get('argon',this.argonSection,'mode'),this.auroraMode);
        this.hint.textContent=media==='/luci-static/aurora'?'外观模式与当前浏览器的页脚开关同步。':
            media==='/luci-static/argon'?'外观模式随路由器配置保存；详细选项可设置主题颜色和登录背景。':
            media==='/luci-static/bootstrap'?'支持跟随系统、固定浅色和固定深色。':'此主题的外观选项由它自身提供。';
    },
    openArgon:async function(){
        if(this.theme.value!=='/luci-static/argon'||this.busy||!L.hasViewPermission())return;
        this.busy=true;this.argonButton.disabled=true;
        try{
            const config=await L.require('johnny.argon-config');
            const content=await config.render(await config.load());
            ui.showModal('Argon 详细设置',[E('div',{class:'jw-argon-dialog'},content),
                E('div',{class:'right'},E('button',{type:'button',class:'cbi-button',click:()=>{ui.hideModal();this.refreshOptions();}},'关闭'))],'jw-page','jw-argon-modal');
        }catch(e){ui.addNotification(null,E('p',{},'无法打开 Argon 设置：'+e.message));}
        finally{this.busy=false;this.argonButton.disabled=!L.hasViewPermission();}
    },
    save:async function(){
        if(this.busy||!L.hasViewPermission())return;
        const target=appearance.target(this.theme.value,this.mode.value);
        if(!this.choices.some(choice=>choice.value===this.theme.value))return;
        this.busy=true;this.saveButton.disabled=true;
        try{
            // A storage failure must be visible before changing the installed theme.
            if(target.aurora)localStorage.setItem('aurora.theme',target.aurora);
            uci.set('luci','main','mediaurlbase',target.media);
            if(target.argon)uci.set('argon',this.argonSection,'mode',target.argon);
            await uci.save();
            const changes=await uci.changes();
            if(Object.values(changes).some(items=>items.length))ui.changes.apply(true);
            else window.location.reload();
        }catch(e){this.notice.textContent='保存失败：'+(e.message||String(e));}
        finally{this.busy=false;this.saveButton.disabled=false;}
    },
    render:function(){
        const readonly=!L.hasViewPermission(),media=uci.get('luci','main','mediaurlbase');
        this.argonSection=uci.sections('argon','global')[0]?.['.name'];
        this.choices=appearance.choices(uci.get('luci','themes'));
        try{this.auroraMode=localStorage.getItem('aurora.theme');}catch(e){this.auroraMode='device';}
        this.theme=E('select',{'aria-label':'主题',disabled:readonly||null,change:()=>this.refreshOptions()},
            this.choices.map(choice=>E('option',{value:choice.value},choice.label)));
        this.theme.value=(media||'').replace(/\/bootstrap-(dark|light)$/,'/bootstrap');
        this.mode=E('select',{'aria-label':'外观模式'},[
            E('option',{value:'auto'},'跟随系统'),E('option',{value:'light'},'浅色'),E('option',{value:'dark'},'深色')]);
        this.hint=E('p',{class:'jw-subtle'});
        this.notice=E('p',{class:'jw-subtle','aria-live':'polite'});
        this.argonButton=E('button',{type:'button',class:'cbi-button',disabled:readonly||null,click:()=>this.openArgon()},'Argon 详细设置');
        this.saveButton=E('button',{type:'button',class:'cbi-button cbi-button-action',disabled:readonly||null,click:()=>this.save()},'保存并应用');
        this.refreshOptions();
        this.mode.value=appearance.current(media,uci.get('argon',this.argonSection,'mode'),this.auroraMode);
        return E('div',{class:'jw-page jw-theme-settings'},[
            E('link',{rel:'stylesheet',href:L.resource('johnny/johnny.css')+'?v='+encodeURIComponent(L.env?.resource_version||'development')}),
            E('div',{class:'jw-header'},E('h2',{},'主题设置')),
            E('section',{class:'jw-card'},[
                E('label',{class:'jw-field'},[E('span',{},'主题'),this.theme]),
                E('label',{class:'jw-field'},[E('span',{},'外观模式'),this.mode]),
                this.hint,this.argonButton,E('div',{class:'jw-actions'},this.saveButton),this.notice])]);
    },handleSaveApply:null,handleSave:null,handleReset:null
});
