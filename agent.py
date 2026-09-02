"""Voice-latency benchmark: LiveKit AgentSession with the LLM as the only variable.

Purpose
    Measure end-to-end voice latency for two LLMs behind an identical voice
    pipeline. Arm A is Inception Mercury 2 through the LiveKit OpenAI plugin
    (Inception is OpenAI-compatible); Arm B is Anthropic Claude Haiku 4.5
    through the LiveKit Anthropic plugin. Everything downstream of the LLM is
    held constant: same ElevenLabs voice id, same ElevenLabs model, same system
    prompt, same pipeline code, same prompts.

    There is deliberately no STT. Turns are injected as text so the comparison
    does not carry speech-recognition variance.

Metrics (one row per turn, written to results.csv)
    ttfa_s          turn start -> first audio byte out of TTS. The headline.
    ttft_s          LLM request send -> first content delta from the LLM
    tts_handoff_s   first LLM delta -> first speakable chunk handed to TTS
    tts_ttfb_s      first text into TTS -> first audio byte out
    total_s         turn start -> last LLM token
    passed          deterministic whole-word assertion against the LLM's text
    error           reason string, empty when clean

    An unmeasured value stays empty in the CSV. It is never zero and never
    filled in from a different metric.

Usage
    .venv/bin/python agent.py                 # 8 prompts x 3 reps x 2 arms = 48 turns
    .venv/bin/python agent.py --reps 1        # shorter run
    .venv/bin/python agent.py --smoke         # one prompt, one rep, both arms
    .venv/bin/python analyze.py               # read results.csv, print the table
"""

import argparse
import asyncio
import csv
import json
import os
import re
import sys
import time

from dotenv import load_dotenv
from livekit.agents import Agent, AgentSession, metrics as lk_metrics
from livekit.agents import llm as agents_llm
from livekit.agents.utils import http_context
from livekit.agents.voice import io as agents_io
from livekit.plugins import anthropic as lk_anthropic
from livekit.plugins import elevenlabs as lk_elevenlabs
from livekit.plugins import openai as lk_openai

# --- Configuration ----------------------------------------------------------

ENV_FILE = ".env.local"
PROMPTS_FILE = "prompts.json"
RESULTS_FILE = "results.csv"

# Validated at startup, all of them, before any network call. A missing key must
# not surface as a 401 twenty turns into a run.
REQUIRED_ENV_VARS = (
    "INCEPTION_API_KEY",
    "ANTHROPIC_API_KEY",
    "ELEVENLABS_API_KEY",
    "LIVEKIT_URL",
    "LIVEKIT_API_KEY",
    "LIVEKIT_API_SECRET",
)

# Identical in both arms. Short answers are realistic for voice and they
# normalize output length, which is a control we document rather than hide.
SYSTEM_PROMPT = (
    "You are a voice assistant. Answer in one or two short sentences. "
    "No lists, no markdown, no preamble."
)

ARM_INCEPTION = "inception-mercury-2"
ARM_ANTHROPIC = "anthropic-claude-haiku-4-5"
ARMS = (ARM_INCEPTION, ARM_ANTHROPIC)

INCEPTION_MODEL = "mercury-2"
INCEPTION_BASE_URL = "https://api.inceptionlabs.ai/v1"
ANTHROPIC_MODEL = "claude-haiku-4-5"

# The held-constant half of the pipeline. Pinned explicitly rather than left to
# the plugin defaults, so the control is visible here and cannot drift when the
# plugin version changes.
ELEVENLABS_MODEL = "eleven_flash_v2_5"
ELEVENLABS_VOICE_ID = "hpp4J3VqNfWAUOO0d1Us"

REPS = 3
TURN_TIMEOUT_S = 60.0

# Only used to report a playback position back to the session. It does not affect
# any measured latency - every metric is a wall-clock stamp, not a sample count.
SINK_SAMPLE_RATE = 16000

CSV_FIELDS = (
    "arm",
    "prompt_id",
    "rep",
    "ttfa_s",
    "ttft_s",
    "tts_handoff_s",
    "tts_ttfb_s",
    "total_s",
    "passed",
    "error",
    "answer_text",
    "prompt_tokens",
    "completion_tokens",
    "sdk_ttft_s",
    "sdk_tts_ttfb_s",
)

# --- Startup validation -----------------------------------------------------


