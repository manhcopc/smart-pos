import type {
  PosCatalogCategorySummary,
  PosCatalogItem,
  PosCatalogSyncResponse,
} from "@smart-pos/shared";

const DB_NAME = "smartpos_pos_cache_v1";
const DB_VERSION = 1;
const STORE_NAME = "branch_catalogs";

export interface CachedPosCatalog {
  cacheKey: string;
  tenantId: string;
  branchId: string;
  serverTimestamp: string;
  categories: PosCatalogCategorySummary[];
  items: PosCatalogItem[];
}

const memoryFallback = new Map<string, CachedPosCatalog>();

export function buildCatalogCacheKey(
  tenantId: string,
  branchId: string,
): string {
  return `${tenantId}:${branchId}`;
}

function openCatalogDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "cacheKey" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function readCachedPosCatalog(
  tenantId: string,
  branchId: string,
): Promise<CachedPosCatalog | null> {
  const key = buildCatalogCacheKey(tenantId, branchId);
  const db = await openCatalogDb();
  if (!db) {
    return memoryFallback.get(key) ?? null;
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => {
        db.close();
        resolve((req.result as CachedPosCatalog | undefined) ?? null);
      };
      req.onerror = () => {
        db.close();
        resolve(memoryFallback.get(key) ?? null);
      };
    } catch {
      db.close();
      resolve(memoryFallback.get(key) ?? null);
    }
  });
}

export async function writeCachedPosCatalog(
  snapshot: CachedPosCatalog,
): Promise<void> {
  memoryFallback.set(snapshot.cacheKey, snapshot);
  const db = await openCatalogDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.put(snapshot);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

export function mergePosCatalogDelta(
  tenantId: string,
  existing: CachedPosCatalog | null,
  syncPayload: PosCatalogSyncResponse,
): CachedPosCatalog {
  const byVariantId = new Map<string, PosCatalogItem>();

  if (!syncPayload.fullSync && existing) {
    for (const item of existing.items) {
      byVariantId.set(item.variantId, item);
    }
  }

  for (const incoming of syncPayload.items) {
    if (incoming.isActive) {
      byVariantId.set(incoming.variantId, incoming);
    } else {
      byVariantId.delete(incoming.variantId);
    }
  }

  return {
    cacheKey: buildCatalogCacheKey(tenantId, syncPayload.branchId),
    tenantId,
    branchId: syncPayload.branchId,
    serverTimestamp: syncPayload.serverTimestamp,
    categories: syncPayload.categories,
    items: Array.from(byVariantId.values()),
  };
}

export function applyPosStockPatch(
  snapshot: CachedPosCatalog,
  updates: ReadonlyArray<{ variantId: string; onHand: string; available: string }>,
): CachedPosCatalog {
  if (updates.length === 0) return snapshot;
  const updateMap = new Map(updates.map((u) => [u.variantId, u]));
  return {
    ...snapshot,
    items: snapshot.items.map((item) => {
      const patch = updateMap.get(item.variantId);
      return patch
        ? { ...item, onHand: patch.onHand, available: patch.available }
        : item;
    }),
  };
}

/**
 * Local in-memory / IndexedDB-backed search optimized for <50ms POS scanner lookup.
 * Prioritizes exact barcode & SKU hits before substring matches.
 */
export function searchPosCatalog(
  items: readonly PosCatalogItem[],
  options: { query?: string; categoryId?: string | null; limit?: number },
): PosCatalogItem[] {
  const limit = options.limit ?? 60;
  const normalized = (options.query ?? "").trim().toLowerCase();
  const categoryId = options.categoryId;

  const activeItems = categoryId
    ? items.filter((item) => item.categoryId === categoryId)
    : items;

  if (!normalized) {
    return activeItems.slice(0, limit);
  }

  const exactMatches: PosCatalogItem[] = [];
  const partialMatches: PosCatalogItem[] = [];

  for (const item of activeItems) {
    const skuLower = item.sku.toLowerCase();
    const barcodeLower = item.barcode?.toLowerCase() ?? "";

    if (barcodeLower === normalized || skuLower === normalized) {
      exactMatches.push(item);
      continue;
    }

    if (
      skuLower.includes(normalized) ||
      barcodeLower.includes(normalized) ||
      item.productName.toLowerCase().includes(normalized) ||
      item.variantName.toLowerCase().includes(normalized)
    ) {
      partialMatches.push(item);
    }
  }

  return [...exactMatches, ...partialMatches].slice(0, limit);
}
