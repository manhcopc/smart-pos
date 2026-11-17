import {
  calculateLineSubtotal,
  calculatePercentAmount,
  formatMoney,
  parseMoney,
  parseQuantity,
} from "./money";
import type { PaymentMethod } from "./schemas/pos";

export class PosMathError extends Error {
  readonly code:
    | "INVALID_DISCOUNT"
    | "PAYMENT_UNDERPAID"
    | "NON_CASH_OVERPAYMENT"
    | "EMPTY_CART";

  constructor(
    code:
      | "INVALID_DISCOUNT"
      | "PAYMENT_UNDERPAID"
      | "NON_CASH_OVERPAYMENT"
      | "EMPTY_CART",
    message: string,
  ) {
    super(message);
    this.name = "PosMathError";
    this.code = code;
  }
}

export interface PosLineCalculationInput {
  quantity: string | number;
  unitPrice: string | number;
  discountAmount?: string | number;
  taxRate?: string | number;
}

export interface PosLineCalculationResult {
  quantityMilli: bigint;
  unitPriceMinor: bigint;
  grossMinor: bigint;
  discountMinor: bigint;
  netBeforeTaxMinor: bigint;
  taxMinor: bigint;
  lineTotalMinor: bigint;
}

export interface PosPaymentInput {
  method: PaymentMethod;
  amount: string | number;
}

export interface PosTotalsCalculationResult {
  lines: PosLineCalculationResult[];
  subtotalMinor: bigint;
  lineDiscountTotalMinor: bigint;
  invoiceDiscountMinor: bigint;
  discountTotalMinor: bigint;
  taxTotalMinor: bigint;
  totalAmountMinor: bigint;
  paidTenderedMinor: bigint;
  cashTenderedMinor: bigint;
  nonCashTenderedMinor: bigint;
  changeDueMinor: bigint;
  netCashReceivedMinor: bigint;
  settledByMethodMinor: Record<PaymentMethod, bigint>;
  formatted: {
    subtotal: string;
    discountAmount: string;
    taxAmount: string;
    totalAmount: string;
    paidTendered: string;
    changeDue: string;
    netCashReceived: string;
  };
}

/**
 * Pure fixed-point POS line calculation:
 * gross = round_half_up(qty * unitPrice)
 * lineTax = round_half_up((gross - lineDiscount) * taxRate / 100)
 * lineTotal = (gross - lineDiscount) + lineTax
 */
export function calculatePosLine(
  input: PosLineCalculationInput,
): PosLineCalculationResult {
  const quantityMilli = parseQuantity(input.quantity);
  const unitPriceMinor = parseMoney(input.unitPrice);
  const discountMinor = parseMoney(input.discountAmount ?? "0.00");

  const grossMinor = calculateLineSubtotal(quantityMilli, unitPriceMinor);
  if (discountMinor < 0n || discountMinor > grossMinor) {
    throw new PosMathError(
      "INVALID_DISCOUNT",
      "Chiết khấu dòng hàng không được vượt quá thành tiền dòng",
    );
  }

  const netBeforeTaxMinor = grossMinor - discountMinor;
  const taxMinor = calculatePercentAmount(
    netBeforeTaxMinor,
    input.taxRate ?? "0.00",
  );
  const lineTotalMinor = netBeforeTaxMinor + taxMinor;

  return {
    quantityMilli,
    unitPriceMinor,
    grossMinor,
    discountMinor,
    netBeforeTaxMinor,
    taxMinor,
    lineTotalMinor,
  };
}

/**
 * Pure fixed-point POS checkout calculation covering line discounts, VAT,
 * invoice-level discount, split payments, cash change, and net cash drawer retention.
 */
export function calculatePosInvoiceTotals(params: {
  lines: readonly PosLineCalculationInput[];
  invoiceDiscountAmount?: string | number;
  payments: readonly PosPaymentInput[];
}): PosTotalsCalculationResult {
  if (params.lines.length === 0) {
    throw new PosMathError("EMPTY_CART", "Hóa đơn phải có ít nhất 1 sản phẩm");
  }

  const lines = params.lines.map((line) => calculatePosLine(line));

  let subtotalMinor = 0n;
  let lineDiscountTotalMinor = 0n;
  let taxTotalMinor = 0n;
  let linesTotalMinor = 0n;

  for (const line of lines) {
    subtotalMinor += line.grossMinor;
    lineDiscountTotalMinor += line.discountMinor;
    taxTotalMinor += line.taxMinor;
    linesTotalMinor += line.lineTotalMinor;
  }

  const invoiceDiscountMinor = parseMoney(
    params.invoiceDiscountAmount ?? "0.00",
  );
  if (invoiceDiscountMinor < 0n || invoiceDiscountMinor > linesTotalMinor) {
    throw new PosMathError(
      "INVALID_DISCOUNT",
      "Chiết khấu hóa đơn không được vượt quá tổng tiền sau thuế",
    );
  }

  const discountTotalMinor = lineDiscountTotalMinor + invoiceDiscountMinor;
  const totalAmountMinor = linesTotalMinor - invoiceDiscountMinor;

  let cashTenderedMinor = 0n;
  let nonCashTenderedMinor = 0n;

  const settledByMethodMinor: Record<PaymentMethod, bigint> = {
    CASH: 0n,
    BANK_TRANSFER_QR: 0n,
    CARD: 0n,
    LOYALTY_POINTS: 0n,
    STORE_CREDIT: 0n,
  };

  for (const payment of params.payments) {
    const amountMinor = parseMoney(payment.amount);
    if (payment.method === "CASH") {
      cashTenderedMinor += amountMinor;
    } else {
      nonCashTenderedMinor += amountMinor;
      settledByMethodMinor[payment.method] += amountMinor;
    }
  }

  if (nonCashTenderedMinor > totalAmountMinor) {
    throw new PosMathError(
      "NON_CASH_OVERPAYMENT",
      "Thanh toán chuyển khoản/thẻ không được vượt quá tổng hóa đơn",
    );
  }

  const paidTenderedMinor = cashTenderedMinor + nonCashTenderedMinor;
  if (paidTenderedMinor < totalAmountMinor) {
    throw new PosMathError(
      "PAYMENT_UNDERPAID",
      "Số tiền khách thanh toán chưa đủ tổng giá trị hóa đơn",
    );
  }

  const changeDueMinor = paidTenderedMinor - totalAmountMinor;
  const netCashReceivedMinor = cashTenderedMinor - changeDueMinor;
  settledByMethodMinor.CASH = netCashReceivedMinor;

  return {
    lines,
    subtotalMinor,
    lineDiscountTotalMinor,
    invoiceDiscountMinor,
    discountTotalMinor,
    taxTotalMinor,
    totalAmountMinor,
    paidTenderedMinor,
    cashTenderedMinor,
    nonCashTenderedMinor,
    changeDueMinor,
    netCashReceivedMinor,
    settledByMethodMinor,
    formatted: {
      subtotal: formatMoney(subtotalMinor),
      discountAmount: formatMoney(discountTotalMinor),
      taxAmount: formatMoney(taxTotalMinor),
      totalAmount: formatMoney(totalAmountMinor),
      paidTendered: formatMoney(paidTenderedMinor),
      changeDue: formatMoney(changeDueMinor),
      netCashReceived: formatMoney(netCashReceivedMinor),
    },
  };
}