def load_and_validate_env():
    """Load .env.local and fail fast, naming every missing variable.

    Reports names only. A value is never read into a message, a log line, or a
    traceback.
    """
    if not os.path.exists(ENV_FILE):
        raise SystemExit(
            f"{ENV_FILE} not found in {os.getcwd()}.\n"
            f"Copy .env.example to {ENV_FILE} and fill in the six required keys."
        )
    load_dotenv(ENV_FILE)

    missing = [name for name in REQUIRED_ENV_VARS if not (os.environ.get(name) or "").strip()]
    if missing:
        raise SystemExit(
            "Missing or empty required environment variables:\n"
            + "".join(f"  - {name}\n" for name in missing)
            + f"All six must be set in {ENV_FILE} before a run starts."
        )
    print(f"env ok: {len(REQUIRED_ENV_VARS)} required variables present "
          f"({', '.join(REQUIRED_ENV_VARS)})")


def load_prompts():
    with open(PROMPTS_FILE) as handle:
        return json.load(handle)["prompts"]


# --- Assertions -------------------------------------------------------------


def check_answer(text, expect_any):
    """True when any expected phrase appears as a whole word in the LLM's text.

    Whole-word rather than substring: a substring test would score "300" as a
    correct answer of "30". Runs on text only - we never transcribe our own TTS
    to grade it, and no model judges another model here.
    """
    if not text:
        return False
    lowered = text.lower()
    return any(
        re.search(r"\b" + re.escape(phrase.lower()) + r"\b", lowered)
        for phrase in expect_any
    )


# --- Pipeline construction --------------------------------------------------


def build_llm(arm):
    if arm == ARM_INCEPTION:
        # Inception is OpenAI-compatible, so it is driven through the OpenAI
        # plugin with base_url pointed at Inception. Not OpenRouter - both arms
        # hit their provider directly.
        return lk_openai.LLM(
            model=INCEPTION_MODEL,
            base_url=INCEPTION_BASE_URL,
            api_key=os.environ["INCEPTION_API_KEY"],
        )
    if arm == ARM_ANTHROPIC:
        return lk_anthropic.LLM(
            model=ANTHROPIC_MODEL,
            api_key=os.environ["ANTHROPIC_API_KEY"],
        )
    raise ValueError(f"unknown arm: {arm}")


def build_tts():
    return lk_elevenlabs.TTS(
        model=ELEVENLABS_MODEL,
        voice_id=ELEVENLABS_VOICE_ID,
        api_key=os.environ["ELEVENLABS_API_KEY"],
    )


def new_turn():
    """Fresh timing slots for one turn. None means not measured, and stays None."""
    return {
        "t0_s": None,
        "llm_request_s": None,
        "llm_first_delta_s": None,
        "llm_last_token_s": None,
        "tts_first_text_s": None,
        "tts_first_audio_s": None,
        "answer_text": "",
        "prompt_tokens": None,
        "completion_tokens": None,
        "sdk_ttft_s": None,
        "sdk_tts_ttfb_s": None,
        "saw_content": False,
        "session_error": "",
    }


class NullAudioSink(agents_io.AudioOutput):
    """Headless audio sink. Discards the audio; times the arrival of frame one.

    Without an audio output attached, AgentSession runs no TTS at all - tts_node
    is never called and no frames are produced, so ttfa_s would be unmeasurable.
    Verified directly: the same probe emitted 0 frames with no sink and 15 with
    this one. The sink is what makes the headless target reachable.

    capture_frame is awaited by the framework, so it must be async. flush() must
    report playback finished or wait_for_playout() never returns.

    We never inspect the audio. Grading is done on the LLM's text; our own TTS
    output is never transcribed back.
    """

    def __init__(self):
        super().__init__(
            label="null-sink",
            capabilities=agents_io.AudioOutputCapabilities(pause=False),
        )
        self.frames = 0
        self.samples = 0

    async def capture_frame(self, frame):
        await super().capture_frame(frame)
        self.frames += 1
        self.samples += frame.samples_per_channel

    def flush(self):
        super().flush()
        position = self.samples / SINK_SAMPLE_RATE if self.samples else 0.0
        self.on_playback_finished(playback_position=position, interrupted=False)

    def clear_buffer(self):
        pass


