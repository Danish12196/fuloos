import { useEffect, useState } from "react";
import { Check, Copy, LogOut, Plus, Trash2, UserPlus, Users } from "lucide-react";
import {
  errorMessage,
  type Account,
  type Budget,
  type Category,
  type Household,
  type HouseholdMember,
} from "./domain";
import {
  HOUSEHOLD_ROLE_LABELS,
  createDemoHouseholdState,
  generateDemoInviteCode,
  householdMembersFor,
  normalizeInviteCode,
  userRoleInHousehold,
  validateHouseholdName,
} from "./household";

const demoStore = createDemoHouseholdState();

export function HouseholdSettings({
  demo,
  userId,
  userEmail,
  accounts,
  budgets,
  categories,
  busy,
  onLoadHouseholds,
  onCreateHousehold,
  onCreateInvite,
  onJoinHousehold,
  onLeaveHousehold,
  onRemoveMember,
  onToggleAccountShare,
  onToggleBudgetShare,
  onReloadLedger,
}: {
  demo: boolean;
  userId?: string;
  userEmail?: string;
  accounts: Account[];
  budgets: Budget[];
  categories: Category[];
  busy?: boolean;
  onLoadHouseholds?: () => Promise<{
    households: Household[];
    members: HouseholdMember[];
    supported: boolean;
  }>;
  onCreateHousehold?: (name: string) => Promise<{
    household: Household;
    member: HouseholdMember;
  }>;
  onCreateInvite?: (
    householdId: string,
    role: "editor" | "viewer",
  ) => Promise<HouseholdMember>;
  onJoinHousehold?: (inviteCode: string) => Promise<{
    household: Household;
    member: HouseholdMember;
  }>;
  onLeaveHousehold?: (householdId: string) => Promise<void>;
  onRemoveMember?: (memberId: string) => Promise<void>;
  onToggleAccountShare: (
    accountId: string,
    householdId: string | null,
  ) => Promise<void>;
  onToggleBudgetShare?: (
    budgetId: string,
    householdId: string | null,
  ) => Promise<void>;
  onReloadLedger?: () => Promise<void>;
}) {
  const effectiveUserId = demo ? "demo-user" : (userId ?? "");
  const effectiveEmail = demo ? "demo@fuloos.local" : (userEmail ?? "");

  const [households, setHouseholds] = useState<Household[]>(() =>
    demo ? [...demoStore.households] : [],
  );
  const [members, setMembers] = useState<HouseholdMember[]>(() =>
    demo ? [...demoStore.members] : [],
  );
  const [supported, setSupported] = useState(true);
  const [loading, setLoading] = useState(!demo);
  const [working, setWorking] = useState(false);
  const [newName, setNewName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [inviteRole, setInviteRole] = useState<"editor" | "viewer">("editor");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (demo || !onLoadHouseholds) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError("");
    onLoadHouseholds()
      .then((res) => {
        if (!active) return;
        setHouseholds(res.households);
        setMembers(res.members);
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
  }, [demo, onLoadHouseholds]);

  const disabled = Boolean(busy || loading || working || !supported);
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  async function handleCreateHousehold(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setStatus("");
    try {
      const name = validateHouseholdName(newName);
      setWorking(true);
      if (demo) {
        const hh: Household = {
          id: `hh-${Date.now()}`,
          name,
          owner_id: effectiveUserId,
        };
        const member: HouseholdMember = {
          id: `hm-${Date.now()}`,
          household_id: hh.id,
          user_id: effectiveUserId,
          role: "owner",
          status: "active",
          member_email: effectiveEmail,
        };
        demoStore.households = [...demoStore.households, hh];
        demoStore.members = [...demoStore.members, member];
        setHouseholds([...demoStore.households]);
        setMembers([...demoStore.members]);
      } else if (onCreateHousehold) {
        const res = await onCreateHousehold(name);
        setHouseholds((prev) => [...prev, res.household]);
        setMembers((prev) => [...prev, res.member]);
      }
      setNewName("");
      setStatus(`Created household "${name}".`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setWorking(false);
    }
  }

  async function handleJoinHousehold(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setStatus("");
    const code = normalizeInviteCode(joinCode);
    if (!code) {
      setError("Enter an invite code.");
      return;
    }
    try {
      setWorking(true);
      if (demo) {
        const invite = demoStore.members.find(
          (m) => m.status === "pending" && m.invite_code === code,
        );
        if (!invite) {
          throw new Error("Invalid or expired invite code.");
        }
        invite.user_id = effectiveUserId;
        invite.status = "active";
        invite.invite_code = undefined;
        invite.member_email = effectiveEmail;
        setHouseholds([...demoStore.households]);
        setMembers([...demoStore.members]);
        setStatus("Joined household.");
      } else if (onJoinHousehold) {
        const res = await onJoinHousehold(code);
        setHouseholds((prev) =>
          prev.some((h) => h.id === res.household.id)
            ? prev
            : [...prev, res.household],
        );
        setMembers((prev) => [
          ...prev.filter((m) => m.id !== res.member.id),
          res.member,
        ]);
        if (onLoadHouseholds) {
          const fresh = await onLoadHouseholds();
          setHouseholds(fresh.households);
          setMembers(fresh.members);
        }
        await onReloadLedger?.();
        setStatus(`Joined "${res.household.name}".`);
      }
      setJoinCode("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setWorking(false);
    }
  }

  async function handleGenerateInvite(householdId: string) {
    setError("");
    setStatus("");
    try {
      setWorking(true);
      if (demo) {
        const invite: HouseholdMember = {
          id: `hm-${Date.now()}`,
          household_id: householdId,
          user_id: null,
          role: inviteRole,
          status: "pending",
          invite_code: generateDemoInviteCode(),
        };
        demoStore.members = [...demoStore.members, invite];
        setMembers([...demoStore.members]);
      } else if (onCreateInvite) {
        const invite = await onCreateInvite(householdId, inviteRole);
        setMembers((prev) => [...prev, invite]);
      }
      setStatus("Invite code generated.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setWorking(false);
    }
  }

  async function handleLeaveHousehold(household: Household) {
    setError("");
    setStatus("");
    try {
      setWorking(true);
      if (demo) {
        if (household.owner_id === effectiveUserId) {
          demoStore.households = demoStore.households.filter(
            (h) => h.id !== household.id,
          );
          demoStore.members = demoStore.members.filter(
            (m) => m.household_id !== household.id,
          );
        } else {
          demoStore.members = demoStore.members.filter(
            (m) =>
              !(
                m.household_id === household.id &&
                m.user_id === effectiveUserId
              ),
          );
        }
        setHouseholds([...demoStore.households]);
        setMembers([...demoStore.members]);
        for (const a of accounts) {
          if (a.household_id === household.id) {
            await onToggleAccountShare(a.id, null);
          }
        }
      } else if (onLeaveHousehold) {
        await onLeaveHousehold(household.id);
        setHouseholds((prev) => prev.filter((h) => h.id !== household.id));
        setMembers((prev) =>
          prev.filter((m) => m.household_id !== household.id),
        );
        await onReloadLedger?.();
      }
      setStatus(
        household.owner_id === effectiveUserId
          ? `Deleted household "${household.name}".`
          : `Left household "${household.name}".`,
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setWorking(false);
    }
  }

  async function handleRemoveMember(memberId: string) {
    setError("");
    setStatus("");
    try {
      setWorking(true);
      if (demo) {
        demoStore.members = demoStore.members.filter((m) => m.id !== memberId);
        setMembers([...demoStore.members]);
      } else if (onRemoveMember) {
        await onRemoveMember(memberId);
        setMembers((prev) => prev.filter((m) => m.id !== memberId));
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setWorking(false);
    }
  }

  async function handleCopyCode(id: string, code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedId(id);
      setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1800);
    } catch {
      setStatus(`Invite code: ${code}`);
    }
  }

  async function toggleAccount(account: Account, householdId: string) {
    setError("");
    setStatus("");
    try {
      setWorking(true);
      const next = account.household_id === householdId ? null : householdId;
      await onToggleAccountShare(account.id, next);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setWorking(false);
    }
  }

  async function toggleBudget(budget: Budget, householdId: string) {
    if (!onToggleBudgetShare) return;
    setError("");
    setStatus("");
    try {
      setWorking(true);
      const next = budget.household_id === householdId ? null : householdId;
      await onToggleBudgetShare(budget.id, next);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setWorking(false);
    }
  }

  return (
    <section
      className="household-settings"
      aria-labelledby="household-settings-title"
    >
      <div className="household-head">
        <div>
          <h3 id="household-settings-title">
            <Users size={15} /> Household sharing
          </h3>
          <p className="muted small">
            Share selected accounts and budgets with a partner or family while
            keeping your other accounts private.
          </p>
        </div>
      </div>

      {!supported && (
        <p className="muted small">
          Household sharing isn&apos;t installed on the server yet. Apply the
          latest PocketBase migration and hooks to enable it.
        </p>
      )}

      {error && (
        <p className="error-text small" role="alert">
          {error}
        </p>
      )}
      {status && (
        <p className="muted small" role="status">
          {status}
        </p>
      )}

      {supported &&
        households.map((hh) => {
          const hhMembers = householdMembersFor(members, hh.id);
          const myRole = userRoleInHousehold(
            members,
            hh.id,
            effectiveUserId,
            hh.owner_id,
          );
          const isOwner = myRole === "owner";
          const canShare = myRole === "owner" || myRole === "editor";
          const activeMembers = hhMembers.filter((m) => m.status === "active");
          const pendingInvites = hhMembers.filter(
            (m) => m.status === "pending" && m.invite_code,
          );

          return (
            <div className="household-card" key={hh.id}>
              <div className="household-card-head">
                <div className="household-card-title">
                  <span>{hh.name}</span>
                  {myRole && (
                    <span className="household-role-badge">
                      {HOUSEHOLD_ROLE_LABELS[myRole]}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className="secondary danger"
                  disabled={disabled}
                  onClick={() => handleLeaveHousehold(hh)}
                >
                  <LogOut size={14} />{" "}
                  {isOwner ? "Delete household" : "Leave household"}
                </button>
              </div>

              <div>
                <div className="household-section-label">Members</div>
                <div className="household-list">
                  {activeMembers.map((m) => (
                    <div className="household-member-row" key={m.id}>
                      <div className="household-member-info">
                        <span className="household-member-name">
                          {m.member_email ||
                            (m.user_id === effectiveUserId
                              ? effectiveEmail || "You"
                              : `Member ${m.user_id?.slice(0, 6)}`)}
                        </span>
                        <span className="household-role-badge">
                          {HOUSEHOLD_ROLE_LABELS[m.role]}
                        </span>
                      </div>
                      {isOwner && m.user_id !== effectiveUserId && (
                        <button
                          type="button"
                          className="icon-button"
                          aria-label="Remove member"
                          disabled={disabled}
                          onClick={() => handleRemoveMember(m.id)}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                  {pendingInvites.map((inv) => (
                    <div className="household-member-row" key={inv.id}>
                      <div className="household-member-info">
                        <span className="household-invite-code">
                          {inv.invite_code}
                        </span>
                        <span className="household-role-badge is-pending">
                          Pending · {HOUSEHOLD_ROLE_LABELS[inv.role]}
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`Copy invite code ${inv.invite_code}`}
                          onClick={() =>
                            handleCopyCode(inv.id, inv.invite_code!)
                          }
                        >
                          {copiedId === inv.id ? (
                            <Check size={14} />
                          ) : (
                            <Copy size={14} />
                          )}
                        </button>
                        {isOwner && (
                          <button
                            type="button"
                            className="icon-button"
                            aria-label="Revoke invite"
                            disabled={disabled}
                            onClick={() => handleRemoveMember(inv.id)}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {isOwner && (
                <div className="household-inline-form">
                  <select
                    aria-label="Invite role"
                    value={inviteRole}
                    disabled={disabled}
                    onChange={(e) =>
                      setInviteRole(
                        e.target.value === "viewer" ? "viewer" : "editor",
                      )
                    }
                  >
                    <option value="editor">Editor (can add/edit)</option>
                    <option value="viewer">Viewer (read-only)</option>
                  </select>
                  <button
                    type="button"
                    className="secondary"
                    disabled={disabled}
                    onClick={() => handleGenerateInvite(hh.id)}
                  >
                    <UserPlus size={14} /> Generate invite code
                  </button>
                </div>
              )}

              {canShare && accounts.length > 0 && (
                <div>
                  <div className="household-section-label">Shared accounts</div>
                  <div className="household-share-list">
                    {accounts
                      .filter(
                        (a) => !a.household_id || a.household_id === hh.id,
                      )
                      .map((a) => {
                        const isShared = a.household_id === hh.id;
                        return (
                          <div className="household-share-item" key={a.id}>
                            <label>
                              <input
                                type="checkbox"
                                checked={isShared}
                                disabled={disabled}
                                onChange={() => toggleAccount(a, hh.id)}
                              />
                              <span>
                                {a.emoji ? `${a.emoji} ` : ""}
                                {a.name}
                              </span>
                            </label>
                            {isShared && (
                              <span className="shared-badge">Shared</span>
                            )}
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}

              {canShare && budgets.length > 0 && onToggleBudgetShare && (
                <div>
                  <div className="household-section-label">Shared budgets</div>
                  <div className="household-share-list">
                    {budgets
                      .filter(
                        (b) => !b.household_id || b.household_id === hh.id,
                      )
                      .map((b) => {
                        const isShared = b.household_id === hh.id;
                        const cat = categoryById.get(b.category_id);
                        return (
                          <div className="household-share-item" key={b.id}>
                            <label>
                              <input
                                type="checkbox"
                                checked={isShared}
                                disabled={disabled}
                                onChange={() => toggleBudget(b, hh.id)}
                              />
                              <span>
                                {cat ? `${cat.emoji ?? ""} ${cat.name}` : "Budget"}
                              </span>
                            </label>
                            {isShared && (
                              <span className="shared-badge">Shared</span>
                            )}
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>
          );
        })}

      {supported && (
        <div className="household-forms">
          {households.length === 0 && (
            <form
              className="household-inline-form"
              onSubmit={handleCreateHousehold}
            >
              <input
                type="text"
                placeholder="New household name (e.g. Home)"
                aria-label="New household name"
                maxLength={80}
                value={newName}
                disabled={disabled}
                onChange={(e) => setNewName(e.target.value)}
              />
              <button
                type="submit"
                className="secondary"
                disabled={disabled || !newName.trim()}
              >
                <Plus size={14} /> Create household
              </button>
            </form>
          )}
          <form
            className="household-inline-form"
            onSubmit={handleJoinHousehold}
          >
            <input
              type="text"
              placeholder="Enter invite code to join"
              aria-label="Household invite code"
              maxLength={32}
              value={joinCode}
              disabled={disabled}
              onChange={(e) => setJoinCode(e.target.value)}
            />
            <button
              type="submit"
              className="secondary"
              disabled={disabled || !joinCode.trim()}
            >
              Join household
            </button>
          </form>
        </div>
      )}
    </section>
  );
}
