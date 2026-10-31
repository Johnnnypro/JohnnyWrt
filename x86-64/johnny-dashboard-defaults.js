// Runs before zashboard reads its persistent settings. Migrate the vendor
// default once, then respect all later explicit choices, including Google.
(() => {
    try {
        const key = 'config/speedtest-url', marker = 'johnny/apple-latency-v1';
        const current = localStorage.getItem(key);
        if (!current || (!localStorage.getItem(marker) && current === 'https://www.gstatic.com/generate_204'))
            localStorage.setItem(key, 'https://captive.apple.com/hotspot-detect.html');
        localStorage.setItem(marker, '1');
    } catch (e) { /* Storage may be disabled; leave the dashboard usable. */ }
})();
