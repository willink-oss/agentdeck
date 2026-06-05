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

test('defaultShell: falls back to /bin/zsh without $SHELL', () => {
  assert.equal(defaultShell('darwin', {}), '/bin/zsh');
  assert.equal(defaultShell('linux'), '/bin/zsh');
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

test('worktreeFolderName: combines repo + branch and flattens slashes', () => {
  assert.equal(worktreeFolderName('myrepo', 'agentdeck/claude-1'), 'myrepo__agentdeck-claude-1');
  assert.equal(worktreeFolderName('tsuu', 'feature/x'), 'tsuu__feature-x');
});
