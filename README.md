# Voice latency benchmark — Inception Mercury 2 vs Claude Haiku 4.5

A LiveKit Agents pipeline that measures end-to-end voice latency with the LLM as
the only variable. The writeup is the deliverable; this file is how to run it.

Two arms, identical everything else:

| | Arm A | Arm B |
|---|---|---|
| Model | `mercury-2` | `claude-haiku-4-5` |
| Driver | LiveKit **OpenAI** plugin, `base_url` at Inception | LiveKit **Anthropic** plugin |
| TTS | ElevenLabs `eleven_flash_v2_5`, voice `hpp4J3VqNfWAUOO0d1Us` | identical |
| System prompt | identical | identical |
| Prompts | identical | identical |

No STT. Turns are injected as text so the comparison does not carry
speech-recognition variance. No microphone, no browser, no room — headless.

## Result

48 turns (8 prompts x 3 reps x 2 arms), arms interleaved turn by turn, all 48
passing their assertion with no errors.

**Median time to first audio: Mercury 2 `0.516s`, Haiku 4.5 `1.041s`.** Mercury 2
is 0.526s faster, 2.02x, at the median. Run `analyze.py` for the full table.

## Run it

```bash
python3 -m venv .venv
.venv/bin/python -m pip install livekit-agents livekit-plugins-openai \
    livekit-plugins-anthropic livekit-plugins-elevenlabs python-dotenv
.venv/bin/python -m pip install "anthropic==0.125.0"   # see below

cp .env.example .env.local     # then fill in the keys
.venv/bin/python agent.py      # writes results.csv
.venv/bin/python analyze.py    # prints the markdown table
```

`agent.py --smoke` runs one prompt on both arms if you only want to check wiring.

**The `anthropic==0.125.0` pin is required.** A clean install resolves
`anthropic` to 1.3.0, which `livekit-plugins-anthropic` 1.7.1 cannot construct a
client with (`Expected an instance of httpx2.AsyncClient but got httpx.AsyncClient`).

## Credentials

All six variables in `.env.example` must be set in `.env.local`, which is
git-ignored and never committed. `agent.py` validates all of them before the
first network call and names any that are missing.

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

Two things to read carefully:

**`total_s` is not the total.** It ends at the last LLM token, per the metric
definition, and the LLM finishes before TTS has emitted its first audio byte. So
`total_s` is smaller than `ttfa_s` on the fast arm, and that is correct rather
than a bug. Nothing here measures the end of audio playback.

**`total_s` is confounded by output length; `ttfa_s` and `ttft_s` are not.** The
system prompt constrains answer length identically in both arms, but the arms
still emit different numbers of tokens — Mercury 2's median completion is 43
tokens against Haiku's 32. A first-token measurement does not care how long the
answer runs; a last-token measurement does.

An empty CSV field means the value was not measured. It is never zero, and
`analyze.py` skips it rather than filling it in.

Assertions run on the LLM's text only. We never transcribe our own TTS output to
grade it, and no model judges another model.

## Files

The build friction log ships separately, alongside the project rather than in
it.

```
agent.py         the pipeline, both arms, one swap variable
prompts.json     8 voice-shaped prompts, each with a deterministic assertion
analyze.py       stdlib only; reads results.csv, prints a markdown table
results.csv      raw rows, committed
.env.example     variable names, empty values
```

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
