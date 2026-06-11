# Homebrew Cask for Agent Deck (macOS / Apple Silicon + Intel).
# 配布元は GitHub Releases。tap 経由で使う:  brew install --cask willink-oss/tap/agentdeck
# version / sha256 は tap 側の update-cask.yml が自動追従する（このファイルは構造のテンプレート）。
cask "agentdeck" do
  arch arm: "arm64", intel: "x64"

  version "0.2.1"
  sha256 arm:   "ARM64_SHA256",
         intel: "X64_SHA256"

  url "https://github.com/willink-oss/agentdeck/releases/download/v#{version}/Agent.Deck-#{version}-#{arch}.dmg"
  name "Agent Deck"
  desc "Parallel AI agent terminal orchestrator with git-worktree isolation"
  homepage "https://github.com/willink-oss/agentdeck"

  # 未署名配布（署名・公証なし）
  depends_on macos: :monterey

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
