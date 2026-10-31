// Loaded by the shared LuCI header before views, independently of MeowX's APK.
// Keep the vendor's downloader, authentication and error handling intact.
(() => {
    if (!L.env.sessionid || /^0+$/.test(L.env.sessionid)) return;
    return L.require('tools.meowx').then(meowx => {
        const repair = () => L.require('rpc').then(rpc =>
            rpc.declare({object: 'luci.johnny', method: 'dashboard_defaults'})()
        ).then(result => {
            if (result.error) throw new Error(result.error);
        });
        for (const name of ['updateDashboard', 'dashboardURL']) {
            const original = meowx[name];
            if (typeof original !== 'function') throw new Error('Unsupported MeowX dashboard API');
            meowx[name] = function(...args) {
                if (name === 'dashboardURL' && !L.hasViewPermission()) return original.apply(this, args);
                return original.apply(this, args).then(result => {
                    if (name === 'updateDashboard' && (!result || result.message)) return result;
                    return repair().then(() => result);
                });
            };
        }
    });
})();
