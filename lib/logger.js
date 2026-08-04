'use strict';

/* A small append-only log under userData.
 *
 * Agent Deck launches AI agents unattended on a schedule and leaves them running
 * for hours. When something goes wrong after the fact — a schedule that never
 * fired, a session that died, an update that failed — there was previously
 * nothing to look at: the main process had no console calls at all and twenty-one
 * empty catch blocks. This exists so a bug report can carry evidence.
 *
 * Deliberately NOT telemetry: it is written to the user's own machine, it is
 * never transmitted, and the app states so in its README. Terminal CONTENT is
 * never logged — only lifecycle events — because the screen contents of an agent
 * session are the most sensitive thing this app touches.
 *
 * Main-process only, so plain CommonJS. Node's fs is injected to keep the
 * rotation logic unit-testable without touching a real disk.
 */

const LEVELS = { error: 0, warn: 1, info: 2 };
const MAX_BYTES = 512 * 1024;   // rotate at 512KB; two generations kept
const MAX_LINE = 2000;          // one pathological message can't eat the file

/** Serialise one entry as a single line: ISO timestamp, level, event, detail. */
function formatLine(now, level, event, detail) {
  let line = `${new Date(now).toISOString()} ${level.toUpperCase()} ${event}`;
  if (detail !== undefined && detail !== null && detail !== '') {
    let text;
    try { text = typeof detail === 'string' ? detail : JSON.stringify(detail); }
    catch (_) { text = String(detail); }
    line += ' ' + text;
  }
  // control characters would let a logged error message forge log lines
  return line.replace(/[\x00-\x1F\x7F]/g, ' ').slice(0, MAX_LINE);
}

/**
 * @param {object} deps
 * @param {string} deps.file            absolute path of the log file
 * @param {object} deps.fs              node:fs (appendFileSync / statSync / renameSync / mkdirSync)
 * @param {() => number} [deps.now]     clock, injectable for tests
 * @param {string} [deps.level]         minimum level to record ('error' | 'warn' | 'info')
 */
function createLogger({ file, fs, now = Date.now, level = 'info' } = {}) {
  const threshold = LEVELS[level] === undefined ? LEVELS.info : LEVELS[level];
  let disabled = !file || !fs;

  /** Keep one previous generation, then start fresh. Best-effort: a log that
   *  cannot rotate must never become a reason the app misbehaves. */
  function rotateIfNeeded() {
    try {
      const stat = fs.statSync(file);
      if (stat && stat.size > MAX_BYTES) fs.renameSync(file, file + '.1');
    } catch (_) { /* no file yet, or rename raced — either way, keep going */ }
  }

  function write(lvl, event, detail) {
    if (disabled || LEVELS[lvl] > threshold) return;
    try {
      rotateIfNeeded();
      fs.appendFileSync(file, formatLine(now(), lvl, event, detail) + '\n');
    } catch (_) {
      // A failing log is not worth a failing app, but retrying every event on a
      // read-only volume would burn syscalls for the whole session.
      disabled = true;
    }
  }

  return {
    error: (event, detail) => write('error', event, detail),
    warn: (event, detail) => write('warn', event, detail),
    info: (event, detail) => write('info', event, detail),
    /** Wrap an unknown throwable into something loggable without losing the stack. */
    fail: (event, err) => write('error', event, {
      message: String((err && err.message) || err),
      stack: err && err.stack ? String(err.stack).split('\n').slice(0, 4).join(' | ') : undefined,
    }),
    get enabled() { return !disabled; },
  };
}

module.exports = { createLogger, formatLine, MAX_BYTES, MAX_LINE, LEVELS };
