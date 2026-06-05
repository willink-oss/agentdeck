'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { shouldFlagAttention } = require('../lib/attention');

const base = { alive: true, hasOutput: true, attention: false, lastData: 0, watching: false };
const THRESH = 6000;

test('flags when idle beyond threshold', () => {
  assert.equal(shouldFlagAttention({ ...base, lastData: 0 }, 6001, THRESH), true);
});

test('does not flag before threshold', () => {
  assert.equal(shouldFlagAttention({ ...base, lastData: 0 }, 5999, THRESH), false);
});

test('does not flag the session the user is actively watching', () => {
  assert.equal(shouldFlagAttention({ ...base, watching: true }, 10000, THRESH), false);
});

test('does not flag dead sessions', () => {
  assert.equal(shouldFlagAttention({ ...base, alive: false }, 10000, THRESH), false);
});

test('does not flag sessions that have produced no output yet', () => {
  assert.equal(shouldFlagAttention({ ...base, hasOutput: false }, 10000, THRESH), false);
});

test('does not re-flag an already-flagged session', () => {
  assert.equal(shouldFlagAttention({ ...base, attention: true }, 10000, THRESH), false);
});

test('handles missing state object', () => {
  assert.equal(shouldFlagAttention(null, 10000, THRESH), false);
});
