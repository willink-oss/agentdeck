'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MODES, normalizeLayoutMode, gridTemplateFor } = require('../lib/layout');

test('MODES lists auto + fixed column counts', () => {
  assert.deepEqual(MODES, ['auto', '1', '2', '3']);
});

test('normalizeLayoutMode: known modes pass, anything else -> auto', () => {
  assert.equal(normalizeLayoutMode('auto'), 'auto');
  assert.equal(normalizeLayoutMode('2'), '2');
  assert.equal(normalizeLayoutMode('  3 '), '3'); // trims
  assert.equal(normalizeLayoutMode(''), 'auto');
  assert.equal(normalizeLayoutMode('9'), 'auto');
  assert.equal(normalizeLayoutMode(null), 'auto');
  assert.equal(normalizeLayoutMode(undefined), 'auto');
});

test('gridTemplateFor: fixed column counts', () => {
  assert.equal(gridTemplateFor('1'), '1fr');
  assert.equal(gridTemplateFor('2'), 'repeat(2, 1fr)');
  assert.equal(gridTemplateFor('3'), 'repeat(3, 1fr)');
});

test('gridTemplateFor: auto + unknown fall back to responsive auto-fit', () => {
  const autofit = 'repeat(auto-fit, minmax(440px, 1fr))';
  assert.equal(gridTemplateFor('auto'), autofit);
  assert.equal(gridTemplateFor('bogus'), autofit);
  assert.equal(gridTemplateFor(null), autofit);
});

test('MODES is a copy — mutating it does not affect the module', () => {
  MODES.push('99');
  assert.equal(normalizeLayoutMode('99'), 'auto');
});
