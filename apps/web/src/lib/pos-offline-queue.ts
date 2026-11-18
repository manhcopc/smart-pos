import {
  calculatePosInvoiceTotals,
  type CreateInvoiceInput,
  formatMoney,
  formatQuantity,
  type InvoiceReceiptResponse,
  type OfflineSyncLatestStockInfo,
  parseMoney,
  parseQuantity,
} from "@smart-pos/shared";
import { applyPosStockPatch, type CachedPosCatalog } from "./pos-indexeddb";

const QUEUE_DB_NAME = "smartpos_offline_queue_v1";
const QUEUE_DB_VERSION = 1;
const QUEUE_STORE_NAME = "offline_invoices";

export interface QueuedOfflineItemSummary {
  variantId: string;
  sku: string;
  name: string;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  taxRate: string;
  lineTotal: string;
}

export interface QueuedOfflineInvoice {
  idempotencyKey: string;
  tenantId: string;
  branchId: string;
  shiftId: string;
  queuedAt: string;
  localReceiptCode: string;
  customerName: string | null;
  subtotal: string;
  discountAmount: string;
  taxAmount: string;
  totalAmount: string;
  paidAmount: string;
  changeGiven: string;
  itemSummaries: QueuedOfflineItemSummary[];
  status: "PENDING" | "CONFLICT" | "FAILED";
  errorCode?: string;
  errorMessage?: string;
  latestStock?: OfflineSyncLatestStockInfo[];
  payload: CreateInvoiceInput;
}

const memoryQueue = new Map<string, QueuedOfflineInvoice>();

function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined" && indexedDB !== null;
}

function openQueueDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(QUEUE_DB_NAME, QUEUE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(QUEUE_STORE_NAME)) {
        db.createObjectStore(QUEUE_STORE_NAME, { keyPath: "idempotencyKey" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB queue open error"));
  });
}

export async function readOfflineInvoiceQueue(
  tenantId: string,
  branchId?: string,
): Promise<QueuedOfflineInvoice[]> {
  let allEntries: QueuedOfflineInvoice[];

  if (!hasIndexedDb()) {
    allEntries = Array.from(memoryQueue.values());
  } else {
    try {
      const db = await openQueueDatabase();
      allEntries = await new Promise<QueuedOfflineInvoice[]>((resolve, reject) => {
        const tx = db.transaction(QUEUE_STORE_NAME, "readonly");
        const store = tx.objectStore(QUEUE_STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () =>
          resolve((req.result as QueuedOfflineInvoice[] | undefined) ?? []);
        req.onerror = () =>
          reject(req.error ?? new Error("IndexedDB read error"));
      });
    } catch {
      allEntries = Array.from(memoryQueue.values());
    }
  }

  return allEntries
    .filter(
      (entry) =>
        entry.tenantId === tenantId &&
        (!branchId || entry.branchId === branchId),
    )
    .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
}

export async function enqueueOfflineInvoice(
  entry: QueuedOfflineInvoice,
): Promise<void> {
  memoryQueue.set(entry.idempotencyKey, entry);
  if (!hasIndexedDb()) return;

  try {
    const db = await openQueueDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(QUEUE_STORE_NAME, "readwrite");
      const store = tx.objectStore(QUEUE_STORE_NAME);
      const req = store.put(entry);
      req.onsuccess = () => resolve();
      req.onerror = () =>
        reject(req.error ?? new Error("IndexedDB write error"));
    });
  } catch {
    // Keep in-memory queue intact if browser storage quota rejects.
  }
}

export async function updateOfflineInvoiceQueueEntry(
  idempotencyKey: string,
  patch: Partial<QueuedOfflineInvoice>,
): Promise<void> {
  const existingMem = memoryQueue.get(idempotencyKey);
  if (existingMem) {
    memoryQueue.set(idempotencyKey, { ...existingMem, ...patch });
  }

  if (!hasIndexedDb()) return;

  try {
    const db = await openQueueDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(QUEUE_STORE_NAME, "readwrite");
      const store = tx.objectStore(QUEUE_STORE_NAME);
      const getReq = store.get(idempotencyKey);
      getReq.onsuccess = () => {
        const current = getReq.result as QueuedOfflineInvoice | undefined;
        if (!current) {
          resolve();
          return;
        }
        const merged = { ...current, ...patch };
        memoryQueue.set(idempotencyKey, merged);
        const putReq = store.put(merged);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () =>
          reject(putReq.error ?? new Error("IndexedDB update error"));
      };
      getReq.onerror = () =>
        reject(getReq.error ?? new Error("IndexedDB read error"));
    });
  } catch {
    // Ignore storage error cleanly.
  }
}

export async function removeOfflineInvoiceFromQueue(
  idempotencyKey: string,
): Promise<void> {
  memoryQueue.delete(idempotencyKey);
  if (!hasIndexedDb()) return;

  try {
    const db = await openQueueDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(QUEUE_STORE_NAME, "readwrite");
      const store = tx.objectStore(QUEUE_STORE_NAME);
      const req = store.delete(idempotencyKey);
      req.onsuccess = () => resolve();
      req.onerror = () =>
        reject(req.error ?? new Error("IndexedDB delete error"));
    });
  } catch {
    // Ignore cleanly.
  }
}

