'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyLine, diffToSegments } = require('../lib/diff');

test('classifyLine: file headers', () => {
  assert.equal(classifyLine('diff --git a/x b/x'), 'dl dl-file');
  assert.equal(classifyLine('index 0a1b2c..3d4e5f 100644'), 'dl dl-file');
  assert.equal(classifyLine('--- a/x.js'), 'dl dl-file');
  assert.equal(classifyLine('+++ b/x.js'), 'dl dl-file');
});

test('classifyLine: hunk header', () => {
  assert.equal(classifyLine('@@ -1,3 +1,4 @@ func()'), 'dl dl-hunk');
});

test('classifyLine: additions and deletions', () => {
  assert.equal(classifyLine('+  const a = 1;'), 'dl dl-add');
  assert.equal(classifyLine('-  const a = 0;'), 'dl dl-del');
});

test('classifyLine: context lines are neutral', () => {
  assert.equal(classifyLine('   unchanged line'), 'dl');
  assert.equal(classifyLine(''), 'dl');
});

test('classifyLine: +++/--- win over +/-', () => {
  // file headers must not be misread as add/del lines
  assert.equal(classifyLine('+++ b/file'), 'dl dl-file');
  assert.equal(classifyLine('--- a/file'), 'dl dl-file');
});

test('diffToSegments: parses a small diff', () => {
  const diff = [
    'diff --git a/a.txt b/a.txt',
    '@@ -1 +1 @@',
    '-old',
    '+new',
  ].join('\n');
  const segs = diffToSegments(diff, []);
  assert.equal(segs.length, 4);
  assert.equal(segs[0].cls, 'dl dl-file');
  assert.equal(segs[1].cls, 'dl dl-hunk');
  assert.equal(segs[2].cls, 'dl dl-del');
  assert.equal(segs[3].cls, 'dl dl-add');
  assert.equal(segs[3].text, '+new');
});

test('diffToSegments: appends untracked files section', () => {
  const segs = diffToSegments('', ['newfile.js', 'docs/readme.md']);
  // empty diff -> one empty line segment, then header + 2 untracked
  const untrackedHeader = segs.find((s) => s.text.includes('untracked (2)'));
  assert.ok(untrackedHeader, 'has untracked header');
  assert.equal(untrackedHeader.cls, 'dl dl-hunk');
  const added = segs.filter((s) => s.cls === 'dl dl-add' && s.text.startsWith('+ '));
  assert.equal(added.length, 2);
});

test('diffToSegments: handles null/undefined diff safely', () => {
  assert.doesNotThrow(() => diffToSegments(null, null));
  assert.doesNotThrow(() => diffToSegments(undefined));
});
