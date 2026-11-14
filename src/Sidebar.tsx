import {
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
        fuloos<span className="brand-dot">.</span>
      </a>
      <div className="workspace-label">YOUR WORKSPACE</div>
      <nav>
        {[
          { name: "Overview", icon: LayoutDashboard },
          { name: "Transactions", icon: ReceiptText },
          { name: "Recurring", icon: Repeat },
          { name: "Budgets", icon: PiggyBank },
          { name: "Goals", icon: Target },
          { name: "Reports", icon: LayoutDashboard },
          { name: "Accounts", icon: Wallet },
          { name: "Categories", icon: Tags },
        ].map(({ name, icon: Icon }) => (
          <button
            className={`nav-item ${page === name ? "active" : ""}`}
            key={name}
            onClick={() => onNavigate(name)}
          >
            <Icon size={19} />
            {name}
            {page === name && <span className="nav-dot" />}
          </button>
        ))}
      </nav>
      <div className="sidebar-note">
        <span className="tiny-leaf">
          <Leaf size={19} />
        </span>
        <b>A little clarity goes a long way.</b>
        <p>Make room for what matters. One transaction at a time.</p>
      </div>
      <div className="profile">
        <span className="avatar">
          {demo ? "D" : session?.user.email?.slice(0, 1).toUpperCase()}
        </span>
        <div>
          <b>{demo ? "Demo workspace" : session?.user.email?.split("@")[0]}</b>
          <small>
            {demo ? "Sample data · not saved" : "Personal workspace"}
          </small>
        </div>
        <button
          className="icon-button"
          aria-label="Settings"
          title="Settings"
          onClick={onOpenSettings}
        >
          <SettingsIcon size={18} />
        </button>
        <button
          className="icon-button"
          aria-label="Sign out"
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
