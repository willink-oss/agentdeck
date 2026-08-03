'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../lib/presets');

/* Profiles are the argument half of a launch command, and overrides are the
 * user's edits to the built-in table. Both are storage-backed and both feed the
 * one decision that matters: what string gets typed into a real shell. These
 * tests pin that string, and pin which strings count as handing the agent
 * unattended authority. */

/* ---- profiles ------------------------------------------------------------- */

test('profilesFor: every built-in leads with a safe default', () => {
  for (const key of Object.keys(P.BUILTINS)) {
    const list = P.profilesFor(key);
    assert.ok(list.length >= 1, `${key} has at least one profile`);
    assert.equal(list[0].id, P.DEFAULT_PROFILE, `${key} leads with the default`);
    assert.equal(list[0].args, '', `${key} default appends nothing`);
    assert.equal(list[0].danger, false, `${key} default is never dangerous`);
  }
  assert.deepEqual(P.profilesFor('shell').map((p) => p.id), ['default']);
  assert.deepEqual(P.profilesFor('claude').map((p) => p.id), ['default', 'continue', 'plan', 'yolo']);
  assert.deepEqual(P.profilesFor('codex').map((p) => p.id), ['default', 'continue', 'auto', 'yolo']);
});

test('profilesFor: an unknown key still yields an iterable default', () => {
  const only = [{ id: 'default', args: '', danger: false }];
  assert.deepEqual(P.profilesFor('custom-aider'), only);
  assert.deepEqual(P.profilesFor(''), only);
  assert.deepEqual(P.profilesFor(null), only);
  assert.deepEqual(P.profilesFor(undefined), only);
});

test('profilesFor: returns copies, so a caller cannot mutate the built-in table', () => {
  const list = P.profilesFor('claude');
  list[0].args = 'tampered';
  list.push({ id: 'injected', args: 'rm -rf /' });
  assert.equal(P.profilesFor('claude')[0].args, '');
  assert.equal(P.profilesFor('claude').length, 4);
});

/* ---- resolveCommand ------------------------------------------------------- */

test('resolveCommand: base plus the profile tail', () => {
  assert.equal(P.resolveCommand('claude', 'default'), 'claude');
  assert.equal(P.resolveCommand('claude', 'continue'), 'claude --continue');
  assert.equal(P.resolveCommand('claude', 'plan'), 'claude --permission-mode plan');
  assert.equal(P.resolveCommand('antigravity', 'plan'), 'agy --mode plan');
  assert.equal(P.resolveCommand('gemini', 'continue'), 'gemini --resume latest');
  // codex resume is a subcommand, not a flag — profiles append a string for exactly this
  assert.equal(P.resolveCommand('codex', 'continue'), 'codex resume --last');
  assert.equal(P.resolveCommand('codex', 'auto'), 'codex --sandbox workspace-write --ask-for-approval on-request');
});

test('resolveCommand: an empty base stays empty rather than typing a bare flag', () => {
  assert.equal(P.resolveCommand('shell', 'default'), '');
  assert.equal(P.resolveCommand('shell', 'yolo'), ''); // shell has no yolo; still empty
});

test('resolveCommand: unknown or missing profile falls back to the default', () => {
  assert.equal(P.resolveCommand('claude', 'no-such'), 'claude');
  assert.equal(P.resolveCommand('claude'), 'claude');
  assert.equal(P.resolveCommand('claude', null), 'claude');
});

test('resolveCommand: a custom preset resolves from its own cmd', () => {
  const custom = { 'custom-aider': { key: 'custom-aider', label: 'Aider', cmd: 'aider --4o' } };
  assert.equal(P.resolveCommand('custom-aider', 'default', custom), 'aider --4o');
});

/* ---- overrides ------------------------------------------------------------ */

test('normalizeOverrides: keeps cmd and known profile ids', () => {
  const o = P.normalizeOverrides({
    claude: { cmd: 'claude --model opus', profiles: { plan: '--permission-mode plan --verbose' } },
  });
  assert.deepEqual(o, {
    claude: { cmd: 'claude --model opus', profiles: { plan: '--permission-mode plan --verbose' } },
  });
});

test('normalizeOverrides: drops unknown preset keys unless declared as a live custom', () => {
  assert.deepEqual(P.normalizeOverrides({ 'no-such': { cmd: 'x' } }), {});
  assert.deepEqual(P.normalizeOverrides({ 'custom-a': { cmd: 'x' } }, ['custom-a']), { 'custom-a': { cmd: 'x' } });
});

test('normalizeOverrides: drops profile ids the preset does not have', () => {
  // codex has 'auto', not 'plan'
  assert.deepEqual(P.normalizeOverrides({ codex: { profiles: { plan: 'nope', auto: '--search' } } }),
    { codex: { profiles: { auto: '--search' } } });
});

