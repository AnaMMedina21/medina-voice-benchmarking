"""Arm and TTS configuration shared by the benchmark harness and the live worker.

This module exists so the two cannot drift. The comparison's entire claim is
that the LLM is the only variable; if agent.py and worker/agent.py each kept
their own copy of the model ids, the base url, or the ElevenLabs voice and
model, one could change without the other and the arms would stop being
comparable while every test still passed.

Import from here. Do not re-declare any of these values anywhere else.
"""

import os

from livekit.plugins import anthropic as lk_anthropic
from livekit.plugins import elevenlabs as lk_elevenlabs
from livekit.plugins import openai as lk_openai

ARM_INCEPTION = "inception-mercury-2"
ARM_ANTHROPIC = "anthropic-claude-haiku-4-5"
ARMS = (ARM_INCEPTION, ARM_ANTHROPIC)

# Short ids used in room names and in the page. bench-mercury-… / bench-haiku-…
ARM_SLUGS = {"mercury": ARM_INCEPTION, "haiku": ARM_ANTHROPIC}

INCEPTION_MODEL = "mercury-2"
INCEPTION_BASE_URL = "https://api.inceptionlabs.ai/v1"
ANTHROPIC_MODEL = "claude-haiku-4-5"

# The held-constant half of the pipeline. Defaults match the published run;
# env overrides exist so the Render worker and scripts/render-audio.ts read one
# value from one place.
ELEVENLABS_MODEL_ID = os.environ.get("ELEVENLABS_MODEL_ID") or "eleven_flash_v2_5"
ELEVENLABS_VOICE_ID = os.environ.get("ELEVENLABS_VOICE_ID") or "hpp4J3VqNfWAUOO0d1Us"

SYSTEM_PROMPT = (
    "You are a voice assistant. Answer in one or two short sentences. "
    "No lists, no markdown, no preamble."
)


def arm_from_room_name(room_name):
    """bench-mercury-<uuid> -> the full arm id. None when the name says nothing.

    The arm is encoded in the room name on purpose: it shows up in every LiveKit
    log and dashboard row, which room metadata does not.
    """
    for slug, arm in ARM_SLUGS.items():
        if room_name.startswith(f"bench-{slug}-"):
            return arm
    return None


def build_llm(arm):
    """The only thing that differs between the two arms."""
    if arm == ARM_INCEPTION:
        # Inception is OpenAI-compatible, so it runs through the OpenAI plugin
        # with base_url pointed at Inception. Direct to the provider, not a router.
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
    """Identical in both arms. Changing this invalidates every comparison."""
    return lk_elevenlabs.TTS(
        model=ELEVENLABS_MODEL_ID,
        voice_id=ELEVENLABS_VOICE_ID,
        api_key=os.environ["ELEVENLABS_API_KEY"],
    )


def require_env(names):
    """Raise naming every missing variable. Never prints a value."""
    missing = [n for n in names if not (os.environ.get(n) or "").strip()]
    if missing:
        raise SystemExit(
            "Missing or empty required environment variables:\n"
            + "".join(f"  - {n}\n" for n in missing)
        )
    return list(names)
