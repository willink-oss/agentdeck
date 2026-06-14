'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseTime, parseDate, validate, normalize, nextFireAt, shouldFire,
  missedOnce, markFired, uniqueBranch,
} = require('../lib/schedule');

// Local-time helper: tests pin wall-clock instants explicitly (no Date.now()).
const at = (y, mo, d, h, mi, s = 0) => new Date(y, mo - 1, d, h, mi, s).getTime();

const LAUNCH = { presetKey: 'claude', command: 'claude', name: '', worktree: false, branchPrefix: '' };
const daily = (over = {}) => ({
  id: 's1', enabled: true, repoId: '/a/b', time: '09:00',
  repeat: { type: 'daily' }, launch: LAUNCH, lastFiredAt: null, ...over,
});

test('parseTime: accepts loose 24h forms, canonical bounds', () => {
  assert.deepEqual(parseTime('9:5'), { h: 9, m: 5 });
  assert.deepEqual(parseTime('09:05'), { h: 9, m: 5 });
  assert.deepEqual(parseTime('00:00'), { h: 0, m: 0 });
  assert.deepEqual(parseTime('23:59'), { h: 23, m: 59 });
});

test('parseTime: rejects out-of-range and malformed', () => {
  for (const bad of ['24:00', '12:60', '9', '9:', ':30', 'ab:cd', '', null, '12:34:56']) {
    assert.equal(parseTime(bad), null, String(bad));
  }
});

test('parseDate: validates real calendar dates', () => {
  assert.deepEqual(parseDate('2026-06-13'), { y: 2026, mo: 6, d: 13 });
  assert.equal(parseDate('2026-02-30'), null);
  assert.equal(parseDate('2026-13-01'), null);
  assert.equal(parseDate('26-06-13'), null);
  assert.equal(parseDate(''), null);
});

// ---- nextFireAt -------------------------------------------------------------

test('nextFireAt: daily — today when still ahead, else tomorrow', () => {
  const s = daily();
  assert.equal(nextFireAt(s, at(2026, 6, 12, 8, 0)), at(2026, 6, 12, 9, 0));
  assert.equal(nextFireAt(s, at(2026, 6, 12, 9, 0)), at(2026, 6, 12, 9, 0)); // exactly on time
  assert.equal(nextFireAt(s, at(2026, 6, 12, 9, 1)), at(2026, 6, 13, 9, 0));
});

test('nextFireAt: daily — rolls over month end', () => {
  assert.equal(nextFireAt(daily(), at(2026, 6, 30, 10, 0)), at(2026, 7, 1, 9, 0));
});

test('nextFireAt: weekly — next selected weekday, wrapping the week', () => {
  // 2026-06-12 is a Friday (day 5).
  const s = daily({ repeat: { type: 'weekly', days: [1] } }); // Mondays
  assert.equal(nextFireAt(s, at(2026, 6, 12, 8, 0)), at(2026, 6, 15, 9, 0));
  // Same day counts when the time is still ahead.
  const fri = daily({ repeat: { type: 'weekly', days: [5] } });
  assert.equal(nextFireAt(fri, at(2026, 6, 12, 8, 0)), at(2026, 6, 12, 9, 0));
  // …but wraps a full week once it passed.
  assert.equal(nextFireAt(fri, at(2026, 6, 12, 9, 1)), at(2026, 6, 19, 9, 0));
});

test('nextFireAt: once — future fires, past/disabled/malformed are null', () => {
  const s = daily({ repeat: { type: 'once', date: '2026-06-13' } });
  assert.equal(nextFireAt(s, at(2026, 6, 12, 8, 0)), at(2026, 6, 13, 9, 0));
  assert.equal(nextFireAt(s, at(2026, 6, 13, 9, 1)), null);   // expired
  assert.equal(nextFireAt(daily({ enabled: false }), at(2026, 6, 12, 8, 0)), null);
  assert.equal(nextFireAt(daily({ time: 'xx' }), at(2026, 6, 12, 8, 0)), null);
});

