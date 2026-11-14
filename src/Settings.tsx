import { useEffect, useRef, type ReactNode } from "react";
import { Inbox, Trash2, Wand2, X } from "lucide-react";
import { useDensity, type Density } from "./density";
import { useLocale, type Locale } from "./i18n";

/** Profile settings. Holds appearance, list layout, data & backup, and account deletion. */
export function SettingsDialog({
  onClose,
  onDeleteAccount,
  onOpenRules,
  onOpenCaptureAlerts,
  pendingAlertCount = 0,
  security,
  notifications,
  household,
  dataBackup,
}: {
  onClose: () => void;
  /** Only offered when signed in (not in the demo workspace). */
  onDeleteAccount?: () => void;
  onOpenRules?: () => void;
  onOpenCaptureAlerts?: () => void;
  pendingAlertCount?: number;
  security?: ReactNode;
  notifications?: ReactNode;
  household?: ReactNode;
  dataBackup?: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [density, setDensity] = useDensity();
  const { locale, setLocale, t } = useLocale();
  const choices: { value: Density; title: string; text: string }[] = [
    {
      value: "compact",
      title: t("settings.compactTitle"),
      text: t("settings.compactText"),
    },
    {
      value: "relaxed",
      title: t("settings.relaxedTitle"),
      text: t("settings.relaxedText"),
    },
  ];
  const languages: { value: Locale; label: string }[] = [
    { value: "en", label: t("settings.langEn") },
    { value: "ar", label: t("settings.langAr") },
  ];
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="modal settings-modal"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-labelledby="settings-title"
    >
      <div className="modal-head">
        <div>
          <span className="eyebrow">{t("settings.eyebrow")}</span>
          <h2 id="settings-title">{t("settings.title")}</h2>
        </div>
        <button
          className="icon-button"
          aria-label={t("common.close")}
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <fieldset className="density-field">
        <legend>{t("settings.appearance")} · {t("settings.language")}</legend>
        <p className="muted small">{t("settings.languageHint")}</p>
        <div className="language-options">
          {languages.map((lang) => (
            <label
              key={lang.value}
              className={`language-option ${locale === lang.value ? "is-selected" : ""}`}
            >
              <span>{lang.label}</span>
              <input
                type="radio"
                name="locale"
                value={lang.value}
                checked={locale === lang.value}
                onChange={() => setLocale(lang.value)}
              />
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="density-field">
        <legend>{t("settings.layout")}</legend>
        <p className="muted small">{t("settings.layoutHint")}</p>
        <div className="density-options">
          {choices.map((c) => (
            <label
              key={c.value}
              className={`density-option ${density === c.value ? "is-selected" : ""}`}
            >
              <input
                type="radio"
                name="density"
                value={c.value}
                checked={density === c.value}
                onChange={() => setDensity(c.value)}
              />
              <span className={`density-preview ${c.value}`} aria-hidden>
                {c.value === "compact" ? (
                  <>
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                  </>
                ) : (
                  <>
                    <em />
                    <b>
                      <span />
                      <span />
                    </b>
                    <b>
                      <span />
                      <span />
                    </b>
                  </>
                )}
              </span>
              <strong>{c.title}</strong>
              <small>{c.text}</small>
            </label>
          ))}
        </div>
      </fieldset>
      {security}
      {notifications}
      {household}
      {onOpenRules && (
        <div className="settings-danger">
          <div>
            <b>{t("settings.rulesTitle")}</b>
            <p className="muted small">{t("settings.rulesText")}</p>
          </div>
          <button type="button" className="secondary" onClick={onOpenRules}>
            <Wand2 size={15} /> {t("common.manageRules")}
          </button>
        </div>
      )}
      {onOpenCaptureAlerts && (
        <div className="settings-danger">
          <div>
            <b>{t("settings.captureTitle")}</b>
            <p className="muted small">{t("settings.captureText")}</p>
          </div>
          <button
            type="button"
            className="secondary"
            onClick={onOpenCaptureAlerts}
          >
            <Inbox size={15} /> {t("settings.capturedAlerts")}
            {pendingAlertCount > 0 ? ` (${pendingAlertCount})` : ""}
          </button>
        </div>
      )}
      {dataBackup}
      {onDeleteAccount && (
        <div className="settings-danger">
          <div>
            <b>{t("settings.deleteAccountTitle")}</b>
            <p className="muted small">{t("settings.deleteAccountText")}</p>
          </div>
          <button className="secondary danger" onClick={onDeleteAccount}>
            <Trash2 size={15} /> {t("settings.deleteEllipsis")}
          </button>
        </div>
      )}
      <div className="modal-actions">
        <button className="primary" onClick={onClose}>
          {t("common.done")}
        </button>
      </div>
    </dialog>
  );
}
