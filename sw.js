/* 追劇本本 – offline-first Service Worker
   策略：同源 GET 一律 cache-first；離線時導航回退到 index.html；不碰外部資源 */
const CACHE = 'dramalist-pwa-v2';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './dramalist.csv',
  './sw.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) =>
        // 逐一加入，避免單一檔案失敗導致整批失敗
        Promise.all(
          ASSETS.map((url) =>
            cache.add(url).catch((err) => {
              console.warn('[SW] precache skip:', url, err);
            })
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // 只處理同源；外部（Google Sheet、Supabase、海報圖）交給瀏覽器，離線自然失敗
  if (url.origin !== self.location.origin) return;

  // 導航請求（開頁、重新整理）：cache-first，失敗再網路，再失敗回 index.html
  const isNavigate =
    event.request.mode === 'navigate' ||
    (event.request.destination === 'document') ||
    (event.request.headers.get('accept') || '').includes('text/html');

  if (isNavigate) {
    event.respondWith(
      caches.match('./index.html')
        .then((cached) => {
          if (cached) return cached;
          return fetch(event.request)
            .then((res) => {
              if (res && res.ok) {
                const copy = res.clone();
                caches.open(CACHE).then((c) => c.put('./index.html', copy));
              }
              return res;
            })
            .catch(() => caches.match('./index.html'));
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // 其他同源資源：嚴格 cache-first
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request)
        .then((response) => {
          // 只快取成功的回應
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((c) => c.put(event.request, copy));
          }
          return response;
        })
        .catch(() => {
          // 離線且無快取：對 HTML 再退回 index，其餘回 503
          if (event.request.destination === 'document' || event.request.url.endsWith('.html')) {
            return caches.match('./index.html');
          }
          return new Response('', {
            status: 503,
            statusText: 'Offline',
            headers: { 'Content-Type': 'text/plain' }
          });
        });
    })
  );
});
