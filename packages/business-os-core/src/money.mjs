const DECIMAL_PATTERN = /^([+-]?)(\d+)(?:\.(\d+))?$/;
const MAX_SCALE = 9;

function assertCurrency(currency) {
  if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) throw new TypeError("currency must be a three-letter uppercase ISO-style code");
}
function assertScale(scale) {
  if (!Number.isInteger(scale) || scale < 0 || scale > MAX_SCALE) throw new RangeError(`scale must be an integer between 0 and ${MAX_SCALE}`);
}
function pow10(scale) { return 10n ** BigInt(scale); }

export class Money {
  constructor(minor, currency, scale = 2) {
    if (typeof minor !== "bigint") throw new TypeError("minor must be bigint");
    assertCurrency(currency); assertScale(scale);
    this.minor = minor; this.currency = currency; this.scale = scale;
    Object.freeze(this);
  }
  static fromMinor(minor, currency, scale = 2) { return new Money(BigInt(minor), currency, scale); }
  static fromDecimal(decimal, currency, scale = 2) {
    assertCurrency(currency); assertScale(scale);
    if (typeof decimal !== "string") throw new TypeError("decimal must be a string to avoid binary floating-point ambiguity");
    const match = DECIMAL_PATTERN.exec(decimal.trim());
    if (!match) throw new TypeError("decimal must be a base-10 string without exponent notation");
    const [, sign, whole, fraction = ""] = match;
    if (fraction.length > scale) throw new RangeError(`decimal has more than ${scale} fractional digits`);
    const magnitude = BigInt(whole) * pow10(scale) + BigInt(fraction.padEnd(scale, "0") || "0");
    return new Money(sign === "-" ? -magnitude : magnitude, currency, scale);
  }
  assertCompatible(other) {
    if (!(other instanceof Money) || other.currency !== this.currency || other.scale !== this.scale) throw new TypeError("money currency and scale must match");
  }
  add(other) { this.assertCompatible(other); return new Money(this.minor + other.minor, this.currency, this.scale); }
  subtract(other) { this.assertCompatible(other); return new Money(this.minor - other.minor, this.currency, this.scale); }
  negate() { return new Money(-this.minor, this.currency, this.scale); }
  multiplyBasisPoints(basisPoints, rounding = "HALF_AWAY_FROM_ZERO") {
    if (!Number.isSafeInteger(basisPoints)) throw new TypeError("basisPoints must be a safe integer");
    const numerator = this.minor * BigInt(basisPoints);
    const denominator = 10_000n;
    const sign = numerator < 0n ? -1n : 1n;
    const absolute = numerator < 0n ? -numerator : numerator;
    let quotient = absolute / denominator;
    const remainder = absolute % denominator;
    if (rounding === "HALF_AWAY_FROM_ZERO" && remainder * 2n >= denominator) quotient += 1n;
    else if (rounding === "AWAY_FROM_ZERO" && remainder > 0n) quotient += 1n;
    else if (rounding !== "TOWARD_ZERO" && rounding !== "HALF_AWAY_FROM_ZERO" && rounding !== "AWAY_FROM_ZERO") throw new TypeError("unsupported rounding mode");
    return new Money(quotient * sign, this.currency, this.scale);
  }
  toDecimalString() {
    const negative = this.minor < 0n;
    const absolute = negative ? -this.minor : this.minor;
    const divisor = pow10(this.scale);
    const whole = absolute / divisor;
    const fraction = (absolute % divisor).toString().padStart(this.scale, "0");
    return `${negative ? "-" : ""}${whole}${this.scale === 0 ? "" : `.${fraction}`}`;
  }
  toJSON() { return { minor: this.minor.toString(), currency: this.currency, scale: this.scale }; }
}
