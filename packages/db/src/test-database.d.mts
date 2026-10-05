export type TestDatabaseEnvironment = Record<string, string | undefined>;
export declare function resolveTestDatabase(
	env?: TestDatabaseEnvironment,
): Readonly<{
	url: string;
	database: string;
	remote: boolean;
}>;
export declare function assertTestDatabaseResetAllowed(
	env?: TestDatabaseEnvironment,
): void;
