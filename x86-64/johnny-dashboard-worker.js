// johnny-dashboard-worker-v1: existing PWA tabs may have loaded an old cached
// index. Once the new cache is active, reload them so the defaults actually run.
self.addEventListener('activate', event => {
    event.waitUntil(self.clients.claim()
        .then(() => self.clients.matchAll({type: 'window'}))
        .then(clients => Promise.allSettled(clients.map(client => client.navigate(client.url)))));
});
