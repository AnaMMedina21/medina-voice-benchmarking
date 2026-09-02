# Voice latency benchmark — Inception Mercury 2 vs Claude Haiku 4.5

Building a voice agent got easy. Choosing the model behind it didn't.

The benchmarks you can find rank models on reasoning, instruction following,
cost per token — and most of them were run by the people selling you the model.
None of that is what a caller experiences anyway. What they experience is the
silence after they stop talking, and that silence is mostly decided by which
model you picked and how fast it starts talking back.

Benchmark numbers also move for a pile of reasons that have nothing to do with
the model: your prompts, the workload, the engine, the hardware, the region,
how much else is running on the box. **A number without its setup attached
isn't a result yet.** So the setup is written down below, the raw per-turn rows
are committed, and you can run the whole thing yourself.

So this measures the silence. Two arms, one variable, everything else pinned.

**This is not a model quality benchmark and it is not a leaderboard.** It
answers one operational question: swap the LLM, change nothing else, and how
much sooner does a person hear a voice?

Two arms, identical everything else:

| | Arm A | Arm B |
|---|---|---|
| Model | `mercury-2` | `claude-haiku-4-5` |
| Driver | LiveKit **OpenAI** plugin, `base_url` at Inception | LiveKit **Anthropic** plugin |
| TTS | ElevenLabs `eleven_flash_v2_5`, voice `hpp4J3VqNfWAUOO0d1Us` | identical |
| System prompt | identical | identical |
| Prompts | identical | identical |

No STT anywhere. Turns go in as text on purpose: bolt speech recognition onto
the front and you're measuring its variance too, and you can no longer say the
LLM was the only thing that changed. No microphone, no browser, no room —
headless.

## Why time to first audio, and not time to first token

This comes from the SRE side, where the first rule of an SLO is that it measures
what the user experiences, not what the system happens to emit.

**Time to first token is an internal event.** It's the moment some process
produced its first output. It's genuinely useful for debugging, and no caller
has ever waited on a token.

**Time to first audio is when the person stops hearing silence.** That's the
thing they actually sit through, and the thing that decides whether they assume
your agent is broken and start talking over it.

The two aren't interchangeable, and the distance between them is the entire
speech stage:

```
turn start ──► LLM request ──► first token ──► first speakable chunk ──► first audio byte
               │                    │                                        │
               └──── ttft_s ────────┘                                        │
               └────────────────── ttfa_s ────────────────────────────────────┘
```

So TTFA is the headline here, and TTFT is published right next to it, because
you need both to know where a difference came from. **If the arms differ on
TTFT, that's the model. If they differ only on TTFA, look at your pipeline
before you blame anyone's model.** That's also why the speech stage is published
even though it's held constant — you can subtract a number you can see. The
figures for this run are below.

The same instinct is why every prompt carries an assertion. An SLO that only
measures speed will happily reward a service that returns the wrong thing
quickly. Agents can't grade their own homework, so a person writes the expected
substring before the run and it's checked against the model's text. A fast wrong
answer isn't a win, and it doesn't get to lower a median.

## Why these two models

It isn't "diffusion vs transformers," which is the framing you usually see. The
real split is **autoregressive vs diffusion**, and what differs is decoding.

An autoregressive model generates strictly left to right, each token conditioned
on everything before it. A diffusion model refines groups of tokens in parallel,
coarse to fine.

That's the bet: if you aren't forced to emit tokens one at a time in order, the
first chunk can land sooner. Whether that survives contact with a real voice
pipeline — with a speech stage and a network in front of it — is the thing this
measures.

Mercury 2 is the diffusion arm. Haiku 4.5 is the autoregressive one, and it was
picked because it's fast. Beating a slow baseline would prove nothing.

## Result

48 turns per run (8 prompts x 3 reps x 2 arms), arms interleaved turn by turn so
network drift lands on both instead of on whichever went second. Every turn
passed its assertion. No errors.

**Median time to first audio: Mercury 2 `0.52s`, Haiku 4.5 `1.01s`.** Roughly
half a second, and about 2x, on the number a caller actually feels.

