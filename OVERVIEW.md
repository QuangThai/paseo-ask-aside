Ask Aside is a read-only side chat for Paseo. Ask a question about the agent you are looking at, such as why it picked an approach, what a file was called, or what an error means, without interrupting it. The question never reaches the agent and nothing is added to its conversation, so it works while the agent is busy.

Type `/btw your question` (or `/aside your question`) in an agent's message box. The answer appears in the Ask Aside panel, which opens in the Explorer sidebar on desktop and web and as a workspace tab in the iOS and Android apps. The panel has its own box for follow-up questions, and each question and answer has a Copy button. `/btw` on its own, or the Command Center item Ask Aside, opens the panel.

On desktop and web you can also select text anywhere in the app and press the Ask aside button that appears above it. Ask Aside finds which agent wrote the text, opens that agent's panel and quotes the text into the question box. When the workspace has several agents and the text is in none of their recent conversations, for example text from a file or a diff, the button says so instead of guessing; use `/btw` in that agent's message box. When the workspace has only one agent, the text goes to that agent. The search covers the newest 400 timeline rows of up to 12 agents.

## How answers are made

When you ask, the daemon reads the agent's conversation from Paseo and builds a transcript of at most about 100,000 characters: the first request, then the newest messages, then the newest tool calls and reasoning. Long messages and tool output are shortened, and very long sessions are read from their first 40 and newest 4,000 timeline rows, with a note to the model that the middle was skipped. Earlier side questions in the same thread are included within a separate budget. Each answer shows which model replied and how much of the conversation it read.

Who answers depends on the agent, like `/side` in Codex and `/btw` in Claude Code:

- **Codex agents** are answered by Codex (`codex exec`) on the daemon host, with the agent's own model and reasoning effort, in the agent's folder. Ultra effort is lowered to max, because ultra hands work to sub-agents. Codex runs in a read-only sandbox: it may read and search files to answer, but cannot change files or use the network, and never asks for approval. Your Codex `config.toml` is not loaded, so the MCP servers, plugins, hooks and model provider set there are not used; only its Windows sandbox mode is kept. On Windows, if that mode is not set there, Codex cannot run any command, so it answers from the transcript alone. Web search, apps, browser use, computer use, sub-agents and image generation are off, and the session is not saved. Codex can read any file your account can read on the daemon host, not only the agent's folder, and loads the folder's AGENTS.md like the agent does; the contents of files it reads become part of what it sends. Choose Always Claude if side questions should never read files. The transcript and question go to OpenAI with the account Codex is signed in with, and count toward your Codex usage. Under each answer, Ask Aside lists the commands Codex ran.
- **Every other agent** is answered by Claude Code, as described below. Choose Always Claude in settings to answer Codex agents this way too.

The transcript and question go to Claude Code (`claude -p`) on the daemon host, which sends them to Anthropic, or to the gateway, proxy, Bedrock or Vertex setup configured for Claude Code there. The run has no tools and no MCP servers, and Ask Aside stops it before it answers if Claude Code ever reports otherwise. It also turns off the advisor tool, skills, saved sessions and the hooks in your own settings, and starts in a new empty temporary folder, so it does not load CLAUDE.md or memory files. Hooks that your organization enforces through managed policy still run. Each question counts toward your Claude usage. Both are told to say so when the answer is not in the conversation rather than guess, but like any model answer, check what matters.

## What leaves your device

- Questions, answers and the agent's conversation go to the daemon and from there to Codex or Claude Code as described above.
- When you use the Ask aside selection button, the selected text goes to the daemon, which searches it in the timelines of the agents in the current workspace, or of every active agent when the workspace cannot be told from the app's address, to find where it came from. It is not sent to Claude until you ask.

## Setup

Requires Paseo 0.12 or later and Claude Code installed and signed in on the daemon host. To answer Codex agents with Codex, Codex must also be installed and signed in there. Tested on Windows 11 with Paseo 0.12.0 and 0.13.0, Claude Code and Codex CLI 0.163. macOS and Linux run the same code but have not been tested. Later Paseo versions are allowed; if one changes the plugin API, report it on GitHub.

## Settings

Open Settings, then Plugins, then Ask Aside:

- Answer with: The agent's own provider (default) answers Codex agents with Codex and every other agent with Claude. Always Claude answers every agent with Claude, without tools.
- Claude model: Same as the agent (default) uses a Claude agent's own model and Sonnet for every other provider. Latest Haiku, Sonnet or Opus applies whenever Claude answers.
- Claude Code command and Codex command: the command or full path used to start each, for when it is not on the daemon's PATH.

## Limits

- Side threads live in the daemon's memory and are shared by every device connected to it. A daemon restart or plugin reload clears them. A thread keeps its 20 newest questions, and threads unused for 12 hours are dropped within the next ten minutes.
- One question per agent runs at a time, and at most three across all agents; others wait up to a minute. A question that takes more than three minutes in total (five when Codex answers) is stopped.
- The answer sees only what Paseo's timeline recorded, which may differ from what the agent's model holds in context, for example after the agent compacts its context.
- Answers stream by polling the daemon every 0.4 seconds rather than token by token.
- Stop and Clear return within about five seconds. If the answering process cannot be ended at all, that agent's side chat says the previous answer is still stopping until the process exits.
- The selection button is not available in the iOS and Android apps, where Paseo gives plugins no access to selected text.
- Paseo does not run plugin commands when the message box has an attachment. In that case `/btw` is sent to the agent as a normal message, so ask from the panel instead.
