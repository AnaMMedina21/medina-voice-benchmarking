"""LiveKit agent worker: one prompt, one arm, spoken into a room.

Purpose
    The live half of the voice-latency project. A browser asks the token route
    for a room; the route creates it with metadata and dispatches this worker
    into it. The worker reads the prompt from that metadata, builds the LLM for
    the arm named in the room, speaks the reply into the room, checks the
    assertion against the TEXT, publishes its stage timings, and leaves.

    This is NOT the benchmark. agent.py is the benchmark: it injects fixed text
    turns with no room and no network between the measurement and the model.
    Numbers produced here include the browser's network and the WebRTC
    transport and are not comparable to results.csv. The page labels them
    differently and so does this file.

Arm selection
    Room name carries the arm (bench-mercury-… / bench-haiku-…) because it
    appears in every LiveKit log line. Room metadata carries it too; if the two
    disagree the job is refused rather than guessed at.

Assertion
    `mustContain` is written by a person before the call and checked as a
    case-insensitive substring of the model's text. No model judges another
    model. A reply that fails the assertion is still spoken and still timed -
    a fast wrong answer is a result, not an error.

Published attributes (strings, read by lib/live-session.ts)
    arm, state, ttft_s, first_sentence_s, tts_ttfb_s, passed, answer, error

Usage
    python worker/agent.py start     # production (Render)
    python worker/agent.py dev       # local, verbose
"""

import asyncio
import json
import logging
import os
import sys
import threading
import time
import unicodedata

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
from livekit.agents import (
    Agent,
    AgentSession,
    JobContext,
    JobExecutorType,
    JobRequest,
    WorkerOptions,
    cli,
)
from livekit.agents.voice.room_io import RoomInputOptions
from livekit.agents import llm as agents_llm

from bench_config import (
    SYSTEM_PROMPT,
    arm_from_room_name,
    build_llm,
    build_tts,
    require_env,
)

load_dotenv(".env.local")

logger = logging.getLogger("voice-bench-worker")

# Explicit dispatch only. With an empty agent_name a worker joins EVERY room on
# the LiveKit project, and this project is shared with another app - a bare
# worker would join its rooms and start talking into them.
AGENT_NAME = "voice-bench"

REQUIRED_ENV_VARS = (
    "LIVEKIT_URL",
    "LIVEKIT_API_KEY",
    "LIVEKIT_API_SECRET",
    "INCEPTION_API_KEY",
    "ANTHROPIC_API_KEY",
    "ELEVENLABS_API_KEY",
    "ELEVENLABS_VOICE_ID",
    "ELEVENLABS_MODEL_ID",
)

# How long to hold the room open after the answer finishes, so the browser can
# read the final attributes before the room disappears.
LINGER_S = 1.5
TURN_TIMEOUT_S = 60.0

# Hard ceiling on jobs running at once. After a restart LiveKit redelivers every
# pending job at once; with load_threshold lifted the worker accepted them all
# into one process and fell over again, which is how a single restart turned
# into a loop. Two, not one, because a turn is still lingering and tearing down
# when the browser dispatches the next arm.
MAX_CONCURRENT_JOBS = 2
_active_jobs = 0
_active_lock = threading.Lock()


def new_turn():
    """Timing slots. None means not measured and stays None."""
    return {
        "t0": None,
        "llm_request": None,
        "first_delta": None,
        "first_sentence": None,
        "tts_first_text": None,
        "tts_first_audio": None,
        "text": "",
    }


def elapsed(start, end):
    return None if start is None or end is None else round(end - start, 4)


class LiveAgent(Agent):
    """Stamps stage boundaries as the turn flows through, same as the harness.

    Deliberately no audio sink: the harness attached a null sink to discard
    frames, and attaching one here would swallow the audio we exist to publish.
    In a room the session's audio output is the room itself.
    """

    def __init__(self, on_stage):
        super().__init__(instructions=SYSTEM_PROMPT)
        self.turn = new_turn()
        self._on_stage = on_stage

    async def llm_node(self, chat_ctx, tools, model_settings):
        turn = self.turn
        turn["llm_request"] = time.monotonic()

        async for chunk in Agent.default.llm_node(self, chat_ctx, tools, model_settings):
            text = None
            if isinstance(chunk, str):
                text = chunk
            elif isinstance(chunk, agents_llm.ChatChunk):
                # chunk.delta is a ChoiceDelta, not the text, and it is non-None
                # on role-only chunks - gating first-token on it would stamp
                # ttft on a chunk carrying no content.
                delta = chunk.delta
                if delta is not None:
                    text = delta.content

            if text:
                if turn["first_delta"] is None:
                    turn["first_delta"] = time.monotonic()
                    self._on_stage("ttft_s", elapsed(turn["llm_request"], turn["first_delta"]))
                turn["text"] += text
                if turn["first_sentence"] is None and any(p in turn["text"] for p in ".!?"):
                    turn["first_sentence"] = time.monotonic()
                    self._on_stage(
                        "first_sentence_s", elapsed(turn["t0"], turn["first_sentence"])
                    )
            yield chunk

        if not turn["text"]:
            raise RuntimeError("LLM stream ended without emitting any content")

    async def tts_node(self, text, model_settings):
        turn = self.turn

        async def stamped():
            async for chunk in text:
                if turn["tts_first_text"] is None:
                    turn["tts_first_text"] = time.monotonic()
                yield chunk

        async for frame in Agent.default.tts_node(self, stamped(), model_settings):
            if turn["tts_first_audio"] is None:
                turn["tts_first_audio"] = time.monotonic()
                self._on_stage(
                    "tts_ttfb_s", elapsed(turn["tts_first_text"], turn["tts_first_audio"])
                )
            yield frame


