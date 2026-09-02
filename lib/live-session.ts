/**
 * One live turn in the browser: ask for a room, join it receive-only, listen.
 *
 * The clock starts when the user taps and stops on the first AUDIBLE frame -
 * not on track subscription, and not on the audio element's "playing" event,
 * both of which fire before any sound exists. Audibility is measured with an
 * AnalyserNode: the first buffer whose RMS clears a silence floor.
 *
 * What this number is: wall time in the visitor's browser, including their
 * network, the WebRTC transport, and the worker's own network to each provider.
 * It is NOT the benchmark's ttfa_s and the page must never present it as such.
 *
 * No microphone is ever requested. The token is receive-only, so no publish
 * path exists.
 */

import {
  RemoteAudioTrack,
  RemoteTrack,
  Room,
  RoomEvent,
  Track,
  type RemoteParticipant,
} from "livekit-client";

export type LiveState = "idle" | "connecting" | "thinking" | "speaking" | "done" | "error";

export type LiveResult = {
  state: LiveState;
  /** Browser-measured: tap to first audible frame. Not comparable to the benchmark. */
  ttfa_s: number | null;
  /** Worker-reported stage timings. null means the worker never published one. */
  ttft_s: number | null;
  first_sentence_s: number | null;
  tts_ttfb_s: number | null;
  passed: boolean | null;
  answer: string | null;
  error: string | null;
  arm: string;
  roomName: string | null;
  /** True when the browser is refusing to play audio until the user taps again.
   *  iOS Safari gates the <audio> element separately from the AudioContext, and
   *  by the time the track arrives we are several awaits past the original tap. */
  needsAudioUnlock: boolean;
};

/** The room for the turn in flight, so a tap can unlock playback mid-turn. */
let activeRoom: Room | null = null;

/**
 * ONE AudioContext for the page, not one per turn.
 *
 * A context created inside the user's tap is unlocked. "Play both" then runs the
 * second turn several awaits later, nowhere near a gesture, so a context built
 * there starts suspended - and on mobile the second room's <audio> element is
 * blocked by the same policy. First clip plays, second is silent, nothing errors.
 * Keeping one unlocked context alive is what makes turn two audible.
 */
let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  try {
    if (!sharedAudioCtx) sharedAudioCtx = new AudioContext();
    if (sharedAudioCtx.state === "suspended") void sharedAudioCtx.resume();
    return sharedAudioCtx;
  } catch {
    return null;
  }
}

/**
 * Call from a real user tap when needsAudioUnlock is true. room.startAudio() is
 * the SDK's own remedy for browser autoplay policy and must originate from an
 * interaction; calling it anywhere else silently does nothing.
 */
export async function enableAudioPlayback(): Promise<boolean> {
  if (!activeRoom) return false;
  try {
    await activeRoom.startAudio();
    return activeRoom.canPlaybackAudio;
  } catch {
    return false;
  }
}

/** RMS below this is treated as silence. WebRTC emits near-zero frames before
 *  real audio arrives; without a floor the clock would stop on those. */
const SILENCE_FLOOR = 0.005;
const CONNECT_TIMEOUT_MS = 20000;
const TURN_TIMEOUT_MS = 60000;
/** How long to wait for the worker to actually join after we connect. A dead or
 *  OOM-killed worker is the likeliest live failure, and without this the page
 *  sits silent for the full turn timeout showing nothing at all. */
const AGENT_JOIN_TIMEOUT_MS = 15000;
/** How long to keep waiting for sound after the worker says the turn is done. */
const AUDIBLE_GRACE_MS = 2500;

function emptyResult(arm: string): LiveResult {
  return {
    state: "connecting", ttfa_s: null, ttft_s: null, first_sentence_s: null,
    tts_ttfb_s: null, passed: null, answer: null, error: null, arm, roomName: null,
    needsAudioUnlock: false,
  };
}

