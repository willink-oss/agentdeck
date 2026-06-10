'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../lib/presets');

test('BUILTINS: the five known presets, shell included', () => {
  assert.deepEqual(Object.keys(P.BUILTINS), ['claude', 'antigravity', 'codex', 'gemini', 'shell']);
  assert.equal(P.KEY, 'agentdeck.presets');
  assert.ok(P.isBuiltin('shell'));
  assert.ok(!P.isBuiltin('custom-aider'));
});

test('deriveBadge: first word uppercased, capped, with fallback', () => {
  assert.equal(P.deriveBadge('Claude Code'), 'CLAUDE');
  assert.equal(P.deriveBadge('aider'), 'AIDER');
  assert.equal(P.deriveBadge('SuperLongAgentName Tool'), 'SUPERLONGAG'); // 11-char cap
  assert.equal(P.deriveBadge('  '), 'AGENT');
  assert.equal(P.deriveBadge(null), 'AGENT');
  assert.equal(P.deriveBadge('日本語エージェント'), 'AGENT'); // non-latin strips to empty
  assert.equal(P.deriveBadge('c++ tool'), 'C++');
});

test('keyFor: slugged, custom- prefixed, deduped', () => {
  assert.equal(P.keyFor('Aider Chat', []), 'custom-aider-chat');
  assert.equal(P.keyFor('Aider', ['custom-aider']), 'custom-aider-2');
  assert.equal(P.keyFor('Aider', ['custom-aider', 'custom-aider-2']), 'custom-aider-3');
  assert.equal(P.keyFor('!!!', []), 'custom-agent'); // symbols-only label
  // a label of 'claude' can never collide with the built-in key 'claude'
  assert.equal(P.keyFor('claude', []), 'custom-claude');
});

test('validate: label required, trimmed, capped; cmd may be empty', () => {
  assert.deepEqual(P.validate('  Aider ', ' aider '), { ok: true, label: 'Aider', cmd: 'aider' });
  assert.equal(P.validate('', 'x').ok, false);
  assert.equal(P.validate('   ', 'x').ok, false);
  assert.equal(P.validate('x'.repeat(41), 'x').ok, false);
  assert.deepEqual(P.validate('Shell-ish', ''), { ok: true, label: 'Shell-ish', cmd: '' });
});

test('normalizeCustom: drops malformed, built-in-shadowing, and duplicate entries', () => {
  assert.deepEqual(P.normalizeCustom(null), []);
  assert.deepEqual(P.normalizeCustom('nope'), []);
  const raw = [
    { key: 'custom-a', label: 'A', cmd: 'a' },
    { key: 'claude', label: 'evil', cmd: 'rm -rf' },   // shadows a built-in -> dropped
    { key: 'custom-a', label: 'dup', cmd: '' },        // duplicate key -> dropped
    { key: '', label: 'x', cmd: 'x' },                 // empty key -> dropped
    { key: 'custom-b', label: '  ', cmd: 'b' },        // blank label -> dropped
    { key: 'custom-c', label: ' C ', cmd: 42 },        // non-string cmd -> ''
    'garbage', null,
  ];
  assert.deepEqual(P.normalizeCustom(raw), [
    { key: 'custom-a', label: 'A', cmd: 'a' },
    { key: 'custom-c', label: 'C', cmd: '' },
  ]);
});

test('normalizeCustom: caps hand-edited labels at 40 chars (validate symmetry)', () => {
  const out = P.normalizeCustom([{ key: 'custom-x', label: 'y'.repeat(80), cmd: '' }]);
  assert.equal(out[0].label.length, 40);
});

test('normalizeCustom: round-trips its own output', () => {
  const list = [{ key: 'custom-a', label: 'A', cmd: 'a' }];
  assert.deepEqual(P.normalizeCustom(P.normalizeCustom(list)), list);
});

test('merge: built-ins always present and never overridden', () => {
  const merged = P.merge([{ key: 'custom-aider', label: 'Aider', cmd: 'aider' }]);
  assert.equal(merged.shell.label, 'Plain shell');
  assert.deepEqual(merged['custom-aider'], { label: 'Aider', cmd: 'aider', badge: 'AIDER' });
  // built-ins keep their explicit badges
  assert.equal(merged.antigravity.badge, 'ANTIGRAVITY');
  // order: built-ins first, customs after
  assert.deepEqual(Object.keys(merged).slice(0, 5), Object.keys(P.BUILTINS));
});

test('merge: tolerates an un-normalized custom list', () => {
  const merged = P.merge([{ key: 'claude', label: 'evil', cmd: 'x' }, null, { key: 'custom-a', label: 'A', cmd: '' }]);
  assert.equal(merged.claude.cmd, 'claude'); // built-in untouched
  assert.ok(merged['custom-a']);
  assert.equal(P.merge(undefined).claude.label, 'Claude Code');
});

test('chipKeys: four agent built-ins (no shell) then customs', () => {
  assert.deepEqual(P.chipKeys([]), ['claude', 'antigravity', 'codex', 'gemini']);
  assert.deepEqual(
    P.chipKeys([{ key: 'custom-aider', label: 'Aider', cmd: 'aider' }]),
    ['claude', 'antigravity', 'codex', 'gemini', 'custom-aider']);
  assert.ok(!P.chipKeys([]).includes('shell'));
});
