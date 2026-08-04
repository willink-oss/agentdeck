'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const H = require('../lib/hooks');

/* The hook listener is a local HTTP server, which is a new way into this
 * process. Loopback is reachable by every local process, so these tests are
 * mostly about what must NOT get through: a forged event lighting up "needs
 * attention", or an unknown payload throwing inside the request handler. */

const TOKEN = 'a'.repeat(64);
const SESSION = 'sess_1_ab3d';
const lookup = (id) => (id === SESSION ? TOKEN : null);
const post = (pathname) => H.authorize({ method: 'POST', pathname, lookup });

// ---- path parsing ----------------------------------------------------------
test('parseHookPath: accepts exactly /hook/<session>/<token>', () => {
  assert.deepEqual(H.parseHookPath(`/hook/${SESSION}/${TOKEN}`), { sessionId: SESSION, token: TOKEN });
  assert.deepEqual(H.parseHookPath(`/hook/${SESSION}/${TOKEN}?x=1`), { sessionId: SESSION, token: TOKEN });
});

test('parseHookPath: rejects the wrong number of segments', () => {
  for (const p of ['/', '/hook', `/hook/${SESSION}`, `/hook/${SESSION}/${TOKEN}/extra`, '/other/a/b']) {
    assert.equal(H.parseHookPath(p), null, p);
  }
});

test('parseHookPath: rejects a session id that is not one of ours', () => {
  assert.equal(H.parseHookPath(`/hook/..%2F..%2Fetc/${TOKEN}`), null);
  assert.equal(H.parseHookPath(`/hook/a b/${TOKEN}`), null);
  assert.equal(H.parseHookPath(`/hook/${'x'.repeat(65)}/${TOKEN}`), null);
  assert.equal(H.parseHookPath(`/hook/<script>/${TOKEN}`), null);
});

test('parseHookPath: rejects a token that is not hex of a plausible length', () => {
  assert.equal(H.parseHookPath(`/hook/${SESSION}/short`), null);
  assert.equal(H.parseHookPath(`/hook/${SESSION}/${'z'.repeat(64)}`), null);
  assert.equal(H.parseHookPath(`/hook/${SESSION}/${'a'.repeat(200)}`), null);
});

test('parseHookPath: tolerates junk without throwing', () => {
  for (const p of [null, undefined, '', 42, '%%%', '/hook/%E0%A4%A/x']) {
    assert.doesNotThrow(() => H.parseHookPath(p));
  }
});

// ---- authorization ---------------------------------------------------------
test('authorize: a genuine callback for a live session is accepted', () => {
  assert.deepEqual(post(`/hook/${SESSION}/${TOKEN}`), { ok: true, sessionId: SESSION });
});

test('authorize: only POST', () => {
  for (const method of ['GET', 'PUT', 'DELETE', 'OPTIONS', 'HEAD']) {
    const res = H.authorize({ method, pathname: `/hook/${SESSION}/${TOKEN}`, lookup });
    assert.equal(res.ok, false, method);
    assert.equal(res.code, 405);
  }
});

test('authorize: a forged token is rejected', () => {
  assert.equal(post(`/hook/${SESSION}/${'b'.repeat(64)}`).ok, false);
});

test('authorize: a token belonging to another session is rejected', () => {
  const two = (id) => ({ 'sess_1_aaaa': 'a'.repeat(64), 'sess_2_bbbb': 'b'.repeat(64) }[id] || null);
  const res = H.authorize({ method: 'POST', pathname: `/hook/sess_1_aaaa/${'b'.repeat(64)}`, lookup: two });
  assert.equal(res.ok, false, 'session 2 cannot speak for session 1');
});

test('authorize: an unknown session is rejected', () => {
  assert.equal(post(`/hook/sess_9_zzzz/${TOKEN}`).ok, false);
});

test('authorize: probing cannot distinguish "no such session" from "wrong token"', () => {
  const unknown = post(`/hook/sess_9_zzzz/${TOKEN}`);
  const wrongToken = post(`/hook/${SESSION}/${'c'.repeat(64)}`);
  assert.equal(unknown.code, wrongToken.code);
  assert.equal(unknown.reason, wrongToken.reason);
});

test('authorize: a dead session stops being addressable the moment lookup forgets it', () => {
  let alive = true;
  const l = (id) => (alive && id === SESSION ? TOKEN : null);
  assert.equal(H.authorize({ method: 'POST', pathname: `/hook/${SESSION}/${TOKEN}`, lookup: l }).ok, true);
    alive = false;
  assert.equal(H.authorize({ method: 'POST', pathname: `/hook/${SESSION}/${TOKEN}`, lookup: l }).ok, false);
});

test('authorize: a missing lookup is a rejection, not a crash', () => {
  assert.equal(H.authorize({ method: 'POST', pathname: `/hook/${SESSION}/${TOKEN}` }).ok, false);
});

