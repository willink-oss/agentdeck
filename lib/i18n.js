/* UMD: i18n dictionary + lookup (renderer + tests). Pure, dependency-free.
 * Every user-facing string lives here keyed by a dotted id; t(key, params) returns
 * the current language's text with {param} interpolation. Add a language by adding
 * a column to each entry — see issue #10 (zh / ko). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.I18n = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LANGS = ['ja', 'en'];
  var FALLBACK = 'en'; // every key must have en; ja may be added later for new keys

  var DICT = {
    // --- repositories panel ---
    'repos.title':    { ja: 'リポジトリ', en: 'Repositories' },
    'repos.refresh':  { ja: 'git ステータスを更新', en: 'Refresh git status' },
    'repos.add':      { ja: 'リポジトリを追加（フォルダ）', en: 'Add repository (folder)' },
    'repos.empty':    { ja: 'リポジトリ未登録', en: 'No repositories' },
    'repos.emptySub': { ja: '＋ でローカルフォルダを追加', en: 'Add a local folder with ＋' },
    'repo.remove':    { ja: '一覧から削除', en: 'Remove from list' },
    'app.tagline':    { ja: '並列エージェントのターミナル', en: 'parallel agent terminals' },
    // --- launch form ---
    'form.agent':       { ja: 'エージェント', en: 'Agent' },
    'form.managePresets': { ja: 'プリセットを管理', en: 'Manage presets' },
    'form.manageSched': { ja: 'スケジュール起動を管理', en: 'Manage scheduled launches' },
    'form.startup':     { ja: '起動コマンド', en: 'Startup command' },
    'form.startupHint': { ja: 'セッション起動時に自動実行されます', en: 'Runs automatically when the session starts' },
    'form.name':        { ja: '名前（任意）', en: 'Name (optional)' },
    'form.workdir':     { ja: '作業ディレクトリ', en: 'Working directory' },
    'form.browse':      { ja: '参照', en: 'Browse' },
    'form.isolate':     { ja: 'git worktree で隔離', en: 'Isolate in git worktree' },
    'form.isRepo':      { ja: '✓ git リポジトリ', en: '✓ git repository' },
    'form.notRepo':     { ja: 'git リポジトリではありません', en: 'not a git repository' },
    'form.isolateHint': { ja: '新規ブランチ＋作業ツリーで隔離起動（競合防止）', en: 'Launch isolated on a new branch + worktree (avoids conflicts)' },
    'quick.label':      { ja: 'クイック起動', en: 'Quick launch' },
    'legend.live':      { ja: '稼働', en: 'live' },
    'legend.attention': { ja: '要対応', en: 'attention' },
    'legend.exited':    { ja: '終了', en: 'exited' },
    'lang.label':       { ja: '言語', en: 'Language' },
    // --- stage / layout ---
    'stage.showAll':  { ja: 'すべて表示', en: 'Show all' },
    'layout.title':   { ja: 'グリッドの列数', en: 'Grid columns' },
    'empty.title':    { ja: '起動中のエージェントはありません', en: 'No agents running' },
    'empty.desc':     { ja: '左のパネルからエージェントを起動すると、ここにターミナルが並びます。複数立ち上げれば並列で監視できます。', en: 'Launch an agent from the left panel and its terminal appears here. Run several to watch them in parallel.' },
    'empty.forRepo':  { ja: 'このリポジトリには起動中のエージェントがありません。▶ Launch で起動できます。', en: 'No agents running in this repo. Launch one with ▶.' },
    // --- common ---
    'common.refresh': { ja: '更新', en: 'refresh' },
    'common.close':   { ja: '閉じる', en: 'close' },
    'common.cancel':  { ja: 'キャンセル', en: 'Cancel' },
    'common.add':     { ja: '＋ 追加', en: '＋ Add' },
    'common.save':    { ja: '保存', en: 'Save' },
    'common.edit':    { ja: '編集', en: 'Edit' },
    'common.delete':  { ja: '削除', en: 'Delete' },
    // --- diff drawer ---
    'diff.merge':         { ja: 'merge ↩ ベース', en: 'merge ↩ base' },
    'diff.pr':            { ja: 'PR 作成', en: 'Create PR' },
    'diff.prevFile':      { ja: '前のファイル', en: 'Previous file' },
    'diff.nextFile':      { ja: '次のファイル', en: 'Next file' },
    'diff.loading':       { ja: '読み込み中…', en: 'loading…' },
    'diff.failed':        { ja: 'diff の取得に失敗しました', en: 'diff failed' },
    'diff.noChanges':     { ja: 'ベースとの差分（追跡ファイル）はありません', en: 'no tracked changes vs base' },
    'diff.merging':       { ja: '{branch} を merge 中…', en: 'merging {branch} …' },
    'diff.mergeFailed':   { ja: 'merge に失敗しました', en: 'merge failed' },
    'diff.merged':        { ja: '✓ {ahead} コミットを merge: {branch} → {target}', en: '✓ merged {ahead} commit(s): {branch} → {target}' },
    'diff.creatingPr':    { ja: '{branch} の PR を作成中…', en: 'creating PR for {branch} …' },
    'diff.prFailed':      { ja: 'PR 作成に失敗しました', en: 'Failed to create the PR' },
    'diff.prCreated':     { ja: '✓ PR 作成: {url}', en: '✓ PR created: {url}' },
    'diff.prCreatedNoUrl':{ ja: '✓ PR を作成しました', en: '✓ PR created' },
    'diff.confirmMerge':  { ja: 'セッションのブランチ「{branch}」をベースブランチへ merge します。よろしいですか？', en: 'Merge the session branch “{branch}” into the base branch?' },
    'diff.confirmPr':     { ja: '「{branch}」を origin に push して PR を作成します。よろしいですか？', en: 'Push “{branch}” to origin and create a PR?' },
    // --- panes / sessions ---
    'pane.kill':   { ja: 'セッションを終了', en: 'Kill session' },
    'pane.diff':   { ja: 'git diff を表示', en: 'Review git diff' },
    'pane.drag':   { ja: 'ドラッグで並べ替え', en: 'Drag to reorder' },
    'pane.rename': { ja: 'ダブルクリックで名前変更', en: 'Double-click to rename' },
    'count.sessions': { ja: '{n} セッション', en: '{n} sessions' },
    'title.attention': { ja: '({n}) Agent Deck — 要対応', en: '({n}) Agent Deck — needs attention' },
    'notify.attention': { ja: '{name} が入力待ちです', en: '{name} is waiting for input' },
    // --- repo dynamic ---
    'repo.launch':      { ja: '▶ エージェント起動', en: '▶ Launch agent' },
    'repo.launchFor':   { ja: '▶ {repo} で起動', en: '▶ Launch in {repo}' },
    'repo.onlyShowing': { ja: '▦ {repo} のみ表示中', en: '▦ Showing {repo} only' },
    'repo.schedAdd':    { ja: 'このリポジトリでスケジュール起動を追加', en: 'Add a scheduled launch for this repo' },
    'repo.homeAlways':  { ja: 'ホームディレクトリは常に「Home」として表示されています。', en: 'The home directory is always shown as “Home”.' },
    'repo.saveFailed':  { ja: 'リポジトリの保存に失敗しました: {error}', en: 'Failed to save repositories: {error}' },
    'deck.restore':     { ja: '↻ 前回のデッキを復元 ({n})', en: '↻ Restore last deck ({n})' },
    // --- command palette ---
    'palette.ph':         { ja: 'セッションを検索…（名前 / リポ / ブランチ / preset）', en: 'Search sessions… (name / repo / branch / preset)' },
    'palette.foot':       { ja: '↑↓ 選択 · ↵ 移動 · Esc 閉じる', en: '↑↓ select · ↵ jump · Esc close' },
    'palette.none':       { ja: '該当なし', en: 'No matches' },
    'palette.noSessions': { ja: '起動中のセッションがありません', en: 'No running sessions' },
    // --- keyboard hint (sidebar) ---
    'hint.kbdMac':   { ja: '⌘K 検索 · ⌘F 端末内検索 · ⌘1–9 ペイン · ⌘[ ⌘] 移動 · ⌘↵ 起動 · ⌘W 終了', en: '⌘K search · ⌘F find · ⌘1–9 pane · ⌘[ ⌘] move · ⌘↵ launch · ⌘W kill' },
    'hint.kbdOther': { ja: 'Ctrl+Shift+K 検索 · Ctrl+Shift+F 端末内検索 · Ctrl+Shift+1–9 ペイン · Ctrl+Shift+[ ] 移動 · Ctrl+Shift+Enter 起動 · Ctrl+Shift+W 終了', en: 'Ctrl+Shift+K search · Ctrl+Shift+F find · Ctrl+Shift+1–9 pane · Ctrl+Shift+[ ] move · Ctrl+Shift+Enter launch · Ctrl+Shift+W kill' },
    // --- preset manager ---
    'presets.title':   { ja: 'エージェントプリセット', en: 'Agent presets' },
    'presets.labelPh': { ja: '表示名（例: Aider）', en: 'Display name (e.g. Aider)' },
    'presets.cmdPh':   { ja: '起動コマンド（例: aider）', en: 'Startup command (e.g. aider)' },
    'presets.builtin': { ja: 'ビルトイン', en: 'Built-in' },
    'presets.confirmDelete': { ja: 'プリセット「{label}」を削除しますか？', en: 'Delete preset “{label}”?' },
    // --- scheduled launches ---
    'sched.title':     { ja: 'スケジュール起動', en: 'Scheduled launch' },
    'sched.repo':      { ja: 'リポジトリ', en: 'Repository' },
    'sched.time':      { ja: '起動時刻', en: 'Launch time' },
    'sched.repeat':    { ja: '繰り返し', en: 'Repeat' },
    'sched.daily':     { ja: '毎日', en: 'Daily' },
    'sched.weekly':    { ja: '曜日指定', en: 'Days of week' },
    'sched.once':      { ja: '一回のみ', en: 'Once' },
    'sched.date':      { ja: '日付（一回のみ）', en: 'Date (once)' },
    'sched.agent':     { ja: 'エージェント', en: 'Agent' },
    'sched.cmdPh':     { ja: '起動コマンド', en: 'Startup command' },
    'sched.namePh':    { ja: 'セッション名（省略可）', en: 'Session name (optional)' },
    'sched.wt':        { ja: 'worktree 隔離', en: 'worktree isolation' },
    'sched.wtPrefixPh':{ ja: 'ブランチ名プレフィックス（省略可）', en: 'Branch name prefix (optional)' },
    'sched.empty':     { ja: 'スケジュールはありません。下のフォームから追加できます。', en: 'No schedules yet. Add one with the form below.' },
    'sched.enable':    { ja: '有効にする', en: 'Enable' },
    'sched.disable':   { ja: '無効にする', en: 'Disable' },
    'sched.noRepo':    { ja: '⚠ リポジトリ未登録', en: '⚠ Repo not registered' },
    'sched.notInList': { ja: '{repoId} はリポジトリ一覧にありません', en: '{repoId} is not in the repository list' },
    'sched.next':      { ja: '次回 {when}', en: 'Next {when}' },
    'sched.disabled':  { ja: '無効', en: 'Disabled' },
    'sched.wtMeta':    { ja: ' · worktree 隔離', en: ' · worktree isolation' },
    'sched.saveFailed':{ ja: '保存に失敗しました', en: 'Failed to save' },
    'sched.notFound':  { ja: '⏰ スケジュールのリポジトリが見つかりません: {repoId}', en: '⏰ Schedule’s repository not found: {repoId}' },
    'sched.fired':     { ja: '⏰ {repo} でスケジュールセッションを起動しました', en: '⏰ Launched a scheduled session in {repo}' },
    // --- terminal search / context menu / update toast ---
    'search.ph':    { ja: 'ターミナル内を検索…', en: 'Search the terminal…' },
    'search.prev':  { ja: '前へ (Shift+Enter)', en: 'Previous (Shift+Enter)' },
    'search.next':  { ja: '次へ (Enter)', en: 'Next (Enter)' },
    'search.close': { ja: '閉じる (Esc)', en: 'Close (Esc)' },
    'menu.copy':      { ja: 'コピー', en: 'Copy' },
    'menu.paste':     { ja: 'ペースト', en: 'Paste' },
    'menu.selectAll': { ja: 'すべて選択', en: 'Select all' },
    'menu.clear':     { ja: 'クリア', en: 'Clear' },
    'update.download':{ ja: 'ダウンロード', en: 'Download' },
    'update.dismiss': { ja: '閉じる', en: 'Dismiss' },
    'update.toast':   { ja: '新しいバージョン v{latest} が利用できます（現在 v{current}）', en: 'Version v{latest} is available (current v{current})' },
    'update.notif':   { ja: '新しいバージョン v{latest} が利用できます。クリックでダウンロードページを開きます。', en: 'Version v{latest} is available. Click to open the download page.' },
  };

  var WEEKDAYS = {
    ja: ['日', '月', '火', '水', '木', '金', '土'],
    en: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'],
  };

  var current = 'en';

  function has(lang) { return LANGS.indexOf(lang) !== -1; }
  function setLang(lang) { if (has(lang)) current = lang; return current; }
  function getLang() { return current; }
  function langs() { return LANGS.slice(); }

  /** Map an OS/browser locale ("ja", "ja-JP", "en-US"…) to a supported language. */
  function resolveLocale(locale) {
    var base = String(locale == null ? '' : locale).toLowerCase().split('-')[0];
    return has(base) ? base : FALLBACK;
  }

  function interpolate(s, params) {
    if (!params) return s;
    return s.replace(/\{(\w+)\}/g, function (m, k) {
      return Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : m;
    });
  }

  /** Translate `key` for the current (or given) language. Falls back lang -> en
   *  -> ja -> the key itself, so a missing translation degrades, never throws. */
  function t(key, params, lang) {
    var entry = DICT[key];
    if (!entry) return key;
    var s = entry[lang || current];
    if (s == null) s = entry[FALLBACK];
    if (s == null) s = entry.ja;
    if (s == null) return key;
    return interpolate(s, params);
  }

  function weekdayLabels(lang) { return (WEEKDAYS[lang || current] || WEEKDAYS[FALLBACK]).slice(); }

  return {
    LANGS: LANGS, DICT: DICT,
    setLang: setLang, getLang: getLang, langs: langs,
    resolveLocale: resolveLocale, t: t, weekdayLabels: weekdayLabels,
  };
}));
