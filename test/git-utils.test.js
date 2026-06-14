'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { defaultShell, sanitizeBranch, worktreeFolderName } = require('../lib/git-utils');

test('defaultShell: Windows -> PowerShell', () => {
  assert.equal(defaultShell('win32', {}), 'powershell.exe');
  assert.equal(defaultShell('win32', { SHELL: '/bin/bash' }), 'powershell.exe');
});

test('defaultShell: macOS/Linux honour $SHELL', () => {
  assert.equal(defaultShell('darwin', { SHELL: '/bin/zsh' }), '/bin/zsh');
  assert.equal(defaultShell('linux', { SHELL: '/usr/bin/fish' }), '/usr/bin/fish');
});

test('defaultShell: falls back per-platform without $SHELL (zsh on macOS, sh elsewhere)', () => {
  assert.equal(defaultShell('darwin', {}), '/bin/zsh');  // macOS ships zsh as the default shell
  assert.equal(defaultShell('linux'), '/bin/sh');        // zsh isn't guaranteed on Linux; /bin/sh is universal
  assert.equal(defaultShell('freebsd', {}), '/bin/sh');  // any other *nix → POSIX /bin/sh
});

test('sanitizeBranch: spaces become hyphens', () => {
  assert.equal(sanitizeBranch('feature branch one'), 'feature-branch-one');
});

test('sanitizeBranch: strips illegal characters', () => {
  assert.equal(sanitizeBranch('feat/x~y^z:?*'), 'feat/xyz');
});

test('sanitizeBranch: trims leading/trailing separators', () => {
  assert.equal(sanitizeBranch('//lead--'), 'lead');
});

test('sanitizeBranch: empty / nullish -> "session"', () => {
  assert.equal(sanitizeBranch(''), 'session');
  assert.equal(sanitizeBranch('   '), 'session');
  assert.equal(sanitizeBranch(null), 'session');
  assert.equal(sanitizeBranch(undefined), 'session');
});

test('sanitizeBranch: keeps slashes and dots in the middle', () => {
  assert.equal(sanitizeBranch('agentdeck/claude-1'), 'agentdeck/claude-1');
  assert.equal(sanitizeBranch('release/v1.2.3'), 'release/v1.2.3');
});

test('sanitizeBranch: emits a git-valid ref (no "..", trailing ".", or ".lock")', () => {
  // git worktree add -b rejects these; previously they passed through and broke launch
  assert.equal(sanitizeBranch('a..b'), 'a.b');         // ".." collapsed
  assert.equal(sanitizeBranch('feature.'), 'feature'); // trailing "." trimmed
  assert.equal(sanitizeBranch('x.lock'), 'x');         // ".lock" suffix stripped
  assert.equal(sanitizeBranch('...'), 'session');      // collapses+trims to empty -> fallback
  // structural invariant: every output is a syntactically valid branch ref
  for (const inp of ['a..b', 'feature.', 'x.lock', 'release/v1.2.3', 'feat/x~y^z', 'wip..', 'x.lock/y']) {
    const out = sanitizeBranch(inp);
    assert.match(out, /^[A-Za-z0-9._\/-]+$/, `${inp} -> ${out}`);
    assert.ok(!out.includes('..'), `${inp} -> ${out} must not contain ".."`);
    assert.ok(!/\.$/.test(out), `${inp} -> ${out} must not end with "."`);
    assert.ok(!/\.lock(?:$|\/)/.test(out), `${inp} -> ${out} must not have a ".lock" suffix`);
  }
});

test('worktreeFolderName: combines repo + branch and flattens slashes', () => {
  assert.equal(worktreeFolderName('myrepo', 'agentdeck/claude-1'), 'myrepo__agentdeck-claude-1');
  assert.equal(worktreeFolderName('tsuu', 'feature/x'), 'tsuu__feature-x');
});
