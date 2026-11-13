import React, { useState } from "react";
import { KeyRound, Lock, LogOut, Mail, ShieldCheck } from "lucide-react";
import { backend, type Session } from "./client";
import { confirmDialog } from "./dialogStore";
import { errorMessage } from "./domain";
import {
  clearAppLock,
  createAppLockConfig,
  isValidPin,
  loadAppLock,
  loadIdleSessionTimeout,
  saveAppLock,
  saveIdleSessionTimeout,
  type AppLockConfig,
  type StorageLike,
} from "./appLock";

export function SecuritySettings({
  session,
  storage,
  onLockNow,
  onLockConfigChanged,
  onIdleTimeoutChanged,
  onCloseSettings,
}: {
  session: Session;
  storage: StorageLike | undefined;
  onLockNow: () => void;
  onLockConfigChanged: (config: AppLockConfig | null) => void;
  onIdleTimeoutChanged: (minutes: number) => void;
  onCloseSettings: () => void;
}) {
  const userId = session.user.id;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Email verification
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [verifyToken, setVerifyToken] = useState("");

  // Idle session timeout
  const [idleSignOutMinutes, setIdleSignOutMinutes] = useState(() =>
    loadIdleSessionTimeout(storage, userId),
  );

  // App lock state
  const [lockConfig, setLockConfig] = useState<AppLockConfig | null>(() =>
    loadAppLock(storage, userId),
  );
  const [pinFormOpen, setPinFormOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [lockIdleMinutes, setLockIdleMinutes] = useState(
    () => lockConfig?.idleMinutes ?? 5,
  );
  const [lockOnReopen, setLockOnReopen] = useState(
    () => lockConfig?.lockOnReopen ?? true,
  );

  // Password change
  const [pwOpen, setPwOpen] = useState(false);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");

  // Email change
  const [emailOpen, setEmailOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [emailToken, setEmailToken] = useState("");
  const [emailConfirmPassword, setEmailConfirmPassword] = useState("");

  function clearFeedback() {
    setError("");
    setNotice("");
  }

  async function toggleMfa() {
    if (!backend || busy) return;
    clearFeedback();
    const next = !session.user.mfaEnabled;
    if (next) {
      const ok = await confirmDialog({
        title: "Enable Email OTP two-factor authentication?",
        message:
          "Signing in with your password will require a one-time code sent to your email. Make sure you have access to your inbox.",
        confirmLabel: "Enable 2FA",
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      await backend.setMfaEnabled(next);
      setNotice(
        next
          ? "Two-factor authentication (Email OTP) is now enabled."
          : "Two-factor authentication has been turned off.",
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function sendVerification() {
    if (!backend || busy) return;
    clearFeedback();
    setBusy(true);
    try {
      await backend.requestVerification(session.user.email);
      setNotice(`Verification email sent to ${session.user.email}.`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitVerifyToken(e: React.FormEvent) {
    e.preventDefault();
    if (!backend || busy) return;
    clearFeedback();
    setBusy(true);
    try {
      await backend.confirmVerification(verifyToken);
      setVerifyToken("");
      setVerifyOpen(false);
      setNotice("Email address verified.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOutEverywhere() {
    if (!backend || busy) return;
    clearFeedback();
    const ok = await confirmDialog({
      title: "Sign out everywhere?",
      message:
        "This rotates your session key on the server and signs out all browsers and devices, including this one.",
      confirmLabel: "Sign out everywhere",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await backend.signOutEverywhere();
      onCloseSettings();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  function handleIdleSignOutChange(minutes: number) {
    setIdleSignOutMinutes(minutes);
    saveIdleSessionTimeout(storage, userId, minutes);
    onIdleTimeoutChanged(minutes);
  }

  async function savePin(e: React.FormEvent) {
    e.preventDefault();
    clearFeedback();
    if (!isValidPin(pin)) {
      setError("PIN must be 4 to 8 digits.");
      return;
    }
    if (pin !== pinConfirm) {
      setError("PINs do not match.");
      return;
    }
    setBusy(true);
    try {
      const cfg = await createAppLockConfig(
        userId,
        pin,
        lockIdleMinutes,
        lockOnReopen,
      );
      saveAppLock(storage, cfg);
      setLockConfig(cfg);
      onLockConfigChanged(cfg);
      setPin("");
      setPinConfirm("");
      setPinFormOpen(false);
      setNotice("App lock PIN saved on this device.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function updateLockPreferences(nextIdle: number, nextReopen: boolean) {
    setLockIdleMinutes(nextIdle);
    setLockOnReopen(nextReopen);
    if (lockConfig) {
      const updated: AppLockConfig = {
        ...lockConfig,
        idleMinutes: nextIdle,
        lockOnReopen: nextReopen,
      };
      saveAppLock(storage, updated);
      setLockConfig(updated);
      onLockConfigChanged(updated);
    }
  }

  function removePin() {
    clearFeedback();
    clearAppLock(storage, userId);
    setLockConfig(null);
    onLockConfigChanged(null);
    setPinFormOpen(false);
    setNotice("App lock removed from this device.");
  }

  async function submitPasswordChange(e: React.FormEvent) {
    e.preventDefault();
    if (!backend || busy) return;
    clearFeedback();
    if (newPassword !== newPasswordConfirm) {
      setError("New passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await backend.changePassword(
        oldPassword,
        newPassword,
        newPasswordConfirm,
      );
      setOldPassword("");
      setNewPassword("");
      setNewPasswordConfirm("");
      setPwOpen(false);
      setNotice("Password updated.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitEmailRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!backend || busy) return;
    clearFeedback();
    setBusy(true);
    try {
      await backend.requestEmailChange(newEmail);
      setNotice(
        `Confirmation sent to ${newEmail.trim()}. Follow the link or paste the token below.`,
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitEmailConfirm(e: React.FormEvent) {
    e.preventDefault();
    if (!backend || busy) return;
    clearFeedback();
    setBusy(true);
    try {
      await backend.confirmEmailChange(emailToken, emailConfirmPassword);
      onCloseSettings();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <fieldset className="security-field">
      <legend>Account &amp; Security</legend>

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}

      <div className="security-block">
        <div className="security-row">
          <div>
            <b>Signed in as {session.user.email}</b>
            <p className="muted small">
              {session.user.verified === true
                ? "Email verified"
                : session.user.verified === false
                  ? "Email not verified yet"
                  : "Active session"}
            </p>
          </div>
          <div className="security-actions">
            {session.user.verified === false && (
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={sendVerification}
              >
                <Mail size={14} /> Verify email
              </button>
            )}
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => {
                backend?.signOut();
                onCloseSettings();
              }}
            >
              <LogOut size={14} /> Sign out
            </button>
            <button
              type="button"
              className="secondary danger-outline"
              disabled={busy}
              onClick={handleSignOutEverywhere}
            >
              Sign out everywhere
            </button>
          </div>
        </div>

        {session.user.verified === false && (
          <div className="security-sub">
            <button
              type="button"
              className="text-button"
              onClick={() => setVerifyOpen((v) => !v)}
            >
              {verifyOpen ? "Hide token entry" : "Have a verification token?"}
            </button>
            {verifyOpen && (
              <form onSubmit={submitVerifyToken} className="security-inline-form">
                <input
                  required
                  value={verifyToken}
                  onChange={(e) => setVerifyToken(e.target.value)}
                  placeholder="Paste verification token"
                />
                <button type="submit" className="primary" disabled={busy}>
                  Confirm
                </button>
              </form>
            )}
          </div>
        )}

        <label className="security-select-row">
          <span>Auto sign out after inactivity</span>
          <select
            value={idleSignOutMinutes}
            onChange={(e) => handleIdleSignOutChange(Number(e.target.value))}
          >
            <option value={0}>Off</option>
            <option value={15}>15 minutes</option>
            <option value={30}>30 minutes</option>
            <option value={60}>1 hour</option>
            <option value={240}>4 hours</option>
          </select>
        </label>
      </div>

      <div className="security-block">
        <div className="security-row">
          <div>
            <b>Two-factor authentication (Email OTP)</b>
            <p className="muted small">
              {session.user.mfaEnabled
                ? "Enabled — password sign-in requires a one-time email code."
                : "Optional — require a one-time email code on sign-in (requires server SMTP)."}
            </p>
          </div>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={toggleMfa}
          >
            <ShieldCheck size={14} />{" "}
            {session.user.mfaEnabled ? "Disable 2FA" : "Enable 2FA"}
          </button>
        </div>
      </div>

      <div className="security-block">
        <div className="security-row">
          <div>
            <b>App lock (PIN privacy screen)</b>
            <p className="muted small">
              Client-side privacy screen only — hides balances and transactions
              in the DOM when idle or reopened. Does not encrypt data.
            </p>
          </div>
          <div className="security-actions">
            {lockConfig && (
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => {
                  onCloseSettings();
                  onLockNow();
                }}
              >
                <Lock size={14} /> Lock now
              </button>
            )}
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => {
                clearFeedback();
                setPinFormOpen((v) => !v);
              }}
            >
              {lockConfig ? "Change PIN" : "Set up PIN"}
            </button>
            {lockConfig && (
              <button
                type="button"
                className="secondary danger-outline"
                disabled={busy}
                onClick={removePin}
              >
                Remove PIN
              </button>
            )}
          </div>
        </div>

        {lockConfig && (
          <div className="security-lock-prefs">
            <label className="security-select-row">
              <span>Lock after idle</span>
              <select
                value={lockIdleMinutes}
                onChange={(e) =>
                  updateLockPreferences(Number(e.target.value), lockOnReopen)
                }
              >
                <option value={0}>Manual / reopen only</option>
                <option value={1}>1 minute</option>
                <option value={5}>5 minutes</option>
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
              </select>
            </label>
            <label className="security-checkbox">
              <input
                type="checkbox"
                checked={lockOnReopen}
                onChange={(e) =>
                  updateLockPreferences(lockIdleMinutes, e.target.checked)
                }
              />
              <span>Lock when reopening the app</span>
            </label>
          </div>
        )}

        {pinFormOpen && (
          <form onSubmit={savePin} className="security-sub-form">
            <div className="security-grid">
              <label>
                New PIN (4–8 digits)
                <input
                  required
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  minLength={4}
                  maxLength={8}
                  autoComplete="off"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                  placeholder="4–8 digits"
                />
              </label>
              <label>
                Confirm PIN
                <input
                  required
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  minLength={4}
                  maxLength={8}
                  autoComplete="off"
                  value={pinConfirm}
                  onChange={(e) =>
                    setPinConfirm(e.target.value.replace(/\D/g, ""))
                  }
                  placeholder="Repeat PIN"
                />
              </label>
            </div>
            <div className="security-actions">
              <button type="submit" className="primary" disabled={busy}>
                Save PIN
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => setPinFormOpen(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      <div className="security-block">
        <div className="security-row">
          <div>
            <b>Password &amp; email</b>
            <p className="muted small">
              Update your sign-in password or change your account email.
            </p>
          </div>
          <div className="security-actions">
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => {
                clearFeedback();
                setPwOpen((v) => !v);
                setEmailOpen(false);
              }}
            >
              <KeyRound size={14} /> Change password
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => {
                clearFeedback();
                setEmailOpen((v) => !v);
                setPwOpen(false);
              }}
            >
              <Mail size={14} /> Change email
            </button>
          </div>
        </div>

        {pwOpen && (
          <form onSubmit={submitPasswordChange} className="security-sub-form">
            <label>
              Current password
              <input
                required
                type="password"
                autoComplete="current-password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
              />
            </label>
            <div className="security-grid">
              <label>
                New password
                <input
                  required
                  type="password"
                  minLength={8}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 8 characters"
                />
              </label>
              <label>
                Confirm new password
                <input
                  required
                  type="password"
                  minLength={8}
                  autoComplete="new-password"
                  value={newPasswordConfirm}
                  onChange={(e) => setNewPasswordConfirm(e.target.value)}
                />
              </label>
            </div>
            <div className="security-actions">
              <button type="submit" className="primary" disabled={busy}>
                Update password
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => setPwOpen(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {emailOpen && (
          <div className="security-sub-form">
            <form onSubmit={submitEmailRequest} className="security-inline-form">
              <input
                required
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="New email address"
              />
              <button type="submit" className="primary" disabled={busy}>
                Send change link
              </button>
            </form>
            <form onSubmit={submitEmailConfirm} className="security-sub-form">
              <p className="muted small">
                Already have an email change token? Confirm it below (you will
                need to sign in again):
              </p>
              <div className="security-grid">
                <label>
                  Email change token
                  <input
                    required
                    value={emailToken}
                    onChange={(e) => setEmailToken(e.target.value)}
                    placeholder="Token from email"
                  />
                </label>
                <label>
                  Current password
                  <input
                    required
                    type="password"
                    autoComplete="current-password"
                    value={emailConfirmPassword}
                    onChange={(e) => setEmailConfirmPassword(e.target.value)}
                  />
                </label>
              </div>
              <button type="submit" className="secondary" disabled={busy}>
                Confirm email change
              </button>
            </form>
          </div>
        )}
      </div>
    </fieldset>
  );
}
