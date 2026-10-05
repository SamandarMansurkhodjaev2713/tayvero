import { parseCsv, detectImportFormat, compileMapping, createMigrationDryRun } from '@crm/migration-core';
import { fail } from './errors.mjs';
/** Source preparation only: this never writes CRM records or claims an import has completed. */
export function createMigrationSourcePreparation({ store, maxBytes = 4 * 1024 * 1024, maxRows = 50000 }) {
    if (typeof store?.put !== 'function' || typeof store?.get !== 'function')
        fail('SOURCE_PREPARATION_CONFIG', 'A durable source store is required');
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 32 * 1024 * 1024 || !Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 100000)
        fail('SOURCE_PREPARATION_CONFIG', 'Source preparation limits are invalid');
    function parse({ filename, mimeType, bytes }) {
        if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > maxBytes)
            fail('SOURCE_SIZE_LIMIT', 'Source exceeds the preparation byte limit');
        const format = detectImportFormat({ filename, mimeType, bytes });
        if (format === 'XLSX')
            fail('XLSX_ADAPTER_REQUIRED', 'XLSX parsing is not enabled. Export UTF-8 CSV or TSV for this preparation lane.');
        let text;
        try {
            text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        }
        catch {
            fail('SOURCE_ENCODING', 'Save the source as UTF-8 CSV; invalid bytes are not silently replaced');
        }
        const parsed = parseCsv(text, { delimiter: format === 'TSV' ? '\t' : 'auto', maxRows: maxRows + 1, maxColumns: 200, maxFieldCharacters: 100000, maxCharacters: maxBytes });
        if (!parsed.headers.length || !parsed.rows.length)
            fail('SOURCE_EMPTY', 'The source needs a header and at least one data row');
        return { format, parsed };
    }
    return Object.freeze({
        async upload({ context, filename, mimeType, bytes }) {
            if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > maxBytes)
                fail('SOURCE_SIZE_LIMIT', 'Source exceeds the preparation byte limit');
            const snapshot = Buffer.from(bytes);
            try {
            const { format, parsed } = parse({ filename, mimeType, bytes: snapshot });
            const source = await store.put({ context, filename, mimeType, bytes: snapshot });
            return { source: { ...source, format }, preview: { headers: parsed.headers, rows: parsed.rows.slice(0, 20), rowNumbers: parsed.rowNumbers.slice(0, 20), totalRows: parsed.rows.length, delimiter: parsed.delimiter, encoding: 'utf-8' } };
            } finally { snapshot.fill(0); }
        },
        async preview({ context, sourceId, expectedSha256 }) {
            const source = await store.get({ context, sourceId, expectedSha256 });
            try {
                const { format, parsed } = parse(source);
                const { bytes: _bytes, ...metadata } = source;
                return { source: { ...metadata, format }, preview: { headers: parsed.headers, rows: parsed.rows.slice(0, 20), rowNumbers: parsed.rowNumbers.slice(0, 20), totalRows: parsed.rows.length, delimiter: parsed.delimiter, encoding: 'utf-8' } };
            } finally { source.bytes.fill(0); }
        },
        async plan({ context, sourceId, expectedSha256, entityType, mapping, targetSchema, existingDedupeKeys = [], batchSize = 500, validateRecord }) {
            // Always re-read persisted bytes. No browser-supplied rows or remembered in-process preview.
            const source = await store.get({ context, sourceId, expectedSha256 });
            try {
            const { format, parsed } = parse(source);
            const compiledMapping = compileMapping({ headers: parsed.headers, mapping, targetSchema });
            const plan = createMigrationDryRun({ tenantId: context.tenantId, entityType, compiledMapping, rows: parsed.rows, sourceRowNumbers: parsed.rowNumbers, existingDedupeKeys, batchSize, maxRows, validateRecord });
            const { bytes: _bytes, ...metadata } = source;
            return { source: { ...metadata, format }, plan };
            } finally { source.bytes.fill(0); }
        },
    });
}
