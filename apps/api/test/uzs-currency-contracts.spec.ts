import { describe, expect, it } from "bun:test";
import {
	currencyCode,
	setManualRateInput,
	setReportingCurrencyInput,
} from "../src/currency/currency.contracts";
import { dealCreateInput, dealUpdateArgs } from "../src/deals/deals.contracts";

describe("UZS currency contracts", () => {
	it("admits UZS in reporting settings and explicit manual rates", () => {
		expect(setReportingCurrencyInput.parse({ currency: "UZS" })).toEqual({
			currency: "UZS",
		});
		expect(
			setManualRateInput.parse({ currency: "UZS", rate: 0.00008 }),
		).toEqual({ currency: "UZS", rate: 0.00008 });
		for (const value of ["uzs", " UZS "]) {
			expect(currencyCode.safeParse(value).success).toBe(true);
		}
	});

	it("admits fractional UZS amounts in deal creation and currency updates", () => {
		const deal = dealCreateInput.parse({
			name: "Recorded sale",
			companyId: "company-1",
			ownerId: "owner-1",
			currency: "UZS",
			amountCents: 125025,
		});
		expect(deal.currency).toBe("UZS");
		expect(deal.amountCents).toBe(125025);
		expect(
			dealUpdateArgs.parse({ id: "deal-1", data: { currency: "UZS" } }).data,
		).toEqual({ currency: "UZS" });
	});

	it("retains currency and rate rejection boundaries", () => {
		for (const value of ["UZ", "UZSS", "ZZZ", "UZS<script>"]) {
			expect(currencyCode.safeParse(value).success).toBe(false);
		}
		for (const rate of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(
				setManualRateInput.safeParse({ currency: "UZS", rate }).success,
			).toBe(false);
		}
	});
});
