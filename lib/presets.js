/* UMD: agent-preset logic (built-ins + user-defined). Pure, dependency-free.
 * Custom presets are persisted as [{key, label, cmd}]; badges are derived from
 * the label at merge time so an edited label keeps its badge in sync. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Presets = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var KEY = 'agentdeck.presets';          // localStorage key (custom presets only)
  var KEY_INIT = 'agentdeck.presetInit';  // localStorage key (per-preset post-launch init commands)
  var KEY_OVERRIDES = 'agentdeck.presetOverrides'; // localStorage key (edits to built-ins)
  var MAX_INIT_LINES = 10;                // cap auto-typed init lines per preset (defends layout + hand-edited storage)
  var INIT_LINE_MAX = 300;                // cap each init line's length
  var CMD_MAX = 300;                      // cap a base command / profile argument string

  var DEFAULT_PROFILE = 'default';

  /* Profiles are the argument half of a launch command: the agent binary stays
   * `cmd`, and picking a profile appends its `args`. Every string below is a
   * flag that exists in the shipping CLI as of 2026-08 — verified against
   * `--help`, not guessed. Labels live in lib/i18n.js keyed by `profile.<id>`
   * so this module stays dependency-free and translatable.
   *
   * `danger: true` marks a profile that hands the agent unattended write/exec
   * authority. It is offered because that is genuinely how people run these
   * tools, but it is never the default, the UI badges it, and scheduled
   * (unattended) launches refuse it. */
  var PROFILES = {
    claude: [
      { id: 'default',  args: '' },
      { id: 'continue', args: '--continue' },
      { id: 'plan',     args: '--permission-mode plan' },
      { id: 'yolo',     args: '--dangerously-skip-permissions', danger: true },
    ],
    antigravity: [
      { id: 'default',  args: '' },
      { id: 'continue', args: '--continue' },
      { id: 'plan',     args: '--mode plan' },
      { id: 'yolo',     args: '--dangerously-skip-permissions', danger: true },
    ],
    codex: [
      { id: 'default',  args: '' },
      // `codex resume` is a subcommand, so this profile is not a pure flag tail —
      // which is exactly why profiles append a string rather than an argv array.
      { id: 'continue', args: 'resume --last' },
      { id: 'auto',     args: '--sandbox workspace-write --ask-for-approval on-request' },
      { id: 'yolo',     args: '--dangerously-bypass-approvals-and-sandbox', danger: true },
    ],
    gemini: [
      { id: 'default',  args: '' },
      { id: 'continue', args: '--resume latest' },
      { id: 'plan',     args: '--approval-mode plan' },
      { id: 'yolo',     args: '--yolo', danger: true },
    ],
    shell: [
      { id: 'default',  args: '' },
    ],
  };

  /* Flags that grant unattended write/exec authority. Checked against the
   * RESOLVED command, so an edited built-in or a hand-written custom preset is
   * flagged on what it actually runs rather than on which profile it came from.
   * Multi-token entries are matched against whitespace-normalised text. */
  var DANGEROUS = [
    '--dangerously-skip-permissions',
    '--allow-dangerously-skip-permissions',
    '--dangerously-bypass-approvals-and-sandbox',
    '--dangerously-bypass-hook-trust',
    '--yolo',
    '--approval-mode yolo',
    '--ask-for-approval never',
    '--sandbox danger-full-access',
  ];

  /* `cmd` is auto-typed + run when the session starts. Built-in definitions are
   * read-only; user edits live in the overrides map (KEY_OVERRIDES) so the
   * defaults are always recoverable and an older build ignores the key. */
  var BUILTINS = {
    claude:      { label: 'Claude Code',  cmd: 'claude', badge: 'CLAUDE',      glyph: '✻', tone: 'amber' },
    antigravity: { label: 'Antigravity',  cmd: 'agy',    badge: 'ANTIGRAVITY', glyph: '▲', tone: 'pink' },
    codex:       { label: 'Codex CLI',    cmd: 'codex',  badge: 'CODEX',       glyph: '◆', tone: 'blue' },
    gemini:      { label: 'Gemini CLI',   cmd: 'gemini', badge: 'GEMINI',      glyph: '✦', tone: 'cyan' },
    shell:       { label: 'Plain shell',  cmd: '',       badge: 'SHELL',       glyph: '❯', tone: 'neutral' },
  };

  /* Which agent a pane belongs to has to be readable at a glance across eight
   * terminals, and colour alone cannot carry that (WCAG 1.4.1, and the panes are
   * small). So identity is drawn three ways at once — a coloured rail, a glyph,
   * and the existing text badge — and the tones stay off the brand hue, which
   * means "Agent Deck's own UI" everywhere else. */
  var TONES = ['amber', 'pink', 'blue', 'cyan', 'green', 'neutral'];
  var CUSTOM_GLYPH = '●';

  /** Deterministic tone for a preset with no declared one, so a custom agent
   *  keeps the same colour across restarts without persisting anything. */
  function toneFor(key) {
    if (isBuiltin(key)) return BUILTINS[key].tone;
    var s = String(key == null ? '' : key);
    var h = 0;
    for (var i = 0; i < s.length; i++) h = ((h * 31) + s.charCodeAt(i)) >>> 0;
    // customs never take 'neutral' — that one reads as "not really an agent"
    return TONES[h % (TONES.length - 1)];
  }
  function glyphFor(key) {
    return isBuiltin(key) ? BUILTINS[key].glyph : CUSTOM_GLYPH;
  }

  function isBuiltin(key) { return Object.prototype.hasOwnProperty.call(BUILTINS, key); }

  /** Pane-badge text from a label: the first word that yields badge characters,
   *  uppercased, capped at 11 chars (the longest built-in badge). A leading
   *  decorative token (emoji / arrow / bullet) is skipped, not fatal; falls back
   *  to 'AGENT' only when no word yields any badge characters. */
  function deriveBadge(label) {
    var words = String(label == null ? '' : label).trim().split(/\s+/);
    for (var i = 0; i < words.length; i++) {
      var word = words[i].replace(/[^0-9A-Za-z+#.-]/g, '').toUpperCase().slice(0, 11);
      if (word) return word;
    }
    return 'AGENT';
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

  /** Parse init-command input (a textarea string OR an array) into a clean list:
   *  one command per line, trimmed, blanks dropped, each line capped at
   *  INIT_LINE_MAX, at most MAX_INIT_LINES kept. Idempotent (re-parsing its own
   *  output is a no-op), so it doubles as the loader-side normalizer. */
  function parseInit(input) {
    var raw = Array.isArray(input) ? input : [input];
    var out = [];
    for (var i = 0; i < raw.length && out.length < MAX_INIT_LINES; i++) {
      // split on every newline flavour — incl. a lone CR — so no element can carry
      // an embedded separator that would later fan out into extra REPL commands
      var parts = String(raw[i] == null ? '' : raw[i]).split(/\r\n|\r|\n/);
      for (var j = 0; j < parts.length && out.length < MAX_INIT_LINES; j++) {
        // strip residual control chars (ESC, BEL, …) so a stored line can never
        // inject a terminator or escape sequence when written verbatim to the PTY
        var line = parts[j].replace(/[\x00-\x1F\x7F]/g, '').trim();
        if (line) out.push(line.slice(0, INIT_LINE_MAX));
      }
    }
    return out;
  }

  /** Validate a loaded init map {presetKey: string[]|string}; drop entries that
   *  normalize to no lines (so empty configs never bloat storage or the UI). */
  function normalizeInitMap(raw) {
    var out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    for (var key in raw) {
      if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
      if (typeof key !== 'string' || !key) continue;
      var lines = parseInit(raw[key]);
      if (lines.length) out[key] = lines;
    }
    return out;
  }

  /** The profile list for a preset key. Built-ins carry their own; anything else
   *  (custom presets, unknown keys) gets the single default profile, so callers
   *  can always iterate without a null check. */
  function profilesFor(key) {
    var list = PROFILES[key];
    // same shape on every path — callers read `.danger` without a guard
    if (!list) return [{ id: DEFAULT_PROFILE, args: '', danger: false }];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      out.push({ id: list[i].id, args: list[i].args, danger: !!list[i].danger });
    }
    return out;
  }

  function clampCmd(v) {
    return String(v == null ? '' : v).replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, CMD_MAX);
  }

  /** Validate a loaded overrides map {presetKey: {cmd?, profiles?:{id:args}}}.
   *  Unknown preset keys and unknown profile ids are dropped: an override is a
   *  patch on something that exists, never a way to smuggle in a new entry.
   *  `customKeys` lets custom presets carry a cmd override too. */
  function normalizeOverrides(raw, customKeys) {
    var out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    var customs = Array.isArray(customKeys) ? customKeys : [];
    for (var key in raw) {
      if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
      if (!isBuiltin(key) && customs.indexOf(key) === -1) continue;
      var src = raw[key];
      if (!src || typeof src !== 'object' || Array.isArray(src)) continue;
      var entry = {};
      if (typeof src.cmd === 'string') entry.cmd = clampCmd(src.cmd);
      if (src.profiles && typeof src.profiles === 'object' && !Array.isArray(src.profiles)) {
        var known = profilesFor(key);
        var profiles = {};
        for (var i = 0; i < known.length; i++) {
          var id = known[i].id;
          if (typeof src.profiles[id] === 'string') profiles[id] = clampCmd(src.profiles[id]);
        }
        for (var k in profiles) { if (Object.prototype.hasOwnProperty.call(profiles, k)) { entry.profiles = profiles; break; } }
      }
      // an override that overrides nothing is not persisted — keeps "reset to
      // default" a deletion rather than an empty object that looks edited
      if (entry.cmd !== undefined || entry.profiles) out[key] = entry;
    }
    return out;
  }

  /** True when a command string would let the agent act without asking. */
  function looksDangerous(cmd) {
    var s = ' ' + String(cmd == null ? '' : cmd).replace(/\s+/g, ' ').trim() + ' ';
    for (var i = 0; i < DANGEROUS.length; i++) {
      if (s.indexOf(' ' + DANGEROUS[i] + ' ') !== -1) return true;
    }
    return false;
  }

  /** The base command for a preset, honouring an override. */
  function baseCommand(key, presets, overrides) {
    var o = overrides && overrides[key];
    if (o && typeof o.cmd === 'string') return o.cmd;
    var p = presets && presets[key];
    if (p && typeof p.cmd === 'string') return p.cmd;
    return isBuiltin(key) ? BUILTINS[key].cmd : '';
  }

  /** The argument tail for one profile, honouring an override. */
  function profileArgs(key, profileId, overrides) {
    var o = overrides && overrides[key];
    if (o && o.profiles && typeof o.profiles[profileId] === 'string') return o.profiles[profileId];
    var list = profilesFor(key);
    for (var i = 0; i < list.length; i++) if (list[i].id === profileId) return list[i].args;
    return '';
  }

  /** The command a launch actually runs: base + profile arguments.
   *  An empty base (Plain shell) stays empty — appending arguments to nothing
   *  would type a bare flag at the prompt. */
  function resolveCommand(key, profileId, presets, overrides) {
    var base = baseCommand(key, presets, overrides);
    if (!base) return '';
    var args = profileArgs(key, profileId || DEFAULT_PROFILE, overrides);
    return args ? (base + ' ' + args).trim() : base;
  }

  /** Whether launching this preset+profile hands over unattended authority. */
  function isDangerous(key, profileId, presets, overrides) {
    return looksDangerous(resolveCommand(key, profileId, presets, overrides));
  }

  /** True when the user has edited this preset away from its built-in defaults. */
  function isOverridden(key, overrides) {
    return !!(overrides && Object.prototype.hasOwnProperty.call(overrides, key));
  }

  /** Built-ins + customs as one map (built-ins first, never overridden by a
   *  custom entry shadowing a built-in key — that entry is skipped).
   *
   *  Each value is {label, cmd, badge, init, profiles, overridden}:
   *   - `cmd` is the base command AFTER any user override, so every existing
   *     caller keeps working without knowing profiles exist.
   *   - `profiles` carries the id/args/danger triples for the launch UI.
   *   - `init` (post-launch commands) is always an array, so callers can read
   *     it without guards. */
  /** Identity fields for a preset, always present so callers need no guards. */
  function identityFor(key) {
    return { glyph: glyphFor(key), tone: toneFor(key) };
  }

  function merge(custom, initMap, overrideMap) {
    var out = {};
    var init = (initMap && typeof initMap === 'object') ? initMap : {};
    var over = (overrideMap && typeof overrideMap === 'object') ? overrideMap : {};
    var k, i;
    for (k in BUILTINS) {
      var b = BUILTINS[k];
      out[k] = {
        label: b.label, badge: b.badge, init: parseInit(init[k]),
        cmd: baseCommand(k, null, over),
        glyph: glyphFor(k), tone: toneFor(k),
        profiles: profilesFor(k),
        overridden: isOverridden(k, over),
      };
    }
    var list = Array.isArray(custom) ? custom : [];
    for (i = 0; i < list.length; i++) {
      var c = list[i];
      if (!c || typeof c.key !== 'string' || out[c.key]) continue;
      out[c.key] = {
        label: c.label, badge: deriveBadge(c.label), init: parseInit(init[c.key]),
        cmd: baseCommand(c.key, { [c.key]: c }, over),
        glyph: glyphFor(c.key), tone: toneFor(c.key),
        profiles: profilesFor(c.key),
        overridden: isOverridden(c.key, over),
      };
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
    KEY: KEY, KEY_INIT: KEY_INIT, KEY_OVERRIDES: KEY_OVERRIDES,
    MAX_INIT_LINES: MAX_INIT_LINES, INIT_LINE_MAX: INIT_LINE_MAX, CMD_MAX: CMD_MAX,
    DEFAULT_PROFILE: DEFAULT_PROFILE, DANGEROUS: DANGEROUS.slice(),
    BUILTINS: BUILTINS, isBuiltin: isBuiltin, deriveBadge: deriveBadge,
    keyFor: keyFor, validate: validate, normalizeCustom: normalizeCustom,
    parseInit: parseInit, normalizeInitMap: normalizeInitMap,
    profilesFor: profilesFor, normalizeOverrides: normalizeOverrides,
    TONES: TONES.slice(), toneFor: toneFor, glyphFor: glyphFor, identityFor: identityFor,
    looksDangerous: looksDangerous, baseCommand: baseCommand, profileArgs: profileArgs,
    resolveCommand: resolveCommand, isDangerous: isDangerous, isOverridden: isOverridden,
    merge: merge, chipKeys: chipKeys,
  };
}));
