import { useEffect, useState } from "react";
import { Bell, Mail, Smartphone } from "lucide-react";
import type { PushSubscriptionRecord } from "./backend";
import {
  defaultNotificationPreferences,
  errorMessage,
  type DigestDay,
  type NotificationPreferences,
} from "./domain";
import {
  deriveWebPushStatus,
  getExistingPushSubscription,
  getNotificationPermission,
  getVapidPublicKey,
  isWebPushSupported,
  subscribeToWebPush,
  unsubscribeFromWebPush,
  type PushSubscriptionPayload,
} from "./webPush";
import "./styles/notifications.css";

const DIGEST_DAYS: { value: DigestDay; label: string }[] = [
  { value: "sun", label: "Sunday" },
  { value: "mon", label: "Monday" },
  { value: "tue", label: "Tuesday" },
  { value: "wed", label: "Wednesday" },
  { value: "thu", label: "Thursday" },
  { value: "fri", label: "Friday" },
  { value: "sat", label: "Saturday" },
];

const TIMEZONES = [
  "Asia/Dubai",
  "Asia/Riyadh",
  "Asia/Qatar",
  "Asia/Kuwait",
  "Asia/Bahrain",
  "Asia/Muscat",
  "Europe/London",
  "UTC",
];

// In-memory store for demo mode so toggling preferences persists during the session.
let demoNotificationPrefs: NotificationPreferences = {
  ...defaultNotificationPreferences,
};