Most of that gap is the model, not the plumbing. Median TTFT — the model alone,
no speech stage — is `0.33s` against `0.61s`. TTS is the same voice and the
same model in both arms and lands within `0.03s` of itself, so it isn't what's
moving.

**One caveat about which number you're reading.** `results.csv` holds two full
runs, because the harness appends. The page publishes run 2 only, so that `rep`
stays a unique key. `analyze.py` with no argument reads the whole file, all 96
turns, and reports `0.52s` / `1.03s`. The two runs agree to within `0.03s`, so
nothing hinges on the choice — but say which one you're quoting.

## Run it

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt

cp .env.example .env.local     # then fill in the keys
.venv/bin/python agent.py      # writes results.csv
.venv/bin/python analyze.py    # prints the markdown table
```

`agent.py --smoke` runs one prompt on both arms if you only want to check wiring.

`requirements.txt` pins `anthropic==0.125.0`, and that pin is load-bearing: a
clean install resolves `anthropic` to 1.3.0, which `livekit-plugins-anthropic`
1.7.1 cannot construct a client with (`Expected an instance of
httpx2.AsyncClient but got httpx.AsyncClient`). Arm B dies at startup without it.

The page is a separate toolchain:

```bash
npm install
npm run generate       # results.csv -> lib/run-data.ts
npm run render-audio   # 16 MP3s into public/audio (needs ELEVENLABS_API_KEY)
npm run dev
```

## Configuration

Every credential is resolved through an environment variable. Nothing is
hardcoded, nothing is echoed, and no key is ever exposed to the browser — there
is no `NEXT_PUBLIC_` variable in this project and there must never be one.

`.env.example` holds the names with empty values and is committed.
`.env.local` holds the real values, is git-ignored, and is never committed.

| Variable | Local | Vercel | Render worker | What it is |
|---|:--:|:--:|:--:|---|
| `INCEPTION_API_KEY` | ✓ | | ✓ | Arm A, Mercury 2 via the OpenAI-compatible endpoint |
| `ANTHROPIC_API_KEY` | ✓ | | ✓ | Arm B, Claude Haiku 4.5 |
| `ELEVENLABS_API_KEY` | ✓ | | ✓ | TTS, held constant across both arms |
| `ELEVENLABS_VOICE_ID` | ✓ | | ✓ | `hpp4J3VqNfWAUOO0d1Us` — the control |
| `ELEVENLABS_MODEL_ID` | ✓ | | ✓ | `eleven_flash_v2_5` — the control |
| `LIVEKIT_URL` | ✓ | ✓ | ✓ | `wss://…` project URL |
| `LIVEKIT_API_KEY` | ✓ | ✓ | ✓ | Server-side only |
| `LIVEKIT_API_SECRET` | ✓ | ✓ | ✓ | Server-side only |

`agent.py` validates all eight before its first network call and fails with a
message naming exactly which are missing, so a bad key surfaces at startup
rather than as a 401 twenty turns into a run.

The two ElevenLabs `*_ID` values exist as variables so the worker and
`scripts/render-audio.ts` cannot drift apart. If they diverge, the arms stop
being comparable and the whole benchmark is void.

## Deployment

### Vercel — the page

Zero-config; Next.js is detected. Defaults are correct.

| Setting | Value |
|---|---|
| Framework preset | Next.js |
| Install command | `npm install` |
| Build command | `npm run build` (runs `generate` then `next build`) |
| Output directory | Next.js default |
| Node version | 20 or later |

`npm run build` regenerates `lib/run-data.ts` from `results.csv` before
building. That file is also committed, so a build still succeeds if the generate
step is skipped — but then the page renders the committed data, not the CSV in
that commit. Keep the build command as `npm run build`, not `next build`.

The three `LIVEKIT_*` variables are only needed once the token route exists.
The static page needs no environment variables at all.

**Deployment Protection is on by default.** The production URL will show
"Log in to Vercel" to anyone who is not a member of the project. Disable it with
`vercel project protection disable --sso`, or in Settings → Deployment
Protection → Vercel Authentication → Disabled.

