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
  const title = clean(payload?.title, 80), body = clean(payload?.body, 360).replace(/(\d{1,2}:\d{2} [AP]M) (?:EDT|EST)\b/g, "$1");
  const id = typeof payload?.id === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(payload.id) ? payload.id : null;
  // Lead with the response; the OS already displays the studio app name/icon.
  event.waitUntil(self.registration.showNotification(title && body ? title : notice.title, {
    body: title && body ? body : notice.body,
    icon: new URL("smooth-studios-logo.png", self.registration.scope).href,
    tag: id ? `smooth-${type}-${id}` : `smooth-${type}`,
    renotify: true,
    data: { type, ...(["alerts", "settings", "scheduling", "creative", "availability", "payouts", "quiz"].includes(payload?.target) ? { target: payload.target } : {}) },
  }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const type = event.notification.data?.type;
  const notice = Object.hasOwn(notices, type) ? notices[type] : notices.schedule;
  // Never navigate to a URL supplied by a payload or notification data.
  const targets = { alerts: "#alerts", settings: "#settings", scheduling: "#scheduling", creative: "#creative-work", availability: "#availability", payouts: "#payouts", quiz: "#daily-quiz" };
  const requested = event.notification.data?.target;
  const target = Object.hasOwn(targets, requested) ? requested : Object.keys(targets).find(key => targets[key] === notice.hash);
  const destination = new URL(`./${targets[target]}`, self.registration.scope).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find(client => client.url.startsWith(self.registration.scope));
    if (existing) {
      // A warm app may be on a different React tab with an unchanged URL.
      // Ask it to route explicitly, avoiding a reload that would lose sign-in.
      const handled = new Promise(resolve => {
        const channel = new MessageChannel();
        const finish = value => { clearTimeout(timer); channel.port1.close(); resolve(value); };
        const timer = setTimeout(() => finish(false), 800);
        channel.port1.onmessage = event => finish(event.data?.handled === true);
        try { existing.postMessage({ type: "smooth-notification", target }, [channel.port2]); }
        catch { finish(false); }
      });
      await existing.focus();
      // Older/unready pages still receive the destination through a normal URL.
      if (!await handled) await existing.navigate(destination);
    }
    else await self.clients.openWindow(destination);
  })());
});
