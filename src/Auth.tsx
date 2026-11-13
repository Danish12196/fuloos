import React, { useEffect, useState } from "react";
import { ArrowRight, Check, Leaf } from "lucide-react";
import { backend } from "./client";
import { errorMessage } from "./domain";
import { ThemeToggle } from "./ThemeToggle";

export function Auth({
  onDemo,
  externalError,
}: {
  onDemo: () => void;
  externalError: string;
}) {
  const [signup, setSignup] = useState(false),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
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
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setBusy(false));
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
      setError(errorMessage(e));
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
          fuloos.
        </a>
        <div>
          <div className="eyebrow">A LITTLE MORE CLARITY</div>
          <h1>
            Your money.
            <br />
            Your life.
            <br />
            <em>In balance.</em>
          </h1>
          <p>
            A calm space for your everyday finances.
            <br />
            Bring your accounts together and make room
            <br />
            for what matters.
          </p>
          <div className="auth-features">
            <span>
              <Check size={17} /> All your accounts, together
            </span>
            <span>
              <Check size={17} /> Categories that feel like you
            </span>
            <span>
              <Check size={17} /> Made for life in the UAE
            </span>
          </div>
        </div>
        <small>YOUR MONEY, IN VIEW.</small>
      </section>
      <section className="auth-side">
        <div className="auth-theme-toggle">
          <ThemeToggle />
        </div>
        <div className="auth-form">
          <span className="auth-tag">
            <Leaf size={16} /> Welcome to Fuloos
          </span>
          <h2>
            {signup ? "Make yourself at home." : "Good to have you here."}
          </h2>
          <p>
            {signup
              ? "Create your account and start with a clear view."
              : "Sign in to pick up where you left off."}
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
            {busy ? "Please wait…" : "Continue with Google"}
          </button>
          {googleAvailable === false && (
            <p className="google-setup-note">
              Google sign-in is awaiting setup. Email and password are available
              below.
            </p>
          )}
          <div className="auth-tabs">
            <button
              className={!signup ? "selected" : ""}
              onClick={() => {
                setSignup(false);
                setError("");
                setNotice("");
              }}
            >
              Sign in
            </button>
            <button
              className={signup ? "selected" : ""}
              onClick={() => {
                setSignup(true);
                setError("");
                setNotice("");
              }}
            >
              Sign up
            </button>
          </div>
          <form onSubmit={submit}>
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
            <label>
              Password
              <input
                required
                type="password"
                minLength={8}
                autoComplete={signup ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={signup ? "At least 8 characters" : "Your password"}
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
              {busy ? "Please wait…" : signup ? "Create account" : "Sign in"}
              <ArrowRight size={17} />
            </button>
          </form>
          <div className="auth-divider">
            <span>or take a look around</span>
          </div>
          <button className="demo-button" onClick={onDemo}>
            Explore the demo <ArrowRight size={16} />
          </button>
          {!backend && (
            <p className="setup-note">
              Preview mode · Live sign-in will be available once the database is
              connected.
            </p>
          )}
          <small className="auth-footnote">
            A clearer picture starts with one small step.
          </small>
        </div>
      </section>
    </div>
  );
}
