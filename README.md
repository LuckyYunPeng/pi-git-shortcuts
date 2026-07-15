# pi-git-shortcuts

**English** | [简体中文](./README.zh-CN.md)

Context-clean Git slash commands for the [Pi coding agent](https://pi.dev).

`pi-git-shortcuts` uses isolated in-memory agent sessions to generate commit messages and resolve rebase conflicts. The model can help with Git work without adding prompts, tool calls, or results to the main conversation context.

## Commands

### `/commit [instructions]`

Stages all working-tree changes, asks an isolated agent to generate a Conventional Commit message, validates the response, and creates the commit.

```text
/commit
/commit use a docs scope
/commit write the commit message in Chinese
```

### `/cp [instructions]`

Commits changes and pushes the current branch.

```text
/cp
/cp describe the authentication fix precisely
```

### `/git-shortcuts-config`

Opens a language selector for model-generated commit messages:

```text
English
简体中文
```

English is the default. The selection applies immediately and is persisted globally in:

```text
~/.pi/agent/pi-git-shortcuts.json
```

For Chinese output, the Conventional Commit type and optional scope remain in English while the description and body use Simplified Chinese.

## Progress UI

While `/commit` or `/cp` is running, a temporary TUI-only panel appears above the editor:

```text
◆ pi-git-shortcuts  commit + push  3s
├─ ✓ Checking repository
├─ ✓ Staging changes · git add -A
├─ ✓ Reading staged diff
└─ ○ Generating commit message · English · 4 file(s)
```

The panel advances through commit, push, rebase, and conflict-resolution stages. On success it shows the commit hash or final push result and hides after 6 seconds. Errors remain visible longer and include recovery details.

The panel is rendered with `setWidget()` and does not enter the main conversation or model context.

The push workflow:

1. Reuses the `/commit` workflow.
2. Pushes the current branch.
3. Creates an upstream with `git push -u origin <branch>` when needed.
4. On a non-fast-forward rejection, runs `git pull --rebase`.
5. If the rebase conflicts, starts an isolated conflict-resolution agent.
6. Continues the rebase and retries the push.

If automatic conflict resolution fails, the rebase is left in progress for manual recovery. The extension does not silently reset or abort your work.

## Context Isolation

The extension is intentionally command-only:

- Registers `/commit`, `/cp`, and `/git-shortcuts-config` with `pi.registerCommand()`.
- Does not register an LLM tool.
- Does not call `sendUserMessage()` or `sendMessage()`.
- Does not append session entries.
- Persists preferences in a standalone JSON config file, not in the session.
- Uses `SessionManager.inMemory()` for model work.
- Shows progress and results only through Pi UI notifications.

The commit-message agent has no tools. The conflict-resolution agent is limited to these repository file tools:

```text
read, edit, grep, find, ls
```

It cannot run shell or Git commands. Rebase state is controlled by the extension.

## Safety Model

- `/commit` stages all changes with `git add -A`.
- Generated commit messages must follow Conventional Commit format.
- Commit headers are limited to 72 characters.
- A detached HEAD is never pushed automatically.
- An upstream is only created against the existing `origin` remote.
- Automatic rebase resolution is limited to 20 rounds.
- Failed conflict resolution leaves the repository recoverable in its current rebase state.

## Install

### GitHub

```bash
pi install git:github.com/LuckyYunPeng/pi-git-shortcuts
```

### Local development

```bash
pi install /absolute/path/to/pi-git-shortcuts
```

After editing local source, run `/reload` inside Pi.

## Development

```bash
npm install
npm run check
```

## Package Layout

```text
pi-git-shortcuts/
├── src/
│   ├── agent.ts      # isolated model sessions
│   ├── commands.ts   # /commit and /cp workflows
│   ├── config.ts     # persistent commit-language preference
│   ├── git.ts        # Git helpers and validation
│   ├── progress.ts   # transient TUI progress panel
│   └── index.ts      # Pi extension entrypoint
├── test/
├── README.md
├── README.zh-CN.md
└── package.json
```

## Acknowledgements

The isolated commit-message approach was informed by [`tmonk/pi-committer`](https://github.com/tmonk/pi-committer). `pi-git-shortcuts` intentionally implements a smaller command-only surface focused on explicit shortcuts and main-context isolation.

## License

MIT. See [LICENSE](./LICENSE).
