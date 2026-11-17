const MONEY_DECIMALS = 2;
const QTY_DECIMALS = 3;
const QTY_SCALE = 1000n;
const RATE_DECIMALS = 2;
const PERCENT_DIVISOR = 10000n; // 100% * 10^RATE_DECIMALS

const DECIMAL_PATTERN = /^-?\d+(?:\.\d+)?$/;

/**
 * Parse a decimal string or finite number into fixed-point bigint scaled by 10^decimals.
 * Rejects scientific notation, NaN, Infinity, and excess precision to avoid float rounding drift.
 */
export function parseScaledInt(
  value: string | number,
  decimals: number,
): bigint {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new RangeError("Numeric value must be finite");
    }
    return parseScaledInt(value.toString(), decimals);
  }

  const trimmed = value.trim();
  if (!DECIMAL_PATTERN.test(trimmed)) {
    throw new RangeError(`Invalid decimal value: "${value}"`);
  }

  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [wholePart = "0", fracPart = ""] = unsigned.split(".");

  if (fracPart.length > decimals) {
    throw new RangeError(
      `Decimal precision exceeds ${decimals} places for value "${value}"`,
    );
  }

  const paddedFrac = fracPart.padEnd(decimals, "0");
  const magnitude = BigInt(`${wholePart}${paddedFrac}`);
  return negative ? -magnitude : magnitude;
}

/** Format a fixed-point bigint back to a canonical decimal string. */
export function formatScaledInt(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const whole = abs / scale;
  const frac = (abs % scale).toString().padStart(decimals, "0");
  return `${negative ? "-" : ""}${whole.toString()}.${frac}`;
}

/** Divide numerator by positive denominator with half-up rounding away from zero. */
export function divideRoundHalfUp(
  numerator: bigint,
  denominator: bigint,
): bigint {
  if (denominator <= 0n) {
    throw new RangeError("Denominator must be positive");
  }
  const negative = numerator < 0n;
  const absNum = negative ? -numerator : numerator;
  const quotient = absNum / denominator;
  const remainder = absNum % denominator;
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

export function parseMoney(value: string | number): bigint {
  return parseScaledInt(value, MONEY_DECIMALS);
}

export function formatMoney(minorUnits: bigint): string {
  return formatScaledInt(minorUnits, MONEY_DECIMALS);
}

export function parseQuantity(value: string | number): bigint {
  return parseScaledInt(value, QTY_DECIMALS);
}

export function formatQuantity(milliUnits: bigint): string {
  return formatScaledInt(milliUnits, QTY_DECIMALS);
}

/** Compute line subtotal from milli-unit quantity and minor-unit unit price. */
export function calculateLineSubtotal(
  quantityMilli: bigint,
  unitPriceMinor: bigint,
): bigint {
  return divideRoundHalfUp(quantityMilli * unitPriceMinor, QTY_SCALE);
}

/** Compute percentage amount (e.g. VAT or % discount) from minor-unit base. */
export function calculatePercentAmount(
  baseMinor: bigint,
  ratePercent: string | number,
): bigint {
  const scaledRate = parseScaledInt(ratePercent, RATE_DECIMALS);
  return divideRoundHalfUp(baseMinor * scaledRate, PERCENT_DIVISOR);
}

/**
 * Compute new Weighted Average Cost (AVCO) in minor units on incoming purchase stock.
 * Clamps negative pre-existing stock to 0 so distorted negative stock cannot corrupt cost.
 */
export function calculateWeightedAverageCost(
  currentQtyMilli: bigint,
  currentAvgCostMinor: bigint,
  incomingQtyMilli: bigint,
  incomingUnitCostMinor: bigint,
): bigint {
  if (incomingQtyMilli <= 0n) {
    throw new RangeError("Incoming quantity must be greater than zero");
  }

  const effectiveCurrentQty = currentQtyMilli > 0n ? currentQtyMilli : 0n;
  const totalQty = effectiveCurrentQty + incomingQtyMilli;
  const totalValuationScaled =
    effectiveCurrentQty * currentAvgCostMinor +
    incomingQtyMilli * incomingUnitCostMinor;

  return divideRoundHalfUp(totalValuationScaled, totalQty);
}
