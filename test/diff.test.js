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

const Syntax = require('../lib/syntax');
const { parseFileHeader, fileIndex } = require('../lib/diff');

test('parseFileHeader: plain and quoted b-side paths; non-headers -> null', () => {
  assert.equal(parseFileHeader('diff --git a/src/app.js b/src/app.js'), 'src/app.js');
  assert.equal(parseFileHeader('diff --git "a/sp ace.js" "b/sp ace.js"'), 'sp ace.js');
  assert.equal(parseFileHeader('+++ b/src/app.js'), null);
  assert.equal(parseFileHeader(null), null);
});

test('fileIndex: one jump point per file header, idx = segment index', () => {
  const diff = [
    'diff --git a/a.js b/a.js', '@@ -1 +1 @@', '-x', '+y',
    'diff --git a/b.py b/b.py', '@@ -1 +1 @@', '-p', '+q',
  ].join('\n');
  const files = fileIndex(diffToSegments(diff, []));
  assert.deepEqual(files, [{ path: 'a.js', idx: 0 }, { path: 'b.py', idx: 4 }]);
  assert.deepEqual(fileIndex(diffToSegments('', [])), []);
});

test('segmentsToHtml + syntax: code lines get sx spans, headers/hunks do not', () => {
  const diff = ['diff --git a/a.js b/a.js', '@@ -1 +1 @@', ' const keep = 1;', '+const port = 3000;'].join('\n');
  const html = segmentsToHtml(diffToSegments(diff, []), Syntax);
  assert.ok(html.includes('<span class="sx-kw">const</span>'), 'keyword coloured');
  assert.ok(html.includes('<span class="sx-num">3000</span>'), 'number coloured');
  // the file header contains "diff" and paths but must stay uncoloured
  assert.ok(!/dl dl-file"><span class="sx-/.test(html), 'file header not tokenized');
});

test('segmentsToHtml + syntax: language follows the current file header', () => {
  const diff = [
    'diff --git a/a.js b/a.js', '@@ -1 +1 @@', '+const x = 1;',
    'diff --git a/b.txt b/b.txt', '@@ -1 +1 @@', '+const looksLikeJs = 1;',
  ].join('\n');
  const html = segmentsToHtml(diffToSegments(diff, []), Syntax);
  const perFile = html.split('dl dl-file');
  assert.ok(perFile[1].includes('sx-kw'), 'js file is coloured');
  assert.ok(!perFile[2].includes('sx-kw'), 'unknown-extension file stays plain');
});

test('segmentsToHtml + syntax: XSS — escaping holds on the syntax path too', () => {
  const diff = ['diff --git a/a.js b/a.js', '@@ -1 +1 @@', '+const s = "<img src=x onerror=alert(1)>";'].join('\n');
  const html = segmentsToHtml(diffToSegments(diff, []), Syntax);
  assert.ok(!html.includes('<img'), 'raw tag must not survive tokenized output');
  assert.ok(html.includes('&lt;img'), 'tag escaped inside the string token');
});

test('segmentsToHtml + syntax: word-diff overlay keeps .dl-word text and nests sx spans', () => {
  const diff = ['diff --git a/a.js b/a.js', '@@ -1 +1 @@', '-const port = 3000;', '+const port = 8080;'].join('\n');
  const html = segmentsToHtml(diffToSegments(diff, []), Syntax);
  assert.ok(html.includes('<span class="dl-word"><span class="sx-num">8080</span></span>'),
    'changed token: dl-word background wraps the sx colour span');
  assert.ok(html.includes('<span class="sx-kw">const</span>'), 'unchanged token still coloured');
});

test('segmentsToHtml: omitting the syntax arg keeps the legacy output byte-identical', () => {
  const diff = ['diff --git a/a.js b/a.js', '@@ -1 +1 @@', '-const a = 1;', '+const a = 2;'].join('\n');
  const segs = diffToSegments(diff, []);
  // pinned pre-syntax output: one block span per line, dl-word around changed tokens only
  assert.equal(segmentsToHtml(segs),
    '<span class="dl dl-file">diff --git a/a.js b/a.js</span>' +
    '<span class="dl dl-hunk">@@ -1 +1 @@</span>' +
    '<span class="dl dl-del">-const a = <span class="dl-word">1</span>;</span>' +
    '<span class="dl dl-add">+const a = <span class="dl-word">2</span>;</span>');
});

test('segmentsToHtml + syntax: untracked file list is never tokenized', () => {
  const diff = ['diff --git a/a.js b/a.js', '@@ -1 +1 @@', '+const a = 1;'].join('\n');
  const html = segmentsToHtml(diffToSegments(diff, ['if-looks-like-code.js']), Syntax);
  const untrackedPart = html.slice(html.indexOf('untracked'));
  assert.ok(!untrackedPart.includes('sx-'), 'untracked names stay plain');
});
