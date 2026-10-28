#!/bin/sh
# Disposable guest only: restore its original custom CSS on exit.
set -eu
backup=$(mktemp)
cp /etc/johnny/theme.css "$backup"
trap 'cp "$backup" /etc/johnny/theme.css; rm -f "$backup"' EXIT
test "$(readlink /www/luci-static/resources/johnny/custom.css)" = /etc/johnny/theme.css
ubus call file write '{"path":"/etc/johnny/theme.css","data":"/* retained theme test */"}'
test "$(curl -fsS http://127.0.0.1/luci-static/resources/johnny/custom.css)" = '/* retained theme test */'
sysupgrade -l | grep -qx /etc/johnny/theme.css
ubus call file write '{"path":"/etc/johnny/theme.css","data":""}'
test ! -s /etc/johnny/theme.css
ucode -e '
import {readfile} from "fs";
let acl=json(readfile("/usr/share/rpcd/acl.d/johnny-theme.json"))["luci-app-johnny-theme"];
assert(length(keys(acl.write.file))==1);
assert(acl.write.file["/etc/johnny/theme.css"][0]=="write");
assert(acl.read.file["/etc/johnny/theme.css"][0]=="read");
'
echo 'PASS: custom CSS file RPC, static CSS serving, restore and backup list'
