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
  // a leading decorative token (emoji / arrow / bullet) is skipped, not fatal
  assert.equal(P.deriveBadge('→ Go'), 'GO');           // was 'AGENT'
  assert.equal(P.deriveBadge('🚀 Rocket'), 'ROCKET');  // was 'AGENT'
  assert.equal(P.deriveBadge('• Aider chat'), 'AIDER'); // was 'AGENT'
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
  assert.deepEqual(merged['custom-aider'], { label: 'Aider', cmd: 'aider', badge: 'AIDER', init: [] });
  // built-ins keep their explicit badges
  assert.equal(merged.antigravity.badge, 'ANTIGRAVITY');
  // every entry carries an init array (empty when unconfigured)
  assert.deepEqual(merged.claude.init, []);
  // order: built-ins first, customs after
  assert.deepEqual(Object.keys(merged).slice(0, 5), Object.keys(P.BUILTINS));
});

test('merge: tolerates an un-normalized custom list', () => {
  const merged = P.merge([{ key: 'claude', label: 'evil', cmd: 'x' }, null, { key: 'custom-a', label: 'A', cmd: '' }]);
  assert.equal(merged.claude.cmd, 'claude'); // built-in untouched
  assert.ok(merged['custom-a']);
  assert.equal(P.merge(undefined).claude.label, 'Claude Code');
  assert.deepEqual(P.merge(undefined).claude.init, []); // no init map -> empty arrays, no throw
});

test('merge: folds init commands onto built-in and custom presets by key', () => {
  const merged = P.merge(
    [{ key: 'custom-aider', label: 'Aider', cmd: 'aider' }],
    { claude: ['/effort ultracode'], 'custom-aider': ['/help'], 'no-such': ['x'] });
  assert.deepEqual(merged.claude.init, ['/effort ultracode']); // built-in init override
  assert.deepEqual(merged['custom-aider'].init, ['/help']);
  assert.deepEqual(merged.antigravity.init, []);              // unconfigured built-in stays empty
  // an init entry for an unknown key is simply ignored (no phantom preset created)
  assert.ok(!merged['no-such']);
});

test('merge: a string init value is split into lines (loader-side tolerance)', () => {
  const merged = P.merge([], { claude: '/effort ultracode\n/model opus' });
  assert.deepEqual(merged.claude.init, ['/effort ultracode', '/model opus']);
});

test('parseInit: splits, trims, drops blanks, caps count and length', () => {
  assert.deepEqual(P.parseInit('  /effort ultracode \n\n /model opus '), ['/effort ultracode', '/model opus']);
  assert.deepEqual(P.parseInit(['a', '', '  ', 'b']), ['a', 'b']);
  assert.deepEqual(P.parseInit(''), []);
  assert.deepEqual(P.parseInit(null), []);
  assert.deepEqual(P.parseInit(undefined), []);
  // count cap
  const many = Array.from({ length: P.MAX_INIT_LINES + 5 }, (_, i) => 'cmd' + i);
  assert.equal(P.parseInit(many).length, P.MAX_INIT_LINES);
  // per-line length cap
  assert.equal(P.parseInit('x'.repeat(P.INIT_LINE_MAX + 50))[0].length, P.INIT_LINE_MAX);
  // CRLF handled
  assert.deepEqual(P.parseInit('a\r\nb'), ['a', 'b']);
  // a lone CR (no LF) is also a separator — one line can't fan out into two REPL commands
  assert.deepEqual(P.parseInit('foo\rbar'), ['foo', 'bar']);
  // and an array element carrying an embedded separator is split too
  assert.deepEqual(P.parseInit(['a\rb', 'c']), ['a', 'b', 'c']);
  // residual control chars (ESC / BEL / etc.) are stripped, never written to the PTY
  assert.deepEqual(P.parseInit('a\x1b[31mb\x07'), ['a[31mb']);
});

test('parseInit: idempotent (re-parsing its own output is a no-op)', () => {
  const once = P.parseInit('  /effort ultracode \n /model opus ');
  assert.deepEqual(P.parseInit(once), once);
});

test('normalizeInitMap: keeps clean lists, drops empties and non-objects', () => {
  assert.deepEqual(P.normalizeInitMap(null), {});
  assert.deepEqual(P.normalizeInitMap('nope'), {});
  assert.deepEqual(P.normalizeInitMap([1, 2]), {}); // arrays have no own string keys here
  assert.deepEqual(
    P.normalizeInitMap({ claude: [' /effort ultracode ', ''], antigravity: ['  ', ''], codex: 'go\n' }),
    { claude: ['/effort ultracode'], codex: ['go'] }); // antigravity normalizes to empty -> dropped
});

test('KEY_INIT: distinct storage key from the custom-preset list', () => {
  assert.equal(P.KEY_INIT, 'agentdeck.presetInit');
  assert.notEqual(P.KEY_INIT, P.KEY);
});

test('chipKeys: four agent built-ins (no shell) then customs', () => {
  assert.deepEqual(P.chipKeys([]), ['claude', 'antigravity', 'codex', 'gemini']);
  assert.deepEqual(
    P.chipKeys([{ key: 'custom-aider', label: 'Aider', cmd: 'aider' }]),
    ['claude', 'antigravity', 'codex', 'gemini', 'custom-aider']);
  assert.ok(!P.chipKeys([]).includes('shell'));
});