test('normalizeOverrides: an override of nothing is not persisted', () => {
  assert.deepEqual(P.normalizeOverrides({ claude: {} }), {});
  assert.deepEqual(P.normalizeOverrides({ claude: { profiles: {} } }), {});
  assert.deepEqual(P.normalizeOverrides({ claude: { profiles: { 'no-such': 'x' } } }), {});
  // an explicitly empty cmd IS an edit — "launch nothing" is a real choice
  assert.deepEqual(P.normalizeOverrides({ claude: { cmd: '' } }), { claude: { cmd: '' } });
});

test('normalizeOverrides: defends against hand-edited storage', () => {
  assert.deepEqual(P.normalizeOverrides(null), {});
  assert.deepEqual(P.normalizeOverrides([]), {});
  assert.deepEqual(P.normalizeOverrides('nope'), {});
  assert.deepEqual(P.normalizeOverrides({ claude: 'nope' }), {});
  assert.deepEqual(P.normalizeOverrides({ claude: ['nope'] }), {});
  assert.deepEqual(P.normalizeOverrides({ claude: { cmd: 42 } }), {});
  assert.deepEqual(P.normalizeOverrides({ claude: { profiles: ['x'] } }), {});
});

test('normalizeOverrides: strips control characters and caps length', () => {
  // an escape sequence in a stored command would be written verbatim to the PTY
  const esc = '  claude[31m --model opus \n';
  assert.equal(P.normalizeOverrides({ claude: { cmd: esc } }).claude.cmd, 'claude[31m --model opus');
  const long = P.normalizeOverrides({ claude: { cmd: 'c'.repeat(P.CMD_MAX + 50) } });
  assert.equal(long.claude.cmd.length, P.CMD_MAX);
  const longArgs = P.normalizeOverrides({ claude: { profiles: { plan: 'p'.repeat(P.CMD_MAX + 50) } } });
  assert.equal(longArgs.claude.profiles.plan.length, P.CMD_MAX);
});

test('normalizeOverrides: is idempotent, so it doubles as the loader normalizer', () => {
  const raw = { claude: { cmd: ' claude --model opus ' }, codex: { profiles: { auto: ' --search ' } } };
  const once = P.normalizeOverrides(raw);
  assert.deepEqual(P.normalizeOverrides(once), once);
});

test('resolveCommand: an override replaces the base but keeps the profile tail', () => {
  const o = P.normalizeOverrides({ claude: { cmd: 'claude --model opus' } });
  assert.equal(P.resolveCommand('claude', 'default', null, o), 'claude --model opus');
  assert.equal(P.resolveCommand('claude', 'plan', null, o), 'claude --model opus --permission-mode plan');
});

test('resolveCommand: an override replaces one profile and leaves the rest', () => {
  const o = P.normalizeOverrides({ claude: { profiles: { plan: '--permission-mode plan --verbose' } } });
  assert.equal(P.resolveCommand('claude', 'plan', null, o), 'claude --permission-mode plan --verbose');
  assert.equal(P.resolveCommand('claude', 'continue', null, o), 'claude --continue');
});

test('resolveCommand: overriding the base to empty disables the auto-typed command', () => {
  const o = P.normalizeOverrides({ claude: { cmd: '' } });
  assert.equal(P.resolveCommand('claude', 'plan', null, o), '');
});

test('isOverridden: true only for presets the user actually edited', () => {
  const o = P.normalizeOverrides({ claude: { cmd: 'claude --model opus' } });
  assert.equal(P.isOverridden('claude', o), true);
  assert.equal(P.isOverridden('codex', o), false);
  assert.equal(P.isOverridden('claude', {}), false);
  assert.equal(P.isOverridden('claude', null), false);
});

/* ---- danger detection ------------------------------------------------------ */

test('looksDangerous: flags the unattended-authority switches', () => {
  assert.equal(P.looksDangerous('claude --dangerously-skip-permissions'), true);
  assert.equal(P.looksDangerous('codex --dangerously-bypass-approvals-and-sandbox'), true);
  assert.equal(P.looksDangerous('gemini --yolo'), true);
  assert.equal(P.looksDangerous('gemini --approval-mode yolo'), true);
  assert.equal(P.looksDangerous('codex --ask-for-approval never'), true);
  assert.equal(P.looksDangerous('codex --sandbox danger-full-access'), true);
});

test('looksDangerous: leaves the safe ones alone', () => {
  assert.equal(P.looksDangerous('claude'), false);
  assert.equal(P.looksDangerous('claude --permission-mode plan'), false);
  assert.equal(P.looksDangerous('gemini --approval-mode auto_edit'), false);
  assert.equal(P.looksDangerous('codex --sandbox workspace-write --ask-for-approval on-request'), false);
  assert.equal(P.looksDangerous(''), false);
  assert.equal(P.looksDangerous(null), false);
  assert.equal(P.looksDangerous(undefined), false);
});

