# Agent notes

**This repository is public. Assume every file is world-readable.**

Read this first. It's committed, so it's the only guidance a fresh checkout has.
Local files — `.env.local`, the writing profiles — are git-ignored and nothing
here depends on them.

## What this repo is

Three things live here, and keeping them apart is the whole point:

- **The harness** (`agent.py`) measures. It injects fixed text turns with no
  room and no browser, times every stage, and writes `results.csv`.
- **The page** (`app/`, `components/`) presents. It renders numbers measured
  elsewhere. It measures nothing.
- **The worker** (`worker/agent.py`) serves live turns from a browser. Those
  numbers include the visitor's network and are a different kind of number
  again.

Blur those and the project's central claim — that the LLM is the only variable —
stops being true. Most of the rules below exist to protect that line.

## Start here

Two toolchains. You usually need both.

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt   # harness + worker
npm install                                            # the page
```

Every Python entry point runs through the venv with an explicit path. Never
invoke bare `python3` — the system interpreter has none of this installed.

```bash
.venv/bin/python agent.py --smoke      # 2 turns, both arms, checks your keys
.venv/bin/python worker/agent.py dev   # live worker, verbose
```

`requirements.txt` pins `anthropic==0.125.0` and that pin is load-bearing. A
clean resolve grabs 1.3.0, which `livekit-plugins-anthropic` 1.7.1 cannot build
a client with (`Expected an instance of httpx2.AsyncClient but got
httpx.AsyncClient`). Arm B dies at startup without it.

## There are no tests, and no CI

Say so rather than implying otherwise. There is no test suite, no `.github/`,
nothing runs on push. **Every claim about this repo is self-reported.**

What verification actually exists:

| command | what it proves |
|---|---|
| `npx tsc --noEmit` | the page's types check |
| `npm run build` | it compiles and prerenders |
| `.venv/bin/python agent.py --smoke` | both providers answer, keys work |
| `.venv/bin/python worker/agent.py dev` | the worker registers with LiveKit |
| a dispatch into a real room | the worker takes a job end to end |

`tsc --noEmit` prints nothing on success and exits 0, which is indistinguishable
from never having run it. Say that rather than quoting empty output.

Deploys are the closest thing to CI: pushing to `main` redeploys the Render
worker, and `vercel --prod` redeploys the page. Neither runs a check first.

## Checks that cannot fail

These share one mechanism: the subject of the check is derived from the act of
checking, so the check confirms itself, passes, and gets quoted as evidence.

- **An assertion that has not been shown to fail has not been shown to work.**
  Run it against a known-bad input and watch it fail before you trust the pass.
- **Never read an exit status through a pipe.** `$?` after `cmd | head` is
  head's status, and head succeeds almost unconditionally. This has already
  produced a meaningless "typecheck exit:" line in this repo. Redirect to a file
  and check `$?`, or use `${PIPESTATUS[0]}` — note zsh is 1-indexed and spells it
  `$pipestatus[1]`.
- **Never `pgrep -f` a pattern you just typed.** The pattern is in the argv of
  the searching process, so it matches itself. Use `pgrep -x`, a pidfile, or a
  port probe.
- **A probe that sets up differently from the product tests a different
  system.** This one has already cost a full debugging cycle here — see the
  metadata race below.
- **Quote the exact command beside any negative result**, and prefer
  `git grep` over `grep -r`. `--include=*.py` is a glob zsh will try to expand
  before `grep` ever sees it.

## Shared values, and where each copy lives

Nothing compares these automatically. One copy can be wrong while everything
still runs.

| value | lives in |
|---|---|
| arm ids, model ids, base URL, system prompt, TTS voice + model | `bench_config.py` — the single source; `agent.py` and `worker/agent.py` import it |
| `mercury` / `haiku` slug → full arm id | `bench_config.py`, `app/api/token/route.ts`, `scripts/generate-run-data.ts` |
| agent name `voice-bench` | `worker/agent.py`, `app/api/token/route.ts` — **if these diverge, dispatch silently never reaches the worker** |
| ElevenLabs voice + model | `bench_config.py`, `scripts/render-audio.ts`, `README.md` |
| the published headline numbers | `README.md`, and derived live from `results.csv` everywhere else |

Before changing any of these, `git grep` the value and list every copy you find.
**Fixing some copies is worse than fixing none** — everything goes green and the
survivor becomes invisible.

The TypeScript side cannot import `bench_config.py`, so the slug map and the
agent name are genuinely duplicated across the language boundary. That's the
reason to keep them few, obvious, and listed here.

## What breaks here most often

This publishes latency numbers about two named vendors. **A wrong number is
worse than a crash**: a plausible wrong value ships silently, a crash does not.

Defect classes that have actually shipped in this repo:

**1. Silent nulls presented as measurements.** An unmeasured value is `None` /
`null` and renders as an em dash. Never zero, never filled in from a different
metric. `lib/aggregate.ts` drops nulls and counts the exclusions.

**2. Two numbers from different populations.** `results.csv` holds two appended
runs. The page publishes run 2, `analyze.py` reads all 96 turns, and the README
quotes run 2 — three medians from three populations. Always say which.

**3. Something works because of the order your test happened to use.** The
worker read `ctx.room.metadata`, which is the RTC room's synced view. A probe
that connected a listener *before* dispatching passed every time; the real flow,
where the agent joins first, always failed. `ctx.job.room.metadata` is the
snapshot delivered with the job and has no race.

**4. Defaults tuned for a bigger host.** `WorkerOptions.num_idle_processes` is 4
in prod and each prewarmed process imports the whole plugin stack — 417 MB RSS
before a job arrives, which OOMs a 512 MB Render instance. The kill is a
SIGKILL, so the only clue is a restart immediately after `received job request`.
The worker now uses the thread executor: 116 MB.

**5. Browser APIs that fail quietly outside a user gesture.** An `AudioContext`
constructed after an `await` starts suspended; the analyser reads silence
forever and the timing stays null while audio plays perfectly. Construct it
inside the click.

**6. Fail-open guards.** For any code whose job is to refuse or gate, check the
path where the guard's own dependency raises rather than returns false. Flag any
`except Exception: return None` or `?? false` that collapses several failure
modes into one value a caller then interprets.

**7. Assertions that check shape, not substance.** `length > 0`, "a row exists",
"events arrived" — none prove the content is right. Name the field and the
expected value.

## Environment limits

Sessions differ. **Do not assert a limitation you have not tested.** Try it
first; if it still fails, say what you ran and what it printed.

State plainly which claims your environment could not execute. A skipped check
is **not run**, never passing.

Known ones: `livekit-agents` requires Python `>=3.10,<3.15`. Render Starter is
512 MB. `livekit-agents` plugins used outside the worker need
`async with livekit.agents.utils.http_context.open()`.

## Security

- Never commit a key. `.env.example` carries names with empty values;
  `.env.local` carries the real ones and is git-ignored.
- **No key is ever exposed to the browser.** There is no `NEXT_PUBLIC_` variable
  in this project and there must never be one. `LIVEKIT_API_KEY` and
  `LIVEKIT_API_SECRET` are read server-side in `app/api/token/route.ts` only.
- Browser tokens are receive-only: `canPublish: false`. No microphone path
  exists, and no STT is used anywhere.
- Report key *names* and lengths when diagnosing, never values or prefixes.
- The LiveKit project is shared with another app, so the worker registers under
  `agent_name="voice-bench"` and is dispatched explicitly. With the default empty
  name a worker joins **every** room on the project.

## Git and deploys

Work lands on `main` and is pushed. There is no PR workflow and no review bot; if
you do open a PR, put the commands you ran and their raw output in the body.

- Run `git status` and `git rev-parse HEAD` at the start of a turn and again
  before committing.
- Never reference a commit sha in prose — name the file and the symbol.
- Pushing `main` redeploys the Render worker. `vercel --prod` redeploys the page.
  Neither is gated, so verify before you push.
- Deployment protection on Vercel is a project setting, not something in this
  repo: `vercel project protection disable --sso`.

## Documentation

Update docs in the same change as the code.

- `README.md` is the entry point: what it measures, how to run it, how to deploy
  both halves, and what it doesn't measure.
- `CLAUDE.md` describes the target design. Where it describes intent rather than
  what the code does today, say so rather than coding to the description.
- Comment *why*, especially where a number could mislead. Not `i += 1`.
- Add new env var names to `.env.example` with empty values.
- Numbers in prose decay. Re-derive them from `results.csv` before repeating one.
