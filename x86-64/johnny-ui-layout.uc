// Preserve upstream handlers and package menu metadata; reject unknown markup.
import { readfile, writefile } from 'fs';

let root = ARGV[0] || '';
let menu = root + '/usr/share/luci/menu.d/';
let flash_path = root + '/www/luci-static/resources/view/system/flash.js';
let flash = readfile(flash_path);
let footer_path = root + '/usr/share/ucode/luci/template/themes/aurora/footer.ut';
let footer = readfile(footer_path);
let loader = '<script src="{{ resource }}/johnny/custom-style.js"></script>';
let footer_anchor = "<script>L.require('menu-aurora')";
assert(footer != null, 'Cannot read the Aurora footer');
if (index(footer, loader) < 0) {
    assert(length(split(footer, footer_anchor)) == 2, 'Unsupported Aurora footer; adapt before building');
    footer = replace(footer, footer_anchor, loader + '\n\t\t' + footer_anchor);
}
let directive = "'require johnny.update as johnnyUpdate';";
let anchor = 'ss=o.subsection;if(has_sysupgrade){';
let option = "o=ss.option(form.DummyValue,'johnny_online_update');o.render=function(){return johnnyUpdate.render();};";
option += "o=ss.option(form.DummyValue,'johnny_manual_upload');o.render=function(){return E('h3',{},'手动上传');};";
assert(flash != null, 'Cannot read the upstream firmware view');
if (index(flash, directive) < 0) {
    assert(length(split(flash, anchor)) == 2, 'Unsupported LuCI firmware view; adapt the integration before building');
    assert(length(split(flash, "'use strict';")) == 2, 'Unsupported LuCI directive header');
    flash = replace(flash, "'use strict';", "'use strict';" + directive);
    flash = replace(flash, anchor, anchor + option);
    flash = replace(flash, "_('Upload a sysupgrade-compatible image here to replace the running firmware.')",
        "'可从仓库检查更新，也可以手动上传固件文件。'");
}
assert(index(flash, "'johnny_online_update'") >= 0, 'Incomplete LuCI firmware integration');

let zt_path = menu + 'luci-app-zerotier.json';
let zt = json(readfile(zt_path));
let meow = json(readfile(menu + 'luci-app-meowx.json'));
for (let key in keys(zt)) {
    if (key == 'admin/vpn/zerotier' || index(key, 'admin/vpn/zerotier/') == 0) {
        zt[replace(key, 'admin/vpn/zerotier', 'admin/services/zerotier')] = zt[key];
        delete zt[key];
    }
}
assert(zt['admin/services/zerotier'], 'Missing ZeroTier menu');
assert(meow['admin/services/meowx'], 'Missing MeowX menu');
zt['admin/services/zerotier'].order = (meow['admin/services/meowx'].order || 10) + 1;

// LuCI scrubMenu() hides empty firstchild categories dynamically. Keep the
// parent definition so installing another VPN app can make it visible again.

// Validate everything before changing files. uci-defaults retries write failures.
for (let path, content in {
    [footer_path]: footer,
    [flash_path]: flash,
    [zt_path]: sprintf('%J\n', zt)
}) assert(writefile(path, content) == length(content), 'Cannot write ' + path);
