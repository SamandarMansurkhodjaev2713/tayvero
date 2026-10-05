export const MAX_AMOUNT_CENTS: number;
export class AmountInputError extends Error {
	code: string;
	constructor(code: string, message: string);
}
export function parseAmountInput(value: string): number | null;
export function formatAmountInput(cents: number | null | undefined): string;
