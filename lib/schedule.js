/* UMD: scheduled-launch logic (Electron main + renderer + tests). Pure, dependency-free.
 * A schedule = repo × launch config × wall-clock time (+ repeat). The main-process
 * scheduler ticks every 30s and asks shouldFire() with the (lastTick, now] window,
 * so sleep/clock drift can delay a firing but never drop or duplicate it. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Schedule = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function str(v, dflt) { return typeof v === 'string' ? v : (v == null ? dflt : String(v)); }

  /** "9:5" / "09:05" -> {h:9, m:5}; null for anything not a valid 24h time. */
  function parseTime(s) {
    var m = /^(\d{1,2}):(\d{1,2})$/.exec(String(s == null ? '' : s).trim());
    if (!m) return null;
    var h = parseInt(m[1], 10), mi = parseInt(m[2], 10);
    if (h > 23 || mi > 59) return null;
    return { h: h, m: mi };
  }

  /** "2026-06-13" -> {y, mo(1-12), d}; null for malformed or impossible dates. */
  function parseDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s == null ? '' : s).trim());
    if (!m) return null;
    var y = parseInt(m[1], 10), mo = parseInt(m[2], 10), d = parseInt(m[3], 10);
    var dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    return { y: y, mo: mo, d: d };
  }

  /** Local-time ms for (the day of `baseMs` + offsetDays) at h:m. Month/year
   *  rollover is delegated to the Date constructor. */
  function dayAt(baseMs, offsetDays, h, m) {
    var b = new Date(baseMs);
    return new Date(b.getFullYear(), b.getMonth(), b.getDate() + offsetDays, h, m, 0, 0).getTime();
  }

  function onceMs(sched) {
    var t = parseTime(sched.time);
    var d = parseDate(sched.repeat && sched.repeat.date);
    if (!t || !d) return null;
    return new Date(d.y, d.mo - 1, d.d, t.h, t.m, 0, 0).getTime();
  }

  /** Latest occurrence at or before `at`, or null. The scheduler fires this one
   *  when it falls inside (lastTick, now] — after sleep the window can span hours,
   *  and taking only the latest occurrence collapses missed repeats into one. */
  function lastOccurrenceAtOrBefore(sched, at) {
    var t = parseTime(sched.time);
    if (!t) return null;
    var rep = sched.repeat || {};
    if (rep.type === 'once') {
      var ms = onceMs(sched);
      return ms != null && ms <= at ? ms : null;
    }
    if (rep.type === 'daily') {
      var today = dayAt(at, 0, t.h, t.m);
      return today <= at ? today : dayAt(at, -1, t.h, t.m);
    }
    if (rep.type === 'weekly') {
      var days = Array.isArray(rep.days) ? rep.days : [];
      for (var i = 0; i <= 7; i++) {
        var cand = dayAt(at, -i, t.h, t.m);
        if (cand <= at && days.indexOf(new Date(cand).getDay()) !== -1) return cand;
      }
    }
    return null;
  }

  /** Next firing time (ms) for the schedules list (FR-12), or null when the
   *  schedule is disabled, malformed, or an expired one-shot. */
  function nextFireAt(sched, now) {
    if (!sched || sched.enabled === false) return null;
    var t = parseTime(sched.time);
    if (!t) return null;
    var rep = sched.repeat || {};
    if (rep.type === 'once') {
      var ms = onceMs(sched);
      return ms != null && ms >= now ? ms : null;
    }
    if (rep.type === 'daily') {
      var today = dayAt(now, 0, t.h, t.m);
      return today >= now ? today : dayAt(now, 1, t.h, t.m);
    }
    if (rep.type === 'weekly') {
      var days = Array.isArray(rep.days) ? rep.days : [];
      if (!days.length) return null;
      for (var i = 0; i <= 7; i++) {
        var cand = dayAt(now, i, t.h, t.m);
        if (cand >= now && days.indexOf(new Date(cand).getDay()) !== -1) return cand;
      }
    }
    return null;
  }

  /** True when lastFiredAt already covers the occurrence (same minute or later) —
   *  the NFR-4 guard against re-firing after clock set-backs or crash-restores. */
  function alreadyFired(sched, occMs) {
    var f = Date.parse(sched.lastFiredAt || '');
    if (isNaN(f)) return false;
    return Math.floor(f / 60000) >= Math.floor(occMs / 60000);
  }

  /** Fire when the latest occurrence falls inside (lastTick, now] and hasn't
   *  fired yet. Interval semantics make tick delay and sleep-wake lossless. */
  function shouldFire(sched, now, lastTick) {
    if (!sched || sched.enabled === false) return false;
    var occ = lastOccurrenceAtOrBefore(sched, now);
    if (occ == null || occ <= lastTick) return false;
    return !alreadyFired(sched, occ);
  }

  /** Startup grace (§5.4): a one-shot whose target passed within the last
   *  graceMs while the app was not running still fires once on boot. */
  function missedOnce(sched, now, graceMs) {
    if (!sched || sched.enabled === false) return false;
    if (!sched.repeat || sched.repeat.type !== 'once') return false;
    var ms = onceMs(sched);
    if (ms == null || ms > now || ms <= now - graceMs) return false;
    return !alreadyFired(sched, ms);
  }

  /** Record a firing (immutable). One-shots disable themselves (FR-9). */
  function markFired(sched, now) {
    var out = {};
    for (var k in sched) out[k] = sched[k];
    out.lastFiredAt = new Date(now).toISOString();
    if (sched.repeat && sched.repeat.type === 'once') out.enabled = false;
    return out;
  }

  function branchSlug(s) {
    return String(s == null ? '' : s).trim()
      .replace(/\s+/g, '-')
      .replace(/[^A-Za-z0-9._-]/g, '')
      .replace(/^[-.]+|[-.]+$/g, '');
  }
  function pad2(n) { return ('0' + n).slice(-2); }

  /** Per-firing unique worktree branch, e.g. "agentdeck/nightly-20260613-2200".
   *  The minute stamp keeps repeated firings from colliding (FR-4). */
  function uniqueBranch(prefix, presetKey, now) {
    var base = branchSlug(prefix) || branchSlug(presetKey) || 'session';
    var d = new Date(now);
    var stamp = d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) +
      '-' + pad2(d.getHours()) + pad2(d.getMinutes());
    return 'agentdeck/' + base + '-' + stamp;
  }

  function normalizeRepeat(rep) {
    if (!rep || typeof rep !== 'object') return null;
    if (rep.type === 'daily') return { type: 'daily' };
    if (rep.type === 'once') {
      var d = parseDate(rep.date);
      return d ? { type: 'once', date: str(rep.date, '').trim() } : null;
    }
    if (rep.type === 'weekly') {
      if (!Array.isArray(rep.days)) return null;
      var seen = {};
      var days = [];
      for (var i = 0; i < rep.days.length; i++) {
        var v = rep.days[i];
        if (typeof v === 'number' && v >= 0 && v <= 6 && v === Math.floor(v) && !seen[v]) {
          seen[v] = true;
          days.push(v);
        }
      }
      days.sort();
      return days.length ? { type: 'weekly', days: days } : null;
    }
    return null;
  }

  function normalizeLaunch(l) {
    if (!l || typeof l !== 'object' || typeof l.presetKey !== 'string' || !l.presetKey) return null;
    return {
      presetKey: l.presetKey,
      command: str(l.command, ''),
      name: str(l.name, ''),
      worktree: !!l.worktree,
      branchPrefix: str(l.branchPrefix, ''),
    };
  }

  /** Validate raw form input. Returns {ok:true, value} with a clean schedule
   *  (no id — the caller assigns one) or {ok:false, error} with a UI message. */
  function validate(raw, now) {
    raw = raw || {};
    var repoId = str(raw.repoId, '').trim();
    if (!repoId) return { ok: false, error: 'リポジトリを選択してください' };
    var t = parseTime(raw.time);
    if (!t) return { ok: false, error: '時刻の形式が不正です（HH:MM）' };
    var rawRep = raw.repeat || {};
    if (rawRep.type === 'weekly' && (!Array.isArray(rawRep.days) || !rawRep.days.length)) {
      return { ok: false, error: '曜日を選択してください' };
    }
    if (rawRep.type === 'once' && !parseDate(rawRep.date)) {
      return { ok: false, error: '日付の形式が不正です' };
    }
    var rep = normalizeRepeat(rawRep);
    if (!rep) return { ok: false, error: '繰り返し設定が不正です' };
    var launch = normalizeLaunch(raw.launch);
    if (!launch) return { ok: false, error: 'エージェントプリセットが不正です' };
    var value = {
      enabled: raw.enabled !== false,
      repoId: repoId,
      time: pad2(t.h) + ':' + pad2(t.m),
      repeat: rep,
      launch: launch,
      lastFiredAt: null,
    };
    if (rep.type === 'once' && onceMs(value) < now) {
      return { ok: false, error: '過去の日時は指定できません' };
    }
    return { ok: true, value: value };
  }

  /** Validate a loaded schedules.json (array); drop malformed entries so one
   *  corrupt record never takes the whole file down (same defence as repos). */
  function normalize(raw) {
    if (!Array.isArray(raw)) return [];
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var s = raw[i];
      if (!s || typeof s !== 'object') continue;
      if (typeof s.id !== 'string' || !s.id) continue;
      if (typeof s.repoId !== 'string' || !s.repoId) continue;
      if (!parseTime(s.time)) continue;
      var rep = normalizeRepeat(s.repeat);
      var launch = normalizeLaunch(s.launch);
      if (!rep || !launch) continue;
      out.push({
        id: s.id,
        enabled: s.enabled !== false,
        repoId: s.repoId,
        time: str(s.time, '').trim(),
        repeat: rep,
        launch: launch,
        lastFiredAt: typeof s.lastFiredAt === 'string' ? s.lastFiredAt : null,
      });
    }
    return out;
  }

  return {
    parseTime: parseTime, parseDate: parseDate,
    validate: validate, normalize: normalize,
    nextFireAt: nextFireAt, shouldFire: shouldFire, missedOnce: missedOnce,
    markFired: markFired, uniqueBranch: uniqueBranch,
  };
}));