// ---- shouldFire ---------------------------------------------------------------

test('shouldFire: fires when the target falls inside (lastTick, now]', () => {
  const s = daily();
  const tick0 = at(2026, 6, 12, 8, 59, 50), tick1 = at(2026, 6, 12, 9, 0, 20);
  assert.equal(shouldFire(s, tick1, tick0), true);
  assert.equal(shouldFire(s, tick0, at(2026, 6, 12, 8, 59, 20)), false); // not reached yet
});

test('shouldFire: boundary — target exactly at lastTick is excluded, at now included', () => {
  const s = daily();
  const t = at(2026, 6, 12, 9, 0);
  assert.equal(shouldFire(s, t, t - 30000), true);   // (t-30s, t] contains t
  assert.equal(shouldFire(s, t + 30000, t), false);  // (t, t+30s] excludes t
});

test('shouldFire: sleep-wake — a long gap fires the missed target once', () => {
  const s = daily();
  // Slept from 08:00 to 14:00; 09:00 was missed and fires on the wake tick.
  assert.equal(shouldFire(s, at(2026, 6, 12, 14, 0), at(2026, 6, 12, 8, 0)), true);
  // A multi-day gap still yields a single firing (the latest occurrence only).
  assert.equal(shouldFire(s, at(2026, 6, 14, 14, 0), at(2026, 6, 12, 8, 0)), true);
});

test('shouldFire: same-minute lastFiredAt suppresses re-fire (clock set back)', () => {
  const fired = daily({ lastFiredAt: new Date(at(2026, 6, 12, 9, 0, 10)).toISOString() });
  // Clock jumped back before 09:00 and crossed it again within the same minute.
  assert.equal(shouldFire(fired, at(2026, 6, 12, 9, 0, 40), at(2026, 6, 12, 8, 59, 50)), false);
  // A late catch-up firing (lastFiredAt after the target minute) also suppresses.
  const late = daily({ lastFiredAt: new Date(at(2026, 6, 12, 9, 3)).toISOString() });
  assert.equal(shouldFire(late, at(2026, 6, 12, 9, 0, 30), at(2026, 6, 12, 8, 59, 50)), false);
});

test('shouldFire: next-day occurrence fires even with yesterday lastFiredAt', () => {
  const fired = daily({ lastFiredAt: new Date(at(2026, 6, 12, 9, 0, 10)).toISOString() });
  assert.equal(shouldFire(fired, at(2026, 6, 13, 9, 0, 10), at(2026, 6, 13, 8, 59, 40)), true);
});

test('shouldFire: weekly fires only on selected days; disabled never fires', () => {
  const mon = daily({ repeat: { type: 'weekly', days: [1] } });
  assert.equal(shouldFire(mon, at(2026, 6, 15, 9, 0, 10), at(2026, 6, 15, 8, 59, 40)), true);  // Mon
  assert.equal(shouldFire(mon, at(2026, 6, 12, 9, 0, 10), at(2026, 6, 12, 8, 59, 40)), false); // Fri
  assert.equal(shouldFire(daily({ enabled: false }), at(2026, 6, 12, 9, 0, 10), at(2026, 6, 12, 8, 59, 40)), false);
});

test('shouldFire: once — fires once in-window, never recurs (lastOccurrenceAtOrBefore once branch)', () => {
  const once = (over) => daily({ repeat: { type: 'once', date: '2026-06-12' }, ...over }); // target 09:00
  assert.equal(shouldFire(once(), at(2026, 6, 12, 9, 0, 20), at(2026, 6, 12, 8, 59, 50)), true);  // inside (lastTick, now]
  assert.equal(shouldFire(once(), at(2026, 6, 12, 8, 59, 0), at(2026, 6, 12, 8, 58, 0)), false);   // before the target
  assert.equal(shouldFire(once(), at(2026, 6, 13, 9, 0, 20), at(2026, 6, 13, 8, 59, 50)), false);  // a one-shot never recurs
  const fired = once({ lastFiredAt: new Date(at(2026, 6, 12, 9, 0, 10)).toISOString() });
  assert.equal(shouldFire(fired, at(2026, 6, 12, 9, 0, 40), at(2026, 6, 12, 8, 59, 50)), false);    // same-minute lastFiredAt suppresses
  assert.equal(shouldFire(daily({ repeat: { type: 'once', date: 'nope' } }), at(2026, 6, 12, 9, 0, 20), at(2026, 6, 12, 8, 59, 50)), false); // malformed date never fires
  assert.equal(shouldFire(daily({ repeat: { type: 'weekly', days: [] } }), at(2026, 6, 15, 9, 0, 20), at(2026, 6, 15, 8, 59, 50)), false);   // weekly with no days: null fallthrough
});

