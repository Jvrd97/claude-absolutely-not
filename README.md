# absolutely-not

A Claude Code mod against "You're absolutely right!": it tells the model to stop praising and agreeing, removes the praise opener from what the model reads back, and counts the tics that still get through.

```
> /tics
absolutely-not: Tics by phrase:

phrase                    session  all time
You're absolutely right         1         9
Perfect                         2         6
load-bearing                    0         3
total                           3        18

Rule: on. The system prompt carries this section:

# Tone

- Do not open with praise or agreement ("You're absolutely right", "Great question", ...). Start with the answer.
- When the user is wrong, say so plainly and explain why. Agree only when they are right, and then just continue.
- Do not end with filler offers or check-ins ("Let me know if...", "Hope this helps").
- Never use these words: load-bearing, delve, seamless, robust, leverage, comprehensive.
```

## Why

The opener is a running joke about Claude Code, and people read it as a sign that the model agrees instead of checking:

- Reddit: ["You are absolutely right!"](https://www.reddit.com/r/ClaudeAI/comments/1opfu2i/) (1.2k upvotes) and [a thread that turns its tics against it](https://www.reddit.com/r/ClaudeAI/comments/1vrlrud/) (900).
- GitHub: [#3382](https://github.com/anthropics/claude-code/issues/3382) (870 👍) and [#77136](https://github.com/anthropics/claude-code/issues/77136).
- Hacker News: [the discussion](https://news.ycombinator.com/item?id=44885398) (773 points).

The tic costs more than a sentence. An agent that opens with "You're absolutely right!" has agreed before it checked. Every opener it writes also stays in the conversation, so the model reads it back on every later request, as an example of how it talks.

## What it does

| Part | What |
|---|---|
| Tone rule | A short section in the system prompt: no praise or agreement openers, say so when the user is wrong and why, no filler closers, none of the banned words |
| Strip | Removes a leading praise opener from each response before it is stored, so the model never reads its own tic back |
| Count | Counts openers and banned words in every finished turn, per session and all time |
| `/tics` | Prints the counts by phrase (session and all time) and the rule text the system prompt carries |
| Status line (optional) | `tics: 3` for this session |

## Install

You need Claude Code with mods (function hooks); tested on 2.1.285 and 2.1.291. Mods are in early access: if the CLI says hooks modules are not turned on, start it as `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude`.

From the marketplace in this repo:

```
/plugin marketplace add Jvrd97/claude-absolutely-not
/plugin install absolutely-not@absolutely-not
```

Or straight from disk, for one session:

```bash
git clone https://github.com/Jvrd97/claude-absolutely-not.git
claude --plugin-dir ./claude-absolutely-not
```

## Settings

Change them in `/config` under the plugin, or in `settings.json` under `pluginConfigs`:

| Field | Default | Meaning |
|---|---|---|
| `rule` | `true` | Add the tone section to the system prompt |
| `strip` | `true` | Remove a leading praise opener from each response before it is stored |
| `bannedWords` | `load-bearing, delve, seamless, robust, leverage, comprehensive` | Words the rule forbids and `/tics` counts, comma-separated; empty turns the list off |
| `extraOpeners` | empty | Openers to strip and count on top of the built-in ones, comma-separated |
| `status` | `false` | Show `tics: N` for this session in the status line |

The built-in openers are "You're absolutely right", "You are absolutely right", "Great question", "Excellent point", "Good catch", "Perfect" and "Absolutely". Matching ignores case and accepts a straight or curly apostrophe.

## How it works

- **Tone rule.** `prompt.section` for the environment section (`env_info_simple`, or `env_info_static` in SDK sessions). Claude Code 2.1.285 has no event that lets a plugin add a section of its own, so the rule is appended after that section's text as its own `# Tone` block. Anthropic's text is not changed. The section is cached for the session and sits after the prompt cache boundary, so the rule does not break the shared cache. A `--bare` session has no environment section and gets no rule.
- **Strip.** `session.append` for rows that come in by the `response` door. The mod looks at the first text block of the row and removes the opener sentences at its start: the phrase, then `!` or `.`, or nothing more on that line. It never touches thinking, tool_use or later text blocks.
- **What stays.** "You're right that X fails because…" stays, and so does "You're absolutely right, the lock is never released.": the phrase begins a sentence that carries content, and removing it would change that sentence. "Absolutely not." stays. A response that is only an opener ("Absolutely!" to a yes-or-no question) stays too, because that is the answer.
- **Count.** Each response row of the main conversation is scanned before the strip. At `turn.complete` the mod also scans `e.answer` and takes the larger count per phrase, so a tic is counted once whether the answer arrives stripped or not. Openers count where a sentence starts. Banned words count anywhere in prose, with common forms ("delves", "leveraging"). Fenced code and inline code are skipped. Subagent turns are not counted.
- **Storage.** Session counts live in `$.state`. All-time counts are one key (`counts`) in the plugin's own `$.store`, a JSON file Claude Code keeps for the plugin under your Claude configuration directory. The mod sends nothing anywhere and writes no other files.

What it can't do:

- **You may still see the opener while a reply streams.** The strip runs when the row is stored, after the text has streamed. In our checks the finished reply showed without the opener, both in the terminal (2.1.291) and in `claude -p` output (2.1.285). Claude Code's API notes say a surface, an SDK stream or Remote Control may show a row just before its rewrite, so expect to see the opener there sometimes. The transcript file and the model only ever get the stripped text.
- **The rule is an instruction, not a filter.** The model can still agree with you when you are wrong. The rule makes that less likely, and `/tics` shows how often it still happens.
- **Banned words are counted, not removed.** Rewriting words inside a sentence would change its meaning. "Robust" can be the right word, so edit `bannedWords` if it is for you.
- **Counting is pattern matching.** An opener inside a quote ("He wrote: Perfect. Ship it.") counts. Bold openers (`**Perfect!**`) are neither stripped nor counted.

## Develop

Inside Claude Code run `/plugin-types .claude/types` once: it writes the API types `tsc` reads. Then:

```bash
tsc -p .
claude plugin validate .claude-plugin/plugin.json
claude plugin test .
```

## По-русски

Мод борется с угодливостью Claude: «You're absolutely right!», «Great question!», «load-bearing».

- **Правило.** В системный промпт добавляется короткий раздел: не начинать с похвалы, прямо говорить, когда пользователь неправ, без дежурных концовок и без запрещённых слов.
- **Срезание.** Хвалебное вступление убирается из ответа до записи в историю, поэтому модель не перечитывает свой тик и не повторяет его. На экране вступление остаётся.
- **Счётчик.** Команда `/tics` показывает, сколько тиков было в этой сессии и за всё время.

## License

MIT
