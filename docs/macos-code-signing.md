# macOS コード署名 + notarization セットアップ（CEO 作業・約 20–30 分）

Agent Deck の **アプリ内自動更新（in-app auto-update）を macOS で有効化**するには、リリースを
**Developer ID で署名 + Apple に notarize** する必要があります。未署名のままだと Squirrel.Mac
が自動インストールを拒否するため、アプリは自動的にブラウザ誘導（旧挙動）にフォールバックします。

> Windows / Linux(AppImage) は署名なしでもアプリ内更新が機能するため、この作業は **macOS のためだけ**に必要です。
> 追加費用はありません（既存の Apple Developer Program 内で完結）。

設定後は、**GitHub Secrets を 5 つ登録 → 次のバージョンタグを push** するだけで CI が署名+notarize
し、ユーザーのアプリが自動更新できるようになります。

---

## 登録する GitHub Secrets（5 つ）

リポジトリ: **https://github.com/willink-oss/agentdeck/settings/secrets/actions** → `New repository secret`

| Secret 名 | 中身 |
|---|---|
| `MAC_CSC_LINK` | Developer ID Application 証明書（秘密鍵込み）の **`.p12` を base64 化した文字列** |
| `MAC_CSC_KEY_PASSWORD` | `.p12` をエクスポートした時に設定した**パスワード** |
| `APPLE_ID` | Apple Developer アカウントの **Apple ID（メール）** |
| `APPLE_APP_SPECIFIC_PASSWORD` | appleid.apple.com で発行する **App 用パスワード** |
| `APPLE_TEAM_ID` | 10 桁の **Team ID** |

> 5 つは**セットで登録**してください。`MAC_CSC_LINK` が無い間は CI が自動的に未署名ビルドにフォールバックするので、パイプライン自体は壊れません（段階的に登録しても OK だが、揃うまで mac 自動更新は無効）。

---

## 手順

### 1. Developer ID Application 証明書を用意する
（Apple Developer Program の **Account Holder** のみ作成可）

**かんたんな方法（Xcode）**:
1. Xcode → Settings → Accounts → 該当 Apple ID を選択 → **Manage Certificates…**
2. 左下 **＋** → **Developer ID Application** を作成

**ポータルから**: https://developer.apple.com/account/resources/certificates/list → **＋** → *Developer ID Application* → 画面の指示に従い CSR をアップロード。

### 2. `.p12` にエクスポート
1. **キーチェーンアクセス**を開く → 「ログイン」キーチェーン → 分類「自分の証明書」
2. **Developer ID Application: <あなたの名前> (TEAMID)** を展開し、**証明書＋秘密鍵の両方**を選択
3. 右クリック → **2項目を書き出す…** → フォーマット `.p12` → 保存（例 `agentdeck-signing.p12`）
4. **エクスポートパスワード**を設定 → これが `MAC_CSC_KEY_PASSWORD`

### 3. `.p12` を base64 化（= `MAC_CSC_LINK`）
ターミナルで（クリップボードにコピーされます）:
```bash
base64 -i agentdeck-signing.p12 | pbcopy
```
→ そのまま `MAC_CSC_LINK` に貼り付け。

### 4. Team ID を確認（= `APPLE_TEAM_ID`）
https://developer.apple.com/account → **Membership details** → **Team ID**（10 桁の英数字）。

### 5. App 用パスワードを発行（= `APPLE_APP_SPECIFIC_PASSWORD`）
https://appleid.apple.com → **サインインとセキュリティ** → **App 用パスワード** → **＋** → 名称「agentdeck notarize」等 → 生成された `xxxx-xxxx-xxxx-xxxx` をコピー。

### 6. `APPLE_ID` = Apple Developer アカウントのメールアドレス

### 7. 5 つの Secret を登録 → リリース
上記 5 つを GitHub Secrets に登録したら、通常どおりバージョンタグを push:
```bash
# package.json の version を上げてコミット → タグ push（RELEASE.md 参照）
git tag -a vX.Y.Z -m "Agent Deck vX.Y.Z" && git push origin vX.Y.Z
```
CI（`release.yml`）が **`MAC_CSC_LINK` を検知して署名+notarize ビルド**を実行し、`.dmg` に加えて
**`.zip` + `latest-mac.yml` + `.blockmap`** を Release に添付します。これでユーザーのアプリが
「ダウンロード」ボタンからアプリ内で更新できるようになります（次回以降の更新が対象）。

---

## 動作確認
- CI ログの build(macos) ステップに `signing cert present -> signed + notarized build` が出ていれば署名成功。
- Release アセットに `latest-mac.yml` と `Agent Deck-<ver>-*.zip` が含まれていれば auto-update feed が有効。
- 旧バージョンのアプリ（署名済みビルド以降）で「ダウンロード」→進捗→「再起動してインストール」が出れば完成。

## トラブルシュート
- **notarization 失敗**: `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` の不一致が大半。3 つが同一アカウント・同一 Team か確認。
- **`MAC_CSC_LINK` が読めない**: base64 に改行が混じった可能性。`base64 -i file | pbcopy` で取り直す。
- **証明書の種類違い**: 「Apple Distribution」ではなく **Developer ID Application** であること（前者は App Store 用で外部配布には使えない）。
