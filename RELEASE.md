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

## 1. 標準リリース手順（タグ → CI）

```bash
# 1) バージョンを上げてコミット・push（タグはこの HEAD を指す）
#    package.json の "version" を編集（例 0.1.1）
git add package.json && git commit -m "chore: v0.1.1" && git push origin main

# 2) Release（とタグ）を作成 → これが CI をトリガし、mac/win/linux が自動添付される
gh release create v0.1.1 --title "v0.1.1 (beta)" --generate-notes
```

- **Release を先に作る**ことで、CI の 3 ジョブは「既存 Release に添付」するだけになり、同時作成の競合を避けられる。
- `package.json > version` と Git タグ（`vX.Y.Z`）は**必ず一致**させる（更新チェックが tag を見るため）。
- 進捗は Actions タブで確認。完了すると Release に `.dmg / .exe / .AppImage / .deb` が並ぶ。
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