async def entrypoint(ctx: JobContext):
    global _active_jobs
    with _active_lock:
        _active_jobs += 1
    try:
        await _run_turn(ctx)
    except Exception as exc:  # noqa: BLE001
        # Never let a job take the worker down with it.
        logger.exception("turn failed: %s: %s", type(exc).__name__, exc)
    finally:
        with _active_lock:
            _active_jobs -= 1


async def _run_turn(ctx: JobContext):
    require_env(REQUIRED_ENV_VARS)
    await ctx.connect()

    room_name = ctx.room.name
    logger.info("job accepted room=%s", room_name)

    attributes = {}

    async def publish(**pairs):
        """Attributes are strings. A None metric is published as "" - the page
        renders an em dash for it and never a zero."""
        attributes.update({k: ("" if v is None else str(v)) for k, v in pairs.items()})
        await ctx.room.local_participant.set_attributes(dict(attributes))

    def stage(name, value):
        asyncio.create_task(publish(**{name: value}))

    # Read metadata from the JOB, not from the live room object.
    #
    # ctx.room.metadata is the RTC room's synced view, and when the agent is the
    # FIRST participant to join it can still be empty at this point - the room is
    # created with metadata, then the agent is dispatched and arrives before any
    # browser does. ctx.job.room is the snapshot delivered with the job request
    # itself, so it carries the metadata that existed at creation with no race.
    #
    # This is why a probe that connects a listener before dispatching passes
    # while the real flow fails: the listener's join gives the room time to sync.
    raw_meta = ""
    if ctx.job is not None and ctx.job.room is not None:
        raw_meta = ctx.job.room.metadata or ""
    if not raw_meta:
        # Fall back to the live room, giving it a moment to sync.
        for _ in range(10):
            raw_meta = ctx.room.metadata or ""
            if raw_meta:
                break
            await asyncio.sleep(0.2)

    try:
        meta = json.loads(raw_meta or "{}")
    except json.JSONDecodeError as exc:
        await publish(state="error", error=f"room metadata is not JSON: {exc}")
        return

    prompt = (meta.get("prompt") or "").strip()
    must_contain = (meta.get("mustContain") or "").strip()
    meta_arm = meta.get("arm")
    name_arm = arm_from_room_name(room_name)

    # Refuse rather than guess. A mismatch means the caller is confused about
    # which model it is measuring, and a wrong attribution is worse than a stop.
    if name_arm is None:
        await publish(state="error", error=f"room name does not encode an arm: {room_name}")
        return
    if meta_arm and meta_arm != name_arm:
        await publish(
            state="error",
            error=f"arm mismatch: metadata says {meta_arm}, room name says {name_arm}",
        )
        return
    if not prompt:
        await publish(state="error", arm=name_arm, error="room metadata has no prompt")
        return
    if not must_contain:
        # The assertion is the point. A live turn without one is a timing with
        # no correctness check.
        await publish(state="error", arm=name_arm, error="room metadata has no mustContain")
        return

    arm = name_arm
    logger.info("arm=%s prompt=%r mustContain=%r", arm, prompt, must_contain)
    await publish(arm=arm, state="thinking")

    agent = LiveAgent(on_stage=stage)
    # No resume_false_interruption here: it is deprecated in 1.7.1, and nothing
    # can interrupt this turn anyway - no STT, no VAD, no microphone.
    session = AgentSession(llm=build_llm(arm), tts=build_tts())

    try:
        # close_on_disconnect defaults to True, so a browser that drops for even
        # a moment - backgrounding a tab, switching networks, anything a phone
        # does constantly - tears the session down mid-answer. That is the
        # "second answer started and then stopped" symptom. We own the room
        # lifecycle here and delete it ourselves when the turn ends.
        await session.start(
            agent,
            room=ctx.room,
            room_input_options=RoomInputOptions(close_on_disconnect=False),
        )
        agent.turn["t0"] = time.monotonic()
        handle = await asyncio.wait_for(
            session.generate_reply(
                user_input=prompt, chat_ctx=agents_llm.ChatContext.empty()
            ),
            timeout=TURN_TIMEOUT_S,
        )
        await asyncio.wait_for(handle.wait_for_playout(), timeout=TURN_TIMEOUT_S)
    except asyncio.TimeoutError:
        await publish(state="error", error=f"turn exceeded {TURN_TIMEOUT_S}s")
        return
    except Exception as exc:  # noqa: BLE001 - the reason string is the deliverable
        await publish(state="error", error=f"{type(exc).__name__}: {exc}")
        return

    text = agent.turn["text"]

    # Assertion runs on the model's text. The synthesized audio is never
    # transcribed back to grade it.
    #
    # Both sides are NFC-normalised first. Accented characters have more than
    # one valid encoding - "í" can be one code point or "i" plus a combining
    # accent - and some mobile keyboards emit the decomposed form. Two strings
    # that look identical then fail a substring test. This is about
    # representation, not meaning: it does not make the assertion any looser.
    # A genuinely different character, like typing "Martinez" for "Martínez",
    # still fails, and should.
    def norm(value):
        return unicodedata.normalize("NFC", value).casefold()

    passed = norm(must_contain) in norm(text)

    await publish(
        state="done",
        passed="true" if passed else "false",
        answer=" ".join(text.split())[:400],
        ttft_s=elapsed(agent.turn["llm_request"], agent.turn["first_delta"]),
        first_sentence_s=elapsed(agent.turn["t0"], agent.turn["first_sentence"]),
        tts_ttfb_s=elapsed(agent.turn["tts_first_text"], agent.turn["tts_first_audio"]),
    )
    # Log what was asked for as well as what came back: without mustContain in
    # the record, a failed assertion cannot be diagnosed after the fact.
    logger.info("arm=%s passed=%s mustContain=%r text=%r",
                arm, passed, must_contain, text[:120])

    # Hold briefly so the browser can read the final attributes, then take the
    # room down so rooms do not accumulate on the project.
    #
    # Every step is guarded. This code ran unguarded before, and when a
    # disconnect had already closed the session underneath it, the exception
    # escaped the entrypoint - which with the thread executor takes the whole
    # worker process down and restarts it. A turn that has already published its
    # result must never be able to kill the worker on the way out.
    await asyncio.sleep(LINGER_S)
    try:
        await session.aclose()
    except Exception as exc:  # noqa: BLE001
        logger.info("session close raised, ignoring: %s: %s", type(exc).__name__, exc)
    try:
        await ctx.delete_room()
    except Exception as exc:  # noqa: BLE001
        logger.info("room delete raised, ignoring: %s: %s", type(exc).__name__, exc)


