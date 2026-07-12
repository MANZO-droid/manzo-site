// 홈 화면 설치와 최소한의 오프라인 대비를 위한 서비스 워커.
// 뉴스/마켓 데이터(JSON, api/*)는 매번 최신 값을 받아야 하므로 여기서 캐시하지 않는다.
// 페이지(HTML)는 "네트워크 우선, 실패 시에만 캐시"로 동작해야 새로 배포한 내용이
// 바로 반영된다. (예전에는 캐시를 먼저 보여주는 방식이라 새 배포가 반영 안 되는 문제가 있었음)
const CACHE_NAME = 'manzo-shell-v5';
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
    fetch(event.request)
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});

// 회원가입/구독 알림을 실제 화면에 띄우는 부분
// 알림 자체는 기기별 글자 수 제한으로 길게 못 보여주므로 짧게만 띄우고,
// 전체 내용은 data.url이 가리키는 페이지를 열어서 보여준다.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}
  const title = data.title || '만조';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url || '/index.html' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/index.html';
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((list) => {
      for (const client of list) {
        if ('navigate' in client) {
          return client.navigate(targetUrl).then((c) => c && c.focus());
        }
      }
      return clients.openWindow(targetUrl);
    })
  );
});
