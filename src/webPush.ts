export interface PushSubscriptionPayload {
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string;
  created_at_iso: string;
}

export type WebPushBrowserStatus =
  | "unsupported"
  | "not_configured"
  | "denied"
  | "subscribed"
  | "unsubscribed";

export function getVapidPublicKey(
  override?: string,
): string | null {
  if (typeof override === "string" && override.trim()) {
    return override.trim();
  }
  const envKey =
    typeof import.meta !== "undefined" &&
    (import.meta as { env?: Record<string, unknown> }).env
      ? (import.meta as { env?: Record<string, unknown> }).env!
          .VITE_VAPID_PUBLIC_KEY
      : undefined;
  if (typeof envKey === "string" && envKey.trim()) {
    return envKey.trim();
  }
  return null;
}

export function isWebPushSupported(env?: {
  hasWindow?: boolean;
  hasServiceWorker?: boolean;
  hasPushManager?: boolean;
  hasNotification?: boolean;
}): boolean {
  if (env) {
    return Boolean(
      env.hasWindow &&
        env.hasServiceWorker &&
        env.hasPushManager &&
        env.hasNotification,
    );
  }
  return (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/**
 * Converts a URL-safe Base64 VAPID public key into a Uint8Array suitable for
 * `PushManager.subscribe({ applicationServerKey })`.
 */
export function urlBase64ToUint8Array(
  base64String: string,
): Uint8Array<ArrayBuffer> {
  const trimmed = base64String.trim();
  if (!trimmed) {
    throw new Error("VAPID public key is empty.");
  }
  const padding = "=".repeat((4 - (trimmed.length % 4)) % 4);
  const base64 = (trimmed + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function arrayBufferToBase64Url(buf: ArrayBuffer | null): string {
  if (!buf) return "";
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export interface PushSubscriptionLike {
  endpoint: string;
  getKey?: (name: "p256dh" | "auth") => ArrayBuffer | null;
  toJSON?: () => {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
}

export function extractPushSubscriptionPayload(
  sub: PushSubscriptionLike,
  userAgent?: string,
  nowIso?: string,
): PushSubscriptionPayload {
  const json = typeof sub.toJSON === "function" ? sub.toJSON() : undefined;
  const endpoint = String(sub.endpoint || json?.endpoint || "").trim();
  const p256dh =
    json?.keys?.p256dh ||
    (typeof sub.getKey === "function"
      ? arrayBufferToBase64Url(sub.getKey("p256dh"))
      : "");
  const auth =
    json?.keys?.auth ||
    (typeof sub.getKey === "function"
      ? arrayBufferToBase64Url(sub.getKey("auth"))
      : "");

  if (!endpoint) {
    throw new Error("Browser push subscription is missing an endpoint.");
  }
  if (!p256dh || !auth) {
    throw new Error("Browser push subscription is missing encryption keys.");
  }

  const ua =
    typeof userAgent === "string"
      ? userAgent
      : typeof navigator !== "undefined"
        ? navigator.userAgent
        : "";

  return {
    endpoint,
    p256dh,
    auth,
    user_agent: ua.slice(0, 300),
    created_at_iso: nowIso || new Date().toISOString(),
  };
}

export function getNotificationPermission():
  | NotificationPermission
  | "unsupported" {
  if (!isWebPushSupported()) return "unsupported";
  return Notification.permission;
}

export async function getExistingPushSubscription(): Promise<PushSubscription | null> {
  if (!isWebPushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    if (!reg) return null;
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

export async function subscribeToWebPush(
  vapidPublicKey?: string,
): Promise<PushSubscriptionPayload> {
  if (!isWebPushSupported()) {
    throw new Error("Web Push notifications are not supported in this browser.");
  }
  const key = getVapidPublicKey(vapidPublicKey);
  if (!key) {
    throw new Error(
      "Web Push is not configured in this build (VITE_VAPID_PUBLIC_KEY is missing).",
    );
  }

  let permission = Notification.permission;
  if (permission === "default") {
    permission = await Notification.requestPermission();
  }
  if (permission !== "granted") {
    throw new Error(
      "Notification permission was denied. Allow notifications in your browser settings and try again.",
    );
  }

  const existingReg = await navigator.serviceWorker.getRegistration("/");
  const registration =
    existingReg ??
    (await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                "No active service worker is registered (Web Push requires a production build or HTTPS).",
              ),
            ),
          3000,
        ),
      ),
    ]));

  const current = await registration.pushManager.getSubscription();
  const subscription =
    current ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    }));

  return extractPushSubscriptionPayload(subscription);
}

export async function unsubscribeFromWebPush(): Promise<string | null> {
  const existing = await getExistingPushSubscription();
  if (!existing) return null;
  const endpoint = existing.endpoint;
  await existing.unsubscribe();
  return endpoint;
}

export function deriveWebPushStatus(opts: {
  supported: boolean;
  vapidConfigured: boolean;
  permission: NotificationPermission | "unsupported";
  subscribed: boolean;
}): WebPushBrowserStatus {
  if (!opts.supported || !opts.vapidConfigured) return "not_configured";
  if (opts.permission === "denied") return "denied";
  if (opts.subscribed) return "subscribed";
  return "unsubscribed";
}
