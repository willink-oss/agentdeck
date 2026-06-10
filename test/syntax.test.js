'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { langFromPath, tokenizeLine } = require('../lib/syntax');

const joined = (tokens) => tokens.map((t) => t.text).join('');
const ofType = (tokens, type) => tokens.filter((t) => t.type === type).map((t) => t.text);

test('langFromPath: known extensions, case-insensitive, unknown -> null', () => {
  assert.equal(langFromPath('src/app.js'), 'js');
  assert.equal(langFromPath('a/b/Component.TSX'), 'js');
  assert.equal(langFromPath('config.JSON'), 'json');
  assert.equal(langFromPath('tool.py'), 'py');
  assert.equal(langFromPath('run.sh'), 'sh');
  assert.equal(langFromPath('main.rs'), null);   // unsupported language
  assert.equal(langFromPath('Makefile'), null);  // no extension
  assert.equal(langFromPath(null), null);
});

test('tokenizeLine: js keywords, numbers, strings', () => {
  const t = tokenizeLine('const port = 3000;', 'js');
  assert.deepEqual(ofType(t, 'kw'), ['const']);
  assert.deepEqual(ofType(t, 'num'), ['3000']);
  assert.equal(joined(t), 'const port = 3000;');
});

test('tokenizeLine: strings win — keywords/comments inside strings stay strings', () => {
  const t = tokenizeLine('x = "if for // not a comment"', 'js');
  assert.deepEqual(ofType(t, 'str'), ['"if for // not a comment"']);
  assert.deepEqual(ofType(t, 'kw'), []);
  assert.deepEqual(ofType(t, 'com'), []);
});

test('tokenizeLine: js line + block comments (unterminated block runs to EOL)', () => {
  assert.deepEqual(ofType(tokenizeLine('let a = 1; // note', 'js'), 'com'), ['// note']);
  assert.deepEqual(ofType(tokenizeLine('a /* mid */ b', 'js'), 'com'), ['/* mid */']);
  assert.deepEqual(ofType(tokenizeLine('a /* open', 'js'), 'com'), ['/* open']);
});

test('tokenizeLine: escaped quotes and unterminated strings', () => {
  assert.deepEqual(ofType(tokenizeLine('s = "a\\"b"', 'js'), 'str'), ['"a\\"b"']);
  const t = tokenizeLine('s = "open to eol', 'js');
  assert.deepEqual(ofType(t, 'str'), ['"open to eol']);
  assert.equal(joined(t), 's = "open to eol');
});

test('tokenizeLine: python / shell hash comments and keywords', () => {
  assert.deepEqual(ofType(tokenizeLine('def f():  # doc', 'py'), 'com'), ['# doc']);
  assert.deepEqual(ofType(tokenizeLine('def f():  # doc', 'py'), 'kw'), ['def']);
  assert.deepEqual(ofType(tokenizeLine('if [ -f x ]; then', 'sh'), 'kw'), ['if', 'then']);
});

test('tokenizeLine: json literals', () => {
  const t = tokenizeLine('{"a": true, "b": null, "c": 12}', 'json');
  assert.deepEqual(ofType(t, 'kw'), ['true', 'null']);
  assert.deepEqual(ofType(t, 'num'), ['12']);
  assert.deepEqual(ofType(t, 'str'), ['"a"', '"b"', '"c"']);
});

test('tokenizeLine: markdown heading and inline code', () => {
  assert.deepEqual(tokenizeLine('## Title', 'md'), [{ type: 'kw', text: '## Title' }]);
  assert.deepEqual(ofType(tokenizeLine('use `npm test` here', 'md'), 'str'), ['`npm test`']);
});

test('tokenizeLine: html tag names highlighted', () => {
  const t = tokenizeLine('<div class="x">', 'html');
  assert.deepEqual(ofType(t, 'kw'), ['div']);
  assert.deepEqual(ofType(t, 'str'), ['"x"']);
});

test('tokenizeLine: unknown lang or empty line -> single plain token', () => {
  assert.deepEqual(tokenizeLine('const a = 1;', null), [{ type: null, text: 'const a = 1;' }]);
  assert.deepEqual(tokenizeLine('anything', 'rs'), [{ type: null, text: 'anything' }]);
  assert.deepEqual(tokenizeLine('', 'js'), [{ type: null, text: '' }]);
});

test('tokenizeLine: round-trip invariant holds across shapes', () => {
  const lines = [
    'const s = `tpl ${x}` // tail',
    '  if (a >= 0x1f && b !== "q\\"q") { return [1, 2.5]; }',
    '#!/usr/bin/env bash',
    '@media (max-width: 600px) { /* a */ }',
    '<a href="#">x</a>',
    '日本語コメント // も通る',
  ];
  const langs = ['js', 'js', 'sh', 'css', 'html', 'js'];
  lines.forEach((ln, i) => assert.equal(joined(tokenizeLine(ln, langs[i])), ln));
});
