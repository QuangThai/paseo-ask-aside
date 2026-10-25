# Changelog

All notable changes to Ask Aside are listed here. Versions follow [Semantic Versioning](https://semver.org/).

## 1.0.0 - 2026-10-26

First release, for Paseo 0.12.

### Added

- Ask a side question about an agent's session with `/btw` or `/aside`, without interrupting the agent or adding anything to its conversation.
- On desktop and web, select text in a chat and press **Ask aside** to quote it into the side chat of the agent that wrote it.
- Ask Aside panel in the Explorer sidebar, or a workspace tab in the iOS and Android apps, with follow-up questions, Markdown answers, copy buttons, Stop and Clear.
- Claude agents and other providers are answered by Claude Code with no tools and no MCP servers. The run stops before answering if Claude Code reports any tool.
- Codex agents are answered by Codex with the agent's own model and reasoning effort, in a read-only sandbox, in the agent's folder. Your Codex `config.toml` is not loaded, so MCP servers, plugins and hooks declared there do not run. The panel lists the commands Codex ran.
- Each answer shows which model replied and how much of the conversation it read.
- Settings to answer every agent with Claude, choose the Claude model, and set the Claude Code and Codex commands.

### Limits

- Side threads live in the daemon's memory and are cleared when the daemon restarts or the plugin reloads.
- Answers update by polling every 0.4 seconds rather than streaming token by token.
- The selection button is not available in the iOS and Android apps.
- Tested on Windows 11 with Paseo 0.12.0. macOS and Linux run the same code but have not been tested with the Paseo app.
