// Preserve upstream handlers and package menu metadata; reject unknown markup.
import { readfile, writefile } from 'fs';

let root = ARGV[0] || '';
let menu = root + '/usr/share/luci/menu.d/';
let flash_path = root + '/www/luci-static/resources/view/system/flash.js';
let flash = readfile(flash_path);
let build = trim(readfile(root + '/etc/johnnywrt-release') || 'development');
assert(match(build, /^[A-Za-z0-9._-]+$/), 'Invalid build cache identifier');
let header_path = root + '/usr/share/ucode/luci/template/header.ut';
let header = readfile(header_path);
assert(header != null && length(split(header, '{{ pkgs_update_time }}')) == 2,
    'Unsupported LuCI resource version; adapt before building');
header = replace(header, /\{\{ pkgs_update_time \}\}(-johnny-[A-Za-z0-9._-]+)?/,
    '{{ pkgs_update_time }}-johnny-' + build);
let native_css = '<link rel="stylesheet" data-luci-shell href="{{ resource }}/johnny/johnny-native.css?v=' + build + '">';
if (index(header, '/johnny/johnny-native.css?') >= 0)
    header = replace(header, /<link rel="stylesheet" data-luci-shell href="[^"\n]*\/johnny\/johnny-native\.css\?v=[^"\n]+">/, native_css);
else header += '\n' + native_css + '\n';
let aurora_path = root + '/usr/share/ucode/luci/template/themes/aurora/header.ut';
let aurora = readfile(aurora_path);
assert(aurora != null && index(aurora, 'data-asset-version="1.4.0') >= 0 &&
    index(aurora, ':1.4.0') >= 0, 'Unsupported Aurora navigation cache stamp');
aurora = replace(aurora, /1\.4\.0(-johnny-[A-Za-z0-9._-]+)?"/g, '1.4.0-johnny-' + build + '"');
let argon_path = root + '/usr/share/ucode/luci/template/themes/argon/header.ut';
let argon = readfile(argon_path);
assert(argon != null, 'Cannot read Argon header');
if (index(argon, 'johnny-appearance') < 0) {
    let anchor = '<head>';
    assert(length(split(argon, anchor)) == 2 && index(argon, "let mode = 'normal'") >= 0,
        'Unsupported Argon header; adapt before building');
    let bridge = '<script data-johnny-appearance>\n';
    bridge += '(() => { const mode = "{{ mode }}", query = matchMedia("(prefers-color-scheme: dark)");\n';
    bridge += 'const apply = () => document.documentElement.setAttribute("data-darkmode", mode === "dark" || (mode === "normal" && query.matches));\n';
    bridge += 'apply(); if (mode === "normal") query.addEventListener("change", apply); })();\n</script>';
    argon = replace(argon, anchor, anchor + '\n' + bridge);
}
let argon_source = readfile(root + '/www/luci-static/resources/view/argon-config.js');
assert(argon_source != null && length(split(argon_source, "'require view';")) == 2 &&
    length(split(argon_source, 'return view.extend(')) == 2, 'Unsupported Argon config view');
// Reuse official fields and handlers without its automatic full-page view initializer.
let argon_modal = replace(replace(argon_source, "'require view';", "'require baseclass';"),
    'return view.extend(', 'return baseclass.extend(');
let argon_acl_path = root + '/usr/share/rpcd/acl.d/luci-app-argon-config.json';
let argon_acl = json(readfile(argon_acl_path));
let acl = argon_acl['luci-app-argon-config'];
let mutations = acl.read.ubus['luci.argon'] || acl.write.ubus?.['luci.argon'];
assert(length(mutations) == 2 && index(mutations, 'remove') >= 0 && index(mutations, 'rename') >= 0,
    'Unsupported Argon background RPC permissions');
delete acl.read.ubus['luci.argon'];
if (!acl.write.ubus) acl.write.ubus = {};
acl.write.ubus['luci.argon'] = mutations;
let argon_menu_path = menu + 'luci-app-argon-config.json';
let argon_menu = json(readfile(argon_menu_path));
assert(argon_menu['admin/system/argon-config'], 'Missing Argon settings menu');
delete argon_menu['admin/system/argon-config'].title;
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
    [header_path]: header,
    [aurora_path]: aurora,
    [argon_path]: argon,
    [root + '/www/luci-static/resources/johnny/argon-config.js']: argon_modal,
    [argon_acl_path]: sprintf('%J\n', argon_acl),
    [argon_menu_path]: sprintf('%J\n', argon_menu),
    [flash_path]: flash,
    [zt_path]: sprintf('%J\n', zt)
}) assert(writefile(path, content) == length(content), 'Cannot write ' + path);