class BenchmarkAgent(Agent):
    """Agent that stamps the stage boundaries as the turn flows through it.

    The node overrides are the instrumentation point rather than the metrics
    events, because tts_node sees both sides of the TTS boundary in one place:
    the text going in and the audio frames coming out. The SDK's own
    LLMMetrics.ttft and TTSMetrics.ttfb are still captured, into separate
    sdk_* columns, as a cross-check on these numbers.
    """

    def __init__(self):
        super().__init__(instructions=SYSTEM_PROMPT)
        self.turn = new_turn()

    async def llm_node(self, chat_ctx, tools, model_settings):
        turn = self.turn
        turn["llm_request_s"] = time.monotonic()

        async for chunk in Agent.default.llm_node(self, chat_ctx, tools, model_settings):
            text = None
            if isinstance(chunk, str):
                text = chunk
            elif isinstance(chunk, agents_llm.ChatChunk):
                # chunk.delta is a ChoiceDelta, not the text. It is non-None on
                # role-only and tool-call-only chunks, so gating first-token on
                # `delta` alone would stamp ttft_s on a chunk carrying no
                # content - a plausible number measuring the wrong event.
                delta = chunk.delta
                if delta is not None:
                    text = delta.content
                if chunk.usage is not None:
                    turn["prompt_tokens"] = chunk.usage.prompt_tokens
                    turn["completion_tokens"] = chunk.usage.completion_tokens

            if text:
                if turn["llm_first_delta_s"] is None:
                    turn["llm_first_delta_s"] = time.monotonic()
                turn["answer_text"] += text
                turn["saw_content"] = True
                turn["llm_last_token_s"] = time.monotonic()

            yield chunk

        # A stream that produced no content at all is an invalid exchange, not a
        # fast one. Raise rather than let the turn record a plausible total_s.
        # Absent usage is treated differently: it stays None and the latency
        # numbers still stand, because token counts are not what we measure.
        if not turn["saw_content"]:
            raise RuntimeError("LLM stream ended without emitting any content delta")

    async def tts_node(self, text, model_settings):
        turn = self.turn

        async def stamped_text():
            async for chunk in text:
                if turn["tts_first_text_s"] is None:
                    turn["tts_first_text_s"] = time.monotonic()
                yield chunk

        async for frame in Agent.default.tts_node(self, stamped_text(), model_settings):
            if turn["tts_first_audio_s"] is None:
                turn["tts_first_audio_s"] = time.monotonic()
            yield frame


# --- Measurement ------------------------------------------------------------


def elapsed(start, end):
    """Seconds between two stamps, or None when either end was never measured."""
    if start is None or end is None:
        return None
    return round(end - start, 4)


def build_row(arm, prompt, rep, turn, error):
    text = turn["answer_text"]
    passed = check_answer(text, prompt["expect_any"]) if not error else False
    return {
        "arm": arm,
        "prompt_id": prompt["id"],
        "rep": rep,
        "ttfa_s": elapsed(turn["t0_s"], turn["tts_first_audio_s"]),
        "ttft_s": elapsed(turn["llm_request_s"], turn["llm_first_delta_s"]),
        "tts_handoff_s": elapsed(turn["llm_first_delta_s"], turn["tts_first_text_s"]),
        "tts_ttfb_s": elapsed(turn["tts_first_text_s"], turn["tts_first_audio_s"]),
        "total_s": elapsed(turn["t0_s"], turn["llm_last_token_s"]),
        "passed": passed,
        "error": error,
        "answer_text": " ".join(text.split()),
        "prompt_tokens": turn["prompt_tokens"],
        "completion_tokens": turn["completion_tokens"],
        "sdk_ttft_s": turn["sdk_ttft_s"],
        "sdk_tts_ttfb_s": turn["sdk_tts_ttfb_s"],
    }


def open_results():
    is_new = not os.path.exists(RESULTS_FILE) or os.path.getsize(RESULTS_FILE) == 0
    handle = open(RESULTS_FILE, "a", newline="")
    writer = csv.DictWriter(handle, fieldnames=CSV_FIELDS, restval="")
    if is_new:
        writer.writeheader()
        handle.flush()
    return handle, writer


async def start_session(arm):
    """Build one AgentSession for an arm. No room, no mic, no STT.

    AgentSession.start() takes room as NotGivenOr in livekit-agents 1.7.1, so
    the session runs headless with no LiveKit room at all.
    """
    # resume_false_interruption is off because nothing can interrupt here: no
    # STT, no VAD, no mic. Left on, it only logs a warning about the null sink.
    session = AgentSession(
        llm=build_llm(arm), tts=build_tts(), resume_false_interruption=False
    )
    agent = BenchmarkAgent()
    session.output.audio = NullAudioSink()

    def on_metrics(event):
        collected = event.metrics
        if isinstance(collected, lk_metrics.LLMMetrics):
            agent.turn["sdk_ttft_s"] = round(collected.ttft, 4)
        elif isinstance(collected, lk_metrics.TTSMetrics):
            # acquire_time is connection-pool wait and is reported separately by
            # the SDK. Folding it in would attribute pool contention to ElevenLabs.
            agent.turn["sdk_tts_ttfb_s"] = round(collected.ttfb, 4)

    def on_error(event):
        err = getattr(event, "error", event)
        agent.turn["session_error"] = f"{type(err).__name__}: {err}"

    session.on("metrics_collected", on_metrics)
    session.on("error", on_error)
    await session.start(agent)
    return session, agent


