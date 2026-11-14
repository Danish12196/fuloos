// Self-contained Web Push dispatch helpers for PocketBase Goja runtime and Node.js tests.
// Note: PocketBase's Goja JS runtime does not expose WebCrypto ECDH (P-256) or ES256 signing
// primitives required for direct RFC 8291 / VAPID encryption, so server-side push delivery
// delegates encrypted Web Push delivery to an optional PUSH_RELAY_URL webhook.
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.FuloosWebPush = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function readEnv(env, key) {
    if (typeof env === "function") return String(env(key) || "").trim();
    if (env && typeof env === "object") return String(env[key] || "").trim();
    return "";
  }

  function isValidRelayUrl(url) {
    if (!url || typeof url !== "string") return false;
    var trimmed = url.trim();
    return (
      trimmed.indexOf("https://") === 0 ||
      trimmed.indexOf("http://localhost") === 0 ||
      trimmed.indexOf("http://127.0.0.1") === 0
    );
  }

  function isPushRelayConfigured(env) {
    return isValidRelayUrl(readEnv(env, "PUSH_RELAY_URL"));
  }

  function isVapidConfigured(env) {
    return Boolean(
      readEnv(env, "VAPID_PUBLIC_KEY") &&
        readEnv(env, "VAPID_PRIVATE_KEY") &&
        readEnv(env, "VAPID_SUBJECT")
    );
  }

  function normalizeSubscription(sub) {
    if (!sub || typeof sub !== "object") {
      throw new Error("Push subscription is required.");
    }
    var endpoint = String(sub.endpoint || "").trim();
    var p256dh = String(sub.p256dh || (sub.keys && sub.keys.p256dh) || "").trim();
    var auth = String(sub.auth || (sub.keys && sub.keys.auth) || "").trim();
    if (!endpoint || !p256dh || !auth) {
      throw new Error("Push subscription is missing endpoint or encryption keys.");
    }
    return {
      endpoint: endpoint,
      keys: {
        p256dh: p256dh,
        auth: auth,
      },
    };
  }

  function buildPushRelayRequest(subscription, message, env) {
    var relayUrl = readEnv(env, "PUSH_RELAY_URL");
    if (!isValidRelayUrl(relayUrl)) {
      throw new Error(
        "PUSH_RELAY_URL is not configured. PocketBase's Goja JS runtime lacks WebCrypto ECDH/P-256 for direct RFC 8291 encryption; configure PUSH_RELAY_URL (and optional PUSH_RELAY_SECRET) to deliver Web Push notifications."
      );
    }

    var normalizedSub = normalizeSubscription(subscription);
    var relaySecret = readEnv(env, "PUSH_RELAY_SECRET");
    var headers = {
      "Content-Type": "application/json",
    };
    if (relaySecret) {
      headers.Authorization = "Bearer " + relaySecret;
    }

    var bodyObj = {
      subscription: normalizedSub,
      payload: {
        title: String((message && message.title) || "Fuloos").slice(0, 120),
        body: String(
          (message && message.body) || "You have a new financial alert."
        ).slice(0, 240),
        url: String((message && message.url) || "/?settings=notifications"),
        tag: String((message && message.tag) || "fuloos-alert").slice(0, 64),
      },
    };

    if (isVapidConfigured(env)) {
      bodyObj.vapid = {
        publicKey: readEnv(env, "VAPID_PUBLIC_KEY"),
        privateKey: readEnv(env, "VAPID_PRIVATE_KEY"),
        subject: readEnv(env, "VAPID_SUBJECT"),
      };
    }

    return {
      url: relayUrl,
      method: "POST",
      headers: headers,
      body: JSON.stringify(bodyObj),
      timeout: 10,
    };
  }

  function dispatchPushToSubscription(httpSend, subscription, message, env) {
    if (typeof httpSend !== "function") {
      throw new Error("httpSend function is required.");
    }
    var req = buildPushRelayRequest(subscription, message, env);
    var res = httpSend(req);
    var status = res && typeof res.statusCode === "number" ? res.statusCode : 0;

    if (status >= 200 && status < 300) {
      return { ok: true, status: status, gone: false };
    }
    if (status === 404 || status === 410) {
      return { ok: false, status: status, gone: true };
    }
    throw new Error("Push relay returned HTTP " + status);
  }

  return {
    isValidRelayUrl: isValidRelayUrl,
    isPushRelayConfigured: isPushRelayConfigured,
    isVapidConfigured: isVapidConfigured,
    normalizeSubscription: normalizeSubscription,
    buildPushRelayRequest: buildPushRelayRequest,
    dispatchPushToSubscription: dispatchPushToSubscription,
  };
});