// ---- safeEqual -------------------------------------------------------------
test('safeEqual: equal only for identical strings', () => {
  assert.equal(H.safeEqual('abc', 'abc'), true);
  assert.equal(H.safeEqual('abc', 'abd'), false);
  assert.equal(H.safeEqual('abc', 'ab'), false);
  assert.equal(H.safeEqual('', ''), true);
  assert.equal(H.safeEqual(null, ''), true); // both coerce to ''
  assert.equal(H.safeEqual('abc', null), false);
});

// ---- event normalisation ---------------------------------------------------
test('normalizeEvent: the events that mean "you are needed"', () => {
  for (const event of ['Notification', 'PermissionRequest', 'Stop', 'StopFailure', 'Elicitation', 'TeammateIdle']) {
    assert.deepEqual(H.normalizeEvent({ hook_event_name: event }), { event, state: 'attention' }, event);
  }
});

test('normalizeEvent: the events that mean "working"', () => {
  for (const event of ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'SessionStart']) {
    assert.equal(H.normalizeEvent({ hook_event_name: event }).state, 'busy', event);
  }
});

test('normalizeEvent: SessionEnd ends the session', () => {
  assert.equal(H.normalizeEvent({ hook_event_name: 'SessionEnd' }).state, 'ended');
});

test('normalizeEvent: an unknown event is no signal, not a guess', () => {
  assert.equal(H.normalizeEvent({ hook_event_name: 'SomeFutureHook' }), null);
  assert.equal(H.normalizeEvent({ hook_event_name: '' }), null);
  assert.equal(H.normalizeEvent({}), null);
});

test('normalizeEvent: parses a JSON string body', () => {
  assert.deepEqual(H.normalizeEvent('{"hook_event_name":"Stop"}'), { event: 'Stop', state: 'attention' });
});

test('normalizeEvent: junk degrades to no signal rather than throwing', () => {
  for (const body of [null, undefined, '', 'not json', '[]', [], 42, true, '{"a":']) {
    assert.doesNotThrow(() => H.normalizeEvent(body));
    assert.equal(H.normalizeEvent(body), null, JSON.stringify(body));
  }
});

test('normalizeEvent: an oversized string body is refused before parsing', () => {
  const huge = '{"hook_event_name":"Stop","pad":"' + 'x'.repeat(H.MAX_BODY_BYTES) + '"}';
  assert.equal(H.normalizeEvent(huge), null);
});

test('normalizeEvent: extra fields are ignored, not trusted', () => {
  const res = H.normalizeEvent({ hook_event_name: 'Stop', session_id: 'whatever', state: 'ended' });
  assert.deepEqual(res, { event: 'Stop', state: 'attention' }, 'the body cannot dictate the state');
});

// ---- settings generation ---------------------------------------------------
test('buildClaudeSettings: registers every event we act on, at one URL', () => {
  const url = 'http://127.0.0.1:1234/hook/s/t';
  const settings = H.buildClaudeSettings({ url });
  assert.deepEqual(Object.keys(settings.hooks).sort(), Object.keys(H.EVENT_STATE).sort());
  const entry = settings.hooks.Stop[0].hooks[0];
  assert.equal(entry.type, 'http');
  assert.equal(entry.url, url);
  assert.equal(typeof entry.timeout, 'number');
});

test('buildClaudeSettings: no URL, no settings', () => {
  assert.equal(H.buildClaudeSettings({}), null);
  assert.equal(H.buildClaudeSettings(), null);
});

test('hookUrl: carries the session and token in the path', () => {
  assert.equal(H.hookUrl({ port: 8080, sessionId: 'sess_1_a', token: 'ff' }),
    'http://127.0.0.1:8080/hook/sess_1_a/ff');
  assert.equal(H.hookUrl({ port: 0, sessionId: 's', token: 't' }), '');
  assert.equal(H.hookUrl({ port: 1, sessionId: '', token: 't' }), '');
});

test('hookUrl: round-trips through parseHookPath', () => {
  const url = H.hookUrl({ port: 9, sessionId: SESSION, token: TOKEN });
  const { pathname } = new URL(url);
  assert.deepEqual(H.parseHookPath(pathname), { sessionId: SESSION, token: TOKEN });
});

// ---- command injection guard ------------------------------------------------
test('canInjectSettings: only when the command really is that binary', () => {
  assert.equal(H.canInjectSettings('claude', 'claude'), true);
  assert.equal(H.canInjectSettings('claude --continue', 'claude'), true);
  assert.equal(H.canInjectSettings('/usr/local/bin/claude --continue', 'claude'), true);
  assert.equal(H.canInjectSettings('codex', 'claude'), false);
  assert.equal(H.canInjectSettings('my-claude-wrapper', 'claude'), false);
  assert.equal(H.canInjectSettings('', 'claude'), false);
  assert.equal(H.canInjectSettings('claude', ''), false);
});

