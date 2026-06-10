# packaging — パッケージマネージャ配布

Agent Deck をパッケージマネージャ経由でインストールできるようにする資材。
配布元はすべて **GitHub Releases**（正本）。

| ツール | 状態 | 資材 |
|---|---|---|
| **Homebrew Cask**（macOS） | ✅ 利用可（v0.1.2 stable の .dmg を参照） | `homebrew/agentdeck.rb` |
| **winget**（Windows） | ⏳ **マニフェスト提出待ち**（.exe は v0.1.2 で配布済み・提出は未了） | `winget/iWillink.AgentDeck.*.yaml`（雛形） |

---

## Homebrew Cask（macOS / Apple Silicon）

未署名配布のため**公式 `homebrew/cask` ではなく自社 tap** で配る（公式は知名度要件あり）。
tap は **[`willink-oss/homebrew-tap`](https://github.com/willink-oss/homebrew-tap)** に作成済み。
このリポの `packaging/homebrew/agentdeck.rb` が**正本**で、tap の `Casks/agentdeck.rb` に同期する。

### インストール（利用者）

```bash
brew install --cask willink-oss/tap/agentdeck
```

> 未署名のため初回起動でブロックされたら、cask の caveats に出る手順
> （`xattr -dr com.apple.quarantine "/Applications/Agent Deck.app"` か 右クリック→開く）で開く。

### 新バージョンの反映（自動）

tap リポの **`update-cask.yml`** が 6 時間毎に `releases/latest` を見て
version / sha256（リリース資産の digest）を自動更新する。**手動同期は不要**。
即時反映したい場合: `gh workflow run update-cask.yml --repo willink-oss/homebrew-tap`

- `releases/latest` はプレリリースを返さないため、ベータ版が cask に流れることはない
- 本リポの `packaging/homebrew/agentdeck.rb` は**構造のテンプレート**（caveats / zap 等を
  変える時はここを編集して tap へ反映）。version/sha256 は tap 側が正本
- 検証: `brew audit --cask --online willink-oss/tap/agentdeck`（url 到達性 + sha256）

---

## winget（Windows） ⏳ Windows ビルドが前提

winget は Windows インストーラ（`.exe`/`.msi`）を配る仕組み。**現状 Windows 用リリース資産が無いため未着手**。

### 前提（先に必要な作業 = issue #6）
1. electron-builder に **`nsis`** ターゲットを追加（`build.win` 設定）して `.exe` を生成。
2. `.exe` を GitHub Releases に添付（理想は Authenticode 署名／未署名だと SmartScreen 警告）。

### Windows ビルドが出たら
1. `winget/*.yaml` の `<VERSION>` / `<INSTALLER_URL>` / `<SHA256_OF_EXE>` を実値へ置換。
   - sha256: `winget hash <installer.exe>`（または `sha256sum`）。
2. ローカル検証: `winget validate --manifest packaging/winget` / `winget install --manifest packaging/winget`。
3. `microsoft/winget-pkgs` へ PR（または `wingetcreate submit`）。配置先 `manifests/i/iWillink/AgentDeck/<VERSION>/`。

> PackageIdentifier は `iWillink.AgentDeck`、ManifestVersion は 1.6.0 で雛形化済み。
