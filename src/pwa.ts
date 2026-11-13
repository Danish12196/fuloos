import { useEffect, useState, useSyncExternalStore } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * Registers `/sw.js` in production builds only (never in `vite dev`),
 * and invokes `onUpdateAvailable` when a new service worker is waiting
 * to activate.
 */
export function registerServiceWorker(
  onUpdateAvailable: (applyUpdate: () => void) => void,
): () => void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) {
    return () => {};
  }

  let cancelled = false;
  let reloading = false;
  let registrationRef: ServiceWorkerRegistration | null = null;

  const applyUpdate = () => {
    const waiting = registrationRef?.waiting;
    if (waiting) {
      waiting.postMessage({ type: "SKIP_WAITING" });
    }
  };

  const onControllerChange = () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  };

  navigator.serviceWorker.addEventListener(
    "controllerchange",
    onControllerChange,
  );

  navigator.serviceWorker
    .register("/sw.js", { scope: "/" })
    .then((registration) => {
      if (cancelled) return;
      registrationRef = registration;

      if (registration.waiting && navigator.serviceWorker.controller) {
        onUpdateAvailable(applyUpdate);
      }

      registration.addEventListener("updatefound", () => {
        const next = registration.installing;
        if (!next) return;
        next.addEventListener("statechange", () => {
          if (
            next.state === "installed" &&
            navigator.serviceWorker.controller &&
            !cancelled
          ) {
            onUpdateAvailable(applyUpdate);
          }
        });
      });
    })
    .catch(() => {
      // Service worker registration failure should never break the app.
    });

  return () => {
    cancelled = true;
    navigator.serviceWorker.removeEventListener(
      "controllerchange",
      onControllerChange,
    );
  };
}

function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function getOnlineSnapshot() {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    getOnlineSnapshot,
    () => true,
  );
}

export function useInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null,
  );

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setDeferred(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function promptInstall() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice.catch(() => undefined);
    setDeferred(null);
  }

  return {
    canInstall: deferred !== null,
    promptInstall,
  };
}
