import { describe, expect, it } from "vitest";
import { parseMoney } from "../money";
import {
  calculateLoyaltyPointsEarned,
  calculateLoyaltyPointsRequired,
  calculatePosInvoiceTotals,
  calculateSalesReturnTotals,
  PosMathError,
} from "../pos-math";

describe("POS fixed-point checkout calculation engine", () => {
  it("computes line discounts, VAT, invoice discount, split payments, and net cash drawer retention", () => {
    const result = calculatePosInvoiceTotals({
      lines: [
        // 2 * 50,000 - 10,000 = 90,000; 10% VAT = 9,000 => 99,000
        {
          quantity: "2",
          unitPrice: "50000.00",
          discountAmount: "10000.00",
          taxRate: "10.00",
        },
        // 1.500 * 20,000 = 30,000; 0% VAT => 30,000
        {
          quantity: "1.500",
          unitPrice: "20000.00",
          discountAmount: "0.00",
          taxRate: "0.00",
        },
      ],
      invoiceDiscountAmount: "9000.00",
      // Total due = 99,000 + 30,000 - 9,000 = 120,000
      // Customer pays 50,000 QR + 100,000 CASH => 30,000 change given, 70,000 net cash retained!
      payments: [
        { method: "BANK_TRANSFER_QR", amount: "50000.00" },
        { method: "CASH", amount: "100000.00" },
      ],
    });

    expect(result.formatted.subtotal).toBe("130000.00");
    expect(result.formatted.discountAmount).toBe("19000.00");
    expect(result.formatted.taxAmount).toBe("9000.00");
    expect(result.formatted.totalAmount).toBe("120000.00");
    expect(result.formatted.paidTendered).toBe("150000.00");
    expect(result.formatted.changeDue).toBe("30000.00");
    expect(result.formatted.netCashReceived).toBe("70000.00");
    expect(result.settledByMethodMinor.BANK_TRANSFER_QR).toBe(5000000n);
    expect(result.settledByMethodMinor.CASH).toBe(7000000n);
  });

  it("rejects underpayment, non-cash overpayment, and invalid discounts", () => {
    expect(() =>
      calculatePosInvoiceTotals({
        lines: [{ quantity: "1", unitPrice: "50000.00" }],
        payments: [{ method: "CASH", amount: "40000.00" }],
      }),
    ).toThrowError(PosMathError);

    expect(() =>
      calculatePosInvoiceTotals({
        lines: [{ quantity: "1", unitPrice: "50000.00" }],
        payments: [{ method: "CARD", amount: "60000.00" }],
      }),
    ).toThrowError(PosMathError);

    expect(() =>
      calculatePosInvoiceTotals({
        lines: [
          {
            quantity: "1",
            unitPrice: "50000.00",
            discountAmount: "55000.00",
          },
        ],
        payments: [{ method: "CASH", amount: "0.00" }],
      }),
    ).toThrowError(PosMathError);
  });

  it("calculates loyalty points earned/redeemed and rejects non-1000 multiples", () => {
    expect(calculateLoyaltyPointsEarned(parseMoney("95000.00"))).toBe(9);
    expect(calculateLoyaltyPointsRequired(parseMoney("15000.00"))).toBe(15);
    expect(() =>
      calculateLoyaltyPointsRequired(parseMoney("15500.00")),
    ).toThrowError(PosMathError);
  });

  it("computes multi-step proportional sales returns without exceeding invoice total", () => {
    const firstReturn = calculateSalesReturnTotals({
      invoiceSubtotalAfterLineDiscountAndTaxMinor: parseMoney("200000.00"),
      invoiceTotalMinor: parseMoney("180000.00"),
      priorRefundedTotalMinor: 0n,
      lines: [
        {
          invoiceItemId: "item-1",
          originalQuantity: "3.000",
          previouslyReturnedQuantity: "0.000",
          returnQuantity: "1.000",
          lineTotal: "200000.00",
          lineTaxAmount: "0.00",
          unitCostSnapshot: "40000.00",
        },
      ],
    });
    expect(firstReturn.totalRefundMinor).toBe(parseMoney("60000.00"));
    expect(firstReturn.totalCogsReversalMinor).toBe(parseMoney("40000.00"));

    const secondReturn = calculateSalesReturnTotals({
      invoiceSubtotalAfterLineDiscountAndTaxMinor: parseMoney("200000.00"),
      invoiceTotalMinor: parseMoney("180000.00"),
      priorRefundedTotalMinor: firstReturn.totalRefundMinor,
      lines: [
        {
          invoiceItemId: "item-1",
          originalQuantity: "3.000",
          previouslyReturnedQuantity: "1.000",
          returnQuantity: "2.000",
          lineTotal: "200000.00",
          lineTaxAmount: "0.00",
          unitCostSnapshot: "40000.00",
        },
      ],
    });
    expect(secondReturn.totalRefundMinor).toBe(parseMoney("120000.00"));

    expect(() =>
      calculateSalesReturnTotals({
        invoiceSubtotalAfterLineDiscountAndTaxMinor: parseMoney("200000.00"),
        invoiceTotalMinor: parseMoney("180000.00"),
        priorRefundedTotalMinor: parseMoney("180000.00"),
        lines: [
          {
            invoiceItemId: "item-1",
            originalQuantity: "3.000",
            previouslyReturnedQuantity: "3.000",
            returnQuantity: "1.000",
            lineTotal: "200000.00",
            lineTaxAmount: "0.00",
            unitCostSnapshot: "40000.00",
          },
        ],
      }),
    ).toThrowError(PosMathError);
  });
});
