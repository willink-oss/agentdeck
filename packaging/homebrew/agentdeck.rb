# Homebrew Cask for Agent Deck (macOS / Apple Silicon).
# 配布元は GitHub Releases。tap 経由で使う:  brew install --cask willink-oss/tap/agentdeck
# リリースごとに version と sha256 を更新する（packaging/README.md の手順参照）。
cask "agentdeck" do
  version "0.1.1"
  sha256 "91dcdd0916d75f6836dd78ef94cff3a7a23fb080e03b27366cbc6679ddc6ac0b"

  url "https://github.com/willink-oss/agentdeck/releases/download/v#{version}/Agent.Deck-#{version}-arm64.dmg"
  name "Agent Deck"
  desc "Parallel AI agent terminal orchestrator with git-worktree isolation"
  homepage "https://github.com/willink-oss/agentdeck"

  # Apple Silicon 専用・未署名配布（Intel/Universal は未対応）
  depends_on arch: :arm64
  depends_on macos: :big_sur

  app "Agent Deck.app"

  zap trash: [
    "~/Library/Application Support/Agent Deck",
    "~/Library/Logs/Agent Deck",
    "~/Library/Preferences/com.iwillink.agentdeck.plist",
    "~/Library/Saved Application State/com.iwillink.agentdeck.savedState",
  ]

  caveats <<~EOS
    Agent Deck は現在「未署名」で配布されています。
    初回起動が Gatekeeper でブロックされたら、次のいずれかで開いてください:

      xattr -dr com.apple.quarantine "/Applications/Agent Deck.app"

    または Finder で「Agent Deck.app」を右クリック →「開く」。
  EOS
end
