# Flowpane

A live side panel for Claude Code. While the conversation runs, it shows what the agent is doing, what's left on its task list, and why it chose what it chose, so you don't have to scroll the transcript to find out.

**Site:** https://diwakersurya.github.io/flowpane/

```
╭ Flowpane ─────────────────────────────╮
│ [Flow]  Todos 3/7  Decisions 4        │
│ ctx ███████░░░ 112k/200k · 88k left   │
│ ▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆        │
│ ▼ Turn 6 "add auth guard"  41s ●      │
│   ✓ Read src/router.ts                │
│   ✓ Grep requireAuth                  │
│   ▸ ◆ Explore: find session store  2  │
│   ● Edit src/router.ts  running       │
│ ▸ Turn 5 "write spec"  12 calls · 2m  │
│                                       │
│ ◆ Middleware over per-route guard     │
│   one place to audit                  │
╰───────────────────────────────────────╯
```

- **Flow**: turns, newest first. The current turn is open; older turns fold into one line. Each tool call shows its status (`●` running, `✓` done, `✗` error, `⊘` denied). A subagent folds into one `◆` line with its call count; press it to see inside.
- **Todos**: the agent's task list (`TodoWrite`, `TaskCreate`, `TaskUpdate`) with a progress bar. The task in progress shows its "-ing" form.
- **Decisions**: choices the agent made, why, and what it rejected. Each one links back to the turn that made it.
- **Context bar**: tokens used and tokens left in the context window, so you can tell when to start a fresh chat.
- **Minimap** (terminal): one coloured cell per tool call for the whole session. Blue is reads, amber is edits, violet is shell, teal is agents, pink is MCP, and red is errors.
- **Lanes** (desktop app, VS Code): an SVG diagram with one lane for the main agent and one per subagent, with hover tooltips.

## Install

Needs Claude Code **2.1.289 or newer**. Flowpane is a function-hook mod, and that plugin API is early access.

From the marketplace in this repo:

```sh
claude plugin marketplace add diwakersurya/flowpane
claude plugin install flowpane@flowpane
```

Or from a clone, for one session:

```sh
git clone https://github.com/diwakersurya/flowpane.git
claude --plugin-dir ./flowpane
```

To load the clone every time, including in the desktop app, add it to `~/.claude/settings.json`:

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "~/path/to/flowpane" } }
```

## Use

The pane opens by itself when a session starts in a terminal at least **144 columns** wide. In a narrower terminal, open it yourself:

| Command | Does |
| --- | --- |
| `/flow` | Opens or closes the pane |
| `/flow todos` · `/flow decisions` · `/flow flow` | Opens the pane on that tab |
| `/flow clear` | Clears the panel. The conversation is untouched |

When the pane has focus, `f`, `t` and `d` switch tabs, Tab walks the rows, and Enter folds or unfolds a turn or subagent. If you close the pane, it stays closed in later sessions until you run `/flow` again.

## Settings

Change these in `/config` (or under `pluginConfigs.flowpane.options` in settings):

| Setting | Default | What it does |
| --- | --- | --- |
| `autoOpen` | `true` | Open the pane at startup |
| `decisionTool` | `true` | Give the model a `RecordDecision` tool and ask it to log real choices (about 60 tokens of system prompt) |
| `inferDecisions` | `false` | When a turn logged no decision but its answer reads like one ("rather than", "went with"), ask Haiku to extract it. Costs one small model call per such turn. Marked `~` in the panel |
| `minimap` | `true` | Show the terminal minimap row |
| `maxNodes` | `500` | Past this many nodes, older turns keep only their summary line |

## How it works

Flowpane is a plugin of function hooks (`hooks/register.tsx`) that only watches. Each hook passes its event on unchanged:

| Event | Feeds |
| --- | --- |
| `turn.start`, `turn.complete` | turn rows and durations |
| `tool.call` | tool rows and their status, plus todos from `TodoWrite` / `TaskCreate` / `TaskUpdate` |
| `agent.spawn` | links a subagent's calls to its Agent row |
| `session.measure` | the context bar |
| `prompt.compose` | the one-paragraph decision instruction (when `decisionTool` is on) |

State lives in the session's `$.state`, so it survives hot reloads. After each turn a snapshot is saved to the plugin's `$.store`, so `claude --resume` brings the panel back. Snapshots older than 14 days are deleted.

The pure logic (reducers, row layout, minimap, SVG) is in `hooks/model.ts`, and the views are in `hooks/views.tsx`.

## Privacy

Everything stays on your machine. Flowpane makes no network calls. The one exception is the opt-in `inferDecisions` extraction, which goes through your own Claude Code session's model client. Tool arguments are cut down to short labels, file contents are never stored, and no keys or account details are read or kept.

## Develop

```sh
claude plugin validate .   # what the engine sees and would refuse
claude plugin test .       # reducer tests + pane tests on terminal, desktop, VS Code, mobile
claude --plugin-dir .      # run it; saving a file hot-reloads the mod
```

After the first load, Claude Code writes the API types to `.claude-plugin/types/`, and `npx tsc -p .` type-checks against them.

Pushing a `v*` tag runs the checks and attaches a zip of the plugin to a GitHub release.

## Limits

- The function-hook API is early access and may change between Claude Code releases.
- Decisions depend on the model calling `RecordDecision`. It usually does for real forks in the road, and `inferDecisions` covers the rest.
- The pane can't run browser code (there's no DOM), so the desktop diagram is static SVG with CSS hover.

## License

MIT
