'use strict';

/* Agent state from the agent itself, instead of guessing.
 *
 * Agent Deck's core promise is "tell me which session needs me". Until now that
 * was inferred: watch for output to stop, classify the last few terminal lines,
 * hope. It is right often enough to be useful and wrong often enough to be
 * annoying — a spinner that looks like a prompt, a question that scrolls away.
 *
 * Claude Code, Codex and Gemini all ship a hooks surface that says it outright:
 * a permission request, a finished turn, an idle prompt. This module is the
 * protocol half of consuming that — pure, so the parts that decide "is this
 * request authentic" and "what does this event mean" are testable without a
 * socket. main.js owns the listener; the renderer owns the pane.
 *
 * Threat model. The listener is a local HTTP server, which is a new way into
 * this process. It binds to loopback, but any local process can reach loopback,
 * so a forged POST must not be able to light up "needs attention" (annoying) or,
 * worse, be treated as trustworthy about anything else. Hence: every session
 * carries its own random token, the token is compared in constant time, and the
 * event is dropped unless it names a session that is actually live.
 *
 * Main-process-only, so plain CommonJS.
 */

/** What a hook event means for a pane. Anything not listed is ignored rather
 *  than guessed at — an unknown event name is far more likely to be a new
 *  lifecycle hook than a signal the user needs to see. */
const EVENT_STATE = {
  // the agent is asking for something and will not proceed without an answer
  Notification: 'attention',
  PermissionRequest: 'attention',
  Elicitation: 'attention',
  // the turn ended: whatever happens next is the user's move
  Stop: 'attention',
  StopFailure: 'attention',
  TeammateIdle: 'attention',
  // the agent is working; clear any attention flag
  UserPromptSubmit: 'busy',
  PreToolUse: 'busy',
  PostToolUse: 'busy',
  PostToolUseFailure: 'busy',
  SessionStart: 'busy',
  SubagentStart: 'busy',
  PreCompact: 'busy',
  PostCompact: 'busy',
  // the agent is gone
  SessionEnd: 'ended',
};

const MAX_BODY_BYTES = 64 * 1024; // a hook payload carrying a transcript path, not a transcript
const TOKEN_BYTES = 32;

/** Timing-safe string compare. Not because a token oracle is a realistic threat
 *  over loopback, but because the alternative is arguing about it. */
function safeEqual(a, b) {
  const left = String(a == null ? '' : a);
  const right = String(b == null ? '' : b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

/** Parse `/hook/<sessionId>/<token>`. Returns null for anything else, including
 *  paths with extra segments — a prefix match would let `/hook/a/b/../..` style
 *  cleverness through. */
function parseHookPath(pathname) {
  const raw = String(pathname == null ? '' : pathname).split('?')[0];
  const parts = raw.split('/').filter((p) => p !== '');
  if (parts.length !== 3 || parts[0] !== 'hook') return null;
  let sessionId, token;
  try { sessionId = decodeURIComponent(parts[1]); token = decodeURIComponent(parts[2]); }
  catch (_) { return null; }
  if (!sessionId || !token) return null;
  // session ids are minted by the renderer as sess_<n>_<rand>; anything else is
  // not ours, and letting arbitrary text through would put it in the log
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(sessionId) || !/^[a-f0-9]{16,128}$/i.test(token)) return null;
  return { sessionId, token };
}

/** Decide whether a request is a genuine hook callback for a live session.
 *  `lookup(sessionId)` returns the session's registered token, or falsy. */
function authorize({ method, pathname, lookup }) {
  if (method !== 'POST') return { ok: false, code: 405, reason: 'method' };
  const parsed = parseHookPath(pathname);
  if (!parsed) return { ok: false, code: 404, reason: 'path' };
  const expected = typeof lookup === 'function' ? lookup(parsed.sessionId) : null;
  // one reason string for "no such session" and "wrong token": a caller probing
  // for live session ids learns nothing from the difference
  if (!expected || !safeEqual(expected, parsed.token)) return { ok: false, code: 404, reason: 'auth' };
  return { ok: true, sessionId: parsed.sessionId };
}

/** Turn a hook POST body into { event, state } — or null when it says nothing
 *  we act on. Tolerant by design: these payloads gain fields between CLI
 *  releases, and an unknown shape must degrade to "no signal", never to a throw. */
function normalizeEvent(body) {
  let data = body;
  if (typeof data === 'string') {
    if (data.length > MAX_BODY_BYTES) return null;
    try { data = JSON.parse(data); } catch (_) { return null; }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const event = typeof data.hook_event_name === 'string' ? data.hook_event_name : '';
  if (!event) return null;
  const state = EVENT_STATE[event];
  if (!state) return null;
  return { event, state };
}

/** The `--settings` payload that points one Claude Code session at us.
 *  Every event we care about is registered with the same URL; the path carries
 *  the session id and token, so no header interpolation (and therefore no
 *  allowedEnvVars, and no token in argv) is needed. */
function buildClaudeSettings({ url, timeout = 5 } = {}) {
  if (!url) return null;
  const hooks = {};
  for (const event of Object.keys(EVENT_STATE)) {
    hooks[event] = [{ hooks: [{ type: 'http', url, timeout }] }];
  }
  return { hooks };
}

/** The URL a given session's agent should POST to. */
function hookUrl({ port, sessionId, token, host = '127.0.0.1' }) {
  if (!port || !sessionId || !token) return '';
  return `http://${host}:${port}/hook/${encodeURIComponent(sessionId)}/${encodeURIComponent(token)}`;
}

/** True when appending `--settings <path>` to this command would actually
 *  configure Claude Code, rather than corrupting somebody else's command line.
 *  The command is user-editable, so "it starts with the preset's binary" is the
 *  only honest test — anything cleverer would be guessing at a shell grammar. */
function canInjectSettings(command, binary) {
  const cmd = String(command == null ? '' : command).trim();
  const bin = String(binary == null ? '' : binary).trim();
  if (!cmd || !bin) return false;
  if (/[|&;><`$(){}]/.test(cmd)) return false; // a pipeline or substitution is not ours to edit
  const first = cmd.split(/\s+/)[0];
  // allow an absolute path to the same binary, e.g. /usr/local/bin/claude
  const base = first.split(/[\\/]/).pop();
  if (base !== bin) return false;
  return !/(^|\s)--settings(\s|=)/.test(cmd); // the user already set their own
}

module.exports = {
  EVENT_STATE, MAX_BODY_BYTES, TOKEN_BYTES,
  safeEqual, parseHookPath, authorize, normalizeEvent,
  buildClaudeSettings, hookUrl, canInjectSettings,
};
