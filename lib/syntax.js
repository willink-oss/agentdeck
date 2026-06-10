/* UMD: tiny per-line syntax tokenizer for the diff drawer. Pure, dependency-free.
 * Goal is "roughly right colours", not a full lexer: strings win over comments
 * win over keywords/numbers, so a keyword inside a string is never mis-coloured.
 * Diff hunks are fragments, so no cross-line state (open block comments etc.). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Syntax = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var EXT = {
    js: 'js', mjs: 'js', cjs: 'js', jsx: 'js', ts: 'js', tsx: 'js',
    json: 'json', py: 'py', sh: 'sh', bash: 'sh', zsh: 'sh',
    css: 'css', html: 'html', htm: 'html', md: 'md', markdown: 'md',
    yml: 'yml', yaml: 'yml',
  };

  var KEYWORDS = {
    js: 'const let var function return if else for while do switch case break continue new class extends import export from default try catch finally throw await async typeof instanceof in of delete void yield static this super null undefined true false',
    json: 'true false null',
    py: 'def return if elif else for while in not and or import from as class try except finally raise with lambda pass break continue global nonlocal yield assert del is None True False async await print self',
    sh: 'if then else elif fi for while until do done case esac function in local return export readonly shift exit echo source set unset trap',
    css: '',
    yml: 'true false null yes no on off',
    md: '',
    html: '',
  };

  var CFG = {
    js:   { quotes: '"\'`', line: '//', block: ['/*', '*/'] },
    json: { quotes: '"',    line: null, block: null },
    py:   { quotes: '"\'',  line: '#',  block: null },
    sh:   { quotes: '"\'',  line: '#',  block: null },
    css:  { quotes: '"\'',  line: null, block: ['/*', '*/'] },
    yml:  { quotes: '"\'',  line: '#',  block: null },
    md:   { quotes: '`',    line: null, block: null },
    html: { quotes: '"\'',  line: null, block: ['<!--', '-->'] },
  };

  var kwSets = {};
  function kwSet(lang) {
    if (!kwSets[lang]) {
      kwSets[lang] = {};
      var words = (KEYWORDS[lang] || '').split(' ');
      for (var i = 0; i < words.length; i++) if (words[i]) kwSets[lang][words[i]] = true;
    }
    return kwSets[lang];
  }

  /** Language id for a file path ('js'|'json'|'py'|'sh'|'css'|'html'|'md'|'yml')
   *  or null when unknown — null means "no highlighting". */
  function langFromPath(path) {
    var m = String(path == null ? '' : path).toLowerCase().match(/\.([a-z0-9]+)$/);
    return (m && EXT[m[1]]) || null;
  }

  var WORD_START = /[A-Za-z_$]/, WORD = /[A-Za-z0-9_$]/, DIGIT = /[0-9]/, NUMTAIL = /[0-9A-Za-z_.]/;

  /** Tokenize one line into [{type, text}] where type is 'kw'|'str'|'com'|'num'|null.
   *  Invariant: tokens.map(t => t.text).join('') === line (round-trips exactly). */
  function tokenizeLine(line, lang) {
    var s = String(line == null ? '' : line);
    var cfg = lang && CFG[lang];
    if (!cfg || !s) return [{ type: null, text: s }];
    if (lang === 'md' && /^\s{0,3}#{1,6}\s/.test(s)) return [{ type: 'kw', text: s }]; // heading
    var kws = kwSet(lang);
    var out = [];
    var push = function (type, text) {
      var last = out[out.length - 1];
      if (last && last.type === type) last.text += text;
      else out.push({ type: type, text: text });
    };
    var i = 0, n = s.length, expectTag = false;
    while (i < n) {
      var ch = s.charAt(i);
      if (cfg.line && s.startsWith(cfg.line, i)) { push('com', s.slice(i)); break; }
      if (cfg.block && s.startsWith(cfg.block[0], i)) {
        var close = s.indexOf(cfg.block[1], i + cfg.block[0].length);
        var end = close === -1 ? n : close + cfg.block[1].length; // unterminated -> to EOL
        push('com', s.slice(i, end)); i = end; continue;
      }
      if (cfg.quotes.indexOf(ch) !== -1) {
        var j = i + 1;
        while (j < n) {
          if (s.charAt(j) === '\\') { j += 2; continue; }
          if (s.charAt(j) === ch) { j++; break; }
          j++;
        }
        push('str', s.slice(i, Math.min(j, n))); i = Math.min(j, n); continue;
      }
      if (WORD_START.test(ch)) {
        var k = i + 1;
        while (k < n && WORD.test(s.charAt(k))) k++;
        var word = s.slice(i, k);
        if (lang === 'html' && expectTag) { push('kw', word); expectTag = false; }
        else push(kws[word] ? 'kw' : null, word);
        i = k; continue;
      }
      if (DIGIT.test(ch)) {
        var m = i + 1;
        while (m < n && NUMTAIL.test(s.charAt(m))) m++;
        push('num', s.slice(i, m)); i = m; continue;
      }
      if (lang === 'html') {
        if (ch === '<') expectTag = true;        // the next word is a tag name
        else if (ch !== '/') expectTag = false;  // ('/' keeps it: '</div>')
      }
      push(null, ch); i++;
    }
    return out;
  }

  return { langFromPath: langFromPath, tokenizeLine: tokenizeLine };
}));
