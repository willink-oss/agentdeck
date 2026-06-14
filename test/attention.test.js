'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { shouldFlagAttention } = require('../lib/attention');

const base = { alive: true, hasOutput: true, attention: false, lastData: 0, watching: false };
const THRESH = 6000;

test('flags when idle beyond threshold', () => {
  assert.equal(shouldFlagAttention({ ...base, lastData: 0 }, 6001, THRESH), true);
});

test('does not flag before threshold', () => {
  assert.equal(shouldFlagAttention({ ...base, lastData: 0 }, 5999, THRESH), false);
});

test('does not flag the session the user is actively watching', () => {
  assert.equal(shouldFlagAttention({ ...base, watching: true }, 10000, THRESH), false);
});

test('does not flag dead sessions', () => {
  assert.equal(shouldFlagAttention({ ...base, alive: false }, 10000, THRESH), false);
});

test('does not flag sessions that have produced no output yet', () => {
  assert.equal(shouldFlagAttention({ ...base, hasOutput: false }, 10000, THRESH), false);
});

test('does not re-flag an already-flagged session', () => {
  assert.equal(shouldFlagAttention({ ...base, attention: true }, 10000, THRESH), false);
});

test('handles missing state object', () => {
  assert.equal(shouldFlagAttention(null, 10000, THRESH), false);
});

// ---- tail classification (per-kind thresholds) ------------------------------
const { classifyTail, THRESHOLDS_MS } = require('../lib/attention');

test('classifyTail: shell prompts flag as prompt', () => {
  assert.equal(classifyTail(['build done', 'user@host ~ %']), 'prompt');
  assert.equal(classifyTail(['$']), 'prompt');
  assert.equal(classifyTail(['❯']), 'prompt');
  assert.equal(classifyTail(['│ > ']), 'prompt'); // Claude Code boxed input
});

test('classifyTail: explicit confirmations flag as question', () => {
  assert.equal(classifyTail(['Do you want to proceed? (y/n)']), 'question');
  assert.equal(classifyTail(['Overwrite? [y/N]', '']), 'question');
  assert.equal(classifyTail(['Continue?']), 'question');
});

test('classifyTail: busy signals flag as working', () => {
  assert.equal(classifyTail(['…', 'esc to interrupt']), 'working');
  assert.equal(classifyTail(['⠹ thinking']), 'working'); // braille spinner
});

test('classifyTail: working beats question/prompt when both appear', () => {
  assert.equal(classifyTail(['proceed? (y/n)', '⠧ waiting on tool', 'esc to interrupt']), 'working');
});

test('classifyTail: no signal -> plain; empty/blank input -> plain', () => {
  assert.equal(classifyTail(['compiling module 312 of 9000...']), 'plain');
  assert.equal(classifyTail([]), 'plain');
  assert.equal(classifyTail(['   ', '']), 'plain');
  assert.equal(classifyTail(null), 'plain');
});

test('shouldFlagAttention: per-kind thresholds apply', () => {
  assert.equal(shouldFlagAttention({ ...base, lastData: 0 }, 2600, 'question'), true);
  assert.equal(shouldFlagAttention({ ...base, lastData: 0 }, 2600, 'prompt'), false);
  assert.equal(shouldFlagAttention({ ...base, lastData: 0 }, 3100, 'prompt'), true);
  assert.equal(shouldFlagAttention({ ...base, lastData: 0 }, 11000, 'plain'), false);
  assert.equal(shouldFlagAttention({ ...base, lastData: 0 }, 12100, 'plain'), true);
  assert.equal(shouldFlagAttention({ ...base, lastData: 0 }, 29000, 'working'), false);
});

test('shouldFlagAttention: unknown kind falls back to plain; numeric stays legacy', () => {
  assert.equal(shouldFlagAttention({ ...base, lastData: 0 }, 12100, 'mystery'), true);
  assert.equal(shouldFlagAttention({ ...base, lastData: 0 }, 6001, 6000), true);
});

test('classifyTail: progress/markup tails are NOT prompts (reviewer regressions)', () => {
  assert.equal(classifyTail(['Downloading 67%']), 'plain');
  assert.equal(classifyTail(['total cost: 100$']), 'plain');
  assert.equal(classifyTail(['</div>']), 'plain');
  assert.equal(classifyTail(['<done/>']), 'plain');
  assert.equal(classifyTail(['PS C:\\Users\\dev>']), 'prompt'); // digit-tolerant `>` keeps PowerShell
});

test('classifyTail: Claude Code permission dialog (4-line shape) is a question', () => {
  assert.equal(classifyTail([
    '│ Do you want to make this edit?',
    '│ ❯ 1. Yes',
    '│   2. No, and tell Claude what to do differently',
    '╰────────────────────────────────╯',
  ]), 'question');
});

test('classifyTail: U+2800 blank-braille pad must not mask a prompt/question', () => {
  // TUIs pad lines with U+2800 (blank braille, the "⠀" below). It must not read
  // as a spinner, nor defeat the \s*$-anchored prompt/question patterns.
  assert.equal(classifyTail(['Proceed? ⠀']), 'question'); // was 'working' (~10x late flag)
  assert.equal(classifyTail(['$ ⠀']), 'prompt');
  assert.equal(classifyTail(['⠀$']), 'prompt');           // leading blank pad is not a spinner
  assert.notEqual(classifyTail(['Build complete.', '⠀']), 'working');
  assert.equal(classifyTail(['⠹ thinking']), 'working');  // a real spinner frame still works
});