export function NotificationSettings({
  demo,
  userEmail,
  busy,
  onLoadPrefs,
  onSavePrefs,
  onSendTestEmail,
  onLoadPushSubscriptions,
  onSavePushSubscription,
  onDeletePushSubscription,
  onSendTestPush,
}: {
  demo: boolean;
  userEmail?: string;
  busy?: boolean;
  onLoadPrefs?: () => Promise<{
    prefs: NotificationPreferences;
    supported: boolean;
  }>;
  onSavePrefs?: (
    prefs: NotificationPreferences,
  ) => Promise<NotificationPreferences>;
  onSendTestEmail?: () => Promise<{ ok: boolean; message: string }>;
  onLoadPushSubscriptions?: () => Promise<{
    subscriptions: PushSubscriptionRecord[];
    supported: boolean;
  }>;
  onSavePushSubscription?: (
    sub: PushSubscriptionPayload,
  ) => Promise<PushSubscriptionRecord>;
  onDeletePushSubscription?: (id: string) => Promise<void>;
  onSendTestPush?: () => Promise<{ ok: boolean; message: string }>;
}) {
  const [prefs, setPrefs] = useState<NotificationPreferences>(() =>
    demo ? { ...demoNotificationPrefs } : { ...defaultNotificationPreferences },
  );
  const [savedSnapshot, setSavedSnapshot] = useState<string>(() =>
    JSON.stringify(
      demo ? demoNotificationPrefs : defaultNotificationPreferences,
    ),
  );
  const [loading, setLoading] = useState(!demo);
  const [supported, setSupported] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testingPush, setTestingPush] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushServerSupported, setPushServerSupported] = useState(true);
  const [pushSubscriptions, setPushSubscriptions] = useState<
    PushSubscriptionRecord[]
  >([]);
  const [browserEndpoint, setBrowserEndpoint] = useState<string | null>(null);
  const [permission, setPermission] = useState<
    NotificationPermission | "unsupported"
  >(() => getNotificationPermission());
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (demo || !onLoadPrefs) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError("");
    Promise.all([
      onLoadPrefs(),
      onLoadPushSubscriptions
        ? onLoadPushSubscriptions()
        : Promise.resolve({ subscriptions: [], supported: false }),
      getExistingPushSubscription(),
    ])
      .then(([res, pushRes, browserSub]) => {
        if (!active) return;
        setPrefs(res.prefs);
        setSavedSnapshot(JSON.stringify(res.prefs));
        setSupported(res.supported);
        setPushServerSupported(pushRes.supported);
        setPushSubscriptions(pushRes.subscriptions);
        setBrowserEndpoint(browserSub?.endpoint ?? null);
        setPermission(getNotificationPermission());
      })
      .catch((e) => {
        if (!active) return;
        setError(errorMessage(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [demo, onLoadPrefs, onLoadPushSubscriptions]);

  const dirty = JSON.stringify(prefs) !== savedSnapshot;
  const disabled = Boolean(
    busy || loading || saving || testing || testingPush || pushBusy || !supported,
  );
  const pushChannelEnabled = Boolean(prefs.channels?.push);
  const anyChannelEnabled = prefs.email_enabled || pushChannelEnabled;
  const vapidConfigured = getVapidPublicKey() !== null;
  const browserSupported = isWebPushSupported();
  const isBrowserSubscribed = Boolean(
    browserEndpoint &&
      pushSubscriptions.some((s) => s.endpoint === browserEndpoint),
  );
  const pushStatus = deriveWebPushStatus({
    supported: browserSupported && pushServerSupported,
    vapidConfigured,
    permission,
    subscribed: isBrowserSubscribed,
  });

  function update(patch: Partial<NotificationPreferences>) {
    setStatus("");
    setError("");
    setPrefs((prev) => ({ ...prev, ...patch }));
  }

  async function handleSave() {
    setError("");
    setStatus("");
    if (demo) {
      demoNotificationPrefs = { ...prefs };
      setSavedSnapshot(JSON.stringify(demoNotificationPrefs));
      setStatus("Saved notification preferences in demo memory.");
      return;
    }
    if (!onSavePrefs) return;
    setSaving(true);
    try {
      const saved = await onSavePrefs(prefs);
      setPrefs(saved);
      setSavedSnapshot(JSON.stringify(saved));
      setStatus("Notification preferences saved.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleTestEmail() {
    if (demo || !onSendTestEmail) return;
    setError("");
    setStatus("");
    setTesting(true);
    try {
      const res = await onSendTestEmail();
      setStatus(res.message || "Test email sent.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setTesting(false);
    }
  }

  async function handleToggleBrowserPush(enable: boolean) {
    if (demo) return;
    setError("");
    setStatus("");
    setPushBusy(true);
    try {
      if (enable) {
        if (!onSavePushSubscription) return;
        const payload = await subscribeToWebPush();
        const savedSub = await onSavePushSubscription(payload);
        setPushSubscriptions((prev) => [
          ...prev.filter((s) => s.endpoint !== savedSub.endpoint),
          savedSub,
        ]);
        setBrowserEndpoint(savedSub.endpoint);
        setPermission(getNotificationPermission());
        if (!prefs.channels?.push && onSavePrefs) {
          const nextPrefs: NotificationPreferences = {
            ...prefs,
            channels: { ...(prefs.channels ?? {}), push: true },
          };
          const savedPrefs = await onSavePrefs(nextPrefs);
          setPrefs(savedPrefs);
          setSavedSnapshot(JSON.stringify(savedPrefs));
        }
        setStatus("Push notifications enabled for this browser.");
      } else {
        const removedEndpoint = await unsubscribeFromWebPush();
        const match = pushSubscriptions.find(
          (s) => s.endpoint === (removedEndpoint || browserEndpoint),
        );
        if (match && onDeletePushSubscription) {
          await onDeletePushSubscription(match.id);
          setPushSubscriptions((prev) => prev.filter((s) => s.id !== match.id));
        }
        setBrowserEndpoint(null);
        setPermission(getNotificationPermission());
        setStatus("Push notifications disabled for this browser.");
      }
    } catch (e) {
      setPermission(getNotificationPermission());
      setError(errorMessage(e));
    } finally {
      setPushBusy(false);
    }
  }

  async function handleTestPush() {
    if (demo || !onSendTestPush) return;
    setError("");
    setStatus("");
    setTestingPush(true);
    try {
      const res = await onSendTestPush();
      setStatus(res.message || "Test push notification sent.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setTestingPush(false);
    }
  }

  return (
    <section
      className="notifications-settings"
      aria-labelledby="notifications-heading"
    >
      <div className="notifications-head">
        <h3 id="notifications-heading">Notifications</h3>
        <p className="muted small">
          {demo
            ? "Demo mode: preferences are kept in memory only and no emails or push alerts are sent."
            : `Opt-in email${userEmail ? ` (${userEmail})` : ""} and Web Push alerts. All alerts start off until you enable them.`}
        </p>
      </div>

      {!supported && !demo && (
        <p className="muted small" role="status">
          Notifications are not installed on the server yet. Apply the
          notifications migration and hooks to enable alerts.
        </p>
      )}

      <label className="notifications-master">
        <span>
          <Bell size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
          Email notifications
        </span>
        <input
          type="checkbox"
          checked={prefs.email_enabled}
          disabled={disabled}
          onChange={(e) =>
            update({
              email_enabled: e.target.checked,
              channels: {
                ...(prefs.channels ?? {}),
                email: e.target.checked,
              },
            })
          }
        />
      </label>

      <label className="notifications-master">
        <span>
          <Smartphone
            size={14}
            style={{ verticalAlign: "-2px", marginRight: 6 }}
          />
          Push notifications (account preference)
        </span>
        <input
          type="checkbox"
          checked={pushChannelEnabled}
          disabled={disabled}
          onChange={(e) =>
            update({
              channels: {
                ...(prefs.channels ?? {}),
                push: e.target.checked,
              },
            })
          }
        />
      </label>

      <label className="notifications-master">
        <span>
          <Smartphone
            size={14}
            style={{ verticalAlign: "-2px", marginRight: 6 }}
          />
          Push notifications (this browser)
        </span>
        <span className="notifications-master-meta">
          <span
            className={`notifications-badge${
              pushStatus === "subscribed"
                ? " is-ok"
                : pushStatus === "denied"
                  ? " is-warn"
                  : ""
            }`}
          >
            {demo
              ? "Demo"
              : pushStatus === "subscribed"
                ? "Subscribed"
                : pushStatus === "denied"
                  ? "Permission denied"
                  : pushStatus === "not_configured"
                    ? "Not configured"
                    : "Not subscribed"}
          </span>
          <input
            type="checkbox"
            checked={isBrowserSubscribed}
            disabled={
              demo ||
              disabled ||
              !pushServerSupported ||
              !browserSupported ||
              !vapidConfigured
            }
            onChange={(e) => void handleToggleBrowserPush(e.target.checked)}
          />
        </span>
      </label>

      {!demo && pushStatus === "not_configured" && (
        <p className="muted small">
          {!browserSupported
            ? "This browser does not support Web Push notifications."
            : !pushServerSupported
              ? "Web Push migration is not installed on the PocketBase server yet."
              : "Web Push is not configured in this build (VITE_VAPID_PUBLIC_KEY is missing)."}
        </p>
      )}

      <div className="notifications-events">
        <div className="notifications-row">
          <label>
            <input
              type="checkbox"
              checked={prefs.upcoming_bill_enabled}
              disabled={disabled || !anyChannelEnabled}
              onChange={(e) =>
                update({ upcoming_bill_enabled: e.target.checked })
              }
            />
            <span>Upcoming bill due</span>
          </label>
          <span className="notifications-inline-input">
            <input
              type="number"
              min={1}
              max={30}
              aria-label="Days before bill due"
              value={prefs.upcoming_bill_days}
              disabled={
                disabled || !anyChannelEnabled || !prefs.upcoming_bill_enabled
              }
              onChange={(e) => {
                const val = Math.max(
                  1,
                  Math.min(30, Number(e.target.value) || 1),
                );
                update({ upcoming_bill_days: val });
              }}
            />
            <span>days before</span>
          </span>
        </div>

        <div className="notifications-row">
          <label>
            <input
              type="checkbox"
              checked={prefs.overdue_enabled}
              disabled={disabled || !anyChannelEnabled}
              onChange={(e) => update({ overdue_enabled: e.target.checked })}
            />
            <span>Overdue recurring occurrence</span>
          </label>
        </div>

        <div className="notifications-row">
          <label>
            <input
              type="checkbox"
              checked={prefs.budget_80_enabled}
              disabled={disabled || !anyChannelEnabled}
              onChange={(e) => update({ budget_80_enabled: e.target.checked })}
            />
            <span>Monthly budget reaches 80%</span>
          </label>
        </div>

        <div className="notifications-row">
          <label>
            <input
              type="checkbox"
              checked={prefs.budget_100_enabled}
              disabled={disabled || !anyChannelEnabled}
              onChange={(e) => update({ budget_100_enabled: e.target.checked })}
            />
            <span>Monthly budget exceeds 100%</span>
          </label>
        </div>

        <div className="notifications-row">
          <label>
            <input
              type="checkbox"
              checked={prefs.weekly_digest_enabled}
              disabled={disabled || !anyChannelEnabled}
              onChange={(e) =>
                update({ weekly_digest_enabled: e.target.checked })
              }
            />
            <span>Weekly summary digest</span>
          </label>
          <span className="notifications-inline-input">
            <select
              aria-label="Weekly digest day"
              value={prefs.digest_day}
              disabled={
                disabled || !anyChannelEnabled || !prefs.weekly_digest_enabled
              }
              onChange={(e) =>
                update({ digest_day: e.target.value as DigestDay })
              }
            >
              {DIGEST_DAYS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </span>
        </div>

        <div className="notifications-row">
          <span className="muted small">Timezone</span>
          <span className="notifications-inline-input">
            <select
              aria-label="Notification timezone"
              value={
                TIMEZONES.includes(prefs.timezone)
                  ? prefs.timezone
                  : "Asia/Dubai"
              }
              disabled={disabled}
              onChange={(e) => update({ timezone: e.target.value })}
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </span>
        </div>
      </div>

      <div className="notifications-actions">
        <button
          type="button"
          className="primary"
          disabled={disabled || !dirty}
          onClick={() => void handleSave()}
        >
          {saving ? "Saving…" : "Save preferences"}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={demo || disabled}
          onClick={() => void handleTestEmail()}
        >
          <Mail size={14} />
          {testing ? "Sending…" : "Send test email"}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={
            demo || disabled || pushStatus !== "subscribed" || !onSendTestPush
          }
          onClick={() => void handleTestPush()}
        >
          <Smartphone size={14} />
          {testingPush ? "Sending…" : "Send test push"}
        </button>
      </div>

      {status && (
        <p className="small" role="status">
          {status}
        </p>
      )}
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
