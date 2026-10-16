/* No offline cache: private dashboard data and credentials never enter a SW cache. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
const notices = {
  creative: { title: "Creative work update", body: "Open Creative Work to review your assignment, submission, or payment.", hash: "#creative-work" },
  assignment: { title: "New assignment", body: "You have a new rental or task offer. Open your dashboard to review and respond.", hash: "#scheduling" },
  schedule: { title: "Schedule update", body: "Open your dashboard to review your latest schedule and assignment responses.", hash: "#scheduling" },
  quiz: { title: "Quiz Time", body: "Your next creative question is ready. Answer it to earn points toward a SmoothStar.", hash: "#daily-quiz" },
  test: { title: "Notifications are connected", body: "This device can receive Smooth Studios alerts.", hash: "#scheduling" },
};
self.addEventListener("push", event => {
  let type = "schedule", payload;
  try {
    const requested = event.data?.json();
    if (Object.hasOwn(notices, requested?.type)) { type = requested.type; payload = requested; }
  } catch { /* Old subscriptions receive a generic schedule alert. */ }
  const notice = notices[type];
  const clean = (value, max) => typeof value === "string" ? Array.from(value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim()).slice(0, max).join("") : "";
  const title = clean(payload?.title, 80), body = clean(payload?.body, 360);
  const id = typeof payload?.id === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(payload.id) ? payload.id : null;
  // Lead with the response; the OS already displays the studio app name/icon.
  event.waitUntil(self.registration.showNotification(title && body ? title : notice.title, {
    body: title && body ? body : notice.body,
    icon: new URL("smooth-studios-logo.png", self.registration.scope).href,
    tag: id ? `smooth-${type}-${id}` : `smooth-${type}`,
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