test('looksDangerous: matches whole tokens, not substrings', () => {
  assert.equal(P.looksDangerous('claude --dangerously-skip-permissions-not-really'), false);
  assert.equal(P.looksDangerous('claude --not--yolo'), false);
  assert.equal(P.looksDangerous('echo notyolo'), false);
  // multi-token forms still match across arbitrary whitespace
  assert.equal(P.looksDangerous('codex   --ask-for-approval   never'), true);
  assert.equal(P.looksDangerous('gemini --yolo --model x'), true);
  assert.equal(P.looksDangerous('  --yolo  '), true);
});

test('isDangerous: reads the resolved command, not the profile name', () => {
  assert.equal(P.isDangerous('claude', 'yolo'), true);
  assert.equal(P.isDangerous('claude', 'plan'), false);
  assert.equal(P.isDangerous('codex', 'auto'), false);
  assert.equal(P.isDangerous('shell', 'default'), false);
  // defanging the yolo profile makes it safe...
  const defanged = P.normalizeOverrides({ claude: { profiles: { yolo: '--permission-mode plan' } } });
  assert.equal(P.isDangerous('claude', 'yolo', null, defanged), false);
  // ...and arming a safe-looking one makes it dangerous
  const armed = P.normalizeOverrides({ claude: { profiles: { plan: '--dangerously-skip-permissions' } } });
  assert.equal(P.isDangerous('claude', 'plan', null, armed), true);
  // arming the BASE taints every profile built on it
  const armedBase = P.normalizeOverrides({ claude: { cmd: 'claude --dangerously-skip-permissions' } });
  assert.equal(P.isDangerous('claude', 'default', null, armedBase), true);
  assert.equal(P.isDangerous('claude', 'continue', null, armedBase), true);
});

test('no built-in default profile is dangerous', () => {
  for (const key of Object.keys(P.BUILTINS)) {
    assert.equal(P.isDangerous(key, P.DEFAULT_PROFILE), false, `${key} default is safe`);
  }
});

test('every profile declared dangerous really resolves to a dangerous command', () => {
  for (const key of Object.keys(P.BUILTINS)) {
    for (const p of P.profilesFor(key)) {
      assert.equal(P.isDangerous(key, p.id), p.danger, `${key}/${p.id} declaration matches its command`);
    }
  }
});

/* ---- merge ---------------------------------------------------------------- */

test('merge: cmd reflects an override so existing callers need no changes', () => {
  const o = P.normalizeOverrides({ claude: { cmd: 'claude --model opus' } });
  const merged = P.merge([], {}, o);
  assert.equal(merged.claude.cmd, 'claude --model opus');
  assert.equal(merged.claude.overridden, true);
  assert.equal(merged.codex.cmd, 'codex');
  assert.equal(merged.codex.overridden, false);
});

test('merge: profiles ride along on every entry', () => {
  const merged = P.merge([{ key: 'custom-a', label: 'A', cmd: 'a' }], {}, {});
  assert.deepEqual(merged.claude.profiles.map((p) => p.id), ['default', 'continue', 'plan', 'yolo']);
  assert.deepEqual(merged['custom-a'].profiles.map((p) => p.id), ['default']);
});

test('merge: an overrides map is optional and never required', () => {
  assert.equal(P.merge().claude.cmd, 'claude');
  assert.equal(P.merge([], {}).claude.overridden, false);
  assert.equal(P.merge([], {}, null).claude.cmd, 'claude');
});

test('merge: a custom preset can carry a cmd override too', () => {
  const custom = [{ key: 'custom-a', label: 'A', cmd: 'a' }];
  const o = P.normalizeOverrides({ 'custom-a': { cmd: 'a --fast' } }, ['custom-a']);
  assert.equal(P.merge(custom, {}, o)['custom-a'].cmd, 'a --fast');
});

test('BUILTINS stays the recoverable source of truth after any override', () => {
  const o = P.normalizeOverrides({ claude: { cmd: 'claude --model opus' } });
  P.merge([], {}, o);
  assert.equal(P.BUILTINS.claude.cmd, 'claude'); // resetting is a deletion, and the default is still there
  assert.equal(P.resolveCommand('claude', 'default'), 'claude');
});

test('the overrides storage key is distinct from the other preset keys', () => {
  assert.equal(P.KEY_OVERRIDES, 'agentdeck.presetOverrides');
  assert.notEqual(P.KEY_OVERRIDES, P.KEY);
  assert.notEqual(P.KEY_OVERRIDES, P.KEY_INIT);
});
