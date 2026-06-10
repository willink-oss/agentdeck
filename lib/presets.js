/* UMD: agent-preset logic (built-ins + user-defined). Pure, dependency-free.
 * Custom presets are persisted as [{key, label, cmd}]; badges are derived from
 * the label at merge time so an edited label keeps its badge in sync. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Presets = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var KEY = 'agentdeck.presets'; // localStorage key (custom presets only)

  /* `cmd` is auto-typed + run when the session starts. Read-only built-ins. */
  var BUILTINS = {
    claude:      { label: 'Claude Code',  cmd: 'claude', badge: 'CLAUDE' },
    antigravity: { label: 'Antigravity',  cmd: 'agy',    badge: 'ANTIGRAVITY' },
    codex:       { label: 'Codex CLI',    cmd: 'codex',  badge: 'CODEX' },
    gemini:      { label: 'Gemini CLI',   cmd: 'gemini', badge: 'GEMINI' },
    shell:       { label: 'Plain shell',  cmd: '',       badge: 'SHELL' },
  };

  function isBuiltin(key) { return Object.prototype.hasOwnProperty.call(BUILTINS, key); }

  /** Pane-badge text from a label: first word, uppercased, capped at 11 chars
   *  (the longest built-in badge). Falls back to 'AGENT' for empty labels. */
  function deriveBadge(label) {
    var word = String(label == null ? '' : label).trim().split(/\s+/)[0] || '';
    word = word.replace(/[^0-9A-Za-z+#.-]/g, '').toUpperCase().slice(0, 11);
    return word || 'AGENT';
  }

  /** Stable storage key for a new custom preset. The 'custom-' prefix keeps the
   *  namespace structurally disjoint from built-ins; '-2','-3'… resolve clashes. */
  function keyFor(label, existingKeys) {
    var slug = String(label == null ? '' : label).toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    var base = 'custom-' + (slug || 'agent');
    var key = base;
    for (var n = 2; existingKeys && existingKeys.indexOf(key) !== -1; n++) key = base + '-' + n;
    return key;
  }

  /** Validate user input. cmd may be empty (same behaviour as Plain shell). */
  function validate(label, cmd) {
    var l = String(label == null ? '' : label).trim();
    if (!l) return { ok: false, error: '表示名を入力してください' };
    if (l.length > 40) return { ok: false, error: '表示名は40文字以内にしてください' };
    return { ok: true, label: l, cmd: String(cmd == null ? '' : cmd).trim() };
  }

  /** Validate a loaded custom-preset list; drop malformed / built-in-shadowing /
   *  duplicate-key entries (defends against hand-edited or stale storage). */
  function normalizeCustom(raw) {
    if (!Array.isArray(raw)) return [];
    var out = [];
    var seen = {};
    for (var i = 0; i < raw.length; i++) {
      var c = raw[i];
      if (!c || typeof c !== 'object') continue;
      if (typeof c.key !== 'string' || !c.key || isBuiltin(c.key) || seen[c.key]) continue;
      if (typeof c.label !== 'string' || !c.label.trim()) continue;
      seen[c.key] = true;
      // same 40-char cap as validate(), so hand-edited storage can't break the layout
      out.push({ key: c.key, label: c.label.trim().slice(0, 40), cmd: typeof c.cmd === 'string' ? c.cmd : '' });
    }
    return out;
  }

  /** Built-ins + customs as one {key: {label, cmd, badge}} map (built-ins first,
   *  never overridden — a custom entry shadowing a built-in key is skipped). */
  function merge(custom) {
    var out = {};
    for (var k in BUILTINS) out[k] = BUILTINS[k];
    var list = Array.isArray(custom) ? custom : [];
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (!c || typeof c.key !== 'string' || out[c.key]) continue;
      out[c.key] = { label: c.label, cmd: c.cmd, badge: deriveBadge(c.label) };
    }
    return out;
  }

  /** Quick-launch chip order: the four agent built-ins (no plain shell), then customs. */
  function chipKeys(custom) {
    var keys = ['claude', 'antigravity', 'codex', 'gemini'];
    var list = Array.isArray(custom) ? custom : [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && typeof list[i].key === 'string' && !isBuiltin(list[i].key)) keys.push(list[i].key);
    }
    return keys;
  }

  return {
    KEY: KEY, BUILTINS: BUILTINS, isBuiltin: isBuiltin, deriveBadge: deriveBadge,
    keyFor: keyFor, validate: validate, normalizeCustom: normalizeCustom,
    merge: merge, chipKeys: chipKeys,
  };
}));
