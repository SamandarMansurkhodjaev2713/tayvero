export type SourceContext = Readonly<{ tenantId: string; actorId: string }>;
export type StoredSource = Readonly<{ id: string; sha256: string; byteLength: number; filename: string; mimeType: string; createdAt: string }>;
export interface EncryptedSourceStore {
  inventory(input: {context: SourceContext;maxEntries?:number}): Promise<{entries:Array<{sourceId:string;modifiedAt:string;sizeBytes:number}>;scanned:number;ignored:number;truncated:boolean}>;
  put(input: { context: SourceContext; filename: string; mimeType: string; bytes: Uint8Array }): Promise<StoredSource>;
  get(input: { context: SourceContext; sourceId: string; expectedSha256?: string }): Promise<StoredSource & { bytes: Uint8Array }>;
  remove(input: { context: SourceContext; sourceId: string; expectedSha256: string }): Promise<{ removed: boolean }>;
}
export function createEncryptedFileSourceStore(options: { root: string; keys: Record<string, Uint8Array>; activeKeyId: string; maxBytes?: number; clock?: () => Date; idFactory?: () => string }): Promise<EncryptedSourceStore>;
