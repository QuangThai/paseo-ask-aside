# Changelog

All notable changes to Ask Aside are listed here. Versions follow [Semantic Versioning](https://semver.org/).

## 1.0.3 - 2026-10-26

### Fixed

- Installing from npm or GitHub works. Earlier versions imported a type from `@getpaseo/client`, which Paseo does not provide to plugins, so the build failed unless the plugin's development dependencies happened to be installed. Versions 1.0.0 to 1.0.2 are deprecated on npm for this reason.

## 1.0.2 - 2026-10-26

### Changed

- Ask Aside no longer sets an upper Paseo version limit, so it keeps loading when Paseo updates instead of needing a new release for each Paseo version. It requires Paseo 0.12 or later.

## 1.0.1 - 2026-10-26

### Fixed

- Ask Aside loads on Paseo 0.13. Version 1.0.0 accepted only Paseo 0.12, so on a daemon updated to 0.13 the plugin failed to start and `/btw` stopped working. It now supports Paseo 0.12 and 0.13 and is built against the 0.13 plugin SDK.

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
