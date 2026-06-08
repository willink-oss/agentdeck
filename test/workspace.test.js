'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { KEY, toConfig, normalize } = require('../lib/workspace');

test('KEY is a stable storage key', () => {
  assert.equal(KEY, 'agentdeck.workspace');
});

test('toConfig: picks launch fields; worktree session uses gitCwd as cwd', () => {
  const s = { presetKey: 'claude', command: 'claude', name: 'A', gitCwd: '/wt/x', launchCwd: '/repo' };
  assert.deepEqual(toConfig(s), { presetKey: 'claude', command: 'claude', name: 'A', cwd: '/wt/x' });
});

test('toConfig: falls back to launchCwd, and to shell/empty for missing fields', () => {
  assert.deepEqual(toConfig({ launchCwd: '/repo' }),
    { presetKey: 'shell', command: '', name: '', cwd: '/repo' });
  assert.deepEqual(toConfig({}), { presetKey: 'shell', command: '', name: '', cwd: '' });
  assert.deepEqual(toConfig(null), { presetKey: 'shell', command: '', name: '', cwd: '' });
});

test('normalize: keeps valid entries, drops malformed, coerces fields', () => {
  const raw = [
    { presetKey: 'shell', command: '', name: 'a', cwd: '/a' },
    { presetKey: 'claude', command: 'claude', name: 'b', cwd: '/b' },
    { command: 'x' },            // no presetKey -> dropped
    { presetKey: '' },           // empty presetKey -> dropped
    null,                        // -> dropped
    'nope',                      // -> dropped
    { presetKey: 'codex' },      // missing fields -> coerced to defaults
  ];
  assert.deepEqual(normalize(raw), [
    { presetKey: 'shell', command: '', name: 'a', cwd: '/a' },
    { presetKey: 'claude', command: 'claude', name: 'b', cwd: '/b' },
    { presetKey: 'codex', command: '', name: '', cwd: '' },
  ]);
});

test('normalize: non-array -> empty', () => {
  assert.deepEqual(normalize(null), []);
  assert.deepEqual(normalize({}), []);
  assert.deepEqual(normalize(undefined), []);
});

test('toConfig output survives a normalize round-trip', () => {
  const s = { presetKey: 'gemini', command: 'gemini', name: 'G', gitCwd: '', launchCwd: '/g' };
  assert.deepEqual(normalize([toConfig(s)]), [toConfig(s)]);
});
