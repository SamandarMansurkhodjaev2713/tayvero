import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAmountInput, formatAmountInput, MAX_AMOUNT_CENTS } from '../src/money-input.mjs';
test('decimal money input converts exactly without binary floating-point rounding', () => { for (const [text, n] of [['0', 0], ['1.01', 101], ['1.15', 115], ['.50', 50], ['12.', 1200], [' 24000.50 ', 2400050], ['0001.20', 120]])
    assert.equal(parseAmountInput(text), n); assert.equal(parseAmountInput(' '), null); });
test('rejects parseFloat-style trailing junk, grouping, exponent, negative and overprecision', () => { for (const text of ['100USD', '1,000', '1e4', '-1', 'NaN', 'Infinity', '1.005', '.', '1.2.3'])
    assert.throws(() => parseAmountInput(text), e => e.code === 'INVALID_AMOUNT'); });
test('maximum supported amount round trips exactly and overflow is rejected', () => { assert.equal(parseAmountInput('999999999999.99'), MAX_AMOUNT_CENTS); assert.equal(parseAmountInput(formatAmountInput(MAX_AMOUNT_CENTS)), MAX_AMOUNT_CENTS); assert.throws(() => parseAmountInput('1000000000000.00'), e => e.code === 'AMOUNT_TOO_LARGE'); });
test('input formatter does not turn absent data into zero or accept corrupt stored cents', () => { assert.equal(formatAmountInput(null), ''); assert.equal(formatAmountInput(1), '0.01'); for (const x of [-1, 1.1, Infinity, MAX_AMOUNT_CENTS + 1])
    assert.throws(() => formatAmountInput(x)); });
