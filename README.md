# Agent Deck

複数のAI CLIエージェント（Claude Code / Antigravity / Codex / Gemini など）を、
それぞれ独立したターミナルで**並列に**立ち上げて監視するデスクトップアプリです。

- Electron + `node-pty`（本物のPTY）+ `xterm.js`
- クロスプラットフォーム設計（macOS / Windows / Linux）
- シェル自動判定（mac/Linux → `$SHELL`、Windows → PowerShell）

## 機能

1. **並列ターミナル** — エージェントをグリッドに並べて同時操作・監視
2. **起動コマンド自動入力** — 起動時に `claude` / `agy` 等を自動実行
3. **Git worktree 隔離** — セッションごとに新規ブランチ＋作業ツリーで起動し競合防止
4. **内蔵 diff レビュー** — 各ペインの `diff` で起動時点からの変更を色分け表示
5. **入力待ち検知 + 通知** — 出力が既定6秒止まると「要対応」点灯／非アクティブ時はOS通知
6. **マルチリポジトリ管理** — サイドバーにリポを登録し、リポ単位で branch / diff-stat / worktree を表示。選択リポのセッションだけにステージを絞る**フォーカスフィルタ**、ダブルクリック即起動、PC全体で起動できる **⌂Home 常設エントリ**
7. **diff からのローカルマージ** — worktree 隔離セッションの成果を、diff ドロワーの「merge ↩ base」でベースブランチへ `git merge --no-ff` で取り込み（リモート/PR 不要）

---

## セットアップ

```bash
npm install
npm run rebuild   # node-pty を Electron 向けに再ビルド
npm start
```

> `npm start` で「NODE_MODULE_VERSION mismatch」が出たら `npm run rebuild`。
> mac は Xcode CLT（`xcode-select --install`）、Windows はビルドツールが必要な場合あり。

## テスト

純粋ロジックは `lib/` に切り出し、**Node 標準テストランナー**で検証します（依存ゼロ・電子/PTY不要）。

```bash
npm test       # = node --test  （test/*.test.js を実行）
```

CI（GitHub Actions）は ubuntu / macOS / windows のマトリクスで `node --test` を実行します。

## 使い方

1. **Agent** を選ぶ（Startup command 自動入力・編集可）
2. **Working directory** を指定（git リポジトリならステータス表示）
3. 必要なら **Isolate in git worktree** をオン＋ブランチ名入力
4. **▶ Launch agent** → ペイン追加 & コマンド自動実行
5. `diff` で変更レビュー、`kill` で終了

### Antigravity（agy）

起動コマンドは **`agy`**（`antigravity` プリセットに設定済み）。`agy --model <model>` で
モデル指定、`agy -p "..."` でヘッドレス。インストール先: mac/Linux `~/.local/bin/agy`、
Windows `C:\Users\<Username>\AppData\Local\agy\bin`。

---

## GitHub 組織での管理

リポジトリ URL は `willink-labs/agentdeck` を想定しています（`package.json` の
`repository` を組織名に合わせて調整してください）。

### GitHub CLI で一発作成（推奨）

```bash
git init -b main
git add .
git commit -m "chore: initial commit (Agent Deck prototype)"

# 組織にプライベートで作成 & push
gh repo create willink-labs/agentdeck --private --source=. --remote=origin --push
```

### 既存の空リポジトリへ push する場合

```bash
git init -b main
git add .
git commit -m "chore: initial commit (Agent Deck prototype)"
git remote add origin git@github.com:willink-labs/agentdeck.git
git push -u origin main
```

### 同梱物

| パス | 役割 |
|---|---|
| `.github/workflows/ci.yml` | OSマトリクスで `npm test` |
| `.github/pull_request_template.md` | PR テンプレート |
| `.github/ISSUE_TEMPLATE/` | bug / feature テンプレート |
| `LICENSE` | MIT（i-Willink）|
| `CONTRIBUTING.md` | 開発・テスト・PR 規約 |

`.gitignore` で `node_modules/` と `.agentdeck-worktrees/` 相当は除外済みです。

---

## 構成

```
agentdeck/
├── main.js              # Electron main：PTY・git worktree/diff/merge・リポ登録・IPC
├── preload.js           # contextBridge 経由の IPC
├── lib/                 # DOM/Electron 非依存の純粋ロジック（テスト対象）
│   ├── git-utils.js     #   defaultShell / sanitizeBranch / worktreeFolderName
│   ├── diff.js          #   classifyLine / diffToSegments
│   ├── attention.js     #   shouldFlagAttention
│   ├── repos.js         #   normalizePath / addRepo / findRepo / effectiveRepos / findEff
│   └── gitstat.js       #   parseNumstat / parseWorktreeList / formatStat
├── renderer/            # サイドバー（マルチリポ）＋ターミナルグリッド＋diff ドロワー
│   ├── index.html
│   ├── renderer.js
│   └── styles.css
└── test/                # node --test 用ユニットテスト（52 cases）
    ├── git-utils.test.js
    ├── diff.test.js
    ├── attention.test.js
    ├── gitstat.test.js
    └── repos.test.js
```

## 既知の割り切り

- `kill` では worktree とブランチを**残す**（作業保全優先。不要分は `git worktree prune`）。
- diff は `git diff <base>`（追跡ファイル）＋ untracked 一覧。
- 入力待ち検知はヒューリスティック（出力停止＝待ち）。ビルド完了等でも点灯し得る。
- merge はローカル `git merge --no-ff` のみ（**コミット済み履歴**が対象。未コミット分はセッション内で commit してから）。コンフリクト時は `git merge --abort` で原状復帰。

## 次の一手（任意）

- diff からの **PR 作成**（ローカル `git merge` 導線は実装済み）
- レイアウト切替・ペイン並べ替え、セッション構成の保存/復元
- 配布を絞るなら Tauri + `portable-pty`（Rust）へ移植