// ---- missedOnce ---------------------------------------------------------------

test('missedOnce: one-shot missed within the grace window fires on boot', () => {
  const s = daily({ repeat: { type: 'once', date: '2026-06-12' } }); // 09:00
  const GRACE = 5 * 60000;
  assert.equal(missedOnce(s, at(2026, 6, 12, 9, 3), GRACE), true);
  assert.equal(missedOnce(s, at(2026, 6, 12, 9, 6), GRACE), false);  // too late
  assert.equal(missedOnce(s, at(2026, 6, 12, 8, 59), GRACE), false); // not yet due
  const fired = { ...s, lastFiredAt: new Date(at(2026, 6, 12, 9, 0, 5)).toISOString() };
  assert.equal(missedOnce(fired, at(2026, 6, 12, 9, 3), GRACE), false); // already fired
  assert.equal(missedOnce(daily(), at(2026, 6, 12, 9, 3), GRACE), false); // daily ineligible
});

// ---- markFired ----------------------------------------------------------------

test('markFired: stamps lastFiredAt; one-shots self-disable; input untouched', () => {
  const now = at(2026, 6, 12, 9, 0, 12);
  const d = daily();
  const d2 = markFired(d, now);
  assert.equal(d2.lastFiredAt, new Date(now).toISOString());
  assert.equal(d2.enabled, true);
  assert.equal(d.lastFiredAt, null); // immutable update
  const once = daily({ repeat: { type: 'once', date: '2026-06-12' } });
  assert.equal(markFired(once, now).enabled, false);
});

// ---- uniqueBranch ---------------------------------------------------------------

test('uniqueBranch: prefix > presetKey > "session", minute-stamped', () => {
  const now = at(2026, 6, 12, 9, 5);
  assert.equal(uniqueBranch('nightly', 'claude', now), 'agentdeck/nightly-20260612-0905');
  assert.equal(uniqueBranch('', 'claude', now), 'agentdeck/claude-20260612-0905');
  assert.equal(uniqueBranch('', '', now), 'agentdeck/session-20260612-0905');
});

test('uniqueBranch: sanitises spaces and illegal characters', () => {
  const now = at(2026, 6, 12, 9, 5);
  assert.equal(uniqueBranch('my task!', 'claude', now), 'agentdeck/my-task-20260612-0905');
  assert.equal(uniqueBranch('日本語のみ', 'claude', now), 'agentdeck/claude-20260612-0905');
});

test('uniqueBranch: per-schedule discriminator keeps same-minute firings apart (#9)', () => {
  const now = at(2026, 6, 12, 9, 5);
  // Two distinct schedules, same now + same prefix/preset (empty prefix) — would
  // collide on 'agentdeck/claude-20260612-0905' without a discriminator.
  const a = uniqueBranch('', 'claude', now, 'sched-aaa');
  const b = uniqueBranch('', 'claude', now, 'sched-bbb');
  assert.notEqual(a, b);
  assert.ok(a.startsWith('agentdeck/claude-20260612-0905-'));
  assert.ok(b.startsWith('agentdeck/claude-20260612-0905-'));
});

test('uniqueBranch: discriminator is deterministic (no RNG)', () => {
  const now = at(2026, 6, 12, 9, 5);
  assert.equal(
    uniqueBranch('nightly', 'claude', now, 'sched-xyz'),
    uniqueBranch('nightly', 'claude', now, 'sched-xyz'),
  );
});

