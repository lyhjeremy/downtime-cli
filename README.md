# downtime

[![test](https://github.com/lyhjeremy/downtime-cli/actions/workflows/test.yml/badge.svg)](https://github.com/lyhjeremy/downtime-cli/actions/workflows/test.yml)

Wrap a long-running command. If it takes more than a few seconds, the terminal fills the wait with a couple of trivia questions instead of leaving you to reach for your phone. When the command finishes you get a one-line reminder of what you were doing, then the command's output, untouched.

```bash
downtime run claude -p "refactor the auth module"
downtime run npm run build
downtime run pytest -x
```

## Quick start

Three things to know and you are done.

**1. Put `downtime run` in front of any command you are about to wait on.**

```bash
downtime run npm run build
downtime run claude -p "refactor the auth module"
```

Nothing else changes. The command's output, its exit code and its behaviour are the same as running it bare.

**2. If it finishes in under 5 seconds, you will not see downtime at all.** Longer than that and the trivia appears. Answer with `a` to `d`, press `n` for another, press `q` if you would rather watch the output after all.

**3. When the command finishes, you land back automatically** with a line telling you what you ran and how long it took, followed by the full output.

That is the whole tool. Everything below is tuning. There is a one-page version of this at the [field guide](https://claude.ai/code/artifact/c6f50baf-fc3a-481a-ab6c-9948436b6e7a).

```bash
downtime config set entry.thresholdSeconds 10   # wait longer before it kicks in
downtime config set exit.mode finish_round      # let me finish the question
downtime config                                 # show current settings
DOWNTIME_DISABLE=1 downtime run npm test        # off for one run
```

## Why

Waiting on a build or an agent task creates a gap that is too short to start anything real and too long to sit through. Most people fill it by picking up a phone, and then the hard part is not the wait, it is getting back. Anything genuinely engaging (an article, a video, a side task) has the same problem: it does not want to end when your build does.

Trivia is the opposite. Each question is a few seconds long, it finishes cleanly, and nothing carries over. When the command completes you can drop it mid-sentence and lose nothing.

## Install

```bash
npm install -g downtime-cli
```

Or run it without installing:

```bash
npx downtime-cli run npm run build
```

Requires Node 18 or newer. It has no dependencies. Tested on Linux and macOS against Node 18, 20 and 22.

## How it works

```
$ downtime run npm run build

  downtime                                            1m 42s · 2 of 3

  INVENTIONS

  The microwave oven was discovered when an engineer noticed what?

    ✓ a  A melted chocolate bar in his pocket
      b  A warm cup of tea
      c  Popcorn popping on a shelf
      d  A radar dish glowing

  ✓ That's the one.
    Percy Spencer was standing near a magnetron in 1945 when the bar
    in his pocket melted. He tried popcorn next, then an egg, which
    exploded in a colleague's face.

  ──────────────────────────────────────────────────────────────────
  [n] next question   [q] back to your task        ⏳ npm run build
```

Then the moment the build finishes:

```
──────────────────────────────────────────────────────────────────
✅ Done in 2m 14s:  npm run build
Exit code 0 · Trivia: 3/4 correct
──────────────────────────────────────────────────────────────────
[the build's own output follows, exactly as it would have appeared]
```

Get a question wrong and it shows you the right answer with a short explanation. There is no penalty and no score kept between sessions. Being right earns you a fact, being wrong earns you a different one.

500 questions ship with it, across 20 categories: geography, science, space, animals, history, food, language, arts, sport, the human body, plus origins, myths, inventions, records, movies, music, mythology, psychology, oddities and numbers. They lean towards the surprising rather than the examinable. Where the answer is a widely believed thing that happens to be wrong, the question says so.

## Behaviour worth knowing

The trivia screen runs on the terminal's alternate buffer, so it never lands in your scrollback. Everything the wrapped command prints while the screen is occupied is held and replayed afterwards in order, on the same stream it came from. `downtime run` exits with the wrapped command's exit code, so it drops into scripts and CI without changing anything.

If the command finishes before the threshold, downtime is invisible. No game, no recap, no extra line of output.

One fidelity note: stdout and stderr are captured on separate pipes, so their order relative to each other during the held period is best effort. Order within each stream is exact. If you need the two perfectly interleaved, pipe the output, which puts downtime into transparent mode anyway.

If either stdin or stdout is not a terminal (`downtime run x | tee log`, or anything in CI), downtime steps aside entirely and acts as a transparent wrapper.

Ctrl-C forwards the interrupt to the whole process tree, restores the terminal, prints whatever output was captured, and exits 130. A second Ctrl-C escalates to SIGKILL. Once the command has finished, Ctrl-C simply closes the session rather than trying to signal something that is already gone.

Press `q` or Escape to leave the trivia without killing anything. The command carries on, held output is handed back, and the rest streams as normal. You still get the recap when it finishes.

Because output is captured through a pipe, most tools would normally switch their colour off. When your own terminal is a TTY, downtime sets `FORCE_COLOR` and `CLICOLOR_FORCE` for the child so coloured build output survives. Anything you have set yourself takes precedence, and nothing is set when the output is genuinely being piped somewhere.

## Options

```
downtime run <command> [args...]
downtime run [options] -- <command> [args...]
```

| Flag | Values | Default |
|---|---|---|
| `-t, --threshold <seconds>` | any positive number | `5` |
| `--entry <mode>` | `auto`, `manual` | `auto` |
| `--exit <mode>` | `immediate`, `finish_round` | `immediate` |
| `--content <id>` | `trivia` | `trivia` |

Use `--` when the wrapped command has flags that clash with downtime's own:

```bash
downtime run --threshold 15 -- pytest --exit-first
```

`entry.mode`

- `auto` opens the trivia screen once the threshold passes.
- `manual` prints one quiet line (`⏳ Still running. Press [d] for downtime mode`) and waits. If you never press it, nothing happens and the command output keeps streaming as normal.

`exit.mode`

- `immediate` closes the screen the instant the command exits, mid-question if that is where you are.
- `finish_round` shows a `✅ task finished` marker instead and lets you land the answer. Press Enter to return whenever you like, or `n` for one more question.

Keys while the trivia is up: `a` to `d` or `1` to `4` to answer, `n` or space for the next question, `q` or Escape to step out without killing the command, Enter to return once the task has finished.

## Config

Settings live in `~/.downtime/config.json`, created with defaults the first time you run it. Command-line flags override the file for a single run.

```json
{
  "entry": {
    "mode": "auto",
    "thresholdSeconds": 5
  },
  "exit": {
    "mode": "immediate"
  },
  "content": {
    "module": "trivia"
  }
}
```

Change one setting without opening an editor:

```bash
downtime config set entry.thresholdSeconds 10
downtime config set entry.mode manual
downtime config set exit.mode finish_round
```

`downtime config` prints the file's location and the settings currently in effect, and `downtime config path` prints just the path. If the file has a value downtime does not understand, it says so on stderr and falls back to the default rather than rewriting your file. If the config directory cannot be written at all, downtime runs on defaults and gets out of the way rather than failing.

`~/.downtime/state.json` tracks which questions you have already seen so they do not come round again. Delete it to reset.

## What it works with

Downtime mode needs to own the keyboard, so the wrapped command is given an empty stdin that is already closed. That single fact decides everything below.

**Works.** Anything that runs to completion without asking you a question: builds, test suites, installs, compilers, deploys, data jobs, and coding agents in their non-interactive mode.

| Tool | Use |
|---|---|
| Claude Code | `downtime run claude -p "..."` |
| Codex CLI | `downtime run codex exec "..."` |
| Gemini CLI | `downtime run gemini -p "..."` |
| Aider | `downtime run aider --message "..." --yes` |
| Anything else | `downtime run <cmd>` if it does not need a TTY |

Verified end to end against Claude Code. The other agent CLIs follow the same pattern (a non-interactive flag that prints and exits) but have not been run here, so treat those rows as the pattern to use rather than a test result.

**Does not work.** Interactive sessions: bare `claude`, `codex` with no subcommand, `aider` in its REPL, `vim`, `top`, `git rebase -i`, anything that opens its own full-screen interface. These fail immediately and visibly rather than hanging: a tool that requires a TTY prints its own error and exits, and a tool that prompts for input reads end-of-file instead of your answer. Nothing is silently swallowed, but nothing useful happens either. Do not wrap them.

The event for detecting a child blocked on input (`taskNeedsInput`) exists in the runner and nothing emits it yet. That is the main thing 0.2 needs.

## Terminals and editors

The trivia screen uses the alternate screen buffer, the same mechanism `less` and `vim` use, so it works anywhere those do and never touches your scrollback.

| Where | Behaviour |
|---|---|
| macOS Terminal, iTerm2, Alacritty, Kitty, WezTerm, GNOME Terminal | Full support |
| VS Code and Cursor integrated terminal | Full support |
| JetBrains integrated terminal | Full support |
| tmux and GNU screen | Full support |
| Emacs `M-x shell`, restricted CI shells | Detected and skipped, see below |
| Piped, redirected or non-interactive | Transparent wrapper, no trivia |

If `TERM` is unset, `dumb`, or otherwise a terminal that cannot draw a full screen, downtime does not try. It runs your command as a plain wrapper instead, because filling someone's window with escape sequences is worse than skipping the game.

`DOWNTIME_DISABLE=1` forces that same transparent behaviour anywhere, for one run or exported for a session. Useful in scripts, CI, and any terminal that misbehaves.

Windows is untested. Nothing in the design rules it out, the process-group handling already branches on platform, and the alternate screen buffer works in Windows Terminal. It has only been run on macOS and Linux.

## Long or noisy commands

Output produced while the screen is occupied is held in memory. If a command produces more than 32 MB while you are playing, downtime stops holding it, hands back everything captured so far, and lets the rest stream normally. You lose the game, not a single line of output. Verified with a 40,000-line firehose: every line arrives, in order, with no gaps.

## Adding questions

The question bank is a single JSON file at `src/content/trivia/questions.json`, and adding to it is the easiest way to contribute. One object per question, no code involved:

```json
{
  "id": "geo-026",
  "question": "Which country has the most time zones?",
  "choices": ["Russia", "United States", "France", "China"],
  "correctIndex": 2,
  "funFact": "France covers 12 zones because of overseas territories stretching from Tahiti to Réunion. Russia is second with 11.",
  "explanation": "Russia is wider but spans 11 zones. China is almost as wide as the continental US yet runs the whole country on a single clock.",
  "category": "geography",
  "difficulty": "easy"
}
```

`funFact` is shown when the player gets it right and `explanation` when they get it wrong, so both should teach something rather than just confirming the answer. Keep questions easy to moderate. The point is a mental break, not a challenge.

`npm test` checks the whole bank for shape, duplicate ids, thin or missing reward text, questions that accidentally contain their own answer, and whether the correct answer is spread evenly across the four positions. It is exactly even at present: 125 questions for each of a, b, c and d, so always guessing the same letter gets you nowhere.

## Architecture

Three layers, deliberately separate, so new content and new triggers can be added without touching each other:

- `src/runner.js` watches the child process and emits `taskStarted`, `thresholdCrossed`, `output`, `taskFinished`. It knows nothing about trivia or terminals.
- `src/content/` holds content modules behind a small interface (`start`, `onKey`, `render`, `stop`, plus optional `summary` and `canExit`). Trivia is just the first one.
- `src/tui/` owns the alternate screen buffer, raw-mode input, and terminal restoration on every exit path.
- `src/session.js` wires them together and is the only file that knows all three exist.

## Roadmap

Tier 1, which is what this is, handles one command in one terminal. The rest is not built:

- Tier 2: several wrapped commands at once, in one dashboard.
- Tier 3: multiple windows and IDE terminals, so VS Code panes and tmux splits are covered.
- Tier 4: a watcher on the laptop relaying start and stop signals to a companion app on a phone or tablet, where the content actually lives.

Also planned: more content types (word games, vocabulary, stretch prompts), estimating how long a command will take from how long it took last time and sizing the content to fit, and a Claude Code plugin that triggers downtime mode from hooks so the wrapper is not needed.

One thing that will not be built: streaks, daily goals, notifications, or anything else designed to bring you back. A tool for escaping an attention trap has no business becoming one.

## License

MIT
