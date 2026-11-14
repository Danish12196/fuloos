import type {
  Account,
  Budget,
  Household,
  HouseholdMember,
  HouseholdRole,
} from "./domain.ts";

export const HOUSEHOLD_ROLE_LABELS: Record<HouseholdRole, string> = {
  owner: "Owner",
  editor: "Editor",
  viewer: "Viewer",
};

export function validateHouseholdName(raw: string): string {
  const name = raw.trim();
  if (!name) throw new Error("Enter a household name.");
  if (name.length > 80) {
    throw new Error("Household name must be 80 characters or fewer.");
  }
  return name;
}

export function normalizeInviteCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isSharedRecord(record: { household_id?: string | null }): boolean {
  return Boolean(record.household_id && record.household_id.trim());
}

export function canEditHouseholdRole(
  role: HouseholdRole | null | undefined,
): boolean {
  return role === "owner" || role === "editor";
}

export function userRoleInHousehold(
  members: HouseholdMember[],
  householdId: string,
  userId: string,
  ownerId?: string,
): HouseholdRole | null {
  if (ownerId && ownerId === userId) return "owner";
  const match = members.find(
    (m) =>
      m.household_id === householdId &&
      m.user_id === userId &&
      m.status === "active",
  );
  return match ? match.role : null;
}

export function householdMembersFor(
  members: HouseholdMember[],
  householdId: string,
): HouseholdMember[] {
  const rank = (m: HouseholdMember) => {
    if (m.status === "pending") return 3;
    if (m.role === "owner") return 0;
    if (m.role === "editor") return 1;
    return 2;
  };
  return members
    .filter((m) => m.household_id === householdId)
    .slice()
    .sort((a, b) => rank(a) - rank(b));
}

export function sharedAccountCount(
  accounts: Account[],
  householdId: string,
): number {
  return accounts.filter((a) => a.household_id === householdId).length;
}

export function sharedBudgetCount(
  budgets: Budget[],
  householdId: string,
): number {
  return budgets.filter((b) => b.household_id === householdId).length;
}

export function generateDemoInviteCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export interface DemoHouseholdStore {
  households: Household[];
  members: HouseholdMember[];
}

export function createDemoHouseholdState(): DemoHouseholdStore {
  return { households: [], members: [] };
}
