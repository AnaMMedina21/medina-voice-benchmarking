# Voice latency benchmark — Mercury 2 vs Haiku 4.5

Measures how long a person waits before a voice agent starts talking back, with
the LLM as the only variable, and publishes the result on a page you can listen
to.

---

## Design

**Read `AGENTS.md` first.** It is committed, so it is the only guidance a fresh
checkout has: the two toolchains, the fact that there are no tests and no CI,
the shared-value families, and the defect classes that have actually shipped
here.

**This file describes the target design.** Where it describes something the code
does not do yet, say so rather than coding to the description.

### The line that everything else protects

| | does | never does |
|---|---|---|
| `agent.py` | measures — injects text turns, times stages, writes `results.csv` | touches a room or a browser |
| the page | renders numbers measured elsewhere | measures anything, writes to `results.csv` |
| `worker/agent.py` | serves live turns into a LiveKit room | produces a benchmark number |

Live timings and recorded timings are different kinds of number. They never
share a visual treatment, and the page says which is which in words as well as
in styling.

### The control

Everything except the LLM is pinned, and the pinned values live in
`bench_config.py` so the harness and the worker cannot drift:

- same ElevenLabs voice id and model id
- same system prompt
- same prompts, same assertions
- same pipeline code

If a change moves anything on that list, every number in `results.csv` stops
being comparable to anything measured after it. That is not a style rule — it is
the claim the project is built on.

**No STT anywhere.** Turns go in as text on purpose: speech recognition in front
would add its own variance, and the LLM would no longer be the only variable.

---

## Stack

| Layer | Choice |
|---|---|
| Pipeline | **LiveKit Agents** 1.7.1 (Python) — `AgentSession`, node overrides for instrumentation |
| Arm A | **Inception Mercury 2** via the LiveKit **OpenAI** plugin, `base_url` at Inception |
| Arm B | **Anthropic Claude Haiku 4.5** via the LiveKit **Anthropic** plugin |
| TTS | **ElevenLabs** `eleven_flash_v2_5` — identical in both arms |
| Page | **Next.js 15 App Router**, TypeScript, no CSS framework, no UI kit, no state library, no chart library |
| Live transport | **LiveKit Cloud** rooms; `livekit-client` in the browser, receive-only |
| Worker host | **Render** Background Worker, thread executor |
| Page host | **Vercel** |

Both arms hit their provider directly. Nothing is routed through an aggregator —
a router would add a hop to one arm and not the other.

Instrumentation is `Agent.llm_node` and `Agent.tts_node` overrides rather than
the metrics events, because `tts_node` sees both sides of the TTS boundary in
one place. The SDK's own `LLMMetrics.ttft` is kept as a cross-check; the two
clocks agree to within 1.5 ms.

---

## Conventions

- Metric names carry their units: `ttfa_s`, never `ttfa`.
- An unmeasured value is `None` / `null` and renders as an em dash. Never zero,
  never substituted from a different metric.
- Aggregates are pass-gated unless stated otherwise. TTS TTFB is the exception
  and is labelled "all rows", because it is the constant.
- p95 is nearest-rank, so it is always a turn that happened, and the column
  carries its n.
- Arms always render in the same order: Mercury 2, then Haiku 4.5.
- `lib/run-data.ts` is generated from `results.csv` at build time. Never edit it
  by hand, and never parse CSV in the browser.
- Live prompts live in React state only.

---

## Rules that are easy to get wrong

- **Distinguish "the model was slow" from "our pipeline was slow."** TTFT is the
  model with nothing around it; TTFA carries the speech stage; live TTFA also
  carries the visitor's network. Quote the narrowest number that answers the
  question, and say which one it is.
- **Absence is a state, not a default.** A value we could not measure must never
  render like one we did.
- **A fast wrong answer is a result, not an error.** Assertions are written by a
  person before the call and checked as a substring of the model's *text*. Audio
  is never transcribed back to grade it, and no model judges another model.
  A failing turn still plays and is still timed.
- **The recorded clips are a re-synthesis.** The harness timed the audio and
  discarded it, so every clip was rendered again from that turn's exact text.
  The timing is measured; the audio is a reproduction. The caption says so, and
  it must keep saying so.
- **`total_s` ends at the last token, not at the end of audio.** On the fast arm
  it is smaller than `ttfa_s`. That is correct. It is also the one metric
  confounded by answer length, so prefer a first-token measurement when quoting.

---

## Writing register

Plain, operational, candid. Name the real constraint, correct the comfortable
assumption, then give the reader something to do.

- Say what a thing is *and what it is not*.
- Contractions are normal. Second person at decision points.
- One idea per paragraph; a short assertion after the setup.
- Every caveat names what it costs the reader, not just that it exists.
- No "in today's landscape", no "unlock", no decorative metaphor, no exclamation
  points, no restating the thesis in new buzzwords.
- Numbers are never rounded in the project's favour, and a number nobody
  verified does not ship.

Fuller writing and speaking profiles live outside the repo — they are personal
and git-ignored, so nothing here depends on them.
