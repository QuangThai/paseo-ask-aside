# Ask Aside

A read-only side chat for Paseo. Ask questions about your current session without interrupting the main agent. See [OVERVIEW.md](OVERVIEW.md) for what it does, where data goes and its limits.

## Requirements

- Paseo 0.12 or later with plugins turned on (Settings, then Plugins).
- Claude Code installed and signed in on the daemon host.
- Optional: Codex CLI installed and signed in on the daemon host, to answer Codex agents with Codex.

## Install

Plugins run as trusted, unsandboxed code on the daemon host. Read the source before installing.

From a local checkout:

```sh
paseo plugin add /path/to/paseo-ask-aside
```

From npm:

```sh
paseo plugin add npm:paseo-ask-aside
```

From GitHub:

```sh
paseo plugin add git:QuangThai/paseo-ask-aside
```

Then check that it is running:

```sh
paseo plugin ls
```

## Use

- Type `/btw your question` or `/aside your question` in an agent's message box.
- On desktop and web, select text in a chat and press **Ask aside**.

## Develop

```sh
npm install
npm run typecheck
npm test
paseo plugin reload ask-aside
paseo plugin logs ask-aside
```

Tests use Node's built-in test runner with type stripping, so they need Node 22.6 or later.
