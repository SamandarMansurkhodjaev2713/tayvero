export interface TenantContext {
	readonly tenantId: string;
	readonly actorId: string;
	readonly actorType: string;
	readonly roles: readonly string[];
	readonly requestId?: string;
}

export interface CredentialContext {
	tenantId: string;
	resourceType: string;
	resourceId: string;
	field: string;
	purpose?: string;
}

export interface CredentialKeyProvider {
	getActiveKey(): Promise<{ keyId: string; key: Uint8Array }>;
	getKey(keyId: string): Promise<Uint8Array>;
}

export class SecurityCoreError extends Error {
	readonly code: string;
	readonly retryable: boolean;
	readonly safeDetails?: Readonly<Record<string, unknown>>;
	toSafeJSON(): Readonly<Record<string, unknown>>;
}

export class InMemoryCredentialKeyProvider implements CredentialKeyProvider {
	constructor(options: {
		activeKeyId: string;
		keys: Record<string, string | Uint8Array>;
	});
	getActiveKey(): Promise<{ keyId: string; key: Uint8Array }>;
	getKey(keyId: string): Promise<Uint8Array>;
	readonly activeKeyId: string;
	destroy(): void;
}

export function createEnvCredentialKeyProvider(options?: {
	env?: Record<string, string | undefined>;
	keysVariable?: string;
	activeKeyVariable?: string;
}): InMemoryCredentialKeyProvider;

export class CredentialVault {
	constructor(options: {
		keyProvider: CredentialKeyProvider;
		maxPlaintextBytes?: number;
		maxEnvelopeBytes?: number;
	});
	encryptString(plaintext: string, context: CredentialContext): Promise<string>;
	decryptString(envelope: string, context: CredentialContext): Promise<string>;
	inspect(envelope: string): Readonly<{
		version: number;
		algorithm: string;
		keyId: string;
		ciphertextBytes: number;
	}>;
	needsRotation(envelope: string): Promise<boolean>;
	rotate(envelope: string, context: CredentialContext): Promise<string>;
}

export function isCredentialEnvelope(value: unknown): value is string;
export function redactCredential(value: unknown): unknown;
export function credentialAuditFingerprint(envelope: string): string;
export const credentialVaultConstants: Readonly<
	Record<string, string | number>
>;

export function createCredentialCodec<TRecord>(options: {
	vault: CredentialVault;
	contextFactory: (record: TRecord, field: string) => CredentialContext;
	allowLegacyPlaintext?: boolean;
}): Readonly<{
	seal(
		value: string | null | undefined,
		record: TRecord,
		field: string,
	): Promise<string | null | undefined>;
	open(
		value: string | null | undefined,
		record: TRecord,
		field: string,
	): Promise<{
		plaintext: string | null | undefined;
		needsMigration: boolean;
	}>;
	rotate(
		value: string | null | undefined,
		record: TRecord,
		field: string,
	): Promise<string | null | undefined>;
}>;

export function createTenantContext(input: {
	tenantId: string;
	actorId: string;
	actorType?: string;
	roles?: string[];
	requestId?: string;
}): TenantContext;
export function scopeTenantWhere<T extends Record<string, unknown>>(
	context: TenantContext,
	where?: T,
	tenantField?: string,
): T & Record<string, string>;
export function scopeTenantUniqueWhere<T extends Record<string, unknown>>(
	context: TenantContext,
	where: T,
	tenantField?: string,
): T & Record<string, string>;
export function scopeTenantCreateData<T extends Record<string, unknown>>(
	context: TenantContext,
	data: T,
	tenantField?: string,
): T & Record<string, string>;
export function scopeTenantCreateManyData<T extends Record<string, unknown>>(
	context: TenantContext,
	data: T | T[],
	tenantField?: string,
): Array<T & Record<string, string>>;
export function scopeTenantUpdateData<T extends Record<string, unknown>>(
	data: T,
	tenantField?: string,
): T;
export function assertTenantOwnedResult<T>(
	context: TenantContext,
	result: T,
	tenantField?: string,
): T;
export function tenantScopedIdempotencyKey(
	context: TenantContext,
	namespace: string,
	parts?: unknown[],
): string;
export function createTenantScopedDelegate(options: {
	delegate: Record<string, (...args: unknown[]) => unknown>;
	context: TenantContext;
	tenantField?: string;
}): Readonly<Record<string, (...args: unknown[]) => Promise<unknown>>>;
