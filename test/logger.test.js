'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLogger, formatLine, MAX_BYTES, MAX_LINE } = require('../lib/logger');

/* The log exists so a bug report can carry evidence, which means its failure
 * modes matter more than its happy path: it must never throw into a caller, and
 * it must never let logged text forge a line or fill a disk. */

/** An in-memory stand-in for node:fs with just the calls the logger makes. */
function fakeFs(over = {}) {
  const fs = {
    files: new Map(),
    appendCalls: 0,
    renames: [],
    appendFileSync(file, data) { fs.appendCalls++; fs.files.set(file, (fs.files.get(file) || '') + data); },
    statSync(file) {
      if (!fs.files.has(file)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return { size: fs.files.get(file).length };
    },
    renameSync(from, to) { fs.renames.push([from, to]); fs.files.set(to, fs.files.get(from)); fs.files.delete(from); },
    ...over,
  };
  return fs;
}
const FILE = '/ud/agentdeck.log';
const lines = (fs) => (fs.files.get(FILE) || '').split('\n').filter(Boolean);

// ---- formatting ------------------------------------------------------------
test('formatLine: timestamp, level, event, and detail on one line', () => {
  const line = formatLine(0, 'info', 'pty.spawn', { id: 'a' });
  assert.match(line, /^1970-01-01T00:00:00\.000Z INFO pty\.spawn \{"id":"a"\}$/);
});

test('formatLine: a string detail is written as-is, not JSON-quoted', () => {
  assert.equal(formatLine(0, 'warn', 'e', 'plain'), '1970-01-01T00:00:00.000Z WARN e plain');
});

test('formatLine: an absent detail leaves no trailing space', () => {
  for (const empty of [undefined, null, '']) {
    assert.equal(formatLine(0, 'info', 'e', empty), '1970-01-01T00:00:00.000Z INFO e');
  }
});

test('formatLine: control characters cannot forge a second line', () => {
  const nl = String.fromCharCode(10);
  const line = formatLine(0, 'error', 'git.fail', `before${nl}2099-01-01 ERROR forged`);
  assert.ok(!line.includes(nl), 'newline flattened');
  assert.ok(line.includes('before'), 'the message itself survives');
});

test('formatLine: one pathological message cannot eat the file', () => {
  assert.equal(formatLine(0, 'error', 'e', 'x'.repeat(MAX_LINE * 3)).length, MAX_LINE);
});

test('formatLine: a detail that cannot be serialised still logs', () => {
  const circular = {}; circular.self = circular;
  const line = formatLine(0, 'error', 'e', circular);
  assert.ok(line.startsWith('1970-01-01T00:00:00.000Z ERROR e '), 'falls back to String()');
});

// ---- levels ----------------------------------------------------------------
test('records at or below the configured level', () => {
  const fs = fakeFs();
  const log = createLogger({ file: FILE, fs, now: () => 0, level: 'warn' });
  log.error('a'); log.warn('b'); log.info('c');
  assert.deepEqual(lines(fs).map((l) => l.split(' ')[1]), ['ERROR', 'WARN']);
});

test('defaults to info, which records everything', () => {
  const fs = fakeFs();
  const log = createLogger({ file: FILE, fs, now: () => 0 });
  log.error('a'); log.warn('b'); log.info('c');
  assert.equal(lines(fs).length, 3);
});

// ---- rotation --------------------------------------------------------------
test('rotates once the file passes the size cap, keeping one generation', () => {
  const fs = fakeFs();
  fs.files.set(FILE, 'x'.repeat(MAX_BYTES + 1));
  const log = createLogger({ file: FILE, fs, now: () => 0 });
  log.info('after.rotate');
  assert.deepEqual(fs.renames, [[FILE, FILE + '.1']]);
  assert.equal(lines(fs).length, 1, 'the fresh file holds only the new line');
  assert.ok(fs.files.get(FILE + '.1').length > MAX_BYTES, 'the old generation is kept');
});

test('does not rotate a file under the cap', () => {
  const fs = fakeFs();
  fs.files.set(FILE, 'short');
  createLogger({ file: FILE, fs, now: () => 0 }).info('e');
  assert.deepEqual(fs.renames, []);
});

test('a failing rotate does not stop the write', () => {
  const fs = fakeFs({ renameSync() { throw new Error('EBUSY'); } });
  fs.files.set(FILE, 'x'.repeat(MAX_BYTES + 1));
  const log = createLogger({ file: FILE, fs, now: () => 0 });
  log.info('still.logged');
  assert.ok((fs.files.get(FILE) || '').includes('still.logged'));
});

// ---- failure containment ---------------------------------------------------
test('a write failure disables the log instead of throwing at the caller', () => {
  const fs = fakeFs({ appendFileSync() { fs.appendCalls++; throw new Error('EROFS'); } });
  const log = createLogger({ file: FILE, fs, now: () => 0 });
  assert.doesNotThrow(() => log.error('boom'));
  assert.equal(log.enabled, false);
});

test('a disabled log stops burning syscalls on a read-only volume', () => {
  const fs = fakeFs({ appendFileSync() { fs.appendCalls++; throw new Error('EROFS'); } });
  const log = createLogger({ file: FILE, fs, now: () => 0 });
  for (let i = 0; i < 50; i++) log.error('e');
  assert.equal(fs.appendCalls, 1, 'only the first attempt runs');
});

test('a logger with no file or fs is inert, not fatal', () => {
  for (const opts of [{}, { file: FILE }, { fs: fakeFs() }]) {
    const log = createLogger(opts);
    assert.doesNotThrow(() => { log.error('e'); log.warn('e'); log.info('e'); });
    assert.equal(log.enabled, false);
  }
});

// ---- fail() ----------------------------------------------------------------
test('fail: records the message and a trimmed stack', () => {
  const fs = fakeFs();
  const log = createLogger({ file: FILE, fs, now: () => 0 });
  log.fail('git.merge', new Error('conflict'));
  const line = lines(fs)[0];
  assert.ok(line.includes('ERROR git.merge'));
  assert.ok(line.includes('conflict'));
  assert.ok(line.includes('stack'), 'a stack is attached for diagnosis');
});

test('fail: tolerates a thrown non-Error', () => {
  const fs = fakeFs();
  const log = createLogger({ file: FILE, fs, now: () => 0 });
  assert.doesNotThrow(() => log.fail('e', 'just a string'));
  assert.doesNotThrow(() => log.fail('e', null));
  assert.equal(lines(fs).length, 2);
});

test('fail: a multi-line stack still occupies one line', () => {
  const fs = fakeFs();
  const log = createLogger({ file: FILE, fs, now: () => 0 });
  const err = new Error('x');
  err.stack = 'Error: x\n  at a\n  at b\n  at c\n  at d\n  at e';
  log.fail('e', err);
  assert.equal(lines(fs).length, 1);
});

// ---- what must never be logged ---------------------------------------------
test('the module offers no way to log terminal output', () => {
  // Guard against a future "log the pty data for debugging" convenience: the
  // screen contents of an agent session are the most sensitive thing here.
  const api = Object.keys(createLogger({ file: FILE, fs: fakeFs() }));
  assert.deepEqual(api.sort(), ['enabled', 'error', 'fail', 'info', 'warn']);
});
