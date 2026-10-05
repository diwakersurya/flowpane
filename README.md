# Flowpane

A small side panel for Claude Code that does two things no status line or hook can:

- **Pins + guards:** steer the agent live. Pin rules it follows on every request, even after `/compact`. Flip guards that block or ask before certain tool calls, from the panel, with no settings to edit and no restart.
- **Ask aside:** ask a quick question about the conversation and get the answer in the panel. The question never enters the conversation, never interrupts the agent, and doesn't use up its context.

**Site:** https://diwakersurya.github.io/flowpane/

```
╭ Flowpane ─────────────────────────────╮
│ [Pins 3 on]  Ask                      │
│                                       │
│ Guards                                │
│ ● Read-only                           │
│ ○ No git push                         │
│ ● Ask before Bash                     │
│                                       │
│ Pinned rules                          │
│ ☑ use pnpm, not npm               ✕   │
│ ☐ never edit db/migrations        ✕   │
│ [ Pin a rule, e.g. use pnpm…   ]      │
╰───────────────────────────────────────╯
```

## Pins + guards

**Pinned rules** are added to the system prompt of every request while they're ticked. Because they live in the system prompt, they survive `/compact` and long sessions, unlike a rule you typed once 200 messages ago. Pins are saved per project folder, so they come back next session. Tick or untick them freely.

**Guards** are switches for this session only (every new session starts with them off):

| Guard | What it does |
| --- | --- |
| Read-only | Blocks `Edit`, `Write` and `NotebookEdit`, and shell commands that change files (`rm`, `mv`, `>` redirects, `sed -i`, `git commit`, `npm install`…). The agent is told to describe changes instead |
| No git push | Blocks `git push`. Commits still work |
| Ask before Bash | Every shell command goes through Claude Code's own permission prompt, even ones your settings would allow |

The guards also sit in a one-line **band above the prompt**, so you can see and flip them without opening the panel:

```
guards  ● Read-only  ○ No push  ○ Ask Bash  · 2 pins on
❯ _
```

Click a switch, or press `ctrl+x` then `tab` to move the keyboard into the band. The band and the panel share the same switches. It hides while Claude Code shows a survey, and `band` in `/config` turns it off.

The agent is also told which guards are on, so it doesn't keep walking into them. Guards are a convenience, not a sandbox: the read-only check matches common commands, and a determined script could still write files.

Under the hood, a guard is a `tool.check` hook (the permission decision) and pins are a `prompt.compose` section. Toggling either changes the system prompt, which costs one prompt-cache miss on the next request.

## Ask aside

Type a question in the **Ask** tab, for example "which file had the auth bug?", "what did we decide about caching?" or "summarise the last diff". Flowpane uses `$.model.fork`: one tool-free request over the conversation as it stands, using the same prompt cache, so it's cheap. The answer appears in the panel and the agent never sees the question.

- **↳ Insert into prompt** drops an answer into your prompt box.
- **Selection** buttons work on text you've selected in the transcript (fullscreen terminal or desktop): **Explain** asks about it aside, **Quote** inserts it into your prompt as a `>` quote, **Pin** turns it into a pinned rule.

## Install

Needs Claude Code **2.1.289 or newer**. Flowpane uses the early-access function-hook plugin API.

```sh
claude plugin marketplace add diwakersurya/flowpane
claude plugin install flowpane@flowpane
```

Or from a clone: `claude --plugin-dir ./flowpane`. To load it everywhere, including the desktop app, set `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`.

## Commands

| Command | Does |
| --- | --- |
| `/flow` | Opens or closes the panel. `/flow pins` and `/flow ask` open a tab |
| `/pin <rule>` | Pins a rule. `/pin` alone lists your pins |
| `/ask <question>` | Asks aside; the answer shows in the Ask tab |

When the panel has focus, `p` and `a` switch tabs, and `e` and `q` run Explain and Quote on your selection. The panel opens by itself in terminals at least 144 columns wide (turn that off with `autoOpen` in `/config`). The mobile app has no text fields yet, so there you use `/pin` and `/ask`.

## Privacy

Everything stays local. Pins are kept in the plugin's own store on your machine. Ask-aside requests go through your own Claude Code session, like any other turn. Flowpane makes no other network calls and reads no keys or account details.

## Develop

```sh
claude plugin validate .   # what the engine sees and would refuse
claude plugin test .       # logic tests + pane tests on terminal, desktop and mobile
claude --plugin-dir .      # run it; saving a file hot-reloads the mod
```

Pushing a `v*` tag runs the checks and attaches a zip of the plugin to a GitHub release.

## License

MIT
