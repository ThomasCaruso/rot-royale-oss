// Web Push handlers (M9). Imported into the generated workbox service worker via
// `workbox.importScripts` (vite.config.ts). Kept as plain JS so it needs no build step.

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_e) {
    data = {};
  }
  const title = data.title || "Rot Royale";
  const options = {
    body: data.body || "A game window is open — play now!",
    icon: "/icons/pwa-192.png",
    badge: "/icons/pwa-192.png",
    tag: "rr-window-open", // collapse repeats into one notification
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of all) {
        if ("focus" in client) {
          try {
            await client.navigate(url);
          } catch (_e) {
            /* navigation may be disallowed cross-origin; focus anyway */
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
      return undefined;
    })(),
  );
});
