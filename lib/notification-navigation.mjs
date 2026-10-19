const destinations = {
  alerts: "#alerts", settings: "#settings", scheduling: "#scheduling",
  creative: "#creative-work", availability: "#availability", payouts: "#payouts", quiz: "#daily-quiz",
};

export function isNotificationHash(hash) {
  return Object.values(destinations).includes(hash);
}

// Receive a tap even when this window already has the same hash but the user
// has since moved to another tab. Keep signed-in sessions in the current page.
// While signed out, unlock clears the destination so sign-in always opens Home.
export function attachNotificationMessages(win) {
  const serviceWorker = win.navigator.serviceWorker;
  if (!serviceWorker) return;
  const receive = event => {
    if (event.data?.type !== "smooth-notification" || !Object.hasOwn(destinations, event.data.target)) return;
    win.history.replaceState(win.history.state, "", win.location.pathname + win.location.search + destinations[event.data.target]);
    win.dispatchEvent(new win.Event("hashchange"));
    event.ports?.[0]?.postMessage({ handled: true });
  };
  serviceWorker.addEventListener("message", receive);
  return () => serviceWorker.removeEventListener("message", receive);
}
