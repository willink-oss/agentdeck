/* UMD: i18n dictionary + lookup (renderer + tests). Pure, dependency-free.
 * Every user-facing string lives here keyed by a dotted id; t(key, params) returns
 * the current language's text with {param} interpolation. Add a language by adding
 * a column to each entry — see issue #10 (zh / ko). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.I18n = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LANGS = ['ja', 'en', 'zhHans', 'zhHant', 'ko'];
  var FALLBACK = 'en'; // every key must have en; ja may be added later for new keys

  var DICT = {
    // --- repositories panel ---
    'repos.title':    { ja: 'リポジトリ', en: 'Repositories', zhHans: '仓库', zhHant: '儲存庫', ko: '저장소' },
    'repos.refresh':  { ja: 'git ステータスを更新', en: 'Refresh git status', zhHans: '刷新 git 状态', zhHant: '重新整理 git 狀態', ko: 'git 상태 새로고침' },
    'repos.add':      { ja: 'リポジトリを追加（フォルダ）', en: 'Add repository (folder)', zhHans: '添加仓库（文件夹）', zhHant: '新增儲存庫（資料夾）', ko: '저장소 추가(폴더)' },
    'repos.empty':    { ja: 'リポジトリ未登録', en: 'No repositories', zhHans: '尚无仓库', zhHant: '尚無儲存庫', ko: '저장소 없음' },
    'repos.emptySub': { ja: '＋ でローカルフォルダを追加', en: 'Add a local folder with ＋', zhHans: '用 ＋ 添加本地文件夹', zhHant: '用 ＋ 新增本機資料夾', ko: '＋ 로 로컬 폴더 추가' },
    'repo.remove':    { ja: '一覧から削除', en: 'Remove from list', zhHans: '从列表中移除', zhHant: '從清單中移除', ko: '목록에서 제거' },
    'app.tagline':    { ja: '並列エージェントのターミナル', en: 'parallel agent terminals', zhHans: '并行智能体终端', zhHant: '並行代理終端機', ko: '병렬 에이전트 터미널' },
    // --- launch form ---
    'form.agent':       { ja: 'エージェント', en: 'Agent', zhHans: '智能体', zhHant: '代理', ko: '에이전트' },
    'form.managePresets': { ja: 'プリセットを管理', en: 'Manage presets', zhHans: '管理预设', zhHant: '管理預設', ko: '프리셋 관리' },
    'form.manageSched': { ja: 'スケジュール起動を管理', en: 'Manage scheduled launches', zhHans: '管理定时启动', zhHant: '管理排程啟動', ko: '예약 실행 관리' },
    'form.startup':     { ja: '起動コマンド', en: 'Startup command', zhHans: '启动命令', zhHant: '啟動指令', ko: '시작 명령' },
    'form.startupHint': { ja: 'セッション起動時に自動実行されます', en: 'Runs automatically when the session starts', zhHans: '会话启动时自动运行', zhHant: '工作階段啟動時自動執行', ko: '세션이 시작될 때 자동으로 실행됩니다' },
    'form.name':        { ja: '名前（任意）', en: 'Name (optional)', zhHans: '名称（可选）', zhHant: '名稱（選填）', ko: '이름(선택)' },
    'form.workdir':     { ja: '作業ディレクトリ', en: 'Working directory', zhHans: '工作目录', zhHant: '工作目錄', ko: '작업 디렉터리' },
    'form.browse':      { ja: '参照', en: 'Browse', zhHans: '浏览', zhHant: '瀏覽', ko: '찾아보기' },
    'form.isolate':     { ja: 'git worktree で隔離', en: 'Isolate in git worktree', zhHans: '使用 git worktree 隔离', zhHant: '使用 git worktree 隔離', ko: 'git worktree로 격리' },
    'form.isRepo':      { ja: '✓ git リポジトリ', en: '✓ git repository', zhHans: '✓ git 仓库', zhHant: '✓ git 儲存庫', ko: '✓ git 저장소' },
    'form.notRepo':     { ja: 'git リポジトリではありません', en: 'not a git repository', zhHans: '不是 git 仓库', zhHant: '不是 git 儲存庫', ko: 'git 저장소가 아닙니다' },
    'form.isolateHint': { ja: '新規ブランチ＋作業ツリーで隔離起動（競合防止）', en: 'Launch isolated on a new branch + worktree (avoids conflicts)', zhHans: '在新分支 ＋ 工作树中隔离启动（避免冲突）', zhHant: '在新分支 ＋ 工作樹中隔離啟動（避免衝突）', ko: '새 브랜치 ＋ 작업 트리로 격리 실행(충돌 방지)' },
    'quick.label':      { ja: 'クイック起動', en: 'Quick launch', zhHans: '快速启动', zhHant: '快速啟動', ko: '빠른 실행' },
    'legend.live':      { ja: '稼働', en: 'live', zhHans: '运行中', zhHant: '運行中', ko: '실행 중' },
    'legend.attention': { ja: '要対応', en: 'attention', zhHans: '待处理', zhHant: '待處理', ko: '대응 필요' },
    'legend.exited':    { ja: '終了', en: 'exited', zhHans: '已退出', zhHant: '已結束', ko: '종료됨' },
    'lang.label':       { ja: '言語', en: 'Language', zhHans: '语言', zhHant: '語言', ko: '언어' },
    // --- stage / layout ---
    'stage.showAll':  { ja: 'すべて表示', en: 'Show all', zhHans: '显示全部', zhHant: '顯示全部', ko: '모두 표시' },
    'layout.title':   { ja: 'グリッドの列数', en: 'Grid columns', zhHans: '网格列数', zhHant: '格線欄數', ko: '그리드 열 수' },
    'layout.fit':     { ja: '全体', en: 'fit', zhHans: '适应', zhHant: '適應', ko: '맞춤' },
    'empty.title':    { ja: '起動中のエージェントはありません', en: 'No agents running', zhHans: '没有正在运行的智能体', zhHant: '沒有正在運行的代理', ko: '실행 중인 에이전트가 없습니다' },
    'empty.desc':     { ja: '左のパネルからエージェントを起動すると、ここにターミナルが並びます。複数立ち上げれば並列で監視できます。', en: 'Launch an agent from the left panel and its terminal appears here. Run several to watch them in parallel.', zhHans: '从左侧面板启动智能体，其终端就会显示在这里。启动多个即可并行监视。', zhHant: '從左側面板啟動代理，其終端機就會顯示在這裡。啟動多個即可並行監看。', ko: '왼쪽 패널에서 에이전트를 실행하면 해당 터미널이 여기에 표시됩니다. 여러 개를 실행하면 병렬로 모니터링할 수 있습니다.' },
    'empty.forRepo':  { ja: 'このリポジトリには起動中のエージェントがありません。▶ Launch で起動できます。', en: 'No agents running in this repo. Launch one with ▶.', zhHans: '此仓库中没有正在运行的智能体。点击 ▶ 即可启动。', zhHant: '此儲存庫中沒有正在運行的代理。點擊 ▶ 即可啟動。', ko: '이 저장소에는 실행 중인 에이전트가 없습니다. ▶ 로 실행할 수 있습니다.' },
    // --- common ---
    'common.refresh': { ja: '更新', en: 'refresh', zhHans: '刷新', zhHant: '重新整理', ko: '새로고침' },
    'common.close':   { ja: '閉じる', en: 'close', zhHans: '关闭', zhHant: '關閉', ko: '닫기' },
    'common.cancel':  { ja: 'キャンセル', en: 'Cancel', zhHans: '取消', zhHant: '取消', ko: '취소' },
    'common.add':     { ja: '＋ 追加', en: '＋ Add', zhHans: '＋ 添加', zhHant: '＋ 新增', ko: '＋ 추가' },
    'common.save':    { ja: '保存', en: 'Save', zhHans: '保存', zhHant: '儲存', ko: '저장' },
    'common.edit':    { ja: '編集', en: 'Edit', zhHans: '编辑', zhHant: '編輯', ko: '편집' },
    'common.delete':  { ja: '削除', en: 'Delete', zhHans: '删除', zhHant: '刪除', ko: '삭제' },
    // --- diff drawer ---
    'diff.merge':         { ja: 'merge ↩ ベース', en: 'merge ↩ base', zhHans: 'merge ↩ 基线', zhHant: 'merge ↩ 基準', ko: 'merge ↩ 베이스' },
    'diff.pr':            { ja: 'PR 作成', en: 'Create PR', zhHans: '创建 PR', zhHant: '建立 PR', ko: 'PR 생성' },
    'diff.prevFile':      { ja: '前のファイル', en: 'Previous file', zhHans: '上一个文件', zhHant: '上一個檔案', ko: '이전 파일' },
    'diff.nextFile':      { ja: '次のファイル', en: 'Next file', zhHans: '下一个文件', zhHant: '下一個檔案', ko: '다음 파일' },
    'diff.loading':       { ja: '読み込み中…', en: 'loading…', zhHans: '加载中…', zhHant: '載入中…', ko: '불러오는 중…' },
    'diff.failed':        { ja: 'diff の取得に失敗しました', en: 'diff failed', zhHans: '获取 diff 失败', zhHant: '取得 diff 失敗', ko: 'diff 가져오기 실패' },
    'diff.noChanges':     { ja: 'ベースとの差分（追跡ファイル）はありません', en: 'no tracked changes vs base', zhHans: '与基线相比没有跟踪文件的更改', zhHant: '與基準相比沒有追蹤檔案的變更', ko: '베이스와 비교한 추적 파일의 변경 사항이 없습니다' },
    'diff.merging':       { ja: '{branch} を merge 中…', en: 'merging {branch} …', zhHans: '正在 merge {branch} …', zhHant: '正在 merge {branch} …', ko: '{branch} merge 중…' },
    'diff.mergeFailed':   { ja: 'merge に失敗しました', en: 'merge failed', zhHans: 'merge 失败', zhHant: 'merge 失敗', ko: 'merge 실패' },
    'diff.merged':        { ja: '✓ {ahead} コミットを merge: {branch} → {target}', en: '✓ merged {ahead} commit(s): {branch} → {target}', zhHans: '✓ 已 merge {ahead} 个提交：{branch} → {target}', zhHant: '✓ 已 merge {ahead} 個提交：{branch} → {target}', ko: '✓ 커밋 {ahead}개 merge 완료: {branch} → {target}' },
    'diff.creatingPr':    { ja: '{branch} の PR を作成中…', en: 'creating PR for {branch} …', zhHans: '正在为 {branch} 创建 PR …', zhHant: '正在為 {branch} 建立 PR …', ko: '{branch}의 PR 생성 중…' },
    'diff.prFailed':      { ja: 'PR 作成に失敗しました', en: 'Failed to create the PR', zhHans: '创建 PR 失败', zhHant: '建立 PR 失敗', ko: 'PR 생성 실패' },
    'diff.prCreated':     { ja: '✓ PR 作成: {url}', en: '✓ PR created: {url}', zhHans: '✓ 已创建 PR：{url}', zhHant: '✓ 已建立 PR：{url}', ko: '✓ PR 생성됨: {url}' },
    'diff.prCreatedNoUrl':{ ja: '✓ PR を作成しました', en: '✓ PR created', zhHans: '✓ 已创建 PR', zhHant: '✓ 已建立 PR', ko: '✓ PR 생성됨' },
    'diff.confirmMerge':  { ja: 'セッションのブランチ「{branch}」をベースブランチへ merge します。よろしいですか？', en: 'Merge the session branch “{branch}” into the base branch?', zhHans: '将会话分支“{branch}”merge 到基线分支，确定吗？', zhHant: '將工作階段分支「{branch}」merge 到基準分支，確定嗎？', ko: '세션 브랜치 “{branch}”를 베이스 브랜치에 merge 합니다. 계속할까요?' },
    'diff.confirmPr':     { ja: '「{branch}」を origin に push して PR を作成します。よろしいですか？', en: 'Push “{branch}” to origin and create a PR?', zhHans: '将“{branch}”push 到 origin 并创建 PR，确定吗？', zhHant: '將「{branch}」push 到 origin 並建立 PR，確定嗎？', ko: '“{branch}”를 origin에 push 하고 PR을 생성할까요?' },
    // --- panes / sessions ---
    'pane.kill':   { ja: 'セッションを終了', en: 'Kill session', zhHans: '终止会话', zhHant: '終止工作階段', ko: '세션 종료' },
    'pane.confirmKill': { ja: 'セッション「{name}」を終了しますか？ エージェントと未マージの worktree 変更は失われます。', en: 'Kill session “{name}”? Its agent and any unmerged worktree changes will be lost.', zhHans: '终止会话“{name}”？其代理和任何未合并的 worktree 更改都将丢失。', zhHant: '終止工作階段「{name}」？其代理與任何未合併的 worktree 變更都將遺失。', ko: '세션 “{name}”을(를) 종료하시겠습니까? 에이전트와 병합되지 않은 worktree 변경 사항이 사라집니다.' },
    'pane.diff':   { ja: 'git diff を表示', en: 'Review git diff', zhHans: '查看 git diff', zhHant: '檢視 git diff', ko: 'git diff 보기' },
    'pane.drag':   { ja: 'ドラッグで並べ替え', en: 'Drag to reorder', zhHans: '拖动以重新排序', zhHant: '拖曳以重新排序', ko: '드래그하여 순서 변경' },
    'pane.rename': { ja: 'ダブルクリックで名前変更', en: 'Double-click to rename', zhHans: '双击以重命名', zhHant: '按兩下以重新命名', ko: '더블클릭하여 이름 변경' },
    'count.sessions': { ja: '{n} セッション', en: '{n} sessions', zhHans: '{n} 个会话', zhHant: '{n} 個工作階段', ko: '세션 {n}개' },
    'title.attention': { ja: '({n}) Agent Deck — 要対応', en: '({n}) Agent Deck — needs attention', zhHans: '({n}) Agent Deck — 待处理', zhHant: '({n}) Agent Deck — 待處理', ko: '({n}) Agent Deck — 대응 필요' },
    'notify.attention': { ja: '{name} が入力待ちです', en: '{name} is waiting for input', zhHans: '{name} 正在等待输入', zhHant: '{name} 正在等待輸入', ko: '{name}이(가) 입력을 기다리고 있습니다' },
    // --- repo dynamic ---
    'repo.launch':      { ja: '▶ エージェント起動', en: '▶ Launch agent', zhHans: '▶ 启动智能体', zhHant: '▶ 啟動代理', ko: '▶ 에이전트 실행' },
    'repo.launchFor':   { ja: '▶ {repo} で起動', en: '▶ Launch in {repo}', zhHans: '▶ 在 {repo} 中启动', zhHant: '▶ 在 {repo} 中啟動', ko: '▶ {repo}에서 실행' },
    'repo.onlyShowing': { ja: '▦ {repo} のみ表示中', en: '▦ Showing {repo} only', zhHans: '▦ 仅显示 {repo}', zhHant: '▦ 僅顯示 {repo}', ko: '▦ {repo}만 표시 중' },
    'repo.schedAdd':    { ja: 'このリポジトリでスケジュール起動を追加', en: 'Add a scheduled launch for this repo', zhHans: '为此仓库添加定时启动', zhHant: '為此儲存庫新增排程啟動', ko: '이 저장소에 예약 실행 추가' },
    'repo.homeAlways':  { ja: 'ホームディレクトリは常に「Home」として表示されています。', en: 'The home directory is always shown as “Home”.', zhHans: '主目录始终显示为“Home”。', zhHant: '主目錄始終顯示為「Home」。', ko: '홈 디렉터리는 항상 “Home”으로 표시됩니다.' },
    'repo.saveFailed':  { ja: 'リポジトリの保存に失敗しました: {error}', en: 'Failed to save repositories: {error}', zhHans: '保存仓库失败：{error}', zhHant: '儲存儲存庫失敗：{error}', ko: '저장소 저장 실패: {error}' },
    'deck.restore':     { ja: '↻ 前回のデッキを復元 ({n})', en: '↻ Restore last deck ({n})', zhHans: '↻ 恢复上次的面板 ({n})', zhHant: '↻ 還原上次的面板 ({n})', ko: '↻ 마지막 덱 복원 ({n})' },
    'deck.restoreLabel': { ja: '前回のデッキを復元', en: 'Restore last deck', zhHans: '恢复上次的面板', zhHant: '還原上次的面板', ko: '마지막 덱 복원' },
    'deck.restorePartial': { ja: 'デッキ復元: {ok} 件成功 / {failed} 件失敗', en: 'Deck restore: {ok} succeeded / {failed} failed', zhHans: '面板恢复：{ok} 个成功 / {failed} 个失败', zhHant: '面板還原：{ok} 個成功 / {failed} 個失敗', ko: '덱 복원: {ok}개 성공 / {failed}개 실패' },
    'deck.restoreMetadataRejected': { ja: '「{name}」の保存済みworktree情報が現在のGit状態と一致しないため、merge / PRを無効化しました。', en: 'Saved worktree metadata for “{name}” no longer matches Git; merge / PR was disabled.', zhHans: '“{name}”保存的 worktree 信息与当前 Git 状态不符；已禁用 merge / PR。', zhHant: '「{name}」儲存的 worktree 資訊與目前 Git 狀態不符；已停用 merge / PR。', ko: '“{name}”의 저장된 worktree 정보가 현재 Git 상태와 일치하지 않아 merge / PR을 비활성화했습니다.' },
    // --- command palette ---
    'palette.ph':         { ja: 'セッションを検索…（名前 / リポ / ブランチ / preset）', en: 'Search sessions… (name / repo / branch / preset)', zhHans: '搜索会话…（名称 / 仓库 / 分支 / preset）', zhHant: '搜尋工作階段…（名稱 / 儲存庫 / 分支 / preset）', ko: '세션 검색…(이름 / 저장소 / 브랜치 / preset)' },
    'palette.foot':       { ja: '↑↓ 選択 · ↵ 移動 · Esc 閉じる', en: '↑↓ select · ↵ jump · Esc close', zhHans: '↑↓ 选择 · ↵ 跳转 · Esc 关闭', zhHant: '↑↓ 選擇 · ↵ 跳至 · Esc 關閉', ko: '↑↓ 선택 · ↵ 이동 · Esc 닫기' },
    'palette.none':       { ja: '該当なし', en: 'No matches', zhHans: '无匹配项', zhHant: '無相符項目', ko: '일치 항목 없음' },
    'palette.noSessions': { ja: '起動中のセッションがありません', en: 'No running sessions', zhHans: '没有正在运行的会话', zhHant: '沒有正在運行的工作階段', ko: '실행 중인 세션이 없습니다' },
    // --- keyboard hint (sidebar) ---
    'hint.kbdMac':   { ja: '⌘K 検索 · ⌘F 端末内検索 · ⌘1–9 ペイン · ⌘[ ⌘] 移動 · ⌘↵ 起動 · ⌘W 終了', en: '⌘K search · ⌘F find · ⌘1–9 pane · ⌘[ ⌘] move · ⌘↵ launch · ⌘W kill', zhHans: '⌘K 搜索 · ⌘F 终端内查找 · ⌘1–9 窗格 · ⌘[ ⌘] 移动 · ⌘↵ 启动 · ⌘W 终止', zhHant: '⌘K 搜尋 · ⌘F 終端內尋找 · ⌘1–9 窗格 · ⌘[ ⌘] 移動 · ⌘↵ 啟動 · ⌘W 終止', ko: '⌘K 검색 · ⌘F 터미널 내 찾기 · ⌘1–9 창 · ⌘[ ⌘] 이동 · ⌘↵ 실행 · ⌘W 종료' },
    'hint.kbdOther': { ja: 'Ctrl+Shift+K 検索 · Ctrl+Shift+F 端末内検索 · Ctrl+Shift+1–9 ペイン · Ctrl+Shift+[ ] 移動 · Ctrl+Shift+Enter 起動 · Ctrl+Shift+W 終了', en: 'Ctrl+Shift+K search · Ctrl+Shift+F find · Ctrl+Shift+1–9 pane · Ctrl+Shift+[ ] move · Ctrl+Shift+Enter launch · Ctrl+Shift+W kill', zhHans: 'Ctrl+Shift+K 搜索 · Ctrl+Shift+F 终端内查找 · Ctrl+Shift+1–9 窗格 · Ctrl+Shift+[ ] 移动 · Ctrl+Shift+Enter 启动 · Ctrl+Shift+W 终止', zhHant: 'Ctrl+Shift+K 搜尋 · Ctrl+Shift+F 終端內尋找 · Ctrl+Shift+1–9 窗格 · Ctrl+Shift+[ ] 移動 · Ctrl+Shift+Enter 啟動 · Ctrl+Shift+W 終止', ko: 'Ctrl+Shift+K 검색 · Ctrl+Shift+F 터미널 내 찾기 · Ctrl+Shift+1–9 창 · Ctrl+Shift+[ ] 이동 · Ctrl+Shift+Enter 실행 · Ctrl+Shift+W 종료' },
    // --- preset manager ---
    'presets.title':   { ja: 'エージェントプリセット', en: 'Agent presets', zhHans: '智能体预设', zhHant: '代理預設', ko: '에이전트 프리셋' },
    'presets.labelPh': { ja: '表示名（例: Aider）', en: 'Display name (e.g. Aider)', zhHans: '显示名称（例如：Aider）', zhHant: '顯示名稱（例如：Aider）', ko: '표시 이름(예: Aider)' },
    'presets.cmdPh':   { ja: '起動コマンド（例: aider）', en: 'Startup command (e.g. aider)', zhHans: '启动命令（例如：aider）', zhHant: '啟動指令（例如：aider）', ko: '시작 명령(예: aider)' },
    'presets.builtin': { ja: 'ビルトイン', en: 'Built-in', zhHans: '内置', zhHant: '內建', ko: '기본 제공' },
    'presets.confirmDelete': { ja: 'プリセット「{label}」を削除しますか？', en: 'Delete preset “{label}”?', zhHans: '删除预设“{label}”吗？', zhHant: '刪除預設「{label}」嗎？', ko: '프리셋 “{label}”을(를) 삭제할까요?' },
    'presets.initPh':    { ja: '起動後に自動入力（1行1コマンド・例: /effort ultracode）', en: 'Auto-typed after launch (one command per line, e.g. /effort ultracode)', zhHans: '启动后自动输入（每行一条命令，例如：/effort ultracode）', zhHant: '啟動後自動輸入（每行一條指令，例如：/effort ultracode）', ko: '실행 후 자동 입력(한 줄에 한 명령, 예: /effort ultracode)' },
    'presets.initHint':  { ja: '起動後、エージェントの起動が落ち着いてから1行ずつ自動入力されます', en: 'Typed in line by line once the agent has finished starting up', zhHans: '在智能体启动完成后逐行自动输入', zhHant: '在代理啟動完成後逐行自動輸入', ko: '에이전트가 시작을 마친 뒤 한 줄씩 자동으로 입력됩니다' },
    'presets.editInit':  { ja: '起動後コマンド', en: 'Init commands', zhHans: '启动后命令', zhHant: '啟動後指令', ko: '실행 후 명령' },
    'presets.initTitle': { ja: '{label} の起動後コマンド', en: 'Post-launch commands for {label}', zhHans: '{label} 的启动后命令', zhHant: '{label} 的啟動後指令', ko: '{label}의 실행 후 명령' },
    // --- scheduled launches ---
    'sched.title':     { ja: 'スケジュール起動', en: 'Scheduled launch', zhHans: '定时启动', zhHant: '排程啟動', ko: '예약 실행' },
    'sched.repo':      { ja: 'リポジトリ', en: 'Repository', zhHans: '仓库', zhHant: '儲存庫', ko: '저장소' },
    'sched.time':      { ja: '起動時刻', en: 'Launch time', zhHans: '启动时间', zhHant: '啟動時間', ko: '실행 시각' },
    'sched.repeat':    { ja: '繰り返し', en: 'Repeat', zhHans: '重复', zhHant: '重複', ko: '반복' },
    'sched.daily':     { ja: '毎日', en: 'Daily', zhHans: '每天', zhHant: '每天', ko: '매일' },
    'sched.weekly':    { ja: '曜日指定', en: 'Days of week', zhHans: '指定星期', zhHant: '指定星期', ko: '요일 지정' },
    'sched.once':      { ja: '一回のみ', en: 'Once', zhHans: '仅一次', zhHant: '僅一次', ko: '한 번만' },
    'sched.date':      { ja: '日付（一回のみ）', en: 'Date (once)', zhHans: '日期（仅一次）', zhHant: '日期（僅一次）', ko: '날짜(한 번만)' },
    'sched.agent':     { ja: 'エージェント', en: 'Agent', zhHans: '智能体', zhHant: '代理', ko: '에이전트' },
    'sched.cmdPh':     { ja: '起動コマンド', en: 'Startup command', zhHans: '启动命令', zhHant: '啟動指令', ko: '시작 명령' },
    'sched.namePh':    { ja: 'セッション名（省略可）', en: 'Session name (optional)', zhHans: '会话名称（可选）', zhHant: '工作階段名稱（選填）', ko: '세션 이름(선택)' },
    'sched.wt':        { ja: 'worktree 隔離', en: 'worktree isolation', zhHans: 'worktree 隔离', zhHant: 'worktree 隔離', ko: 'worktree 격리' },
    'sched.wtPrefixPh':{ ja: 'ブランチ名プレフィックス（省略可）', en: 'Branch name prefix (optional)', zhHans: '分支名前缀（可选）', zhHant: '分支名稱前綴（選填）', ko: '브랜치 이름 접두사(선택)' },
    'sched.empty':     { ja: 'スケジュールはありません。下のフォームから追加できます。', en: 'No schedules yet. Add one with the form below.', zhHans: '尚无定时计划。可用下面的表单添加。', zhHant: '尚無排程。可用下方的表單新增。', ko: '예약이 없습니다. 아래 양식에서 추가할 수 있습니다.' },
    'sched.enable':    { ja: '有効にする', en: 'Enable', zhHans: '启用', zhHant: '啟用', ko: '사용' },
    'sched.disable':   { ja: '無効にする', en: 'Disable', zhHans: '禁用', zhHant: '停用', ko: '사용 안 함' },
    'sched.noRepo':    { ja: '⚠ リポジトリ未登録', en: '⚠ Repo not registered', zhHans: '⚠ 仓库未注册', zhHant: '⚠ 儲存庫未註冊', ko: '⚠ 저장소 미등록' },
    'sched.notInList': { ja: '{repoId} はリポジトリ一覧にありません', en: '{repoId} is not in the repository list', zhHans: '{repoId} 不在仓库列表中', zhHant: '{repoId} 不在儲存庫清單中', ko: '{repoId}이(가) 저장소 목록에 없습니다' },
    'sched.next':      { ja: '次回 {when}', en: 'Next {when}', zhHans: '下次 {when}', zhHant: '下次 {when}', ko: '다음 {when}' },
    'sched.disabled':  { ja: '無効', en: 'Disabled', zhHans: '已禁用', zhHant: '已停用', ko: '사용 안 함' },
    'sched.wtMeta':    { ja: ' · worktree 隔離', en: ' · worktree isolation', zhHans: ' · worktree 隔离', zhHant: ' · worktree 隔離', ko: ' · worktree 격리' },
    'sched.saveFailed':{ ja: '保存に失敗しました', en: 'Failed to save', zhHans: '保存失败', zhHant: '儲存失敗', ko: '저장 실패' },
    'sched.notFound':  { ja: '⏰ スケジュールのリポジトリが見つかりません: {repoId}', en: '⏰ Schedule’s repository not found: {repoId}', zhHans: '⏰ 找不到定时计划的仓库：{repoId}', zhHant: '⏰ 找不到排程的儲存庫：{repoId}', ko: '⏰ 예약의 저장소를 찾을 수 없습니다: {repoId}' },
    'sched.fired':     { ja: '⏰ {repo} でスケジュールセッションを起動しました', en: '⏰ Launched a scheduled session in {repo}', zhHans: '⏰ 已在 {repo} 中启动定时会话', zhHant: '⏰ 已在 {repo} 中啟動排程工作階段', ko: '⏰ {repo}에서 예약 세션을 실행했습니다' },
    // --- terminal search / context menu / update toast ---
    'search.ph':    { ja: 'ターミナル内を検索…', en: 'Search the terminal…', zhHans: '在终端中搜索…', zhHant: '在終端機中搜尋…', ko: '터미널에서 검색…' },
    'search.prev':  { ja: '前へ (Shift+Enter)', en: 'Previous (Shift+Enter)', zhHans: '上一个 (Shift+Enter)', zhHant: '上一個 (Shift+Enter)', ko: '이전 (Shift+Enter)' },
    'search.next':  { ja: '次へ (Enter)', en: 'Next (Enter)', zhHans: '下一个 (Enter)', zhHant: '下一個 (Enter)', ko: '다음 (Enter)' },
    'search.close': { ja: '閉じる (Esc)', en: 'Close (Esc)', zhHans: '关闭 (Esc)', zhHant: '關閉 (Esc)', ko: '닫기 (Esc)' },
    'menu.copy':      { ja: 'コピー', en: 'Copy', zhHans: '复制', zhHant: '複製', ko: '복사' },
    'menu.paste':     { ja: 'ペースト', en: 'Paste', zhHans: '粘贴', zhHant: '貼上', ko: '붙여넣기' },
    'menu.selectAll': { ja: 'すべて選択', en: 'Select all', zhHans: '全选', zhHant: '全選', ko: '모두 선택' },
    'menu.clear':     { ja: 'クリア', en: 'Clear', zhHans: '清除', zhHant: '清除', ko: '지우기' },
    'update.download':{ ja: 'ダウンロード', en: 'Download', zhHans: '下载', zhHant: '下載', ko: '다운로드' },
    'update.dismiss': { ja: '閉じる', en: 'Dismiss', zhHans: '忽略', zhHant: '忽略', ko: '닫기' },
    'update.toast':   { ja: '新しいバージョン v{latest} が利用できます（現在 v{current}）', en: 'Version v{latest} is available (current v{current})', zhHans: '有新版本 v{latest} 可用（当前 v{current}）', zhHant: '有新版本 v{latest} 可用（目前 v{current}）', ko: '새 버전 v{latest}을(를) 사용할 수 있습니다(현재 v{current})' },
    'update.notif':       { ja: '新しいバージョン v{latest} が利用できます。クリックで詳細を表示します。', en: 'Version v{latest} is available. Click for details.', zhHans: '有新版本 v{latest} 可用。点击查看详情。', zhHant: '有新版本 v{latest} 可用。點擊查看詳情。', ko: '새 버전 v{latest}을(를) 사용할 수 있습니다. 클릭하면 자세히 표시됩니다.' },
    'update.notifBrowser':{ ja: '新しいバージョン v{latest} が利用できます。クリックでダウンロードページを開きます。', en: 'Version v{latest} is available. Click to open the download page.', zhHans: '有新版本 v{latest} 可用。点击打开下载页面。', zhHant: '有新版本 v{latest} 可用。點擊開啟下載頁面。', ko: '새 버전 v{latest}을(를) 사용할 수 있습니다. 클릭하면 다운로드 페이지가 열립니다.' },
    'update.downloading': { ja: 'ダウンロード中 {percent}%', en: 'Downloading {percent}%', zhHans: '下载中 {percent}%', zhHant: '下載中 {percent}%', ko: '다운로드 중 {percent}%' },
    'update.install':     { ja: '再起動してインストール', en: 'Restart & install', zhHans: '重启并安装', zhHant: '重新啟動並安裝', ko: '재시작 후 설치' },
    'update.openPage':    { ja: 'ダウンロードページを開く', en: 'Open download page', zhHans: '打开下载页面', zhHant: '開啟下載頁面', ko: '다운로드 페이지 열기' },
  };

  var WEEKDAYS = {
    ja: ['日', '月', '火', '水', '木', '金', '土'],
    en: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'],
    zhHans: ['日', '一', '二', '三', '四', '五', '六'],
    zhHant: ['日', '一', '二', '三', '四', '五', '六'],
    ko: ['일', '월', '화', '수', '목', '금', '토'],
  };

  var current = 'en';

  function has(lang) { return LANGS.indexOf(lang) !== -1; }
  function setLang(lang) { if (has(lang)) current = lang; return current; }
  function getLang() { return current; }
  function langs() { return LANGS.slice(); }

  /** Map an OS/browser locale ("ja-JP", "en-US", "zh-CN", "zh-TW", "ko"…) to a
   *  supported language. Chinese needs its script subtag, so we inspect region/script
   *  rather than just the primary subtag (which would collapse every zh-* to "zh"). */
  function resolveLocale(locale) {
    var s = String(locale == null ? '' : locale).toLowerCase();
    var base = s.split('-')[0];
    if (base === 'ja') return 'ja';
    if (base === 'en') return 'en';
    if (base === 'ko') return 'ko';
    if (base === 'zh') {
      // An explicit Hans script subtag is authoritative over the region (BCP-47:
      // script is more specific than region), so zh-Hans-HK/TW/MO stays Simplified.
      if (s.indexOf('hans') !== -1) return 'zhHans';
      // Traditional: explicit Hant script, or Taiwan / Hong Kong / Macau regions.
      if (s.indexOf('hant') !== -1 ||
          s.indexOf('-tw') !== -1 || s.indexOf('-hk') !== -1 || s.indexOf('-mo') !== -1) {
        return 'zhHant';
      }
      return 'zhHans'; // zh, zh-Hans, zh-CN, zh-SG → Simplified
    }
    return FALLBACK;
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
