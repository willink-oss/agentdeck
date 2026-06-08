# packaging — パッケージマネージャ配布

Agent Deck をパッケージマネージャ経由でインストールできるようにする資材。
配布元はすべて **GitHub Releases**（正本）。

| ツール | 状態 | 資材 |
|---|---|---|
| **Homebrew Cask**（macOS） | ✅ 利用可（v0.1.0 の .dmg を参照） | `homebrew/agentdeck.rb` |
| **winget**（Windows） | ⏳ **Windows ビルド待ち**（.exe リリース資産が無い） | `winget/iWillink.AgentDeck.*.yaml`（雛形） |

---

## Homebrew Cask（macOS / Apple Silicon）

未署名配布のため**公式 `homebrew/cask` ではなく自社 tap** で配るのが現実的（公式は知名度要件あり）。

### 1. tap リポジトリを用意（初回のみ）

tap は `homebrew-<name>` という命名が必須。例: `willink-oss/homebrew-tap`。

```bash
# 公開リポを作成し、cask を配置
gh repo create willink-oss/homebrew-tap --public -d "Homebrew tap for i-Willink OSS"
git clone https://github.com/willink-oss/homebrew-tap && cd homebrew-tap
mkdir -p Casks
cp /path/to/agentdeck/packaging/homebrew/agentdeck.rb Casks/agentdeck.rb
git add Casks/agentdeck.rb && git commit -m "agentdeck 0.1.0" && git push
```

### 2. ユーザーのインストール

```bash
brew install --cask willink-oss/tap/agentdeck   # = willink-oss/homebrew-tap の Casks/agentdeck.rb
```

> 未署名のため初回起動でブロックされたら、cask の caveats に出る手順
> （`xattr -dr com.apple.quarantine "/Applications/Agent Deck.app"` か 右クリック→開く）で開く。

### 3. 新バージョンを出すたびに（このリポの cask を更新 → tap へ反映）

```bash
# 新しい .dmg を GitHub Releases に上げた後、その sha256 を取得
shasum -a 256 "dist/Agent Deck-<VERSION>-arm64.dmg"
# packaging/homebrew/agentdeck.rb の version と sha256 を更新してコミット
# → tap リポの Casks/agentdeck.rb にコピーして push（自動化するなら CI で同期）
```

`brew bump-cask-pr`（公式 tap 採用後）や `brew audit --cask Casks/agentdeck.rb` / `brew style` で検証可。

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
