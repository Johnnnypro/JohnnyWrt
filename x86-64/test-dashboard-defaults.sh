#!/bin/sh
# Disposable guest only. Test the actual patcher on a copy of bundled assets.
set -eu
root=$(mktemp -d /tmp/johnny-dashboard-test.XXXXXX)
trap 'rm -rf "$root"' EXIT
cp -a /rom/etc/meowx/run/ui "$root/ui"
helper=/usr/libexec/johnny-dashboard-defaults.uc
defaults=/usr/libexec/johnny-dashboard-defaults.js
ucode "$helper" "$root/ui" "$defaults"
ucode -e '
import {readfile} from "fs";
let html=readfile(ARGV[0]+"/index.html");
assert(index(html,"johnny-dashboard-defaults")>=0);
assert(index(html,"johnny-dashboard-defaults")<index(html,"<script type=\"module\""));
assert(index(readfile(ARGV[0]+"/sw.js"),"-johnny-apple-v1")>=0);
assert(index(readfile(ARGV[0]+"/sw.js"),"johnny-dashboard-worker-v1")>=0);
' "$root/ui"
sha256sum "$root/ui/index.html" "$root/ui/sw.js" > "$root/before"
ucode "$helper" "$root/ui" "$defaults"
sha256sum -c "$root/before"
# A changed vendor layout must fail without corrupting the working index.
printf '<html><head><title>other dashboard</title></head></html>\n' > "$root/ui/index.html"
sha256sum "$root/ui/index.html" "$root/ui/sw.js" > "$root/unsupported"
if ucode "$helper" "$root/ui" "$defaults"; then echo 'FAIL: unknown dashboard accepted'; exit 1; fi
sha256sum -c "$root/unsupported"
echo 'PASS: real zashboard default insertion, PWA cache revision, idempotence and unsupported-layout preservation'
