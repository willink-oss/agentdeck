# リリース手順（macOS / arm64 / 署名＋公証）

Agent Deck を **署名＋公証済み .dmg** としてビルドし、GitHub Releases で配布するための手順。
パッケージングは `electron-builder`、配布は手動 `.dmg`、更新はアプリ内チェック（feed = GitHub Releases）。

> アーキテクチャは **Apple Silicon (arm64) のみ**。Intel 機向けは未対応（必要なら `--universal`）。

---

## 0. 前提（初回のみ）

1. **Apple Developer Program** に加入（$99/年）。自分の **Team ID** を控える（`security find-identity -v -p codesigning` の証明書名末尾、または developer.apple.com → Membership で確認）。Team ID はビルド時に `APPLE_TEAM_ID` 環境変数で渡す（ソースにはハードコードしない / `package.json` は `notarize: true`）。
2. **「Developer ID Application」証明書**を作成してログインキーチェーンへインストール
   - Xcode → Settings → Accounts → （Team 選択）→ *Manage Certificates* → 「＋」→ **Developer ID Application**
   - または developer.apple.com → Certificates → ＋ → *Developer ID Application* → ダウンロードしてダブルクリック
   - 確認: `security find-identity -v -p codesigning | grep "Developer ID Application"`
   - ※ いまキーチェーンにあるのは "Apple Development"（開発用）で、**配布/公証には使えない**。上記が必要。
3. **公証用の app-specific password** を発行: appleid.apple.com → サインインとセキュリティ → *Appパスワード*。

---

## 1. 署名＋公証ビルド

環境変数を設定して `dist` を実行（証明書はキーチェーンから自動検出）:

```bash
export APPLE_ID="あなたのAppleID(メール)"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"   # 上で発行したAppパスワード
export APPLE_TEAM_ID="あなたのTeamID"          # 例: ABCDE12345

npm run dist
```

electron-builder が **署名（hardened runtime + entitlements）→ notarytool で公証 → staple** まで自動実行する。
成果物: `dist/Agent Deck-<version>-arm64.dmg`

検証:
```bash
spctl -a -vvv -t install "dist/Agent Deck-<version>-arm64.dmg"   # → accepted / Notarized Developer ID
codesign -dv --verbose=4 "dist/mac-arm64/Agent Deck.app" 2>&1 | grep -E "Authority|Runtime"
```

### 動作確認（未署名でのスモーク）
証明書が未取得でも、パッケージ自体の健全性は次で確認できる（署名/公証はスキップ）:
```bash
npm run pack:unsigned   # → 未署名 .dmg。node-pty でシェルが起動するかの確認用
```

---

## 2. GitHub Releases へ公開（更新チェックの feed になる）

アプリ内更新チェックは `https://api.github.com/repos/willink-labs/agentdeck/releases/latest` の
`tag_name` を見る。**バージョンは `package.json > version` と Git タグを一致させる。**

```bash
# 例: 0.1.0 を出す
gh release create v0.1.0 \
  "dist/Agent Deck-0.1.0-arm64.dmg" \
  --title "v0.1.0 (beta)" \
  --notes "初回ベータ。"
```

次版を出すときは `package.json` の `version` を上げて再ビルド → `gh release create vX.Y.Z ...`。

> ⚠ **更新チェックが効く条件**: 上記 API がテスター環境から**認証なしで読める**こと。
> リポジトリが private の場合 API は 401/404 になり更新通知は出ない。対策のいずれか:
> - リポジトリ（または Releases）を public にする
> - 公開URLに `latest.json` 等を置き、ビルド時に `AGENTDECK_UPDATE_FEED` で差し替える
>   （`main.js` は `tag_name`/`name` と `html_url` を読む。`AGENTDECK_UPDATE_FEED` で任意の feed に変更可）

---

## 3. テスターへの配布

- `.dmg` を渡す（Releases の DL リンク）。開いて **Agent Deck.app を Applications にドラッグ**。
- 署名＋公証済みなら、そのままダブルクリックで起動できる。
- （未署名を配る場合のみ）初回は **右クリック → 開く**、または
  `xattr -dr com.apple.quarantine "/Applications/Agent Deck.app"` で Gatekeeper を回避。

---

## 4. アプリ内アップデート挙動

- 起動 4 秒後と **6 時間ごと**に feed を確認（`main.js: scheduleUpdateChecks` / `UPDATE_INTERVAL_MS`）。
- 現在の版より新しい `tag_name` を見つけると、右下に「新しいバージョン v… が利用できます」トースト＋
  **ダウンロード**ボタン（Releases ページを外部ブラウザで開く）を表示。自動DL/自動インストールはしない。

---

## メモ
- `build/icon.icns` はアプリアイコン（`build/make_icon.py` で再生成可・要 Pillow）。
- entitlements は `build/entitlements.mac.plist`（メイン）/ `build/entitlements.mac.inherit.plist`（子プロセス）。
  node-pty のネイティブ読み込み（`disable-library-validation`）と spawn する子シェル（`inherit`）に必要。
- node-pty は `asarUnpack` で asar 外に展開される（同梱必須・これが無いとターミナルが起動しない）。
