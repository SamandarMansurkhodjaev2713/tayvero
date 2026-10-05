import assert from 'node:assert/strict';
import test from 'node:test';
import { publicErrorMessage } from '../src/trpc/public-error.mjs';
test('unexpected server errors never expose raw diagnostic messages', () => {
    for (const code of ['INTERNAL_SERVER_ERROR', 'UNKNOWN', 'BAD_GATEWAY', 'TIMEOUT'])
        assert.equal(publicErrorMessage(code, 'database contents and PII'), publicErrorMessage(code, 'anything else'));
});
test('expected validation guidance remains useful but bounded and single-line', () => {
    assert.equal(publicErrorMessage('BAD_REQUEST', 'Choose a valid email address.'), 'Choose a valid email address.');
    assert.equal(publicErrorMessage('BAD_REQUEST', 'First\nsecond'), 'First second');
    assert.equal(publicErrorMessage('BAD_REQUEST', 'x'.repeat(1000)).length, 500);
});
test('misclassified internal or credential diagnostics are masked', () => {
    for (const value of ['PrismaClientKnownRequestError P2002', 'postgresql://hidden', 'Authorization: hidden', 'Bearer abcdef123', 'password=hunter', 'SELECT email FROM contact'])
        assert.ok(!publicErrorMessage('BAD_REQUEST', value).includes(value));
});
