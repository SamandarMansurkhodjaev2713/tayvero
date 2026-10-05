import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDealHealth } from '../src/deals/deal-health.mjs';
const options = { now: new Date('2026-09-13T10:00:00Z'), timeZone: 'Asia/Tashkent' };
const healthy = { id: 'd1', stage: 'DEMO_BOOKED', createdAt: '2026-09-10T00:00:00Z', stageChangedAt: '2026-09-10T00:00:00Z', lastActivityAt: '2026-09-12T00:00:00Z', pendingTaskCount: 1, nextTask: { id: 't1', dueAt: '2026-09-14T00:00:00Z' }, contactCount: 1 };
test('clear means no configured signals, not win probability or ROI', () => { const h = evaluateDealHealth(healthy, options); assert.equal(h.status, 'CLEAR'); assert.equal(h.attentionScore, 0); assert.ok(h.notEvaluated.includes('Probability of winning')); assert.equal('roi' in h, false); });
test('closed, unqualified and archived records never get an open-deal risk score', () => { for (const stage of ['CLOSED_WON', 'CLOSED_LOST', 'UNQUALIFIED_TO_BUY']) {
    const h = evaluateDealHealth({ ...healthy, stage }, options);
    assert.equal(h.status, 'NOT_APPLICABLE');
    assert.equal(h.attentionScore, null);
} assert.equal(evaluateDealHealth({ ...healthy, archivedAt: options.now }, options).status, 'NOT_APPLICABLE'); });
test('every signal points to a recorded source and a reproducible weight', () => { const h = evaluateDealHealth({ ...healthy, createdAt: '2026-07-01T00:00:00Z', stageChangedAt: '2026-08-01T00:00:00Z', lastActivityAt: '2026-08-02T00:00:00Z', pendingTaskCount: 0, nextTask: null, contactCount: 0, expectedCloseDate: '2026-09-01T00:00:00Z' }, options); assert.equal(h.status, 'NEEDS_ATTENTION'); assert.equal(h.attentionScore, 95); for (const s of h.signals) {
    assert.equal(s.evidence.recordId, 'd1');
    assert.equal(s.evidence.checkedAt, '2026-09-13T10:00:00.000Z');
    assert.ok(s.weight > 0);
} });
test('overdue tasks link to the exact activity, not an inferred commitment', () => { const h = evaluateDealHealth({ ...healthy, nextTask: { id: 't42', dueAt: '2026-09-12T00:00:00Z' } }, options); const s = h.signals.find(s => s.id === 'TASK_OVERDUE'); assert.equal(s.evidence.model, 'Activity'); assert.equal(s.evidence.recordId, 't42'); });
test('future/missing source timestamps make score unknown, never silently healthy', () => { for (const stageChangedAt of [null, 'bad', '2027-01-01T00:00:00Z']) {
    const h = evaluateDealHealth({ ...healthy, stageChangedAt }, options);
    assert.equal(h.status, 'INSUFFICIENT_DATA');
    assert.equal(h.attentionScore, null);
    assert.ok(h.unknown.length);
} });
test('task snapshot gaps are not reported as absence of a next step', () => { const h = evaluateDealHealth({ ...healthy, pendingTaskCount: undefined, nextTask: null }, options); assert.equal(h.status, 'INSUFFICIENT_DATA'); assert.equal(h.signals.some(s => s.id === 'NO_NEXT_STEP'), false); });
test('business-date comparison follows Tashkent midnight rather than UTC midnight', () => { const input = { ...healthy, expectedCloseDate: '2026-09-13T00:00:00Z' }; assert.equal(evaluateDealHealth(input, { now: new Date('2026-09-13T18:59:00Z') }).signals.some(s => s.id === 'CLOSE_OVERDUE'), false); assert.equal(evaluateDealHealth(input, { now: new Date('2026-09-13T19:00:00Z') }).signals.some(s => s.id === 'CLOSE_OVERDUE'), true); });
test('activity and stage thresholds use complete days without boundary rounding', () => { const input = { ...healthy, createdAt: '2026-09-01T00:00:00Z', lastActivityAt: '2026-09-06T10:00:01Z' }; assert.equal(evaluateDealHealth(input, options).signals.some(s => s.id === 'INACTIVE'), false); input.lastActivityAt = '2026-09-06T10:00:00Z'; assert.equal(evaluateDealHealth(input, options).signals.find(s => s.id === 'INACTIVE').weight, 15); });
test('does not mutate the source record and produces deterministic snapshots', () => { const before = JSON.stringify(healthy); assert.deepEqual(evaluateDealHealth(healthy, options), evaluateDealHealth(healthy, options)); assert.equal(JSON.stringify(healthy), before); });
test('unknown stage semantics and incomplete task records fail closed', () => { assert.equal(evaluateDealHealth({ ...healthy, stage: 'CUSTOM_UNKNOWN' }, options).status, 'INSUFFICIENT_DATA'); assert.equal(evaluateDealHealth({ ...healthy, nextTask: null }, options).status, 'INSUFFICIENT_DATA'); });
