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
    for(const switcher of document.querySelectorAll('.theme-switcher')){
        const group=document.createElement('div');
        group.className='johnny-theme-controls';
        group.style.cssText='display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap;max-width:100%';
        const entry=document.createElement('a');
        entry.href=L.url('admin','system','johnny-theme');entry.textContent='自定义主题';
        entry.style.cssText='padding:5px 10px;font-size:13px;white-space:nowrap;color:var(--text)';
        switcher.before(group);group.appendChild(switcher);group.appendChild(entry);
    }
})();
