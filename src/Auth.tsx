import React, { useEffect, useState } from "react";
import { ArrowRight, Check, Leaf } from "lucide-react";
import { BackendError, MfaRequiredError } from "./backend";
import { backend } from "./client";
import { errorMessage } from "./domain";
import { ThemeToggle } from "./ThemeToggle";
import { LanguageToggle } from "./LanguageToggle";
import { useLocale } from "./i18n";

export function Auth({
  onDemo,
  externalError,
}: {
  onDemo: () => void;
  externalError: string;
}) {
  const { t } = useLocale();
  const [signup, setSignup] = useState(false),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [mfa, setMfa] = useState<{
    mfaId: string;
    otpId: string;
    email: string;
  } | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [resetMode, setResetMode] = useState<"none" | "request" | "confirm">(
    "none",
  );
  const [resetToken, setResetToken] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetPasswordConfirm, setResetPasswordConfirm] = useState("");
  const [googleAvailable, setGoogleAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    if (backend)
      backend
        .googleEnabled()
        .then((enabled) => {
          if (active) setGoogleAvailable(enabled);
        })
        .catch(() => {
          if (active) setGoogleAvailable(false);
        });
    else setGoogleAvailable(false);
    return () => {
      active = false;
    };
  }, []);
  function googleSignIn() {
    if (!backend || busy) return;
    setError("");
    setNotice("");
    setBusy(true);
    backend
      .signInWithGoogle()
      .catch(async (e) => {
        if (e instanceof MfaRequiredError) {
          setError(
            "Multi-factor authentication is required for this account. Please sign in with email and password.",
          );
          return;
        }
        setError(errorMessage(e));
      })
      .finally(() => setBusy(false));
  }
  async function startMfaOtp(mfaId: string, targetEmail: string) {
    if (!backend) return;
    try {
      const { otpId } = await backend.requestOtp(targetEmail);
      setMfa({ mfaId, otpId, email: targetEmail });
      setOtpCode("");
      setNotice(`We sent a verification code to ${targetEmail.trim()}.`);
    } catch (e) {
      setMfa({ mfaId, otpId: "", email: targetEmail });
      setError(
        errorMessage(e) ||
          "Could not send the email verification code. Try resending or contact support.",
      );
    }
  }
  async function submitMfa(e: React.FormEvent) {
    e.preventDefault();
    if (!backend || !mfa) return;
    setError("");
    setNotice("");
    if (!mfa.otpId) {
      setError("Request a verification code first.");
      return;
    }
    setBusy(true);
    try {
      await backend.verifyMfaOtp(mfa.mfaId, mfa.otpId, otpCode);
    } catch (err) {
      if (err instanceof BackendError && err.status === 401) {
        setMfa(null);
        setOtpCode("");
        setError("Your sign-in session expired. Please sign in again.");
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }
  async function resendOtp() {
    if (!backend || !mfa || busy) return;
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const { otpId } = await backend.requestOtp(mfa.email);
      setMfa({ ...mfa, otpId });
      setNotice(`Sent a new verification code to ${mfa.email.trim()}.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  async function submitResetRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!backend) return;
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await backend.requestPasswordReset(email);
      setNotice(
        "If an account exists for that email, a password reset link and token have been sent.",
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  async function submitResetConfirm(e: React.FormEvent) {
    e.preventDefault();
    if (!backend) return;
    setError("");
    setNotice("");
    if (resetPassword !== resetPasswordConfirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await backend.confirmPasswordReset(
        resetToken,
        resetPassword,
        resetPasswordConfirm,
      );
      setResetMode("none");
      setResetToken("");
      setResetPassword("");
      setResetPasswordConfirm("");
      setPassword("");
      setNotice("Your password has been updated. Sign in with your new password.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    if (!backend) {
      setError(
        "Live authentication is not connected yet. You can explore the demo below.",
      );
      return;
    }
    setBusy(true);
    try {
      if (signup) {
        const result = await backend.signUp(email, password);
        if (result.verificationRequired)
          setNotice("Check your email to confirm your account, then sign in.");
        else if (!result.session) {
          setSignup(false);
          setNotice("Your account is ready. Sign in to continue.");
        }
      } else await backend.signIn(email, password);
    } catch (e) {
      if (e instanceof MfaRequiredError) {
        await startMfaOtp(e.mfaId, email);
      } else {
        setError(errorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-layout">
      <section className="auth-story">
        <a className="brand" href="#">
          <span className="brand-icon">
            <Leaf size={24} />
          </span>
          {t("brand.name")}.
        </a>
        <div>
          <div className="eyebrow">{t("auth.eyebrow")}</div>
          <h1>
            {t("auth.heroLine1")}
            <br />
            {t("auth.heroLine2")}
            <br />
            <em>{t("auth.heroLine3")}</em>
          </h1>
          <p>
            {t("auth.heroBody1")}
            <br />
            {t("auth.heroBody2")}
            <br />
            {t("auth.heroBody3")}
          </p>
          <div className="auth-features">
            <span>
              <Check size={17} /> {t("auth.feature1")}
            </span>
            <span>
              <Check size={17} /> {t("auth.feature2")}
            </span>
            <span>
              <Check size={17} /> {t("auth.feature3")}
            </span>
          </div>
        </div>
        <small>{t("auth.storyFooter")}</small>
      </section>
      <section className="auth-side">
        <div className="auth-theme-toggle">
          <LanguageToggle />
          <ThemeToggle />
        </div>
        <div className="auth-form">
          <span className="auth-tag">
            <Leaf size={16} /> {t("auth.welcome")}
          </span>
          <h2>
            {signup ? t("auth.signUpTitle") : t("auth.signInTitle")}
          </h2>
          <p>
            {signup ? t("auth.signUpSubtitle") : t("auth.signInSubtitle")}
          </p>
          <button
            type="button"
            className="google-sign-in"
            disabled={busy || !googleAvailable}
            onClick={googleSignIn}
          >
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M21.6 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.8 3-4.3 3-7.4Z"
              />
              <path
                fill="#34A853"
                d="M12 22c2.7 0 5-.9 6.6-2.4L15.4 17c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22Z"
              />
              <path
                fill="#FBBC05"
                d="M6.4 13.9a6 6 0 0 1 0-3.8V7.5H3.1a10 10 0 0 0 0 9l3.3-2.6Z"
              />
              <path
                fill="#EA4335"
                d="M12 6c1.5 0 2.8.5 3.8 1.5l2.8-2.8A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.9 5.5l3.3 2.6A6 6 0 0 1 12 6Z"
              />
            </svg>
            {busy ? t("auth.pleaseWait") : t("auth.continueGoogle")}
          </button>
          {googleAvailable === false && (
            <p className="google-setup-note">{t("auth.googleSetupNote")}</p>
          )}
          {mfa ? (
            <form onSubmit={submitMfa} className="auth-mfa-form">
              <p className="muted small">
                Two-factor verification is enabled for <b>{mfa.email}</b>. Enter
                the one-time code sent to your email.
              </p>
              <label>
                Verification code
                <input
                  required
                  autoFocus
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  placeholder="Enter code from email"
                />
              </label>
              {(error || externalError) && (
                <div className="error" role="alert">
                  {error || externalError}
                </div>
              )}
              {notice && (
                <div className="notice" role="status">
                  {notice}
                </div>
              )}
              <button className="primary auth-submit" disabled={busy}>
                {busy ? "Verifying…" : "Verify and sign in"}
                <ArrowRight size={17} />
              </button>
              <div className="auth-aux-actions">
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={resendOtp}
                >
                  Resend code
                </button>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    setMfa(null);
                    setOtpCode("");
                    setError("");
                    setNotice("");
                  }}
                >
                  Back to sign in
                </button>
              </div>
            </form>
          ) : resetMode !== "none" ? (
            resetMode === "request" ? (
              <form onSubmit={submitResetRequest}>
                <p className="muted small">
                  Enter your account email and we will send a password reset
                  link and token.
                </p>
                <label>
                  Email address
                  <input
                    required
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                  />
                </label>
                {(error || externalError) && (
                  <div className="error" role="alert">
                    {error || externalError}
                  </div>
                )}
                {notice && (
                  <div className="notice" role="status">
                    {notice}
                  </div>
                )}
                <button className="primary auth-submit" disabled={busy}>
                  {busy ? "Sending…" : "Send reset email"}
                  <ArrowRight size={17} />
                </button>
                <div className="auth-aux-actions">
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => {
                      setResetMode("confirm");
                      setError("");
                      setNotice("");
                    }}
                  >
                    I have a reset token
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => {
                      setResetMode("none");
                      setError("");
                      setNotice("");
                    }}
                  >
                    Back to sign in
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={submitResetConfirm}>
                <label>
                  Reset token
                  <input
                    required
                    autoComplete="off"
                    value={resetToken}
                    onChange={(e) => setResetToken(e.target.value)}
                    placeholder="Paste token from email"
                  />
                </label>
                <label>
                  New password
                  <input
                    required
                    type="password"
                    minLength={8}
                    autoComplete="new-password"
                    value={resetPassword}
                    onChange={(e) => setResetPassword(e.target.value)}
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
                    value={resetPasswordConfirm}
                    onChange={(e) => setResetPasswordConfirm(e.target.value)}
                    placeholder="Repeat new password"
                  />
                </label>
                {(error || externalError) && (
                  <div className="error" role="alert">
                    {error || externalError}
                  </div>
                )}
                {notice && (
                  <div className="notice" role="status">
                    {notice}
                  </div>
                )}
                <button className="primary auth-submit" disabled={busy}>
                  {busy ? "Updating…" : "Update password"}
                  <ArrowRight size={17} />
                </button>
                <div className="auth-aux-actions">
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => {
                      setResetMode("none");
                      setError("");
                      setNotice("");
                    }}
                  >
                    Back to sign in
                  </button>
                </div>
              </form>
            )
          ) : (
            <>
              <div className="auth-tabs">
                <button
                  className={!signup ? "selected" : ""}
                  onClick={() => {
                    setSignup(false);
                    setError("");
                    setNotice("");
                  }}
                >
                  {t("auth.signIn")}
                </button>
                <button
                  className={signup ? "selected" : ""}
                  onClick={() => {
                    setSignup(true);
                    setError("");
                    setNotice("");
                  }}
                >
                  {t("auth.signUp")}
                </button>
              </div>
              <form onSubmit={submit}>
                <label>
                  {t("auth.email")}
                  <input
                    required
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                  />
                </label>
                <label>
                  {t("auth.password")}
                  <input
                    required
                    type="password"
                    minLength={8}
                    autoComplete={signup ? "new-password" : "current-password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={
                      signup
                        ? t("auth.passwordPlaceholderSignUp")
                        : t("auth.passwordPlaceholderSignIn")
                    }
                  />
                </label>
                {(error || externalError) && (
                  <div className="error" role="alert">
                    {error || externalError}
                  </div>
                )}
                {notice && (
                  <div className="notice" role="status">
                    {notice}
                  </div>
                )}
                <button className="primary auth-submit" disabled={busy}>
                  {busy
                    ? t("auth.pleaseWait")
                    : signup
                      ? t("auth.createAccount")
                      : t("auth.signIn")}
                  <ArrowRight size={17} className="rtl-flip" />
                </button>
                {!signup && backend && (
                  <div className="auth-aux-actions">
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy}
                      onClick={() => {
                        setResetMode("request");
                        setError("");
                        setNotice("");
                      }}
                    >
                      {t("auth.forgotPassword")}
                    </button>
                  </div>
                )}
              </form>
            </>
          )}
          <div className="auth-divider">
            <span>{t("auth.orDivider")}</span>
          </div>
          <button className="demo-button" onClick={onDemo}>
            {t("auth.exploreDemo")} <ArrowRight size={16} className="rtl-flip" />
          </button>
          {!backend && (
            <p className="setup-note">{t("auth.previewNote")}</p>
          )}
          <small className="auth-footnote">{t("auth.footnote")}</small>
        </div>
      </section>
    </div>
  );
}
