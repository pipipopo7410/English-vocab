const CACHE = 'vocab-daily-v3.2';
const ASSETS = ['./','./index.html','./styles.css','./app.js','./word-data-full.json','./config.js','./manifest.webmanifest'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('vocab-daily-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if(e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(resp => {if(resp.ok){const copy=resp.clone();caches.open(CACHE).then(c => c.put(e.request,copy));}return resp;}).catch(() => caches.match(e.request)));
});
