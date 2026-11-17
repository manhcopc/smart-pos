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

/** 1 loyalty point earned per 10,000 VND paid (excluding loyalty point redemption); 1 point = 1,000 VND. */
export const LOYALTY_EARN_STEP_MINOR = 1_000_000n;
export const LOYALTY_POINT_VALUE_MINOR = 100_000n;

export function calculateLoyaltyPointsEarned(eligiblePaidMinor: bigint): number {
  if (eligiblePaidMinor <= 0n) return 0;
  return Number(eligiblePaidMinor / LOYALTY_EARN_STEP_MINOR);
}

export function calculateLoyaltyPointsRequired(redeemAmountMinor: bigint): number {
  if (redeemAmountMinor <= 0n) return 0;
  if (redeemAmountMinor % LOYALTY_POINT_VALUE_MINOR !== 0n) {
    throw new PosMathError(
      "PAYMENT_UNDERPAID",
      "Số tiền thanh toán bằng điểm thưởng phải là bội số của 1.000 ₫",
    );
  }
  return Number(redeemAmountMinor / LOYALTY_POINT_VALUE_MINOR);
}

export interface ReturnLineInput {
  invoiceItemId: string;
  originalQuantity: string | number;
  previouslyReturnedQuantity: string | number;
  returnQuantity: string | number;
  lineTotal: string | number;
  lineTaxAmount: string | number;
  unitCostSnapshot: string | number;
}

export interface ComputedReturnLine {
  invoiceItemId: string;
  returnQtyMilli: bigint;
  refundAmountMinor: bigint;
  netRevenueReversalMinor: bigint;
  cogsReversalMinor: bigint;
}

export interface ComputedSalesReturnTotals {
  lines: ComputedReturnLine[];
  totalRefundMinor: bigint;
  totalNetRevenueReversalMinor: bigint;
  totalCogsReversalMinor: bigint;
}

function roundHalfUpRatio(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n || numerator <= 0n) return 0n;
  return (numerator * 2n + denominator) / (2n * denominator);
}

/**
 * Compute proportional sales return totals across invoice items using fixed-point integer math.
 * Caps refunds cleanly against remaining invoice balance when returning remaining units,
 * accounting for invoice-level discounts proportionally by line total.
 */
export function calculateSalesReturnTotals(params: {
  invoiceSubtotalAfterLineDiscountAndTaxMinor: bigint;
  invoiceTotalMinor: bigint;
  priorRefundedTotalMinor: bigint;
  lines: readonly ReturnLineInput[];
}): ComputedSalesReturnTotals {
  if (params.lines.length === 0) {
    throw new PosMathError("EMPTY_CART", "Phiếu trả hàng phải có ít nhất 1 dòng");
  }

  const maxRefundableRemaining =
    params.invoiceTotalMinor > params.priorRefundedTotalMinor
      ? params.invoiceTotalMinor - params.priorRefundedTotalMinor
      : 0n;

  const scaleDenom =
    params.invoiceSubtotalAfterLineDiscountAndTaxMinor > 0n
      ? params.invoiceSubtotalAfterLineDiscountAndTaxMinor
      : 1n;

  let totalRefundMinor = 0n;
  let totalNetRevenueReversalMinor = 0n;
  let totalCogsReversalMinor = 0n;

  const computed: ComputedReturnLine[] = params.lines.map((line) => {
    const origQtyMilli = parseQuantity(line.originalQuantity);
    const prevReturnedMilli = parseQuantity(line.previouslyReturnedQuantity);
    const returnQtyMilli = parseQuantity(line.returnQuantity);
    const lineTotalMinor = parseMoney(line.lineTotal);
    const lineTaxMinor = parseMoney(line.lineTaxAmount);
    const unitCostMinor = parseMoney(line.unitCostSnapshot);

    if (returnQtyMilli <= 0n || prevReturnedMilli + returnQtyMilli > origQtyMilli) {
      throw new PosMathError(
        "INVALID_DISCOUNT",
        "Số lượng hoàn trả vượt quá số lượng còn lại trên hóa đơn",
      );
    }

    // Share of invoice total attributable to this item after any invoice-level discount
    const allocatedLineTotalMinor = roundHalfUpRatio(
      lineTotalMinor * params.invoiceTotalMinor,
      scaleDenom,
    );
    const netBeforeTaxAllocatedMinor =
      allocatedLineTotalMinor > lineTaxMinor
        ? allocatedLineTotalMinor - roundHalfUpRatio(lineTaxMinor * params.invoiceTotalMinor, scaleDenom)
        : 0n;

    const prevRefundForLine = roundHalfUpRatio(
      allocatedLineTotalMinor * prevReturnedMilli,
      origQtyMilli,
    );
    const cumulativeRefundForLine = roundHalfUpRatio(
      allocatedLineTotalMinor * (prevReturnedMilli + returnQtyMilli),
      origQtyMilli,
    );
    let refundAmountMinor =
      cumulativeRefundForLine > prevRefundForLine
        ? cumulativeRefundForLine - prevRefundForLine
        : 0n;

    if (totalRefundMinor + refundAmountMinor > maxRefundableRemaining) {
      refundAmountMinor =
        maxRefundableRemaining > totalRefundMinor
          ? maxRefundableRemaining - totalRefundMinor
          : 0n;
    }

    const netRevenueReversalMinor = roundHalfUpRatio(
      netBeforeTaxAllocatedMinor * returnQtyMilli,
      origQtyMilli,
    );
    const cogsReversalMinor = calculateLineSubtotal(returnQtyMilli, unitCostMinor);

    totalRefundMinor += refundAmountMinor;
    totalNetRevenueReversalMinor += netRevenueReversalMinor;
    totalCogsReversalMinor += cogsReversalMinor;

    return {
      invoiceItemId: line.invoiceItemId,
      returnQtyMilli,
      refundAmountMinor,
      netRevenueReversalMinor,
      cogsReversalMinor,
    };
  });

  return {
    lines: computed,
    totalRefundMinor,
    totalNetRevenueReversalMinor,
    totalCogsReversalMinor,
  };
}