test('uniqueBranch: 4-arg result is branch-safe; no/empty discriminator is legacy form', () => {
  const now = at(2026, 6, 12, 9, 5);
  assert.match(uniqueBranch('nightly', 'claude', now, 'sched-xyz'), /^agentdeck\/[A-Za-z0-9._-]+$/);
  // Absent / empty / non-string discriminator => identical to the 3-arg form.
  const legacy = uniqueBranch('nightly', 'claude', now);
  assert.equal(uniqueBranch('nightly', 'claude', now, ''), legacy);
  assert.equal(uniqueBranch('nightly', 'claude', now, undefined), legacy);
  assert.equal(uniqueBranch('nightly', 'claude', now, 42), legacy);
});

// ---- validate ---------------------------------------------------------------

const NOW = at(2026, 6, 12, 8, 0);
const rawDaily = (over = {}) => ({
  repoId: '/a/b', time: '9:5', repeat: { type: 'daily' }, launch: { ...LAUNCH }, ...over,
});

test('validate: ok — canonicalises time, defaults enabled, no lastFiredAt', () => {
  const r = validate(rawDaily(), NOW);
  assert.equal(r.ok, true);
  assert.equal(r.value.time, '09:05');
  assert.equal(r.value.enabled, true);
  assert.equal(r.value.lastFiredAt, null);
});

test('validate: rejections carry messages', () => {
  assert.equal(validate(rawDaily({ repoId: ' ' }), NOW).ok, false);
  assert.equal(validate(rawDaily({ time: '25:00' }), NOW).ok, false);
  assert.equal(validate(rawDaily({ repeat: { type: 'weekly', days: [] } }), NOW).ok, false);
  assert.equal(validate(rawDaily({ repeat: { type: 'once', date: 'bad' } }), NOW).ok, false);
  assert.equal(validate(rawDaily({ repeat: { type: 'hourly' } }), NOW).ok, false);
  assert.equal(validate(rawDaily({ launch: {} }), NOW).ok, false);
  for (const r of [validate(rawDaily({ repoId: '' }), NOW), validate(rawDaily({ time: 'x' }), NOW)]) {
    assert.equal(typeof r.error, 'string');
    assert.ok(r.error.length > 0);
  }
});

test('validate: once in the past is rejected, future accepted', () => {
  const past = rawDaily({ time: '07:00', repeat: { type: 'once', date: '2026-06-12' } });
  assert.equal(validate(past, NOW).ok, false);
  const future = rawDaily({ time: '09:00', repeat: { type: 'once', date: '2026-06-12' } });
  assert.equal(validate(future, NOW).ok, true);
});

test('validate: weekly days are deduped, bounded and sorted', () => {
  const r = validate(rawDaily({ repeat: { type: 'weekly', days: [5, 1, 5, 9, -1, 2.5] } }), NOW);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.repeat.days, [1, 5]);
});

// ---- normalize ----------------------------------------------------------------

test('normalize: non-array and malformed entries are dropped', () => {
  assert.deepEqual(normalize(null), []);
  assert.deepEqual(normalize('x'), []);
  const good = daily();
  const out = normalize([
    good,
    null, 'junk', {},
    daily({ id: '' }),                                  // missing id
    daily({ time: '99:99' }),                           // bad time
    daily({ repeat: { type: 'weekly', days: 'all' } }), // bad days
    daily({ launch: { command: 'x' } }),                // no presetKey
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 's1');
});

test('normalize: coerces fields and keeps lastFiredAt only when a string', () => {
  const out = normalize([daily({ enabled: undefined, lastFiredAt: 123, launch: { presetKey: 'claude', worktree: 1 } })]);
  assert.equal(out[0].enabled, true);
  assert.equal(out[0].lastFiredAt, null);
  assert.equal(out[0].launch.worktree, true);
  assert.equal(out[0].launch.command, '');
});
