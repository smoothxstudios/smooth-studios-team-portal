// Optional enhancement: unsupported browsers still receive normal UI feedback.
const patterns = { light: 10, success: [12, 45, 18], warning: [20, 35, 20] };
export function hapticFeedback(kind = "light", environment = globalThis) {
  try {
    if (environment.document?.visibilityState === "hidden" ||
        environment.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
        typeof environment.navigator?.vibrate !== "function") return false;
    return environment.navigator.vibrate(patterns[kind] ?? patterns.light);
  } catch { return false; }
}
