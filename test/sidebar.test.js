'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/sidebar');

/* The bounds carry meaning: below MIN the repo rows stop being readable, above
 * MAX the stage can no longer fit two 420px terminal columns, which is the
 * promise `fit` makes. So they are tested as a contract, not as magic numbers. */

test('the bounds leave room for what each side has to show', () => {
  assert.ok(S.MIN < S.DEFAULT && S.DEFAULT < S.MAX);
  // a 1440px window minus MAX must still hold two fit columns (2*420 + 1 gap)
  assert.ok(1440 - S.MAX >= 841, `stage keeps two fit columns at MAX (${1440 - S.MAX}px)`);
});

test('clampWidth: holds the value inside the bounds', () => {
  assert.equal(S.clampWidth(300), 300);
  assert.equal(S.clampWidth(10), S.MIN);
  assert.equal(S.clampWidth(9999), S.MAX);
  assert.equal(S.clampWidth(S.MIN), S.MIN);
  assert.equal(S.clampWidth(S.MAX), S.MAX);
});

test('clampWidth: rounds to whole pixels', () => {
  assert.equal(S.clampWidth(300.4), 300);
  assert.equal(S.clampWidth(300.6), 301);
});

test('clampWidth: junk falls back to the default rather than collapsing', () => {
  for (const junk of [null, undefined, '', 'wide', NaN, Infinity, -Infinity, {}, []]) {
    assert.equal(S.clampWidth(junk), S.DEFAULT, String(junk));
  }
});

test('clampWidth: accepts a numeric string, as a stored value would be', () => {
  assert.equal(S.clampWidth('320'), 320);
});

test('widthFromPointer: the divider does not jump under the cursor', () => {
  // grabbed 6px right of the edge: the width tracks the pointer minus that offset
  assert.equal(S.widthFromPointer(306, 6), 300);
  assert.equal(S.widthFromPointer(306, 0), 306);
  assert.equal(S.widthFromPointer(306), 306);
});

test('widthFromPointer: dragging past either end stops at the bound', () => {
  assert.equal(S.widthFromPointer(-500, 0), S.MIN);
  assert.equal(S.widthFromPointer(5000, 0), S.MAX);
});

test('normalizeStored: an absent or unusable value gives the default', () => {
  for (const raw of [null, undefined, '', 'nope', '{}']) {
    assert.equal(S.normalizeStored(raw), S.DEFAULT, String(raw));
  }
});

test('normalizeStored: a stored width is honoured', () => {
  assert.equal(S.normalizeStored('320'), 320);
  assert.equal(S.normalizeStored(320), 320);
});

test('normalizeStored: an out-of-bounds stored width is clamped, not discarded', () => {
  // the bounds may change between releases; "the user wanted it wide" survives
  assert.equal(S.normalizeStored(String(S.MAX + 200)), S.MAX);
  assert.equal(S.normalizeStored(String(S.MIN - 200)), S.MIN);
});

test('normalizeStored: is idempotent, so it doubles as the loader normalizer', () => {
  const once = S.normalizeStored('9999');
  assert.equal(S.normalizeStored(String(once)), once);
});

test('stepWidth: keyboard resize moves by a readable amount and stays in bounds', () => {
  assert.equal(S.stepWidth(300, 1, false), 308);
  assert.equal(S.stepWidth(300, -1, false), 292);
  assert.equal(S.stepWidth(300, 1, true), 332);
  assert.equal(S.stepWidth(S.MAX, 1, true), S.MAX);
  assert.equal(S.stepWidth(S.MIN, -1, true), S.MIN);
});

test('stepWidth: a junk current width still yields a usable one', () => {
  assert.equal(S.stepWidth(NaN, 1, false), S.DEFAULT + 8);
});

test('the storage key is distinct from the other renderer keys', () => {
  assert.equal(S.KEY, 'agentdeck.sidebarWidth');
  assert.notEqual(S.KEY, 'agentdeck.layout');
});
