// 單字日課 v3.6 PWA 離線快取：僅快取公開網站檔案，不包含帳號資料與雲端 API。
const CACHE='vocab-daily-v3.8';
const CORE=['./','./index.html','./styles.css','./app.js','./word-data-full.json','./word-data-full.js','./config.js','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png','./icons/icon-512-maskable.png','./icons/apple-touch-icon.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('vocab-daily-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET')return;
 const url=new URL(event.request.url);
 if(url.origin!==self.location.origin)return;  // 不攔截 Supabase、CDN 或其他來源
 const isPage=event.request.mode==='navigate'||url.pathname.endsWith('/config.js');
 if(isPage){event.respondWith(fetch(event.request).then(res=>{if(res.ok){let clone=res.clone();caches.open(CACHE).then(c=>c.put(event.request,clone));}return res;}).catch(async()=>await caches.match(event.request)||await caches.match('./index.html')));return;}
 event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request).then(res=>{if(res.ok){let clone=res.clone();caches.open(CACHE).then(c=>c.put(event.request,clone));}return res;})));
});
