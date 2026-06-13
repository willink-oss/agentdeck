# Agent Deck

[![CI](https://github.com/willink-oss/agentdeck/actions/workflows/ci.yml/badge.svg)](https://github.com/willink-oss/agentdeck/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Release](https://img.shields.io/github/v/release/willink-oss/agentdeck?include_prereleases&sort=semver)](https://github.com/willink-oss/agentdeck/releases)

複数のAI CLIエージェント（Claude Code / Antigravity / Codex / Gemini など）を、
それぞれ独立したターミナルで**並列に**立ち上げて監視するデスクトップアプリです。

- Electron + `node-pty`（本物のPTY）+ `xterm.js`
- クロスプラットフォーム設計（macOS / Windows / Linux）
- シェル自動判定（mac/Linux → `$SHELL`、Windows → PowerShell）

## 機能

1. **並列ターミナル** — エージェントをグリッドに並べて同時操作・監視
2. **起動コマンド自動入力** — 起動時に `claude` / `agy` 等を自動実行
3. **Git worktree 隔離** — セッションごとに新規ブランチ＋作業ツリーで起動し競合防止
4. **内蔵 diff レビュー** — 各ペインの `diff` で起動時点からの変更を色分け表示。変更行内の**語句レベル強調**・**シンタックスハイライト**（拡張子判定・依存ゼロの自前トークナイザ）・複数ファイル diff の**ファイル単位ジャンプ**（チップ＋↑↓＋スクロール追従）
5. **入力待ち検知 + 通知** — 出力停止をターミナル末尾の内容で分類し、**プロンプト/確認質問なら約3秒で「要対応」点灯**、作業中表示（スピナー・esc to interrupt）は抑制、判断材料なしは12秒。非アクティブ時はOS通知
6. **マルチリポジトリ管理** — サイドバーにリポを登録し、リポ単位で branch / diff-stat / worktree を表示。選択リポのセッションだけにステージを絞る**フォーカスフィルタ**、ダブルクリック即起動、PC全体で起動できる **⌂Home 常設エントリ**
7. **diff からのマージ / PR** — worktree 隔離セッションの成果を、diff ドロワーから**ローカルマージ**（「merge ↩ base」＝`git merge --no-ff`）または **GitHub PR 作成**（「PR 作成」＝push → `gh pr create`）で取り込み
8. **ステージ操作** — グリッドの列数切替（auto/1/2/3・永続化）、ペインのドラッグ並べ替え、起動中デッキの保存＆**再起動後に「↻ 前回のデッキを復元」**で再 spawn
9. **エージェント・プリセット管理** — Agent 横の ⚙ から**カスタムプリセット（表示名＋起動コマンド）を追加・編集・削除**。Aider 等の任意 CLI をコード変更なしで登録でき、select と Quick launch チップに反映（localStorage 永続）
10. **キーボード操作** — ペイン移動（1–9）・前後循環（[ ]）・クイック起動（Enter）・終了（W）・**コマンドパレット（K・fuzzy 検索でセッションへジャンプ）**。修飾キーは macOS が **⌘**、Windows / Linux が **Ctrl+Shift**（素の Ctrl はシェル/readline のキーのため、ターミナルアプリの慣習に準拠）
11. **スケジュール起動（⏰）** — 「リポジトリ × エージェント × 時刻」を登録すると指定時刻にセッションを自動起動。繰り返し（一回のみ / 毎日 / 曜日指定）、worktree 隔離（発火ごとに日時付きブランチで一意化）、有効/無効トグル・次回発火表示・起動時の OS 通知に対応。Agent 横の ⏰ かリポジトリ行の ⏰ から登録（`userData/schedules.json` に永続化、スケジューラは main プロセス常駐で 30 秒間隔の壁時計照合 — スリープ復帰でも取りこぼし/二重発火なし）
12. **多言語対応（日本語 / 英語）** — UI を日本語・英語で切り替え（サイドバー下部のセレクタ）。初回は OS のロケールに追従。文字列は依存ゼロの `lib/i18n.js` 辞書（`{key: {ja, en}}`）で一元管理（中文・韓国語は issue #10 で追加予定）

---

## ダウンロード

最新版は [Releases](https://github.com/willink-oss/agentdeck/releases) から取得してください。
バージョンタグを切ると CI が各 OS の成果物を自動ビルドして添付します（[RELEASE.md](RELEASE.md)）。

| OS | ファイル | 初回起動 |
|---|---|---|
| **macOS** (Apple Silicon `-arm64` / Intel `-x64`) | `.dmg` | Gatekeeper 警告 → **右クリック → 開く**（または `xattr -dr com.apple.quarantine`） |
| **Windows** (x64) | `.exe`（インストーラ） | SmartScreen → **詳細情報 → 実行** |
| **Linux** (x64) | `.AppImage` / `.deb` | AppImage は `chmod +x` で実行（要 `libfuse2`）／deb は `apt install ./…deb` |

> ⚠️ **未署名の OSS 配布**です（GitHub Releases が正本）。上記の初回起動手順で開けます。
> Apple Developer ID 署名・公証や App Store 配布は予定していません（App Store はサンドボックスとシェル起動が非互換のため非対応）。
> アプリは起動時に Releases を参照してアップデートの有無を通知します（自動更新はしません）。

---

## セットアップ（開発）

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

CI（GitHub Actions）は ubuntu / macOS / windows のマトリクスで `node --test` に加え、
実ランナー上で Electron をヘッドレス起動するスモーク（`npm run smoke` — 起動 / preload /
IPC / node-pty を検証。Linux は xvfb 経由）を実行します。

## ビルド・配布（macOS / arm64 + x64）

`electron-builder` で **.dmg** を生成します（node-pty は asar 外に展開して同梱）。
**現在のリリースは未署名**で、GitHub Releases を正本に配布します。

```bash
npm run pack:unsigned   # 未署名 .dmg ← 現在のリリース手順
```

> Apple Developer ID による署名＋公証（`npm run dist`）は**現状は予定していません**。
> 将来署名する場合の手順（証明書・公証用 env）と、GitHub Releases 公開・アプリ内
> アップデートチェックの詳細は **[RELEASE.md](RELEASE.md)** を参照してください。

アプリは起動時と 6 時間ごとに Releases feed を確認し、新版があれば**右下のトースト＋OS 通知**（バージョンごとに一度・クリックでダウンロードページを開く）でお知らせします。バックグラウンドでも気づけます（自動更新はしません）。

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

## リポジトリ構成

[`willink-oss/agentdeck`](https://github.com/willink-oss/agentdeck)（i-Willink の OSS 組織）で公開しています。

### 同梱物

| パス | 役割 |
|---|---|
| `.github/workflows/ci.yml` | OSマトリクスで `npm test` ＋ ヘッドレス起動スモーク（`npm run smoke`） |
| `.github/pull_request_template.md` | PR テンプレート |
| `.github/ISSUE_TEMPLATE/` | bug / feature テンプレート |
| `LICENSE` | MIT（i-Willink）|
| `CONTRIBUTING.md` | 開発・テスト・PR 規約 |

`.gitignore` で `node_modules/` と `.agentdeck-worktrees/` 相当は除外済みです。

---

## 構成

```
agentdeck/
├── main.js              # Electron main：PTY・git worktree/diff/merge・リポ登録・スケジューラ・IPC
├── preload.js           # contextBridge 経由の IPC
├── lib/                 # DOM/Electron 非依存の純粋ロジック（テスト対象）
│   ├── git-utils.js     #   defaultShell / sanitizeBranch / worktreeFolderName
│   ├── diff.js          #   classifyLine / diffToSegments
│   ├── attention.js     #   shouldFlagAttention
│   ├── repos.js         #   normalizePath / addRepo / findRepo / effectiveRepos / findEff
│   ├── gitstat.js       #   parseNumstat / parseWorktreeList / formatStat
│   ├── layout.js        #   normalizeLayoutMode / gridTemplateFor（グリッド列数）
│   ├── workspace.js     #   toConfig / normalize（デッキ保存/復元）
│   ├── fuzzy.js         #   score（⌘K パレットの部分列マッチ）
│   ├── version.js       #   compare / isNewer（アップデートチェック）
│   ├── presets.js       #   ビルトイン定義 + validate / keyFor / merge（プリセット管理）
│   ├── schedule.js      #   validate / nextFireAt / shouldFire / markFired（スケジュール起動）
│   └── i18n.js          #   t(key) / 辞書（ja / en の多言語）
├── renderer/            # UI（順序ロードの classic script 群 — global lexical scope を共有）
│   ├── index.html       #   script の並び順がロード順（boot を含む 07 → 08 の順を維持）
│   ├── 00-state.js      #   共有状態・定数・DOM refs・lib バインディング
│   ├── 01-launch-form.js#   起動フォーム（preset select / quick chips）
│   ├── 02-repos.js      #   リポジトリパネル（サイドバー・ポーリング・フィルタ）
│   ├── 03-deck.js       #   レイアウト切替・ペイン並べ替え・デッキ保存/復元
│   ├── 04-sessions.js   #   セッション起動/kill・attention 検知・PTY ルーティング
│   ├── 05-diff.js       #   diff ドロワー（merge / PR）
│   ├── 06-keys-palette.js #  ⌘ショートカット・リネーム・⌘K パレット
│   ├── 07-overlays-boot.js # プリセット管理・右クリックメニュー・update toast・boot
│   ├── 08-schedules.js  #   スケジュール起動（⏰ モーダル・schedule:fire ハンドラ）
│   └── styles.css
├── e2e/
│   └── smoke.cjs        # CI 用ヘッドレス起動スモーク（3 OS・起動/preload/IPC/node-pty）
└── test/                # node --test 用ユニットテスト（164 cases）
```

## 既知の割り切り

- `kill` では worktree とブランチを**残す**（作業保全優先。不要分は `git worktree prune`）。
- diff は `git diff <base>`（追跡ファイル）＋ untracked 一覧。
- 入力待ち検知はヒューリスティック（出力停止＋末尾分類）。プロンプト/質問は素早く、不明なケースは保守的に点灯するが、誤検知は依然あり得る。
- merge はローカル `git merge --no-ff` のみ（**コミット済み履歴**が対象。未コミット分はセッション内で commit してから）。コンフリクト時は `git merge --abort` で原状復帰。
- PR 作成は **`origin` リモート＋認証済み `gh` CLI** が前提（push → `gh pr create`）。worktree 隔離セッションのみ対象。
- デッキ復元は各セッションの**起動設定を再 spawn** するもの（ライブ端末出力・スクロールバックは復元しない）。worktree セッションは既存の worktree ディレクトリでシェルを開き直す。
- スケジュール起動は**アプリ起動中のみ**発火する（OS のタスクスケジューラには登録しない）。非起動中に過ぎた回はスキップされるが、「一回のみ」は起動時に**直近 5 分以内なら猶予発火**する。精度は ±30 秒。

## 次の一手（任意）

- 配布を絞るなら Tauri + `portable-pty`（Rust）へ移植

## コントリビュート / ライセンス

- ライセンス: **MIT** — [LICENSE](LICENSE)
- 開発・PR 規約: [CONTRIBUTING.md](CONTRIBUTING.md)
- 行動規範: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- 脆弱性の報告: [SECURITY.md](SECURITY.md)
- ビルド・配布（macOS）: [RELEASE.md](RELEASE.md)

Issue / PR を歓迎します。1 PR = 1 トピック、`npm test` がグリーンであることをご確認ください。
