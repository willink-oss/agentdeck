'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyLine, diffToSegments, wordDiff, escapeHtml, segmentsToHtml } = require('../lib/diff');

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

test('wordDiff: identical strings have no changes', () => {
  const r = wordDiff('const a = 1', 'const a = 1');
  assert.ok(r.a.every((p) => !p.changed) && r.b.every((p) => !p.changed));
});

test('wordDiff: only the differing token is marked', () => {
  const r = wordDiff('const a = 1', 'const a = 2');
  assert.deepEqual(r.a.filter((p) => p.changed).map((p) => p.text), ['1']);
  assert.deepEqual(r.b.filter((p) => p.changed).map((p) => p.text), ['2']);
  assert.ok(r.a.some((p) => !p.changed && /const/.test(p.text)));
});

test('wordDiff: completely different -> all changed', () => {
  assert.deepEqual(wordDiff('old', 'new').a, [{ text: 'old', changed: true }]);
  assert.deepEqual(wordDiff('old', 'new').b, [{ text: 'new', changed: true }]);
});

test('wordDiff: appended word is the only change', () => {
  const r = wordDiff('a b', 'a b c');
  assert.ok(r.a.every((p) => !p.changed));
  assert.equal(r.b.filter((p) => p.changed).map((p) => p.text).join('').trim(), 'c');
});

test('diffToSegments: paired -/+ lines get word-level parts', () => {
  const segs = diffToSegments(['@@ -1 +1 @@', '-const a = 1', '+const a = 2'].join('\n'), []);
  const del = segs.find((s) => s.cls === 'dl dl-del');
  const add = segs.find((s) => s.cls === 'dl dl-add');
  assert.ok(del.parts && add.parts, 'changed lines carry parts');
  assert.deepEqual(del.parts[0], { text: '-', changed: false }); // leading marker not highlighted
  assert.deepEqual(del.parts.filter((p) => p.changed).map((p) => p.text), ['1']);
  assert.deepEqual(add.parts.filter((p) => p.changed).map((p) => p.text), ['2']);
});

test('diffToSegments: unequal -/+ blocks get no word parts', () => {
  const segs = diffToSegments(['@@ -1,2 +1 @@', '-a', '-b', '+c'].join('\n'), []);
  assert.ok(segs.filter((s) => s.cls === 'dl dl-del').every((s) => !s.parts));
});

test('diffToSegments: file-header (---/+++) lines never carry word parts', () => {
  const segs = diffToSegments(['diff --git a/x b/x', '--- a/x', '+++ b/x', '@@ -1 +1 @@', '-a', '+b'].join('\n'), []);
  assert.ok(segs.filter((s) => s.cls === 'dl dl-file').every((s) => !s.parts));
});

test('diffToSegments: very long -/+ lines skip word-diff (O(n*m) guard)', () => {
  const long = 'x'.repeat(1600);
  const segs = diffToSegments(['@@ -1 +1 @@', '-' + long, '+' + long + 'y'].join('\n'), []);
  assert.ok(segs.filter((s) => s.cls === 'dl dl-del' || s.cls === 'dl dl-add').every((s) => !s.parts));
});

test('escapeHtml: neutralises &, <, > and tolerates null', () => {
  assert.equal(escapeHtml('<script>a && b</script>'), '&lt;script&gt;a &amp;&amp; b&lt;/script&gt;');
  assert.equal(escapeHtml(null), '');
});

test('segmentsToHtml: escapes diff text (XSS via committed code)', () => {
  const html = segmentsToHtml(diffToSegments('+<img src=x onerror=alert(1)>', []));
  assert.ok(!html.includes('<img'), 'raw tag must not survive');
  assert.ok(html.includes('&lt;img'), 'tag is escaped as text');
});

test('segmentsToHtml: escapes word-level parts and untracked filenames too', () => {
  const segs = diffToSegments(['@@ -1 +1 @@', '-a <b>', '+a <i>'].join('\n'), ['<svg onload=x>.js']);
  const html = segmentsToHtml(segs);
  assert.ok(!/<b>|<i>|<svg/.test(html), 'no user-controlled tags survive anywhere');
  assert.ok(html.includes('<span class="dl-word">'), 'word-level wrapping still applied');
});

test('segmentsToHtml: blank lines render &nbsp;, empty/no input renders empty string', () => {
  const html = segmentsToHtml([{ cls: 'dl', text: '' }]);
  assert.equal(html, '<span class="dl">&nbsp;</span>');
  assert.equal(segmentsToHtml([]), '');
  assert.equal(segmentsToHtml(null), '');
});

test('segmentsToHtml: matches the exact line structure paintDiff relies on', () => {
  const html = segmentsToHtml(diffToSegments(['@@ -1 +1 @@', '-old', '+new'].join('\n'), []));
  // one <span> per line, class preserved verbatim, parts-lines wrap only changed tokens
  assert.equal((html.match(/<span class="dl dl-del">/g) || []).length, 1);
  assert.equal((html.match(/<span class="dl dl-add">/g) || []).length, 1);
  assert.ok(html.includes('<span class="dl-word">old</span>'));
  assert.ok(html.includes('<span class="dl-word">new</span>'));
});