### Render — the live agent worker

**Service type: Background Worker, not Web Service.** The worker's job is an
outbound registration to LiveKit, not inbound HTTP. (It does bind a local
health/status port — `WorkerOptions.port`, 8081 in prod — so a Web Service is
not impossible, just wrong: nothing should be routing public traffic to it.)

| Setting | Value |
|---|---|
| Environment | Python 3 |
| Build command | `pip install -r requirements.txt` |
| Start command | `python worker/agent.py start` |
| Agent name | `voice-bench` — dispatch is explicit, see below |
| Instance type | Starter is enough; it is one long-lived process |

Set all eight variables above in the Render dashboard. Render does not read
`.env.local` — that file is git-ignored and never reaches the service.

The worker registers with `agent_name="voice-bench"` and is dispatched
explicitly by the token route. This is deliberate: with the default empty agent
name a worker joins **every** room created on the LiveKit project, and this
project is shared with another app — a bare worker would join its rooms and
start speaking into them.

Python must be **3.10 or later and below 3.15** (`livekit-agents` requires
`>=3.10,<3.15`). Pin it with a `.python-version` file if Render's default
moves outside that window.

> **Do not point the start command at `agent.py` in the repo root.** That is
> the headless benchmark harness. It runs 48 turns, appends to `results.csv`,
> and exits 0. Render restarts a Background Worker that exits, so it would run
> the benchmark again, and again — billing Inception, Anthropic and ElevenLabs
> on a loop with nobody watching. The worker entrypoint is `worker/agent.py`,
> which joins a room and waits.

## Live mode

A toggle in the header switches between Recorded and Live. Live sends a prompt
you write to both models through the same LiveKit pipeline and speaks the reply
back in your browser.

```
browser → POST /api/token → creates room bench-{arm}-{uuid} with metadata
                          → dispatches the voice-bench worker
                          → returns a receive-only join token
worker  → reads { prompt, mustContain, arm } from room metadata
        → builds that arm's LLM, speaks into the room
        → publishes ttft_s / first_sentence_s / tts_ttfb_s / passed as attributes
        → deletes the room when the turn ends
```

The browser is receive-only: the token grants `canPublish: false`, so no
microphone path exists. There is no STT anywhere in this project.

**Live numbers are not benchmark numbers, and the page never lets them look
like they are.** The live clock starts when you tap and stops on the first
*audible* frame — measured with an AnalyserNode, because track subscription and
the audio element's own events both fire before any sound exists. It also
carries your network and the WebRTC transport, which is why live TTFA runs
several times the recorded figure. Live rows are dashed, tinted and labelled
`browser`. They never share a treatment with recorded rows, and nothing live is
written to `results.csv`.

The useful comparison in live mode is arm against arm, not live against
recorded. Both arms pay the same transport cost, so the gap between them still
belongs to the model.

**Every live prompt requires an expected substring**, written by a person before
the call and checked case-insensitively against the model's text. No model
judges another model's output, here or anywhere in this project. Drop the
assertion and you still get a stopwatch reading — you just can't say whether the
thing it timed was right.

A reply that fails still plays and is still timed. A fast wrong answer is a
result, not an error. Watch for format mismatches when you write one: asking for
`six` and getting `6` is a real failure of your assertion, not of the model.

## Reading the metrics

| Field | Meaning |
|---|---|
| `ttfa_s` | Turn start to first audio byte out. The headline. |
| `ttft_s` | LLM request send to first content delta |
| `tts_handoff_s` | First LLM delta to first speakable chunk into TTS |
| `tts_ttfb_s` | First text into TTS to first audio byte |
| `total_s` | Turn start to **last LLM token** |
| `passed` | Deterministic whole-word assertion against the LLM's text |
| `error` | Reason string, empty when clean |

Two of these will trip you up if you skim them.

**`total_s` is not the total.** It ends at the last LLM token, and the model
finishes before TTS has produced its first byte — so on the fast arm `total_s`
comes out *smaller* than `ttfa_s`. That's correct, not a bug. Nothing here
measures the end of playback.