test('canInjectSettings: never edits a shell construct', () => {
  for (const cmd of [
    'claude | tee log', 'claude && echo done', 'claude; ls', 'claude > out',
    'claude $(whoami)', 'claude `id`', 'VAR=1 claude',
  ]) {
    assert.equal(H.canInjectSettings(cmd, 'claude'), false, cmd);
  }
});

test('canInjectSettings: leaves a user-specified --settings alone', () => {
  assert.equal(H.canInjectSettings('claude --settings ./mine.json', 'claude'), false);
  assert.equal(H.canInjectSettings('claude --settings=./mine.json', 'claude'), false);
});

test('canInjectSettings: tolerates junk', () => {
  for (const cmd of [null, undefined, 42, {}]) {
    assert.doesNotThrow(() => H.canInjectSettings(cmd, 'claude'));
    assert.equal(H.canInjectSettings(cmd, 'claude'), false);
  }
});

// ---- the contract that keeps the agent safe from us ------------------------
test('every state a hook can produce is one the pane knows how to render', () => {
  const known = new Set(['attention', 'busy', 'ended']);
  for (const [event, state] of Object.entries(H.EVENT_STATE)) {
    assert.ok(known.has(state), `${event} -> ${state}`);
  }
});

/* ---- Shift+Enter --------------------------------------------------------- */

test('SHIFT_ENTER: backslash + CR, and only one line terminator', () => {
  assert.equal(H.SHIFT_ENTER, '\\\r');
  // CRLF would be two terminators to a PTY: the continuation opens and then
  // immediately submits. Verified against a real zsh before this was pinned.
  assert.ok(!H.SHIFT_ENTER.includes('\n'), 'no LF alongside the CR');
});

test('isShiftEnter: the plain chord only', () => {
  const base = { type: 'keydown', key: 'Enter' };
  assert.equal(H.isShiftEnter({ ...base, shiftKey: true }), true);
  assert.equal(H.isShiftEnter(base), false);
  for (const mod of ['ctrlKey', 'metaKey', 'altKey']) {
    assert.equal(H.isShiftEnter({ ...base, shiftKey: true, [mod]: true }), false, mod);
  }
  assert.equal(H.isShiftEnter({ type: 'keyup', key: 'Enter', shiftKey: true }), false, 'keyup');
  assert.equal(H.isShiftEnter({ type: 'keydown', key: 'a', shiftKey: true }), false);
  assert.equal(H.isShiftEnter(null), false);
});

/* ---- dropped file paths --------------------------------------------------- */

test('quotePath: a plain path needs no quoting', () => {
  assert.equal(H.quotePath('/a/b/c.png'), '/a/b/c.png');
  assert.equal(H.quotePath('relative/file.txt'), 'relative/file.txt');
});

test('quotePath: whitespace and shell metacharacters are quoted', () => {
  assert.equal(H.quotePath('/a/My Files/x.png'), "'/a/My Files/x.png'");
  for (const p of ['/a/b&c', '/a/b;c', '/a/b|c', '/a/$HOME', '/a/`x`', '/a/(x)', '/a/*.png', '/a/#1']) {
    assert.ok(H.quotePath(p).startsWith("'"), p);
  }
});

test('quotePath: an embedded quote is escaped the POSIX way', () => {
  assert.equal(H.quotePath("/a/it's.png"), "'/a/it'\\''s.png'");
});

test('quotePath: a path containing a control character is refused, not sanitised', () => {
  // a newline here would submit the prompt as if the user had pressed Enter
  assert.equal(H.quotePath('/a/evil\nrm -rf /'), '');
  assert.equal(H.quotePath('/a/bell\x07'), '');
  assert.equal(H.quotePath('/a/esc\x1b[31m'), '');
});

test('quotePath: junk yields nothing to type', () => {
  for (const junk of [null, undefined, '', 0]) assert.equal(H.quotePath(junk), '');
});

test('dropText: joins, quotes, and drops duplicates', () => {
  assert.equal(H.dropText(['/a/x.png', '/b/y z.png']), "/a/x.png '/b/y z.png'");
  assert.equal(H.dropText(['/a/x.png', '/a/x.png']), '/a/x.png');
  assert.equal(H.dropText('/a/one.png'), '/a/one.png');
});

test('dropText: a refused path is skipped, the rest still type', () => {
  assert.equal(H.dropText(['/a/ok.png', '/a/bad\nx', '/b/also ok.png']),
    "/a/ok.png '/b/also ok.png'");
});

test('dropText: nothing usable means nothing typed', () => {
  assert.equal(H.dropText([]), '');
  assert.equal(H.dropText(['', null]), '');
  assert.equal(H.dropText(null), '');
});
