import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import {
  INSTALL_AVAILABILITY_EVENT,
  getDeferredPrompt,
  isIos,
  isStandalone,
  promptInstall,
} from "../lib/pwa";

/**
 * "Install app" affordance for the login screen.
 *
 * Three outcomes, in order:
 *  - already running from the home screen → renders nothing;
 *  - Chromium (Android/desktop) with a captured install event → a real button
 *    that opens the browser's install dialog;
 *  - iOS Safari, which has no install API at all → a button that reveals the
 *    manual Share → "Add to Home Screen" steps.
 *
 * Anywhere else (e.g. a plain-http LAN origin, where the browser never offers
 * install) it stays hidden rather than showing a button that can't work.
 */
export function InstallAppButton() {
  const [canPrompt, setCanPrompt] = useState(() => !!getDeferredPrompt());
  const [standalone, setStandalone] = useState(() => isStandalone());
  const [showIosHelp, setShowIosHelp] = useState(false);
  const ios = isIos();

  useEffect(() => {
    const sync = () => {
      setCanPrompt(!!getDeferredPrompt());
      setStandalone(isStandalone());
    };
    window.addEventListener(INSTALL_AVAILABILITY_EVENT, sync);
    const mq = window.matchMedia("(display-mode: standalone)");
    mq.addEventListener("change", sync);
    return () => {
      window.removeEventListener(INSTALL_AVAILABILITY_EVENT, sync);
      mq.removeEventListener("change", sync);
    };
  }, []);

  // Already installed and launched from the home screen — nothing to offer.
  if (standalone) return null;
  if (!canPrompt && !ios) return null;

  async function handleInstall() {
    if (ios && !canPrompt) {
      setShowIosHelp((v) => !v);
      return;
    }
    await promptInstall();
  }

  return (
    <div className="mt-lg border-t border-surface-variant pt-lg">
      <button
        type="button"
        onClick={() => void handleInstall()}
        className="flex w-full items-center justify-center gap-xs rounded-full border border-outline-variant px-lg py-sm font-label-md text-label-md text-on-surface transition-colors hover:border-primary hover:bg-surface-container-low hover:text-primary"
      >
        <Icon name={ios && !canPrompt ? "ios_share" : "install_mobile"} size={18} />
        Install app
      </button>
      <p className="mt-xs text-center font-body-md text-[11px] text-on-surface-variant">
        Add TableFlow to your home screen for full-screen, one-tap access.
      </p>

      {showIosHelp && (
        <ol className="mt-sm space-y-xs rounded-lg bg-surface-container-low px-md py-sm font-body-md text-[12px] text-on-surface-variant">
          <li className="flex gap-xs">
            <span className="font-bold text-primary">1.</span>
            <span>
              Tap the <strong>Share</strong> icon in Safari&apos;s toolbar.
            </span>
          </li>
          <li className="flex gap-xs">
            <span className="font-bold text-primary">2.</span>
            <span>
              Choose <strong>Add to Home Screen</strong>.
            </span>
          </li>
          <li className="flex gap-xs">
            <span className="font-bold text-primary">3.</span>
            <span>
              Tap <strong>Add</strong> — TableFlow appears with your other apps.
            </span>
          </li>
        </ol>
      )}
    </div>
  );
}