async def run_turn(session, agent, prompt):
    """Run one injected text turn and return its timing dict plus an error string."""
    agent.turn = new_turn()
    turn = agent.turn

    # A fresh ChatContext per turn holds prompt length constant across the run.
    # Without it the context grows turn over turn and later turns are measuring
    # a longer prompt, not a slower model. prompt_tokens in the CSV is the check.
    chat_ctx = agents_llm.ChatContext.empty()

    turn["t0_s"] = time.monotonic()
    try:
        handle = await asyncio.wait_for(
            session.generate_reply(user_input=prompt["prompt"], chat_ctx=chat_ctx),
            timeout=TURN_TIMEOUT_S,
        )
        await asyncio.wait_for(handle.wait_for_playout(), timeout=TURN_TIMEOUT_S)
    except asyncio.TimeoutError:
        return turn, f"timeout after {TURN_TIMEOUT_S}s"
    except Exception as exc:  # noqa: BLE001 - the reason string is the deliverable
        return turn, f"{type(exc).__name__}: {exc}"

    # generate_reply returns normally even when the provider rejected the
    # request inside the session's own task, so absence of content is checked
    # explicitly rather than inferred from the absence of an exception.
    if not turn["saw_content"]:
        return turn, turn["session_error"] or "no content delta received from LLM"
    return turn, ""


def build_plan(prompts, reps):
    """Interleave the arms turn by turn.

    Never all of A then all of B: network drift over the run would land entirely
    on the second arm and read as a model difference.
    """
    plan = []
    for rep in range(1, reps + 1):
        for prompt in prompts:
            for arm in ARMS:
                plan.append((arm, prompt, rep))
    return plan


async def main_async(args):
    # Plugins used outside the agent worker have no shared aiohttp session;
    # the ElevenLabs plugin raises 'http session outside of a job context'
    # without this. The SDK names this wrapper in that error message.
    async with http_context.open():
        await run_benchmark(args)


async def run_benchmark(args):
    load_and_validate_env()
    prompts = load_prompts()
    if args.smoke:
        prompts = prompts[:1]
        args.reps = 1

    plan = build_plan(prompts, args.reps)
    print(f"plan: {len(prompts)} prompts x {args.reps} reps x {len(ARMS)} arms "
          f"= {len(plan)} turns, arms interleaved")

    sessions = {}
    skipped = {}
    for arm in ARMS:
        try:
            sessions[arm] = await start_session(arm)
        except Exception as exc:  # noqa: BLE001
            # One arm being unavailable must not cost us the other arm's rows.
            skipped[arm] = f"{type(exc).__name__}: {exc}"
            print(f"SKIP {arm}: {skipped[arm]}")

    if not sessions:
        raise SystemExit("both arms failed to start; no rows to write")

    handle, writer = open_results()
    written = 0
    try:
        for index, (arm, prompt, rep) in enumerate(plan, start=1):
            if arm in skipped:
                continue
            session, agent = sessions[arm]
            turn, error = await run_turn(session, agent, prompt)
            row = build_row(arm, prompt, rep, turn, error)
            writer.writerow(row)
            handle.flush()  # a crash at turn 40 must not cost turns 1-39
            written += 1
            status = "ok " if row["passed"] else ("ERR" if error else "FAIL")
            print(f"[{index:>2}/{len(plan)}] {status} {arm:<28} {prompt['id']:<20} "
                  f"ttfa_s={row['ttfa_s']} ttft_s={row['ttft_s']} {error}")
    finally:
        handle.close()
        for arm, (session, _agent) in sessions.items():
            try:
                await session.aclose()
            except Exception as exc:  # noqa: BLE001
                print(f"note: closing {arm} raised {type(exc).__name__}: {exc}")

    print(f"\nwrote {written} rows to {RESULTS_FILE}")
    for arm, reason in skipped.items():
        print(f"SKIP {arm}: {reason}")


def main():
    parser = argparse.ArgumentParser(description="Voice-latency benchmark, two LLM arms.")
    parser.add_argument("--reps", type=int, default=REPS, help=f"reps per prompt (default {REPS})")
    parser.add_argument("--smoke", action="store_true", help="one prompt, one rep, both arms")
    args = parser.parse_args()
    try:
        asyncio.run(main_async(args))
    except KeyboardInterrupt:
        print("\ninterrupted; rows already written are preserved", file=sys.stderr)


if __name__ == "__main__":
    main()
