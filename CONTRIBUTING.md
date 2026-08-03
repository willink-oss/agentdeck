# Contributing

## 開発の前提

- Node.js 22.12+
- macOS では Xcode Command Line Tools

## セットアップ

```bash
npm install
npm run rebuild   # node-pty を Electron 向けに再ビルド
npm start
```

## テスト

純粋ロジックは `lib/` に切り出し、Node 標準テストランナーで検証します（依存ゼロ）。

```bash
npm test
```

新しいロジックを追加するときは、可能な限り `lib/` に DOM/Electron 非依存の
純粋関数として実装し、`test/*.test.js` を追加してください。

## ブランチ / PR

- ブランチ名: `feature/<topic>` / `fix/<topic>`
- PR は `main` 向け。CI（lint なし・`npm test`）がグリーンであること。
- 1 PR = 1 トピック。レビューしやすい粒度を心がける。

## コード構成

| パス | 役割 |
|---|---|
| `main.js` | Electron main：PTY・git worktree/diff・IPC |
| `preload.js` | contextBridge 経由の IPC |
| `renderer/` | UI（HTML/CSS/JS）|
| `lib/` | DOM/Electron 非依存の純粋ロジック（テスト対象）|
| `test/` | `node --test` 用のユニットテスト |
