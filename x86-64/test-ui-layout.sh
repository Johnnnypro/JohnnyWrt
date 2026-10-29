#!/bin/sh
# Run in the disposable firmware guest, never against live configuration.
set -eu
helper=${1:-/usr/libexec/johnny-ui-layout.uc}
source_root=${2:-/rom}
root=$(mktemp -d /tmp/johnny-ui-test.XXXXXX)
trap 'rm -rf "$root"; rm -f "$root.before" "$root.after"' EXIT
menu=/usr/share/luci/menu.d
flash=/www/luci-static/resources/view/system/flash.js
footer=/usr/share/ucode/luci/template/themes/aurora/footer.ut
argon=/usr/share/ucode/luci/template/themes/argon/header.ut
argon_view=/www/luci-static/resources/view/argon-config.js
argon_acl=/usr/share/rpcd/acl.d/luci-app-argon-config.json
header=/usr/share/ucode/luci/template/header.ut
aurora=/usr/share/ucode/luci/template/themes/aurora/header.ut
mkdir -p "$root$menu" "$(dirname "$root$flash")"
mkdir -p "$(dirname "$root$footer")"
cp "$source_root$flash" "$root$flash"
cp "$source_root$footer" "$root$footer"
mkdir -p "$(dirname "$root$argon")" "$root/www/luci-static/resources/johnny"
cp "$source_root$argon" "$root$argon"
cp "$source_root$argon_view" "$root$argon_view"
mkdir -p "$(dirname "$root$argon_acl")"
cp "$source_root$argon_acl" "$root$argon_acl"
cp "$source_root$header" "$root$header"
cp "$source_root$aurora" "$root$aurora"
mkdir -p "$root/etc"
printf 'same-source\n' > "$root/etc/johnnywrt-build"
printf 'test-build-2\n' > "$root/etc/johnnywrt-release"
for name in luci-base luci-app-zerotier luci-app-meowx luci-app-argon-config; do
    cp "$source_root$menu/$name.json" "$root$menu/"
done
ucode "$helper" "$root"
ucode -e '
    import { readfile } from "fs";
    let root = ARGV[0], menu = root + "/usr/share/luci/menu.d/";
    let zt = json(readfile(menu + "luci-app-zerotier.json"));
    let meow = json(readfile(menu + "luci-app-meowx.json"));
    assert(zt["admin/services/zerotier"].order > meow["admin/services/meowx"].order);
    assert(zt["admin/services/zerotier/config"].action.path == "zerotier/config");
    assert(zt["admin/services/zerotier/interface"].action.path == "zerotier/interface");
    assert(zt["admin/services/zerotier"].depends.acl[0] == "luci-app-zerotier");
    assert(!zt["admin/vpn/zerotier"]);
    assert(json(readfile(menu + "luci-base.json"))["admin/vpn"].title == "VPN");
    let acl = json(readfile(root + "/usr/share/rpcd/acl.d/luci-app-argon-config.json"))["luci-app-argon-config"];
    assert(!acl.read.ubus["luci.argon"], "background mutations must not be readable RPCs");
    assert(index(acl.write.ubus["luci.argon"], "remove") >= 0);
    assert(index(acl.write.ubus["luci.argon"], "rename") >= 0);
' "$root"
grep -qF "'require johnny.update as johnnyUpdate';" "$root$flash"
grep -qF "'johnny_online_update'" "$root$flash"
# Native appearance controls remain untouched; no custom CSS loader is added.
cmp "$source_root$footer" "$root$footer"
! grep -q 'johnny/custom-style.js' "$root$footer"
# Argon manual modes and OS-following mode must expose the same resolved signal.
grep -q 'johnny-appearance' "$root$argon"
grep -q 'data-darkmode' "$root$argon"
grep -q 'baseclass.extend' "$root/www/luci-static/resources/johnny/argon-config.js"
! grep -q 'return view.extend' "$root/www/luci-static/resources/johnny/argon-config.js"
test -z "$(jsonfilter -i "$root$menu/luci-app-argon-config.json" -e '@["admin/system/argon-config"].title')"
grep -q 'pkgs_update_time }}-johnny-test-build-2' "$root$header"
grep -q ':1.4.0-johnny-test-build-2' "$root$aurora"
grep -q 'data-luci-shell.*johnny-native.css?v=test-build-2' "$root$header"
# Integration must keep all three native actions.
for handler in handleBackup handleRestore handleSysupgrade; do
    grep -q "$handler" "$root$flash"
done
find "$root" -type f -exec sha256sum {} \; | sort > "$root.before"
ucode "$helper" "$root"
find "$root" -type f -exec sha256sum {} \; | sort > "$root.after"
cmp "$root.before" "$root.after"
rm "$root.before" "$root.after"
# A rebuild of unchanged source still receives a new release cache key.
printf 'test-build-3\n' > "$root/etc/johnnywrt-release"
ucode "$helper" "$root"
grep -q 'pkgs_update_time }}-johnny-test-build-3' "$root$header"
grep -q ':1.4.0-johnny-test-build-3' "$root$aurora"
! grep -q 'johnny-test-build-2' "$root$header"
# An additional VPN application must retain its category.
printf '%s\n' '{"admin/vpn/other":{"title":"Other VPN"}}' > "$root$menu/other.json"
ucode "$helper" "$root"
test "$(jsonfilter -i "$root$menu/luci-base.json" -e '@["admin/vpn"].title')" = VPN
# Reject changed upstream markup before writing any files.
printf '%s\n' 'unsupported upstream page' > "$root$flash"
find "$root" -type f -exec sha256sum {} \; | sort > "$root.before"
if ucode "$helper" "$root"; then
    echo 'FAIL: unsupported page accepted' >&2
    exit 1
fi
find "$root" -type f -exec sha256sum {} \; | sort > "$root.after"
cmp "$root.before" "$root.after"
rm "$root.before" "$root.after"
echo 'PASS: UI relocation, native actions, idempotence and upstream layout guard'
