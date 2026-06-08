# セキュリティポリシー / Security Policy

## サポート対象バージョン

Agent Deck はベータ（0.x）です。**最新リリースのみ**サポート対象です。

| Version | Supported |
|---|---|
| latest (0.x) | ✅ |
| それ以前 | ❌ |

## 脆弱性の報告 / Reporting a Vulnerability

脆弱性を見つけた場合は **公開 issue を作らないでください**。
GitHub の [Private vulnerability reporting](https://github.com/willink-labs/agentdeck/security/advisories/new)
からご報告ください（リポジトリ設定 → Security → *Private vulnerability reporting* を有効化）。
利用できない場合は `yutaro_shirai@i-willink.com` 宛にメールでも受け付けます。

- 初動応答: 通常 5 営業日以内
- 修正方針・公開タイミング（coordinated disclosure）は報告者と調整します

## 想定する脅威モデル

Agent Deck は **ユーザー自身のマシン上で、ユーザーが指定した CLI エージェント／シェルを
起動・操作する**ローカルツールです。次は設計上の前提でありユーザー責任の範囲です:

- 信頼できないコマンド／リポジトリ／worktree をユーザーが指定した場合の挙動
- 起動した AI エージェント CLI 自体の挙動

一方、**アプリ本体の脆弱性**は報告対象です。例:

- preload / IPC 境界の不正利用（renderer から想定外の特権操作ができる等）
- 外部から取得するデータ（git 出力・アップデート feed 等）を介した任意コード実行や XSS
- アップデートチェックの feed/リンクを悪用した誘導

報告に感謝します。
