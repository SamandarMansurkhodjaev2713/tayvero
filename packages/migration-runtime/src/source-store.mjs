import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { open, mkdir, lstat, realpath, link, unlink, opendir } from 'node:fs/promises';
import path from 'node:path';
import { fail } from './errors.mjs';
const MAGIC = Buffer.from('CRMSRC1\n');
const ID = /^[a-f0-9]{32}$/;
const SHA = /^[a-f0-9]{64}$/;
const KEY_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function trustedTenant(context) {
    if (!context || typeof context.tenantId !== 'string' || !context.tenantId.trim() || context.tenantId.length > 128 || /[\u0000-\u001f\u007f]/.test(context.tenantId) || typeof context.actorId !== 'string' || !context.actorId.trim())
        fail('INVALID_SOURCE_CONTEXT', 'Trusted tenant and actor are required');
    return context.tenantId;
}
function sourceId(value) { if (typeof value !== 'string' || !ID.test(value))
    fail('INVALID_SOURCE_ID', 'Invalid opaque source identifier'); return value; }
function validFilename(value) {
    if (typeof value !== 'string' || !value.trim() || value.length > 255 || value === '.' || value === '..' || /[\\/\u0000-\u001f\u007f]/.test(value))
        fail('INVALID_SOURCE_FILENAME', 'Source filename must be a safe basename');
    return value;
}
function validMime(value) {
    if (typeof value !== 'string' || value.length > 160 || !value.trim() || /[\u0000-\u001f\u007f]/.test(value))
        fail('INVALID_SOURCE_MIME', 'Source MIME type is invalid');
    return value;
}
/** Local persistent-volume adapter. Not suitable for ephemeral/serverless disks or multi-host local disks. */
export async function createEncryptedFileSourceStore({ root, keys, activeKeyId, maxBytes = 4 * 1024 * 1024, clock = () => new Date(), idFactory = () => randomBytes(16).toString('hex') }) {
    if (typeof root !== 'string' || !path.isAbsolute(root) || !constants.O_NOFOLLOW)
        fail('SOURCE_STORE_CONFIG', 'An absolute POSIX storage directory with O_NOFOLLOW support is required');
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 32 * 1024 * 1024)
        fail('SOURCE_STORE_CONFIG', 'maxBytes must be between 1 and 33554432');
    if (!keys || typeof keys !== 'object' || Array.isArray(keys) || !KEY_ID.test(activeKeyId ?? ''))
        fail('SOURCE_STORE_CONFIG', 'A source encryption key ring is required');
    const ring = new Map();
    for (const [id, key] of Object.entries(keys)) {
        if (!KEY_ID.test(id) || !(key instanceof Uint8Array) || key.byteLength !== 32)
            fail('SOURCE_STORE_CONFIG', 'Each source encryption key must contain 32 bytes');
        ring.set(id, Buffer.from(key));
    }
    if (!ring.has(activeKeyId))
        fail('SOURCE_STORE_CONFIG', 'The active source key is not available');
    const storageRoot = path.resolve(root);
    await mkdir(storageRoot, { recursive: true, mode: 0o700 });
    if (await realpath(storageRoot) !== storageRoot)
        fail('UNSAFE_SOURCE_DIRECTORY', 'Storage paths must not traverse symbolic links');
    async function checkDir(dir) {
        const s = await lstat(dir);
        if (!s.isDirectory() || s.isSymbolicLink() || (s.mode & 0o022) !== 0 || (process.getuid && s.uid !== process.getuid()))
            fail('UNSAFE_SOURCE_DIRECTORY', 'Source directories must be owned by the service and not group/world writable');
    }
    async function checkRoot() {
        await checkDir(storageRoot);
        if (await realpath(storageRoot) !== storageRoot)
            fail('UNSAFE_SOURCE_DIRECTORY', 'Storage roots must not traverse symbolic links');
        let ancestor = path.dirname(storageRoot);
        while (true) {
            const info = await lstat(ancestor);
            const trustedOwner = info.uid === 0 || (process.getuid && info.uid === process.getuid());
            const protectedSticky = (info.mode & 0o1000) !== 0 && trustedOwner;
            if (!info.isDirectory() || info.isSymbolicLink() || !trustedOwner || ((info.mode & 0o022) !== 0 && !protectedSticky))
                fail('UNSAFE_SOURCE_DIRECTORY', 'Storage ancestors must not allow an untrusted account to rename the source root');
            if (ancestor === path.dirname(ancestor))
                break;
            ancestor = path.dirname(ancestor);
        }
    }
    await checkRoot();
    // Flush newly-created directory entries as well as source files. This does not
    // replace infrastructure backup/restore or a true power-loss qualification.
    for (let dir = storageRoot;; dir = path.dirname(dir)) {
        await syncDirectory(dir);
        if (dir === path.dirname(dir))
            break;
    }
    async function tenantDir(tenant, create = false) {
        await checkRoot();
        const dir = path.join(storageRoot, hash(Buffer.from(JSON.stringify(['source-tenant-v1', tenant]))));
        if (create) {
            await mkdir(dir, { mode: 0o700 });
            await syncDirectory(storageRoot);
        }
        await checkDir(dir);
        return dir;
    }
    // mkdir is allowed to reuse only a directory that subsequently passes owner/mode/symlink checks.
    async function ensureTenantDir(tenant) {
        try {
            return await tenantDir(tenant, true);
        }
        catch (error) {
            if (error.code !== 'EEXIST')
                throw error;
            return tenantDir(tenant);
        }
    }
    function aad(tenant, id, keyId) { return Buffer.from(JSON.stringify([1, tenant, id, keyId])); }
    const maxEnvelopeBytes = Math.ceil(maxBytes * 4 / 3) + 16384;
    async function syncDirectory(dir) { const h = await open(dir, constants.O_RDONLY | constants.O_NOFOLLOW); try {
        await h.sync();
    }
    finally {
        await h.close();
    } }
    return Object.freeze({
        async put({ context, filename, mimeType, bytes }) {
            const tenant = trustedTenant(context);
            validFilename(filename);
            validMime(mimeType);
            if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > maxBytes)
                fail('SOURCE_SIZE_LIMIT', 'Source is empty or exceeds the configured byte limit');
            const snapshot = Buffer.from(bytes);
            const id = sourceId(idFactory());
            const at = clock();
            if (!(at instanceof Date) || !Number.isFinite(at.getTime()))
                fail('SOURCE_STORE_CONFIG', 'Source clock is invalid');
            const meta = { id, sha256: hash(snapshot), byteLength: snapshot.length, filename, mimeType, createdAt: at.toISOString() };
            const plaintext = Buffer.from(JSON.stringify({ ...meta, data: snapshot.toString('base64') }));
            snapshot.fill(0);
            const iv = randomBytes(12);
            const cipher = createCipheriv('aes-256-gcm', ring.get(activeKeyId), iv);
            cipher.setAAD(aad(tenant, id, activeKeyId));
            let ciphertext;
            try {
                ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
            }
            finally {
                plaintext.fill(0);
            }
            const header = Buffer.from(JSON.stringify({ version: 1, keyId: activeKeyId, iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url') }));
            const length = Buffer.alloc(4);
            length.writeUInt32BE(header.length);
            const envelope = Buffer.concat([MAGIC, length, header, ciphertext]);
            const dir = await ensureTenantDir(tenant);
            const final = path.join(dir, `${id}.source`);
            const temp = path.join(dir, `.upload-${randomBytes(16).toString('hex')}.tmp`);
            let handle;
            try {
                handle = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
                await handle.writeFile(envelope);
                await handle.sync();
                await handle.close();
                handle = null;
                // Exclusive publication: a concurrent put never overwrites another intent, even on an ID collision.
                try {
                    await link(temp, final);
                }
                catch (error) {
                    if (error.code === 'EEXIST')
                        fail('SOURCE_ALREADY_EXISTS', 'Source identity already exists');
                    throw error;
                }
                await unlink(temp);
                await syncDirectory(dir);
                return Object.freeze(meta);
            }
            finally {
                if (handle)
                    await handle.close();
                await unlink(temp).catch(error => { if (error.code !== 'ENOENT')
                    throw error; });
            }
        },
        async get({ context, sourceId: rawId, expectedSha256 }) {
            const tenant = trustedTenant(context);
            const id = sourceId(rawId);
            if (expectedSha256 !== undefined && (typeof expectedSha256 !== 'string' || !SHA.test(expectedSha256)))
                fail('INVALID_SOURCE_DIGEST', 'Expected SHA-256 is invalid');
            let handle, envelope;
            try {
                const dir = await tenantDir(tenant);
                handle = await open(path.join(dir, `${id}.source`), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
                const s = await handle.stat();
                if (!s.isFile() || s.size > maxEnvelopeBytes || s.size < MAGIC.length + 4 || s.nlink !== 1 || (s.mode & 0o077) !== 0 || (process.getuid && s.uid !== process.getuid()))
                    fail('UNSAFE_SOURCE_FILE', 'Stored source is not a private regular file');
                // Bounded reads, including if another service bug replaces a file during this operation.
                const buffer = Buffer.alloc(s.size + 1);
                let total = 0;
                while (total < buffer.length) {
                    const r = await handle.read(buffer, total, buffer.length - total, null);
                    if (!r.bytesRead)
                        break;
                    total += r.bytesRead;
                }
                if (total !== s.size)
                    fail('SOURCE_INTEGRITY', 'Stored source size changed while reading');
                envelope = buffer.subarray(0, total);
            }
            catch (error) {
                if (error.code === 'ENOENT')
                    fail('SOURCE_NOT_FOUND', 'Source was not found in this workspace');
                if (error.code === 'ELOOP')
                    fail('UNSAFE_SOURCE_FILE', 'Stored source must not be a symbolic link');
                throw error;
            }
            finally {
                if (handle)
                    await handle.close();
            }
            let plaintext;
            try {
                if (!envelope.subarray(0, MAGIC.length).equals(MAGIC))
                    fail('SOURCE_INTEGRITY', 'Invalid encrypted source format');
                const headerLength = envelope.readUInt32BE(MAGIC.length);
                if (headerLength < 1 || headerLength > 4096 || envelope.length <= MAGIC.length + 4 + headerLength)
                    fail('SOURCE_INTEGRITY', 'Invalid encrypted source header');
                const offset = MAGIC.length + 4;
                const header = JSON.parse(envelope.subarray(offset, offset + headerLength).toString('utf8'));
                if (header.version !== 1 || !KEY_ID.test(header.keyId ?? ''))
                    fail('SOURCE_INTEGRITY', 'Invalid encrypted source version');
                const key = ring.get(header.keyId);
                if (!key)
                    fail('SOURCE_KEY_UNAVAILABLE', 'The encryption key required by this source is unavailable');
                const iv = Buffer.from(header.iv ?? '', 'base64url'), tag = Buffer.from(header.tag ?? '', 'base64url');
                if (iv.length !== 12 || tag.length !== 16 || iv.toString('base64url') !== header.iv || tag.toString('base64url') !== header.tag)
                    fail('SOURCE_INTEGRITY', 'Invalid encrypted source authentication data');
                const decipher = createDecipheriv('aes-256-gcm', key, iv);
                decipher.setAAD(aad(tenant, id, header.keyId));
                decipher.setAuthTag(tag);
                plaintext = Buffer.concat([decipher.update(envelope.subarray(offset + headerLength)), decipher.final()]);
                const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext));
                if (body.id !== id || !SHA.test(body.sha256 ?? '') || typeof body.data !== 'string' || !Number.isSafeInteger(body.byteLength) || body.byteLength < 1 || body.byteLength > maxBytes)
                    fail('SOURCE_INTEGRITY', 'Invalid stored source metadata');
                validFilename(body.filename);
                validMime(body.mimeType);
                if (typeof body.createdAt !== 'string' || !Number.isFinite(Date.parse(body.createdAt)))
                    fail('SOURCE_INTEGRITY', 'Invalid stored source timestamp');
                const bytes = Buffer.from(body.data, 'base64');
                if (bytes.toString('base64') !== body.data || bytes.length !== body.byteLength || hash(bytes) !== body.sha256 || (expectedSha256 && body.sha256 !== expectedSha256))
                    fail('SOURCE_INTEGRITY', 'Stored source bytes do not match the migration source');
                return Object.freeze({ id, sha256: body.sha256, byteLength: body.byteLength, filename: body.filename, mimeType: body.mimeType, createdAt: body.createdAt, bytes });
            }
            catch (error) {
                if (error.code === 'SOURCE_KEY_UNAVAILABLE' || error.code === 'SOURCE_INTEGRITY')
                    throw error;
                fail('SOURCE_INTEGRITY', 'Encrypted source could not be authenticated');
            }
            finally {
                plaintext?.fill(0);
            }
        },
        /** Bounded inventory of this tenant only. Never follows names or decrypts arbitrary paths. */
        async inventory({ context, maxEntries = 1000 }) {
            const tenant = trustedTenant(context);
            if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 1000)
                fail('SOURCE_STORE_CONFIG', 'Inventory bounds are invalid');
            let dir;
            try { dir = await tenantDir(tenant); }
            catch (error) { if (error.code === 'ENOENT') return { entries: [], scanned: 0, ignored: 0, truncated: false }; throw error; }
            const entries = []; let scanned = 0, ignored = 0, truncated = false;
            const listing = await opendir(dir, { bufferSize: 32 });
            for await (const entry of listing) {
                if (scanned >= maxEntries) { truncated = true; break; }
                scanned++;
                if (!/^[a-f0-9]{32}\.source$/.test(entry.name) || !entry.isFile()) { ignored++; continue; }
                try {
                    const file = await lstat(path.join(dir, entry.name));
                    if (!file.isFile() || file.isSymbolicLink() || file.nlink !== 1 || (file.mode & 0o077) !== 0 || (process.getuid && file.uid !== process.getuid())) { ignored++; continue; }
                    entries.push({ sourceId: entry.name.slice(0,32), modifiedAt: file.mtime.toISOString(), sizeBytes: file.size });
                } catch (error) { if (error.code !== 'ENOENT') throw error; }
            }
            return { entries: entries.sort((a,b) => a.sourceId.localeCompare(b.sourceId)), scanned, ignored, truncated };
        },
        /** Delete only an authenticated owned source; callers must first persist a tombstone. */
        async remove({ context, sourceId: rawId, expectedSha256 }) {
            const tenant = trustedTenant(context);
            const id = sourceId(rawId);
            if (typeof expectedSha256 !== 'string' || !SHA.test(expectedSha256))
                fail('INVALID_SOURCE_DIGEST', 'An exact digest is required for physical deletion');
            try {
                const source = await this.get({ context, sourceId: id, expectedSha256 });
                source.bytes.fill(0);
            } catch (error) {
                if (error.code === 'SOURCE_NOT_FOUND') {
                    // A prior process may have unlinked but died before directory fsync.
                    try { await syncDirectory(await tenantDir(tenant)); }
                    catch (missing) { if (missing.code !== 'ENOENT') throw missing; }
                    return { removed: false };
                }
                throw error;
            }
            const dir = await tenantDir(tenant);
            await unlink(path.join(dir, `${id}.source`)).catch(error => { if (error.code !== 'ENOENT') throw error; });
            await syncDirectory(dir);
            return { removed: true };
        },
    });
}
