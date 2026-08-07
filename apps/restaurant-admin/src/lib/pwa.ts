/**
 * PWA install plumbing: service-worker registration + the "Install app" hook.
 *
 * Install is only ever offered by the browser in a **secure context** (https,
 * or localhost). Over a plain `http://<lan-ip>:5174` dev origin neither the
 * service worker nor `beforeinstallprompt` exists, so `useInstallApp` reports
 * `unavailable` and the UI simply hides the button — see docs/pwa.md.
 */

/** Chromium's install prompt event — not in lib.dom yet. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * The event fires once, early — usually before React has mounted the login
 * page. We stash it at module scope so the button can still find it whenever
 * it renders, and re-broadcast so a late-mounting component wakes up.
 */
let deferredPrompt: BeforeInstallPromptEvent | null = null;

export const INSTALL_AVAILABILITY_EVENT = "tableflow:install-availability";

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    // Keep the browser's own mini-infobar from appearing so the prompt happens
    // on our terms (the login page button).
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    window.dispatchEvent(new Event(INSTALL_AVAILABILITY_EVENT));
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    window.dispatchEvent(new Event(INSTALL_AVAILABILITY_EVENT));
  });
}

export function getDeferredPrompt() {
  return deferredPrompt;
}

export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const evt = deferredPrompt;
  if (!evt) return "unavailable";
  await evt.prompt();
  const { outcome } = await evt.userChoice;
  // A prompt can only be shown once; the browser re-fires the event if the
  // user dismissed it and remains eligible.
  deferredPrompt = null;
  window.dispatchEvent(new Event(INSTALL_AVAILABILITY_EVENT));
  return outcome;
}

/** True once the app is running from the home screen rather than a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari's non-standard flag.
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

/** iOS/iPadOS Safari never fires `beforeinstallprompt` — it needs Share → Add to Home Screen. */
export function isIos(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ reports as a Mac; the touch points give it away.
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  );
}

/**
 * Registers the service worker. Production only: in dev, a worker caching
 * Vite's module graph fights HMR and serves confusing stale modules.
 */
export function registerServiceWorker() {
  if (!import.meta.env.PROD) return;
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* offline shell is a nice-to-have; never block the app on it */
    });
  });
}
