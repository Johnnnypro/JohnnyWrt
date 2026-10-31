// Apply only to the known zashboard layout. Validate both files before writes.
import { readfile, writefile, glob, rename } from 'fs';
let root = ARGV[0] || '/etc/meowx/run/ui';
let defaults = readfile(ARGV[1] || '/usr/libexec/johnny-dashboard-defaults.js');
let worker = readfile(ARGV[2] || '/usr/libexec/johnny-dashboard-worker.js');
let html = readfile(root + '/index.html'), sw = readfile(root + '/sw.js');
let marker = 'johnny-dashboard-defaults';
assert(defaults != null && index(defaults, '</script>') < 0, 'Missing dashboard defaults');
assert(worker != null, 'Missing dashboard cache migration');
assert(html != null && index(html, '<title>zashboard</title>') >= 0 &&
    length(split(html, '<head>')) == 2 && index(html, '<script type="module"') >= 0,
    'Unsupported dashboard HTML; Apple defaults were not applied');
let revision = match(sw || '', /url:"index\.html",revision:"([a-zA-Z0-9-]+)"/);
assert(revision != null, 'Unsupported dashboard offline cache');
if (index(html, marker) < 0) {
    let supported = false;
    for (let file in glob(root + '/assets/*.js'))
        if (index(readfile(file) || '', 'config/speedtest-url') >= 0) { supported = true; break; }
    assert(supported, 'Unsupported dashboard settings storage');
    html = replace(html, '<head>', '<head>\n<script id="' + marker + '">\n' + defaults + '</script>');
}
if (index(revision[1], '-johnny-apple-v1') < 0)
    sw = replace(sw, revision[0], 'url:"index.html",revision:"' + revision[1] + '-johnny-apple-v1"');
if (index(sw, 'johnny-dashboard-worker-v1') < 0) sw += '\n' + worker;
for (let name, content in { 'index.html': html, 'sw.js': sw }) {
    let path = root + '/' + name;
    if (readfile(path) == content) continue;
    assert(writefile(path + '.johnny-tmp', content) == length(content), 'Cannot stage dashboard defaults');
    assert(rename(path + '.johnny-tmp', path), 'Cannot install dashboard defaults');
}
