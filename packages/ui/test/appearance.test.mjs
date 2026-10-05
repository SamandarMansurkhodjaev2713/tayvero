import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { APPEARANCE_BOOTSTRAP, DEFAULT_APPEARANCE, PALETTES, THEME_TOKENS, applyAppearance, parseAppearance, generateAppearanceCss } from '../src/theme/appearance.mjs';
function luminance(hex) {
    const rgb = hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(a, b) { const values = [luminance(a), luminance(b)].sort((a, b) => b - a); return (values[0] + .05) / (values[1] + .05); }
for (const palette of PALETTES)
    for (const mode of ['light', 'dark']) {
        test(`${palette.id}/${mode}: semantic text and controls meet contrast thresholds`, () => {
            const t = THEME_TOKENS[palette.id][mode];
            for (const [fg, bg] of [['foreground', 'background'], ['card-foreground', 'card'], ['popover-foreground', 'popover'], ['muted-foreground', 'muted'], ['muted-foreground', 'background'], ['muted-foreground', 'card'], ['accent-foreground', 'accent'], ['primary-foreground', 'primary'], ['destructive-foreground', 'destructive'], ['success-foreground', 'success'], ['warning-foreground', 'warning'], ['info-foreground', 'info'], ['sidebar-primary', 'sidebar-accent']]) {
                assert.ok(contrast(t[fg], t[bg]) >= 4.5, `${fg}/${bg}: ${contrast(t[fg], t[bg])}`);
            }
            for (const token of ['ring', 'input'])
                for (const bg of ['background', 'card'])
                    assert.ok(contrast(t[token], t[bg]) >= 3, `${token}/${bg}: ${contrast(t[token], t[bg])}`);
        });
    }
test('invalid, oversized or future-version stored preferences fall back safely', () => {
    for (const raw of [null, '', '{broken', 'x'.repeat(2050), 'null', '[]', '{"version":2,"palette":"sand"}'])
        assert.deepEqual(parseAppearance(raw), DEFAULT_APPEARANCE);
    assert.deepEqual(parseAppearance('{"version":1,"palette":"url(javascript:bad)","density":"huge","navigation":"bad"}'), DEFAULT_APPEARANCE);
});
test('whitelisted preferences survive parsing and DOM application; unrelated attributes remain', () => {
    const root = { dataset: { locale: 'uz' } };
    const value = { version: 1, palette: 'grove', density: 'compact', navigation: 'compact' };
    assert.deepEqual(applyAppearance(root, parseAppearance(JSON.stringify(value))), value);
    assert.equal(root.dataset.locale, 'uz');
    assert.equal(root.dataset.palette, 'grove');
    assert.equal(root.dataset.density, 'compact');
});
test('pre-paint bootstrap and parser agree, including unavailable storage', () => {
    for (const raw of [null, 'x', '{"version":1,"palette":"indigo","density":"compact","navigation":"expanded"}', '{"version":2,"palette":"sand"}']) {
        const document = { documentElement: { dataset: {} } };
        vm.runInNewContext(APPEARANCE_BOOTSTRAP, { document, localStorage: { getItem: () => raw } });
        const expected = parseAppearance(raw);
        for (const key of ['palette', 'density', 'navigation'])
            assert.equal(document.documentElement.dataset[key], expected[key]);
    }
    const document = { documentElement: { dataset: {} } };
    vm.runInNewContext(APPEARANCE_BOOTSTRAP, { document, localStorage: { getItem() { throw Error('disabled'); } } });
    assert.equal(document.documentElement.dataset.palette, 'graphite');
});
test('generated CSS is exactly derived from the tested token registry', async () => {
    const css = await readFile(new URL('../src/styles/globals.css', import.meta.url), 'utf8');
    assert.ok(css.endsWith(generateAppearanceCss()));
    assert.ok(css.includes('prefers-reduced-motion: reduce'));
    assert.ok(css.includes(':focus-visible'));
});
test('palette contracts are immutable and equally capable', () => {
    const keys = Object.keys(THEME_TOKENS.graphite.light).sort();
    for (const p of PALETTES)
        for (const mode of ['light', 'dark']) {
            assert.deepEqual(Object.keys(THEME_TOKENS[p.id][mode]).sort(), keys);
            assert.throws(() => { THEME_TOKENS[p.id][mode].primary = '#fff'; }, TypeError);
        }
});
