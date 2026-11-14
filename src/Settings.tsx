import { useEffect, useRef, type ReactNode } from "react";
import { Trash2, X } from "lucide-react";
import { useDensity, type Density } from "./density";

const choices: { value: Density; title: string; text: string }[] = [
  {
    value: "compact",
    title: "Compact",
    text: "A tight, spreadsheet-style table. More rows on screen.",
  },
  {
    value: "relaxed",
    title: "Relaxed",
    text: "Roomier cards grouped by day, like the dashboard.",
  },
];

/** Profile settings. Holds list layout, data & backup, and account deletion. */
export function SettingsDialog({
  onClose,
  onDeleteAccount,
  security,
  notifications,
  dataBackup,
}: {
  onClose: () => void;
  /** Only offered when signed in (not in the demo workspace). */
  onDeleteAccount?: () => void;
  security?: ReactNode;
  notifications?: ReactNode;
  dataBackup?: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [density, setDensity] = useDensity();
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
          <span className="eyebrow">PROFILE</span>
          <h2 id="settings-title">Settings</h2>
        </div>
        <button className="icon-button" aria-label="Close" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <fieldset className="density-field">
        <legend>Layout</legend>
        <p className="muted small">
          Choose how transactions, accounts and categories are laid out. Saved
          on this device.
        </p>
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
      {dataBackup}
      {onDeleteAccount && (
        <div className="settings-danger">
          <div>
            <b>Delete my account</b>
            <p className="muted small">
              Removes your sign-in and everything you have saved.
            </p>
          </div>
          <button className="secondary danger" onClick={onDeleteAccount}>
            <Trash2 size={15} /> Delete…
          </button>
        </div>
      )}
      <div className="modal-actions">
        <button className="primary" onClick={onClose}>
          Done
        </button>
      </div>
    </dialog>
  );
}
