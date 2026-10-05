function nonNegativeBigInt(value, name) {
	const result = BigInt(value);
	if (result < 0n) throw new RangeError(`${name} cannot be negative`);
	return result;
}
function nonNegativeInteger(value, name) {
	if (!Number.isSafeInteger(value) || value < 0)
		throw new RangeError(`${name} must be a non-negative safe integer`);
	return value;
}
function divideHalfAway(numerator, denominator) {
	if (denominator <= 0n) throw new RangeError("denominator must be positive");
	const quotient = numerator / denominator;
	const remainder = numerator % denominator;
	return quotient + (remainder * 2n >= denominator ? 1n : 0n);
}

export function calculateAutomationRoi(input) {
	const employees = nonNegativeInteger(input.employees, "employees");
	const workdays = nonNegativeInteger(
		input.workdaysPerMonth,
		"workdaysPerMonth",
	);
	const savedMinutesPerEmployeePerDay = nonNegativeInteger(
		input.savedMinutesPerEmployeePerDay,
		"savedMinutesPerEmployeePerDay",
	);
	const workingMinutesPerEmployeePerMonth = nonNegativeInteger(
		input.workingMinutesPerEmployeePerMonth,
		"workingMinutesPerEmployeePerMonth",
	);
	if (employees > 0 && workingMinutesPerEmployeePerMonth === 0)
		throw new RangeError(
			"workingMinutesPerEmployeePerMonth must be positive when employees exist",
		);
	const monthlyEmployeeCostMinor = nonNegativeBigInt(
		input.monthlyEmployeeCostMinor,
		"monthlyEmployeeCostMinor",
	);
	const platformCostMinor = nonNegativeBigInt(
		input.platformCostMinor,
		"platformCostMinor",
	);
	const recoveredRevenueMinor = nonNegativeBigInt(
		input.recoveredRevenueMinor ?? 0,
		"recoveredRevenueMinor",
	);
	const savedMinutes = BigInt(
		employees * workdays * savedMinutesPerEmployeePerDay,
	);
	const denominator = BigInt(workingMinutesPerEmployeePerMonth || 1);
	const laborSavedMinor = divideHalfAway(
		monthlyEmployeeCostMinor * savedMinutes,
		denominator,
	);
	const grossBenefitMinor = laborSavedMinor + recoveredRevenueMinor;
	const netBenefitMinor = grossBenefitMinor - platformCostMinor;
	const roiBps =
		platformCostMinor === 0n
			? null
			: divideHalfAway(netBenefitMinor * 10_000n, platformCostMinor);
	return {
		savedMinutes: savedMinutes.toString(),
		savedHoursBps: divideHalfAway(savedMinutes * 10_000n, 60n).toString(),
		laborSavedMinor: laborSavedMinor.toString(),
		recoveredRevenueMinor: recoveredRevenueMinor.toString(),
		grossBenefitMinor: grossBenefitMinor.toString(),
		platformCostMinor: platformCostMinor.toString(),
		netBenefitMinor: netBenefitMinor.toString(),
		roiBps: roiBps?.toString() ?? null,
	};
}
