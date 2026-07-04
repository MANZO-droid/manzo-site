// 홈 화면 설치와 최소한의 오프라인 대비를 위한 서비스 워커.
// 뉴스/마켓 데이터(JSON, api/*)는 매번 최신 값을 받아야 하므로 여기서 캐시하지 않는다.
const CACHE_NAME = 'manzo-shell-v3';
const SHELL_ASSETS = ['/', '/index.html', '/archive.html', '/article.html', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isShellPage = event.request.method === 'GET' && SHELL_ASSETS.includes(url.pathname);
  if (!isShellPage) return;

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

// 회원가입/구독 알림을 실제 화면에 띄우는 부분
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}
  const title = data.title || '만조';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((list) => {
      if (list.length > 0) return list[0].focus();
      return clients.openWindow('/index.html');
    })
  );
});
