/* No offline cache: private dashboard data and credentials never enter a SW cache. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("push", event => {
  event.waitUntil(self.registration.showNotification("Smooth Studios · Schedule update", {
    body: "Open your team dashboard to review your latest schedule and assignment offers.",
    icon: new URL("smooth-studios-logo.png", self.registration.scope).href,
    tag: "smooth-schedule",
    renotify: true,
    data: { url: new URL("./#scheduling", self.registration.scope).href },
  }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const destination = new URL("./#scheduling", self.registration.scope).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find(client => client.url.startsWith(self.registration.scope));
    if (existing) { await existing.navigate(destination); await existing.focus(); }
    else await self.clients.openWindow(destination);
  })());
});
