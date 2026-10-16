/* No offline cache: private dashboard data and credentials never enter a SW cache. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
const notices = {
  assignment: { title: "New assignment", body: "You have a new rental or task offer. Open your dashboard to review and respond.", hash: "#scheduling" },
  schedule: { title: "Schedule update", body: "Open your dashboard to review your latest schedule and assignment responses.", hash: "#scheduling" },
  quiz: { title: "Daily Quiz is ready", body: "Your next creative question is ready. Answer it to earn points toward a SmoothStar.", hash: "#daily-quiz" },
  test: { title: "Notifications are connected", body: "This device can receive Smooth Studios alerts.", hash: "#scheduling" },
};
self.addEventListener("push", event => {
  let type = "schedule";
  try {
    const requested = event.data?.json()?.type;
    if (Object.hasOwn(notices, requested)) type = requested;
  } catch { /* Old subscriptions receive a generic schedule alert. */ }
  const notice = notices[type];
  event.waitUntil(self.registration.showNotification(`Smooth Studios · ${notice.title}`, {
    body: notice.body,
    icon: new URL("smooth-studios-logo.png", self.registration.scope).href,
    tag: `smooth-${type}`,
    renotify: true,
    data: { type },
  }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const type = event.notification.data?.type;
  const notice = Object.hasOwn(notices, type) ? notices[type] : notices.schedule;
  // Never navigate to a URL supplied by a payload or notification data.
  const destination = new URL(`./${notice.hash}`, self.registration.scope).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find(client => client.url.startsWith(self.registration.scope));
    if (existing) { await existing.navigate(destination); await existing.focus(); }
    else await self.clients.openWindow(destination);
  })());
});