/** Worker attributes are strings; "" means the worker measured nothing. */
function attrNumber(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function runLiveTurn(options: {
  prompt: string;
  mustContain: string;
  arm: "mercury" | "haiku";
  onUpdate?: (result: LiveResult) => void;
}): Promise<LiveResult> {
  const { prompt, mustContain, arm, onUpdate } = options;

  // The tap. Everything after this is on the clock.
  const t0 = performance.now();
  let result = emptyResult(arm);
  const emit = (patch: Partial<LiveResult>) => {
    result = { ...result, ...patch };
    onUpdate?.(result);
  };
  emit({});

  let room: Room | null = null;
  let element: HTMLAudioElement | null = null;

  // Touch the shared context now, while we are still inside the click that
  // started this turn. For the first turn this is what unlocks it; for later
  // turns it is already unlocked and this just resumes it.
  const audioCtx = getAudioContext();

  const teardown = async () => {
    try { if (element) { element.pause(); element.srcObject = null; element.remove(); } } catch {}
    // The shared context is deliberately NOT closed: closing it would re-lock
    // audio and the next turn would be silent again.
    try { if (room) await room.disconnect(); } catch {}
  };

  try {
    const response = await fetch("/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, mustContain, arm }),
    });
    const payload = (await response.json()) as {
      token?: string; url?: string; roomName?: string; error?: string;
    };
    if (!response.ok || !payload.token || !payload.url) {
      throw new Error(payload.error ?? `token route returned ${response.status}`);
    }
    emit({ roomName: payload.roomName ?? null });

    room = new Room();

    room.on(RoomEvent.ParticipantAttributesChanged, (_changed, participant) => {
      const a = (participant as RemoteParticipant).attributes ?? {};
      const state = a.state;
      emit({
        ttft_s: attrNumber(a.ttft_s),
        first_sentence_s: attrNumber(a.first_sentence_s),
        tts_ttfb_s: attrNumber(a.tts_ttfb_s),
        answer: a.answer ?? result.answer,
        // The assertion is the worker's, run on the model's text. The browser
        // never re-judges it and never transcribes the audio.
        passed: a.passed === undefined || a.passed === "" ? result.passed : a.passed === "true",
        error: a.error ? a.error : result.error,
        state: state === "error" ? "error" : result.state,
      });
    });

    const firstAudible = new Promise<void>((resolve) => {
      room!.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind !== Track.Kind.Audio) return;
        emit({ state: "speaking" });

        // The element is attached because iOS will not flow a WebRTC track that
        // isn't bound to one - but it is MUTED, because element playback is the
        // thing the autoplay policy blocks on the second turn. The audible path
        // is the shared AudioContext below, which one tap unlocked for good.
        element = (track as RemoteAudioTrack).attach();
        element.autoplay = true;
        element.muted = true;
        element.setAttribute("playsinline", "");
        document.body.appendChild(element);
        element.style.display = "none";

        // Detect audibility separately from playback: subscription and the
        // element's own events both fire before there is any sound.
        try {
          if (!audioCtx) throw new Error("no AudioContext");
          if (audioCtx.state === "suspended") void audioCtx.resume();
          const stream = new MediaStream([track.mediaStreamTrack]);
          const source = audioCtx.createMediaStreamSource(stream);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 512;
          source.connect(analyser);
          analyser.connect(audioCtx.destination); // this is what you actually hear
          const buffer = new Float32Array(analyser.fftSize);

          const poll = () => {
            if (!audioCtx || audioCtx.state === "closed") return;
            analyser.getFloatTimeDomainData(buffer);
            let sum = 0;
            for (const sample of buffer) sum += sample * sample;
            if (Math.sqrt(sum / buffer.length) > SILENCE_FLOOR) {
              emit({ ttfa_s: Number(((performance.now() - t0) / 1000).toFixed(3)) });
              resolve();
              return;
            }
            requestAnimationFrame(poll);
          };
          requestAnimationFrame(poll);
        } catch {
          // No AudioContext available: the turn still plays and still reports
          // the worker's timings; ttfa_s stays null rather than becoming a
          // subscription timestamp dressed up as a measurement.
          resolve();
        }
      });
    });

    const connected = room.connect(payload.url, payload.token);
    await Promise.race([
      connected,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timed out connecting to the room")), CONNECT_TIMEOUT_MS)
      ),
    ]);
    activeRoom = room;

    // Browsers gate audio behind a user interaction, and mobile Safari is far
    // stricter than desktop Chrome. This usually succeeds because the whole
    // turn started from a tap; when it doesn't, we surface a control rather
    // than playing to a muted output and reporting a timing for silence.
    room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
      emit({ needsAudioUnlock: !room!.canPlaybackAudio });
    });
    try {
      await room.startAudio();
    } catch {
      /* reported through canPlaybackAudio below, not thrown */
    }
    emit({ needsAudioUnlock: !room.canPlaybackAudio });

    emit({ state: "thinking" });

    // A worker that never joins is the common live failure: it is down, it was
    // OOM-killed, or no worker is registered for this agent name at all. Say
    // that, and say which arm, rather than timing out silently.
    const agentJoined = new Promise<void>((resolve, reject) => {
      const started = performance.now();
      const check = () => {
        if ((room?.remoteParticipants.size ?? 0) > 0) return resolve();
        if (performance.now() - started > AGENT_JOIN_TIMEOUT_MS) {
          return reject(
            new Error(
              `the ${arm} worker never joined the room within ` +
                `${AGENT_JOIN_TIMEOUT_MS / 1000}s — it may be down or not registered`
            )
          );
        }
        setTimeout(check, 200);
      };
      check();
    });
    await agentJoined;

    const finished = new Promise<void>((resolve) => {
      const check = () => {
        if (result.state === "error") return resolve();
        const done = room?.remoteParticipants.values().next().value?.attributes?.state;
        if (done === "done" || done === "error") return resolve();
        setTimeout(check, 150);
      };
      check();
    });

    await Promise.race([
      finished,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`turn exceeded ${TURN_TIMEOUT_MS / 1000}s`)), TURN_TIMEOUT_MS)
      ),
    ]);

    // Give audio a moment to arrive, but don't block the turn on it. Blocking
    // meant a browser that silently refused to play sat here for the full turn
    // timeout instead of reporting anything.
    await Promise.race([
      firstAudible,
      new Promise((resolve) => setTimeout(resolve, AUDIBLE_GRACE_MS)),
    ]);

    // Let the tail of the answer play out before tearing the room down.
    await new Promise((resolve) => setTimeout(resolve, 400));
    emit({ state: result.error ? "error" : "done" });
  } catch (err) {
    // Name what failed and which arm. Never fall back to a recorded clip.
    emit({ state: "error", error: err instanceof Error ? err.message : String(err) });
  } finally {
    await teardown();
    activeRoom = null;
  }

  return result;
}
