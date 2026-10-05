
import { fail } from "./errors.mjs";
import { nextBatchState } from "./batch-invariants.mjs";
function copy(value) { return structuredClone(value); }
function key(tenantId, id) { return JSON.stringify([tenantId, id]); }
export class InMemoryMigrationRepository {
  #jobs = new Map(); #batches = new Map(); #events = []; #tail = Promise.resolve();
  async transaction(callback) {
    let release; const previous = this.#tail; this.#tail = new Promise((resolve) => { release = resolve; }); await previous;
    const snapshot = { jobs: copy(this.#jobs), batches: copy(this.#batches), events: copy(this.#events) };
    try { return await callback(this); } catch (error) { this.#jobs = snapshot.jobs; this.#batches = snapshot.batches; this.#events = snapshot.events; throw error; } finally { release(); }
  }
  async insertJob(job) { const k = key(job.tenantId, job.id); if (this.#jobs.has(k)) fail("JOB_EXISTS", "Migration job already exists"); this.#jobs.set(k, copy(job)); return copy(job); }
  async getJob(tenantId, id) { return copy(this.#jobs.get(key(tenantId, id)) ?? null); }
  async replaceJob(tenantId, id, expectedVersion, next) { const k = key(tenantId, id); const current = this.#jobs.get(k); if (!current) fail("JOB_NOT_FOUND", "Migration job was not found"); if (current.version !== expectedVersion) fail("STALE_JOB", "Migration job changed after it was read"); this.#jobs.set(k, copy(next)); return copy(next); }
  async replaceBatches(tenantId, jobId, batches) { this.#batches.set(key(tenantId, jobId), copy(batches)); }
  async listBatches(tenantId, jobId) { return copy(this.#batches.get(key(tenantId, jobId)) ?? []); }
  async updateBatch(tenantId, jobId, batchIndex, updater) { const k = key(tenantId, jobId); const batches = this.#batches.get(k) ?? []; const index = batches.findIndex((batch) => batch.index === batchIndex); if (index < 0) fail("BATCH_NOT_FOUND", "Migration batch was not found"); const current = copy(batches[index]); const next = nextBatchState(current, updater(copy(current))); batches[index] = copy(next); this.#batches.set(k, batches); return copy(next); }
  async appendEvent(event) { this.#events.push(copy(event)); }
  async events() { return copy(this.#events); }
}
