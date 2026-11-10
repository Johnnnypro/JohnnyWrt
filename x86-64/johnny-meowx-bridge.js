// Loaded by the shared LuCI header before views, independently of MeowX's APK.
// Keep the vendor's downloader, authentication and error handling intact.
(() => {
    if (!L.env.sessionid || /^0+$/.test(L.env.sessionid)) return;
    return L.require('tools.meowx').then(meowx => {
        const mesh = meowx.mesh;
        if (typeof mesh === 'function') meowx.mesh = function(...args) {
            return mesh.apply(this, args).then(result => {
                if (args[0] !== 'status' || !result?.state?.error?.includes('timeout waiting for Tailscale service to enter a Running state')) return result;
                const recovered = result.backend === 'Running' && result.self?.online !== false;
                const message = recovered ? '连接已恢复，但上次设置未完整应用；请点“保存并应用”完成网段和防火墙配置。' :
                    result.daemon && result.settings?.enabled ? '等待主控响应超时，Tailscale 仍在后台重试；恢复连接后请点“保存并应用”完成配置。' :
                    '上次等待主控响应超时；当前服务未连接，请启用喵窝并保存并应用。';
                return {...result, state: {...result.state, error: message}};
            });
        };
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