async def request_fnc(req: JobRequest) -> None:
    """Accept unless this worker is already saturated.

    This replaces the CPU-load backpressure, which on a small shared-CPU host
    measured 0.837 for a single ordinary turn and refused work when there was no
    second worker to send it to. Counting jobs is deterministic; CPU average is
    not.
    """
    with _active_lock:
        running = _active_jobs
    if running >= MAX_CONCURRENT_JOBS:
        logger.warning("rejecting job for %s: %d already running", req.room.name, running)
        await req.reject()
        return
    await req.accept()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    require_env(REQUIRED_ENV_VARS)
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            request_fnc=request_fnc,
            agent_name=AGENT_NAME,
            # Memory, not preference. The defaults assume a fat host: the prod
            # default for num_idle_processes is 4, and each prewarmed process
            # imports the whole plugin stack. Measured locally that is ~417 MB
            # of RSS before a single job arrives, which OOMs a 512 MB Render
            # instance the moment a job spawns a fifth process. The kill is a
            # SIGKILL, so there is no traceback in the logs - the service just
            # restarts, and the only clue is that the restart follows
            # "received job request" immediately.
            job_executor_type=JobExecutorType.THREAD,
            num_idle_processes=1,
            # The prod default marks the worker unavailable above 0.7 CPU load.
            # On a small shared-CPU instance one live turn pushes past that
            # (observed: 0.837), LiveKit stops dispatching, and because this is
            # the ONLY worker the job has nowhere else to go - the browser waits
            # and reports that no agent ever joined.
            #
            # Backpressure only helps when there is a second worker to shed to.
            # There isn't, and turns are sequential, so accept every job and let
            # a genuine overload show up as latency rather than as a refusal.
            load_threshold=float("inf"),
        )
    )
