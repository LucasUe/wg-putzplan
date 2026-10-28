// Service Worker: App-Shell-Cache (Offline-Start) und Push-Empfang.
const CACHE = 'wg-putzplan-v2';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Netzwerk zuerst, Cache als Fallback. Fremde Origins (Firebase, Fonts) werden nicht angefasst.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html'))),
  );
});

// Push: { title, body, tag, data: { url, periodKey, taskId, taskName, memberId, canComplete, firestore } }
self.addEventListener('push', (event) => {
  let payload = { title: 'WG-Putzplan', body: 'Neue Nachricht', data: {} };
  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() };
    } catch {
      payload.body = event.data.text();
    }
  }
  const data = { url: payload.url || './#/overview', ...(payload.data || {}) };
  const options = {
    body: payload.body,
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: payload.tag,
    data,
  };
  if (data.canComplete) {
    options.actions = [
      { action: 'done', title: '✓ Erledigt' },
      { action: 'later', title: 'Noch nicht' },
    ];
  }
  event.waitUntil(self.registration.showNotification(payload.title, options));
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** App öffnen bzw. fokussieren, optional mit Hash (z. B. #/overview?confirm=...). */
async function openApp(hash) {
  const target = new URL(hash || './#/overview', self.registration.scope).href;
  const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of list) {
    if (!client.url.startsWith(self.registration.scope)) continue;
    try {
      if ('navigate' in client) {
        const navigated = await client.navigate(target);
        return (navigated || client).focus();
      }
    } catch {
      // nicht steuerbarer Client: nur fokussieren
    }
    return client.focus();
  }
  return self.clients.openWindow(target);
}

function confirmHash(data) {
  return data && data.canComplete && data.periodKey && data.taskId
    ? `./#/overview?confirm=${encodeURIComponent(`${data.periodKey}|${data.taskId}`)}`
    : './#/overview';
}

/** Completion per Firestore-REST schreiben, im gleichen Format wie die App (id = periodKey_taskId). */
async function completeViaRest(data) {
  const { projectId, apiKey } = data.firestore || {};
  if (!projectId || !apiKey) throw new Error('Firestore-Config fehlt');
  const id = `${data.periodKey}_${data.taskId}`;
  const url =
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}` +
    `/databases/(default)/documents/completions/${encodeURIComponent(id)}?key=${encodeURIComponent(apiKey)}`;
  const fields = {
    id: { stringValue: id },
    periodKey: { stringValue: data.periodKey },
    taskId: { stringValue: data.taskId },
    doneBy: { stringValue: data.memberId },
    doneAt: { stringValue: new Date().toISOString() },
  };
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`Firestore ${res.status}`);
}

self.addEventListener('notificationclick', (event) => {
  const data = event.notification.data || {};
  event.notification.close();

  if (event.action === 'later') return;

  if (event.action === 'done') {
    event.waitUntil(
      (async () => {
        try {
          await completeViaRest(data);
          const tag = `done-${data.periodKey}-${data.taskId}`;
          await self.registration.showNotification(`✓ ${data.taskName || 'Aufgabe'} abgehakt`, {
            tag,
            icon: './icon-192.png',
            badge: './icon-192.png',
            silent: true,
          });
          await sleep(4000);
          const shown = await self.registration.getNotifications({ tag });
          shown.forEach((n) => n.close());
        } catch {
          await openApp(confirmHash(data));
        }
      })(),
    );
    return;
  }

  // Klick ohne Button (z. B. iPhone): App öffnen, bei abhakbaren Aufgaben mit Rückfrage-Dialog
  event.waitUntil(openApp(confirmHash(data)));
});
