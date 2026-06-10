# リリース手順（macOS / Windows / Linux）

Agent Deck は **electron-builder** でパッケージし、**GitHub Releases** で配布します。
**バージョンタグ（`v*`）を push すると CI（`.github/workflows/release.yml`）が各 OS の成果物を
自動ビルドして Release に添付**します（native の node-pty は各 OS 上でしかビルドできないため CI マトリクス）。

| OS | 成果物 | 署名 |
|---|---|---|
| macOS (arm64) | `.dmg` | **未署名**（`pack:unsigned`） |
| Windows (x64) | `.exe`（NSIS インストーラ） | 未署名 |
| Linux (x64) | `.AppImage` / `.deb` | 未署名 |

更新はアプリ内チェック（feed = GitHub Releases）。

---

## 1. 標準リリース手順（タグ1本 → 全チャネル自動伝播）

```bash
# 1) バージョンを上げてコミット・push（タグはこの HEAD を指す）
#    package.json の "version" を編集（例 0.2.0）
git add package.json && git commit -m "chore: v0.2.0" && git push origin main

# 2) タグを push → あとは全自動
git tag -a v0.2.0 -m "Agent Deck v0.2.0" && git push origin v0.2.0
```

タグ push 後のパイプライン（`release.yml`）:

1. **prepare**: draft Release をノート自動生成付きで作成（1回だけ — draft はタグ一意性がないため matrix で作らない）
2. **build ×3**: mac/win/linux が成果物をビルドし draft に添付
3. **publish**: 全添付完了後に draft を公開。**安定版タグは `latest` に昇格**、
   `-` を含むタグ（例 `v0.2.0-beta.1`）は **pre-release** として公開
4. 公開後、各チャネルが**自動追従**:
   - **アプリ内更新通知**: feed = `releases/latest`（即時）
   - **Homebrew tap**: `willink-oss/homebrew-tap` の `update-cask.yml`（6時間毎 cron。
     即時反映したい場合は同リポで `gh workflow run update-cask.yml`）
   - **i-willink.com**: サイトリポの `update-agentdeck-release.yml` が DLリンク更新 PR を自動作成
     （6時間毎 cron / 手動 dispatch 可。merge で Amplify が自動デプロイ）
   - **winget**: 現状は手動 PR（`packaging/winget/` を実値化して microsoft/winget-pkgs へ）。
     初回パッケージ（#386081）マージ後に `wingetcreate --submit` での自動化へ移行予定

- draft 公開方式により、`releases/latest` が**アップロード途中のリリースを指すことは構造的にない**。
- `package.json > version` と Git タグ（`vX.Y.Z`）は**必ず一致**させる（更新チェックが tag を見るため）。
- リリースノートは自動生成（commit 一覧）。公開後に `gh release edit vX.Y.Z --notes-file …` で差し替え可。
- ローカル動作確認だけなら各 OS で `npm run pack:unsigned`（mac）/ `npm run dist:win` / `npm run dist:linux`。

> ⚠ **更新チェックが効く条件**: `https://api.github.com/repos/willink-oss/agentdeck/releases/latest` が
> テスター環境から**認証なしで読める**こと（public リポなので OK）。feed は `AGENTDECK_UPDATE_FEED` で差替可。

---

## 2. 各 OS の初回起動（未署名のため）

- **macOS**: Gatekeeper が「開発元を確認できません」。**右クリック → 開く**、または
  `xattr -dr com.apple.quarantine "/Applications/Agent Deck.app"`。
- **Windows**: SmartScreen が「WindowsによってPCが保護されました／不明な発行元」。
  **詳細情報 → 実行**（Run anyway）で起動。
- **Linux**:
  - AppImage: `chmod +x Agent\ Deck-*.AppImage` して実行。distro によっては **`libfuse2`** が必要
    （Ubuntu 22.04+ は `sudo apt install libfuse2`）。
  - deb: `sudo apt install ./agent-deck_*.deb`。

---

## 3. アプリ内アップデート挙動

- 起動直後（renderer 主導）と **6 時間ごと**に feed を確認（`main.js: scheduleUpdateChecks` / `UPDATE_INTERVAL_MS`）。
- 現在の版より新しい `tag_name` を見つけると、右下に「新しいバージョン v… が利用できます」トースト＋
  **ダウンロード**ボタン（Releases ページを外部ブラウザで開く）を表示。自動DL/自動インストールはしない。

---

## 4. （任意）macOS の署名＋公証

現状の方針は**未署名**。将来 Gatekeeper 警告を無くしたい場合のみ、以下で署名＋公証 mac を作れる。
**この場合は CI の未署名 mac 資産と二重にならないよう**、手動で署名版をアップロードするか、
`release.yml` の macos ジョブを一時的に外すこと。

```bash
# 前提（初回）: Apple Developer Program 加入、"Developer ID Application" 証明書をキーチェーンへ、
#              公証用 app-specific password を発行（appleid.apple.com）。
export APPLE_ID="あなたのAppleID"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="あなたのTeamID"
npm run dist   # 署名(hardened runtime+entitlements)→ notarytool で公証 → staple

spctl -a -vvv -t install "dist/Agent Deck-<version>-arm64.dmg"  # → accepted / Notarized
```

> Windows の Authenticode / Linux の署名も同様に「やるなら別途」。現状は未署名で配布。

---

## メモ
- アイコン: `build/icon.icns`(mac) / `build/icon.ico`(win) / `build/icon.png`(linux)。`build/make_icon.py` で再生成（要 Pillow）。
- entitlements: `build/entitlements.mac.plist` / `build/entitlements.mac.inherit.plist`
  （node-pty のネイティブ読み込み `disable-library-validation` と spawn する子シェル `inherit` に必要）。
- node-pty は `asarUnpack` で asar 外に展開（同梱必須・無いとターミナルが起動しない）。Linux は prebuild が無く CI でソースビルド。
