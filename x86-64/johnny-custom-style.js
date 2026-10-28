/* Loaded after the page container so user CSS has the final cascade position. */
(() => {
    const link=document.createElement('link');
    link.id='johnny-custom-style';link.rel='stylesheet';
    link.setAttribute('data-luci-shell','');
    link.href=L.resource('johnny/custom.css')+'?v='+Date.now();
    document.body.appendChild(link);
    const sync=()=>{link.disabled=document.body.dataset.page==='admin-system-johnny-theme';};
    sync();
    new MutationObserver(sync).observe(document.body,{attributes:true,attributeFilter:['data-page']});
    const switcher=document.querySelector('.theme-switcher');
    if(switcher){
        const entry=document.createElement('a');
        entry.href=L.url('admin','system','johnny-theme');entry.textContent='自定义主题';
        entry.style.cssText='margin-left:8px;padding:5px 10px;font-size:13px;white-space:nowrap;color:var(--text)';
        switcher.appendChild(entry);
    }
})();
