import type { Role } from "@smart-pos/shared";

export type DataMode = "mock" | "real";

const DATA_MODE_STORAGE_KEY = "smartpos_data_mode";
const MOCK_ROLE_STORAGE_KEY = "smartpos_mock_role";
const DATA_MODE_EVENT = "smartpos:data-mode-change";

const VALID_ROLES = new Set<Role>(["OWNER", "MANAGER", "CASHIER", "WAREHOUSE"]);

let memoryDataModeOverride: DataMode | null = null;
let memoryMockRole: Role = "OWNER";

function safeStorageGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const ls = window.localStorage;
    if (ls && typeof ls.getItem === "function") {
      return ls.getItem(key);
    }
  } catch {
    // Ignore storage access restrictions safely.
  }
  return null;
}

function safeStorageSet(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    const ls = window.localStorage;
    if (ls && typeof ls.setItem === "function") {
      ls.setItem(key, value);
    }
  } catch {
    // Ignore cleanly.
  }
}

function safeStorageRemove(key: string): void {
  if (typeof window === "undefined") return;
  try {
    const ls = window.localStorage;
    if (ls && typeof ls.removeItem === "function") {
      ls.removeItem(key);
    }
  } catch {
    // Ignore cleanly.
  }
}

export function getDefaultEnvDataMode(): DataMode {
  return process.env.NEXT_PUBLIC_DATA_MODE?.trim().toLowerCase() === "mock"
    ? "mock"
    : "real";
}

export function getDataMode(): DataMode {
  const saved = safeStorageGet(DATA_MODE_STORAGE_KEY);
  if (saved === "mock" || saved === "real") {
    return saved;
  }
  if (memoryDataModeOverride !== null) {
    return memoryDataModeOverride;
  }
  return getDefaultEnvDataMode();
}

export function isMockDataMode(): boolean {
  return getDataMode() === "mock";
}

export function setDataMode(mode: DataMode): void {
  memoryDataModeOverride = mode;
  safeStorageSet(DATA_MODE_STORAGE_KEY, mode);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(DATA_MODE_EVENT, { detail: { mode } }));
  }
}

export function clearDataModeOverride(): void {
  memoryDataModeOverride = null;
  safeStorageRemove(DATA_MODE_STORAGE_KEY);
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(DATA_MODE_EVENT, {
        detail: { mode: getDefaultEnvDataMode() },
      }),
    );
  }
}

export function getMockRole(): Role {
  const saved = safeStorageGet(MOCK_ROLE_STORAGE_KEY) as Role | null;
  if (saved && VALID_ROLES.has(saved)) {
    return saved;
  }
  return memoryMockRole;
}

export function setMockRole(role: Role): void {
  memoryMockRole = role;
  safeStorageSet(MOCK_ROLE_STORAGE_KEY, role);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(DATA_MODE_EVENT, { detail: { role } }));
  }
}

export function subscribeDataModeChange(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const onStorage = (e: StorageEvent) => {
    if (
      e.key === DATA_MODE_STORAGE_KEY ||
      e.key === MOCK_ROLE_STORAGE_KEY
    ) {
      listener();
    }
  };
  const onCustom = () => listener();
  window.addEventListener("storage", onStorage);
  window.addEventListener(DATA_MODE_EVENT, onCustom);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(DATA_MODE_EVENT, onCustom);
  };
}
