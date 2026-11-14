import {
  Landmark,
  LayoutDashboard,
  Leaf,
  LogOut,
  PiggyBank,
  ReceiptText,
  Repeat,
  Settings as SettingsIcon,
  Tags,
  Target,
  Wallet,
} from "lucide-react";
import { backend, type Session } from "./client";
import { emptyLedger, type Ledger } from "./domain";
import { useLocale, type TranslationKey } from "./i18n";

const NAV_ITEMS = [
  { name: "Overview", icon: LayoutDashboard },
  { name: "Transactions", icon: ReceiptText },
  { name: "Recurring", icon: Repeat },
  { name: "Budgets", icon: PiggyBank },
  { name: "Goals", icon: Target },
  { name: "Net Worth", icon: Landmark },
  { name: "Reports", icon: LayoutDashboard },
  { name: "Accounts", icon: Wallet },
  { name: "Categories", icon: Tags },
] as const;

export function Sidebar({
  page,
  demo,
  session,
  onNavigate,
  onOpenSettings,
  onSignOutDemo,
}: {
  page: string;
  demo: boolean;
  session: Session | null;
  onNavigate: (page: string) => void;
  onOpenSettings: () => void;
  onSignOutDemo: (empty: Ledger) => void;
}) {
  const { t } = useLocale();
  return (
    <aside className="sidebar">
      <a
        className="brand"
        href="#"
        onClick={(e) => {
          e.preventDefault();
          onNavigate("Overview");
        }}
      >
        <span className="brand-icon">
          <Leaf size={23} />
        </span>
        {t("brand.name")}<span className="brand-dot">.</span>
      </a>
      <div className="workspace-label">{t("workspace.label")}</div>
      <nav>
        {NAV_ITEMS.map(({ name, icon: Icon }) => (
          <button
            className={`nav-item ${page === name ? "active" : ""}`}
            key={name}
            onClick={() => onNavigate(name)}
          >
            <Icon size={19} />
            {t(`nav.${name}` as TranslationKey)}
            {page === name && <span className="nav-dot" />}
          </button>
        ))}
      </nav>
      <div className="sidebar-note">
        <span className="tiny-leaf">
          <Leaf size={19} />
        </span>
        <b>{t("sidebar.noteTitle")}</b>
        <p>{t("sidebar.noteBody")}</p>
      </div>
      <div className="profile">
        <span className="avatar">
          {demo ? "D" : session?.user.email?.slice(0, 1).toUpperCase()}
        </span>
        <div>
          <b>{demo ? t("workspace.demo") : session?.user.email?.split("@")[0]}</b>
          <small>
            {demo ? t("workspace.demoSubtitle") : t("workspace.personal")}
          </small>
        </div>
        <button
          className="icon-button"
          aria-label={t("common.settings")}
          title={t("common.settings")}
          onClick={onOpenSettings}
        >
          <SettingsIcon size={18} />
        </button>
        <button
          className="icon-button"
          aria-label={t("common.signOut")}
          title={t("common.signOut")}
          onClick={async () => {
            if (demo) {
              onSignOutDemo(emptyLedger);
            } else {
              backend?.signOut();
            }
          }}
        >
          <LogOut size={18} />
        </button>
      </div>
    </aside>
  );
}
