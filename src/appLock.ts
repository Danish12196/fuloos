export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface AppLockConfig {
  userId: string;
  salt: string;
  hash: string;
  iterations: number;
  idleMinutes: number;
  lockOnReopen: boolean;
}

export const MAX_PIN_ATTEMPTS = 5;
export const PBKDF2_ITERATIONS = 100_000;

const LOCK_KEY_PREFIX = "fuloos.applock.v1.";
const ATTEMPTS_KEY_PREFIX = "fuloos.applock.attempts.v1.";
const IDLE_SIGNOUT_KEY_PREFIX = "fuloos.idle_signout.v1.";

function lockKey(userId: string): string {
  return `${LOCK_KEY_PREFIX}${userId}`;
}

function attemptsKey(userId: string): string {
  return `${ATTEMPTS_KEY_PREFIX}${userId}`;
}

function idleSignOutKey(userId: string): string {
  return `${IDLE_SIGNOUT_KEY_PREFIX}${userId}`;
}

export function isValidPin(pin: string): boolean {
  return /^\d{4,8}$/.test(pin);
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

export function generateSalt(length = 16): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return toBase64(bytes);
}

export async function hashPin(
  pin: string,
  saltB64: string,
  iterations = PBKDF2_ITERATIONS,
): Promise<string> {
  if (!isValidPin(pin)) {
    throw new Error("PIN must be 4 to 8 digits.");
  }
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const saltBytes = fromBase64(saltB64);
  const saltBuffer = new Uint8Array(saltBytes).buffer;
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBuffer,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );
  return toBase64(new Uint8Array(bits));
}

export async function createAppLockConfig(
  userId: string,
  pin: string,
  idleMinutes: number,
  lockOnReopen: boolean,
): Promise<AppLockConfig> {
  const salt = generateSalt();
  const iterations = PBKDF2_ITERATIONS;
  const hash = await hashPin(pin, salt, iterations);
  return {
    userId,
    salt,
    hash,
    iterations,
    idleMinutes: Math.max(0, Math.floor(idleMinutes)),
    lockOnReopen,
  };
}

export async function verifyPin(
  pin: string,
  config: AppLockConfig,
): Promise<boolean> {
  if (!isValidPin(pin)) return false;
  try {
    const candidate = await hashPin(pin, config.salt, config.iterations);
    return constantTimeEqual(fromBase64(candidate), fromBase64(config.hash));
  } catch {
    return false;
  }
}

export function loadAppLock(
  storage: StorageLike | undefined,
  userId: string,
): AppLockConfig | null {
  if (!storage || !userId) return null;
  try {
    const raw = storage.getItem(lockKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AppLockConfig>;
    if (
      parsed.userId !== userId ||
      typeof parsed.salt !== "string" ||
      typeof parsed.hash !== "string" ||
      typeof parsed.iterations !== "number" ||
      parsed.iterations < 10_000
    ) {
      return null;
    }
    return {
      userId,
      salt: parsed.salt,
      hash: parsed.hash,
      iterations: parsed.iterations,
      idleMinutes:
        typeof parsed.idleMinutes === "number" && parsed.idleMinutes >= 0
          ? Math.floor(parsed.idleMinutes)
          : 5,
      lockOnReopen: Boolean(parsed.lockOnReopen),
    };
  } catch {
    return null;
  }
}

export function saveAppLock(
  storage: StorageLike | undefined,
  config: AppLockConfig,
): void {
  if (!storage) return;
  try {
    storage.setItem(lockKey(config.userId), JSON.stringify(config));
  } catch {
    /* Ignore storage quota errors. */
  }
}

export function clearAppLock(
  storage: StorageLike | undefined,
  userId: string,
): void {
  if (!storage || !userId) return;
  try {
    storage.removeItem(lockKey(userId));
    storage.removeItem(attemptsKey(userId));
  } catch {
    /* Ignore storage errors. */
  }
}

export function getFailedAttempts(
  storage: StorageLike | undefined,
  userId: string,
): number {
  if (!storage || !userId) return 0;
  try {
    const raw = storage.getItem(attemptsKey(userId));
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

export function recordFailedAttempt(
  storage: StorageLike | undefined,
  userId: string,
): { attempts: number; lockedOut: boolean } {
  const attempts = getFailedAttempts(storage, userId) + 1;
  if (storage && userId) {
    try {
      storage.setItem(attemptsKey(userId), String(attempts));
    } catch {
      /* Ignore storage errors. */
    }
  }
  return { attempts, lockedOut: attempts >= MAX_PIN_ATTEMPTS };
}

export function resetFailedAttempts(
  storage: StorageLike | undefined,
  userId: string,
): void {
  if (!storage || !userId) return;
  try {
    storage.removeItem(attemptsKey(userId));
  } catch {
    /* Ignore storage errors. */
  }
}

export function loadIdleSessionTimeout(
  storage: StorageLike | undefined,
  userId: string,
): number {
  if (!storage || !userId) return 0;
  try {
    const raw = storage.getItem(idleSignOutKey(userId));
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

export function saveIdleSessionTimeout(
  storage: StorageLike | undefined,
  userId: string,
  minutes: number,
): void {
  if (!storage || !userId) return;
  try {
    if (minutes <= 0) {
      storage.removeItem(idleSignOutKey(userId));
    } else {
      storage.setItem(idleSignOutKey(userId), String(Math.floor(minutes)));
    }
  } catch {
    /* Ignore storage errors. */
  }
}

export function shouldLockForIdle(
  lastActiveMs: number,
  nowMs: number,
  idleMinutes: number,
): boolean {
  if (idleMinutes <= 0) return false;
  return nowMs - lastActiveMs >= idleMinutes * 60_000;
}

export function shouldSignOutForIdle(
  lastActiveMs: number,
  nowMs: number,
  timeoutMinutes: number,
): boolean {
  if (timeoutMinutes <= 0) return false;
  return nowMs - lastActiveMs >= timeoutMinutes * 60_000;
}
