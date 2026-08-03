'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  KEY, VERSION, toConfig, normalize, createSnapshot, normalizeSnapshot,
} = require('../lib/workspace');

test('KEY is a stable storage key', () => {
  assert.equal(KEY, 'agentdeck.workspace');
  assert.equal(VERSION, 2);
});

test('toConfig: worktree session keeps its reopen cwd plus parent-repo metadata', () => {
  const s = {
    presetKey: 'claude', command: 'claude', name: 'A', gitCwd: '/wt/x', launchCwd: '/repo',
    repoId: '/repo', baseSha: 'abc123', branch: 'agentdeck/a', baseBranch: 'main', gitRoot: '/repo', worktreePath: '/wt/x',
  };
  assert.deepEqual(toConfig(s), {
    presetKey: 'claude', command: 'claude', name: 'A', cwd: '/wt/x', launchCwd: '/repo',
    repoId: '/repo', baseSha: 'abc123', branch: 'agentdeck/a', baseBranch: 'main', gitRoot: '/repo', worktreePath: '/wt/x',
  });
});

test('toConfig: falls back to launchCwd, and to shell/empty for missing fields', () => {
  assert.deepEqual(toConfig({ launchCwd: '/repo' }),
    { presetKey: 'shell', command: '', name: '', cwd: '/repo' });
  assert.deepEqual(toConfig({}), { presetKey: 'shell', command: '', name: '', cwd: '' });
  assert.deepEqual(toConfig(null), { presetKey: 'shell', command: '', name: '', cwd: '' });
});

test('toConfig: plain repo keeps affinity but recomputes branch/base on restore', () => {
  assert.deepEqual(toConfig({
    presetKey: 'codex', command: 'codex', gitCwd: '/repo', launchCwd: '/repo', repoId: '/repo',
    baseSha: 'stale-base', branch: 'stale-branch', gitRoot: null, worktreePath: null,
  }), {
    presetKey: 'codex', command: 'codex', name: '', cwd: '/repo', repoId: '/repo',
  });
});

test('toConfig: empty-string gitCwd falls through to launchCwd, not "" (|| not ??)', () => {
  // A plain (non-worktree) saved session carries gitCwd:'' + a real launchCwd; the
  // empty-string coalescing (`gitCwd || launchCwd`) is what makes a restored deck
  // reopen the project dir instead of '' (home/undefined cwd). A `||`->`??`
  // modernization would silently break this on every restart — and the round-trip
  // test stays green under either operator — so this case must be pinned explicitly.
  const s = { presetKey: 'gemini', command: 'gemini', name: 'G', gitCwd: '', launchCwd: '/g' };
  assert.equal(toConfig(s).cwd, '/g');
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

test('normalize: preserves valid v2 metadata and drops malformed optional values', () => {
  assert.deepEqual(normalize([{
    presetKey: 'codex', command: 'codex', cwd: '/wt/c', launchCwd: '/repo', repoId: '/repo',
    baseSha: 'deadbeef', branch: 'agentdeck/c', baseBranch: 'main', gitRoot: '/repo', worktreePath: '/wt/c',
  }, {
    presetKey: 'shell', repoId: 42, baseSha: null, branch: '', gitRoot: {}, worktreePath: false,
  }]), [{
    presetKey: 'codex', command: 'codex', name: '', cwd: '/wt/c', launchCwd: '/repo', repoId: '/repo',
    baseSha: 'deadbeef', branch: 'agentdeck/c', baseBranch: 'main', gitRoot: '/repo', worktreePath: '/wt/c',
  }, {
    presetKey: 'shell', command: '', name: '', cwd: '',
  }]);
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

test('createSnapshot: stores layout and normalized sessions in the v2 envelope', () => {
  assert.deepEqual(createSnapshot([
    { presetKey: 'codex', command: 'codex', name: 'API', cwd: '/api' },
    { command: 'bad' },
  ], 'fit'), {
    version: 2,
    layout: 'fit',
    sessions: [{ presetKey: 'codex', command: 'codex', name: 'API', cwd: '/api' }],
  });
});

test('normalizeSnapshot: upgrades a legacy array and inherits the separately saved layout', () => {
  assert.deepEqual(normalizeSnapshot([
    { presetKey: 'claude', command: 'claude', name: 'web', cwd: '/web' },
  ], '2'), {
    version: 2,
    layout: '2',
    sessions: [{ presetKey: 'claude', command: 'claude', name: 'web', cwd: '/web' }],
  });
});

test('normalizeSnapshot: sanitizes unknown layout and malformed envelopes', () => {
  assert.deepEqual(normalizeSnapshot({ version: 99, layout: 'huge', sessions: [
    { presetKey: 'shell', cwd: '/tmp' },
  ] }, 'fit'), {
    version: 2,
    layout: 'fit',
    sessions: [{ presetKey: 'shell', command: '', name: '', cwd: '/tmp' }],
  });
  assert.deepEqual(normalizeSnapshot(null, '3'), { version: 2, layout: '3', sessions: [] });
});

/* ---- profileId: which variant produced the saved command ------------------ */

test('toConfig: carries profileId so a restored pane can name its variant', () => {
  const cfg = toConfig({ presetKey: 'claude', command: 'claude --continue', profileId: 'continue', launchCwd: '/w' });
  assert.equal(cfg.profileId, 'continue');
  assert.equal(cfg.command, 'claude --continue');
});

test('toConfig: omits profileId when there is none, keeping plain decks small', () => {
  const cfg = toConfig({ presetKey: 'shell', launchCwd: '/w' });
  assert.equal('profileId' in cfg, false);
  assert.equal('profileId' in toConfig({ presetKey: 'shell', profileId: '', launchCwd: '/w' }), false);
});

test('toConfig: profileId rides along on worktree sessions too', () => {
  const cfg = toConfig({
    presetKey: 'codex', command: 'codex resume --last', profileId: 'continue',
    gitCwd: '/w/.agentdeck-worktrees/x', launchCwd: '/w', worktreePath: '/w/.agentdeck-worktrees/x',
    branch: 'agentdeck/x', baseBranch: 'main', baseSha: 'a'.repeat(40), gitRoot: '/w',
  });
  assert.equal(cfg.profileId, 'continue');
  assert.equal(cfg.worktreePath, '/w/.agentdeck-worktrees/x');
});

test('normalize: keeps a valid profileId and drops a malformed one', () => {
  assert.equal(normalize([{ presetKey: 'claude', profileId: 'plan' }])[0].profileId, 'plan');
  assert.equal('profileId' in normalize([{ presetKey: 'claude', profileId: 42 }])[0], false);
  assert.equal('profileId' in normalize([{ presetKey: 'claude', profileId: null }])[0], false);
  assert.equal('profileId' in normalize([{ presetKey: 'claude' }])[0], false);
});

test('normalize: a deck saved by an older build still restores, just without the variant', () => {
  const legacy = [{ presetKey: 'claude', command: 'claude --continue', name: 'a', cwd: '/w' }];
  const out = normalize(legacy);
  assert.equal(out[0].command, 'claude --continue'); // the concrete command is what replays
  assert.equal('profileId' in out[0], false);
});

test('profileId survives a save/load round trip', () => {
  const snap = createSnapshot([toConfig({ presetKey: 'claude', command: 'claude --permission-mode plan', profileId: 'plan', launchCwd: '/w' })], 'fit');
  const back = normalizeSnapshot(JSON.parse(JSON.stringify(snap)), 'auto');
  assert.equal(back.sessions[0].profileId, 'plan');
  assert.equal(back.layout, 'fit');
});
