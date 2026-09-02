"use client";

/**
 * The two player rows, ported from the original demo: black circle play button, the
 * measured wait drawn as empty space before the waveform, the ttfa readout on
 * the right with the faster arm in semibold.
 *
 * Playback is wait-then-sound. The wait is the measurement, so it is reproduced
 * at true scale before any audio is allowed to start.
 */

import { useEffect, useRef, useState } from "react";
import { ARMS, type ArmId, type Prompt } from "@/lib/run-data";
import { heights } from "@/lib/waveform";
import { fmt } from "@/lib/aggregate";

const AUDIO_BASE = "/audio/";
const BAR_COUNT = 46;
/** Widest a wait bar may get, as a share of the track. From the original demo. */
const WAIT_MAX_PCT = 34;

type Props = {
  prompt: Prompt;
  maxTtfa: number;
  registerPlay: (fn: (armId: ArmId) => Promise<void>) => void;
};

export default function Players({ prompt, maxTtfa, registerPlay }: Props) {
  const fillRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [playing, setPlaying] = useState<ArmId | null>(null);
  const [audioError, setAudioError] = useState<Record<string, string>>({});

  const measured = ARMS.map((a) => prompt.results[a.id].ttfa_s).filter(
    (v): v is number => v !== null
  );
  const fastest = measured.length ? Math.min(...measured) : null;

  useEffect(() => {
    setAudioError({});
  }, [prompt.id]);

  async function playArm(armId: ArmId): Promise<void> {
    const result = prompt.results[armId];
    if (result.ttfa_s === null) return;
    const waitMs = result.ttfa_s * 1000;
    const fill = fillRefs.current[armId];

    if (fill) {
      fill.style.transition = `width ${waitMs}ms linear`;
      requestAnimationFrame(() => {
        fill.style.width = "100%";
      });
    }

    await new Promise<void>((resolve) => setTimeout(resolve, waitMs));

    if (fill) {
      fill.style.transition = "none";
      fill.style.width = "0";
    }
    setPlaying(armId);

    await new Promise<void>((resolve) => {
      const el = new Audio(`${AUDIO_BASE}${armId}_${prompt.id}.mp3`);
      el.addEventListener("ended", () => resolve());
      el.play().catch((err: unknown) => {
        // Never substitute a sound for a missing recording. Say which arm
        // failed and why, and let the row finish silently.
        setAudioError((prev) => ({
          ...prev,
          [armId]: `audio failed: ${err instanceof Error ? err.message : String(err)}`,
        }));
        resolve();
      });
    });

    setPlaying(null);
  }

  useEffect(() => {
    registerPlay(playArm);
  });

  return (
    <div id="arms">
      {ARMS.map((arm) => {
        const result = prompt.results[arm.id];
        const waitPct =
          result.ttfa_s === null
            ? 0
            : Math.round((result.ttfa_s / maxTtfa) * WAIT_MAX_PCT);
        const error = audioError[arm.id];

        return (
          <div
            key={arm.id}
            className={`arm${playing === arm.id ? " playing" : ""}`}
            data-arm={arm.id}
          >
            <div className="arm-head">
              <span className="arm-name">{arm.name}</span>
              <span className="arm-note">
                {result.ttfa_s === null ? (
                  <span className="fail">no measurement</span>
                ) : result.passed === false ? (
                  <span className="fail">failed assertion</span>
                ) : error ? (
                  <span className="audio-error">{error}</span>
                ) : (
                  ""
                )}
              </span>
            </div>
            <div className="player">
              <button
                className="play"
                aria-label={`Play ${arm.name} response`}
                disabled={result.ttfa_s === null}
                onClick={() => {
                  void playArm(arm.id);
                }}
              >
                <svg viewBox="0 0 12 14" fill="currentColor">
                  <path d="M0 0l12 7-12 7z" />
                </svg>
              </button>
              <div className="track">
                <div className="bars">
                  <div className="wait" style={{ width: `${waitPct}%` }}>
                    <div
                      className="wait-fill"
                      ref={(el) => {
                        fillRefs.current[arm.id] = el;
                      }}
                    />
                  </div>
                  {heights(prompt.id + arm.id, BAR_COUNT).map((h, i) => (
                    <div key={i} className="bar" style={{ height: `${h}%` }} />
                  ))}
                </div>
              </div>
              <div
                className={`ttfa${
                  result.ttfa_s !== null && result.ttfa_s === fastest ? " lead" : ""
                }`}
              >
                {fmt(result.ttfa_s)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