export async function clearOfflineInvoiceQueue(): Promise<void> {
  memoryQueue.clear();
  if (!hasIndexedDb()) return;

  try {
    const db = await openQueueDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(QUEUE_STORE_NAME, "readwrite");
      const store = tx.objectStore(QUEUE_STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () =>
        reject(req.error ?? new Error("IndexedDB clear error"));
    });
  } catch {
    // Ignore cleanly.
  }
}

/**
 * Optimistically decrements cached local branch stock when an invoice is queued offline.
 */
export function applyLocalOfflineSale(
  catalog: CachedPosCatalog,
  soldItems: ReadonlyArray<{ variantId: string; quantity: string }>,
): CachedPosCatalog {
  const soldByVariant = new Map<string, bigint>();
  for (const item of soldItems) {
    const q = parseQuantity(item.quantity);
    soldByVariant.set(
      item.variantId,
      (soldByVariant.get(item.variantId) ?? 0n) + q,
    );
  }

  const patches: Array<{ variantId: string; onHand: string; available: string }> =
    [];
  for (const catalogItem of catalog.items) {
    const dec = soldByVariant.get(catalogItem.variantId);
    if (!dec) continue;
    const prevOnHand = parseQuantity(catalogItem.onHand);
    const prevAvail = parseQuantity(catalogItem.available);
    const nextOnHand = prevOnHand > dec ? prevOnHand - dec : 0n;
    const nextAvail = prevAvail > dec ? prevAvail - dec : 0n;
    patches.push({
      variantId: catalogItem.variantId,
      onHand: formatQuantity(nextOnHand),
      available: formatQuantity(nextAvail),
    });
  }

  return patches.length > 0 ? applyPosStockPatch(catalog, patches) : catalog;
}

export function buildOfflineQueueEntry(params: {
  tenantId: string;
  customerName: string | null;
  payload: CreateInvoiceInput;
  itemSummaries: QueuedOfflineItemSummary[];
}): QueuedOfflineInvoice {
  const totals = calculatePosInvoiceTotals({
    lines: params.itemSummaries.map((item) => ({
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discountAmount: item.discountAmount,
      taxRate: item.taxRate,
    })),
    invoiceDiscountAmount: params.payload.discountAmount ?? "0.00",
    payments: params.payload.payments,
  });

  return {
    idempotencyKey: params.payload.idempotencyKey,
    tenantId: params.tenantId,
    branchId: params.payload.branchId,
    shiftId: params.payload.shiftId,
    queuedAt: new Date().toISOString(),
    localReceiptCode: `OFF-${params.payload.idempotencyKey.slice(0, 6).toUpperCase()}`,
    customerName: params.customerName,
    subtotal: totals.formatted.subtotal,
    discountAmount: totals.formatted.discountAmount,
    taxAmount: totals.formatted.taxAmount,
    totalAmount: totals.formatted.totalAmount,
    paidAmount: totals.formatted.paidTendered,
    changeGiven: totals.formatted.changeDue,
    itemSummaries: params.itemSummaries.map((item) => ({
      ...item,
      lineTotal: formatMoney(
        (parseMoney(item.unitPrice) * parseQuantity(item.quantity)) / 1000n -
          parseMoney(item.discountAmount),
      ),
    })),
    status: "PENDING",
    payload: {
      ...params.payload,
      syncSource: "OFFLINE_SYNC",
    },
  };
}

export function buildLocalOfflineReceipt(
  entry: QueuedOfflineInvoice,
  branchCode: string,
  branchName: string,
  cashierMemberId: string,
  cashierName: string,
): InvoiceReceiptResponse {
  return {
    id: entry.idempotencyKey,
    code: `${entry.localReceiptCode} (Offline)`,
    idempotencyKey: entry.idempotencyKey,
    branchId: entry.branchId,
    branchCode,
    branchName,
    shiftId: entry.shiftId,
    cashierMemberId,
    cashierName,
    customerId: entry.payload.customerId ?? null,
    customerName: entry.customerName,
    status: "PENDING_OFFLINE_SYNC",
    subtotal: entry.subtotal,
    discountAmount: entry.discountAmount,
    taxAmount: entry.taxAmount,
    totalAmount: entry.totalAmount,
    paidAmount: entry.paidAmount,
    changeGiven: entry.changeGiven,
    createdAt: entry.queuedAt,
    items: entry.itemSummaries.map((item, idx) => ({
      id: `${entry.idempotencyKey}-line-${idx}`,
      variantId: item.variantId,
      productName: item.name,
      sku: item.sku,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discountAmount: item.discountAmount,
      taxAmount: "0.00",
      lineTotal: item.lineTotal,
    })),
    payments: entry.payload.payments.map((p, idx) => ({
      id: `${entry.idempotencyKey}-pay-${idx}`,
      method: p.method,
      amount: p.amount,
      referenceNo: p.referenceNo ?? null,
      paidAt: entry.queuedAt,
    })),
  };
}