**`total_s` is confounded by answer length. `ttfa_s` and `ttft_s` aren't.** The
system prompt caps length the same way in both arms, but they still write
different amounts — Mercury's median completion is 43 tokens against Haiku's 32.
A first-token measurement doesn't care how long the answer runs. A last-token
measurement does. So if you quote one number, quote a first-token one.

An empty CSV field means the value was not measured. It is never zero, and
`analyze.py` skips it rather than filling it in.

Assertions run on the LLM's text only. We never transcribe our own TTS output to
grade it, and no model judges another model.

## Files

Three separate things live here, and keeping them separate is the point. The
harness **measures**. The page **presents** numbers measured elsewhere and
measures nothing. The worker **serves** live turns, which are a different kind
of number again.

**The benchmark — the only thing that produces a measurement**

```
agent.py           headless harness: injects text turns, times every stage, writes results.csv
bench_config.py    the arms and the TTS control, in one place so the two entrypoints can't drift
prompts.json       8 voice-shaped prompts, each with a deterministic assertion
analyze.py         stdlib only; reads results.csv, prints a markdown table
results.csv        raw per-turn rows, committed — two appended runs, 96 turns
requirements.txt   Python deps, pinned; the anthropic pin is load-bearing
```

**The page — renders those numbers, measures nothing**

```
app/page.tsx              mode toggle, recorded players, prompt list
app/globals.css           the <style> block from index.html, extracted verbatim, plus results/live/legend rules
app/layout.tsx            shell and metadata
app/api/token/route.ts    creates the room with metadata, dispatches the worker, mints a receive-only token
components/Players.tsx    recorded rows: wait drawn to scale, then the clip
components/PromptList.tsx the eight prompts and their per-prompt deltas
components/Results.tsx    summary table and distribution strip
components/Legend.tsx     what arm, TTFA, TTFT, TTFB and p95 actually span
components/LivePlayers.tsx    live rows — dashed, tinted, never styled like recorded ones
components/AddLivePrompt.tsx  the two-field form; the second field is the assertion
lib/run-data.ts        GENERATED from results.csv at build time; never hand-edited
lib/aggregate.ts       median, nearest-rank p95, and the rule that null is never zero
lib/live-session.ts    connect, subscribe, stop the clock on the first audible frame, tear down
lib/waveform.ts        the decorative bars — seeded, not derived from the audio
scripts/generate-run-data.ts  results.csv -> lib/run-data.ts
scripts/render-audio.ts       one MP3 per prompt per arm, from the median rep's exact text
public/audio/                 16 clips: 8 prompts x 2 arms
index.html                    the original single-file demo; globals.css was extracted from it
```

**The live worker — runs on Render, joins rooms**

```
worker/agent.py    reads prompt + assertion from room metadata, speaks the reply,
                   publishes stage timings, deletes the room when the turn ends
```

**Config and agent guidance**

```
.env.example       the eight variable names, empty values
.gitignore         .env.local, .venv, node_modules, .next, .vercel, the writing profiles
package.json       generate / render-audio / dev / build / start
AGENTS.md          how to work in this repo
CLAUDE.md          the target design
```

`tsconfig.json`, `next.config.mjs` and `package-lock.json` are stock Next.js
scaffolding and behave the way you'd expect.

Two files you won't find. `friction-log.md` ships alongside the project rather
than in it. `.env.local` is git-ignored and holds every real key.

## Caveats

- One run at one moment from one machine. Not a standing claim about either
  provider.
- Arms are interleaved turn by turn, so network drift is spread across both
  rather than landing on whichever ran second. It is not eliminated.
- n = 24 per arm. p95 is nearest-rank, so it is always an observed value rather
  than an interpolated one.
- No cost comparison. We have not confirmed current pricing for either provider.
- Mercury 2 emitted markdown (`**Paris**`) despite the system prompt forbidding
  it. ElevenLabs normalises it away, so it costs nothing here, but a latency
  benchmark is structurally unable to surface that class of difference.
