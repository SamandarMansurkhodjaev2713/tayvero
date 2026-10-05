/** Existing CRM storage contract is Decimal(14,2), expressed as integer cents over the API. */
export const MAX_AMOUNT_CENTS = 99999999999999;
export class AmountInputError extends Error {
    constructor(code, message) { super(message); this.name = 'AmountInputError'; this.code = code; }
}
export function parseAmountInput(value) {
    if (typeof value !== 'string')
        throw new AmountInputError('INVALID_AMOUNT', 'Enter an amount as text.');
    const text = value.trim();
    if (!text)
        return null;
    if (text.length > 100 || !/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(text))
        throw new AmountInputError('INVALID_AMOUNT', 'Use a non-negative amount with up to two decimal places, for example 24000.50.');
    const [whole = '0', fraction = ''] = text.split('.');
    const cents = BigInt(whole || '0') * 100n + BigInt(fraction.padEnd(2, '0'));
    if (cents > BigInt(MAX_AMOUNT_CENTS))
        throw new AmountInputError('AMOUNT_TOO_LARGE', 'That amount is too large to record.');
    return Number(cents);
}
export function formatAmountInput(cents) {
    if (cents === null || cents === undefined)
        return '';
    if (!Number.isSafeInteger(cents) || cents < 0 || cents > MAX_AMOUNT_CENTS)
        throw new AmountInputError('INVALID_AMOUNT', 'Stored amount is outside the supported range.');
    return `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}
