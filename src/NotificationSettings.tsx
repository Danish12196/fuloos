import { useEffect, useRef, useState } from "react";
import { Bell, Mail } from "lucide-react";
import {
  defaultNotificationPreferences,
  errorMessage,
  type DigestDay,
  type NotificationPreferences,
} from "./domain";
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
    onLoadPrefs()
      .then((res) => {
        if (!active) return;
        setPrefs(res.prefs);
        setSavedSnapshot(JSON.stringify(res.prefs));
        setSupported(res.supported);
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
  }, [demo, onLoadPrefs]);

  const dirty = JSON.stringify(prefs) !== savedSnapshot;
  const disabled = Boolean(busy || loading || saving || testing || !supported);

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

  return (
    <section
      className="notifications-settings"
      aria-labelledby="notifications-heading"
    >
      <div className="notifications-head">
        <h3 id="notifications-heading">Notifications</h3>
        <p className="muted small">
          {demo
            ? "Demo mode: preferences are kept in memory only and no emails are sent."
            : `Opt-in email alerts${userEmail ? ` sent to ${userEmail}` : ""}. All alerts start off until you enable them.`}
        </p>
      </div>

      {!supported && !demo && (
        <p className="muted small" role="status">
          Notifications are not installed on the server yet. Apply the
          notifications migration and hooks to enable email alerts.
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

      <div className="notifications-events">
        <div className="notifications-row">
          <label>
            <input
              type="checkbox"
              checked={prefs.upcoming_bill_enabled}
              disabled={disabled || !prefs.email_enabled}
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
                disabled || !prefs.email_enabled || !prefs.upcoming_bill_enabled
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
              disabled={disabled || !prefs.email_enabled}
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
              disabled={disabled || !prefs.email_enabled}
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
              disabled={disabled || !prefs.email_enabled}
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
              disabled={disabled || !prefs.email_enabled}
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
                disabled || !prefs.email_enabled || !prefs.weekly_digest_enabled
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
