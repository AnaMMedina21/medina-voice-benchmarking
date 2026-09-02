"use client";

/**
 * Live mode: a prompt the visitor writes is sent to both models through the
 * LiveKit pipeline and spoken back in this browser.
 *
 * Every number here is measured in the visitor's browser and is a different
 * kind of number from the recorded benchmark. The rows are dashed and tinted,
 * each timing is labelled `browser`, and the caption says so outright.
 *
 * Live prompts live in React state only. Nothing here writes to results.csv.
 */

import { useState } from "react";
import { ARMS } from "@/lib/run-data";
import { enableAudioPlayback, runLiveTurn, type LiveResult } from "@/lib/live-session";

export type LivePrompt = { id: string; text: string; mustContain: string };

type Props = { prompt: LivePrompt };

const ARM_SLUG: Record<string, "mercury" | "haiku"> = {
  mercury: "mercury",
  haiku: "haiku",
};

function seconds(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(2)} s`;
}

export default function LivePlayers({ prompt }: Props) {
  const [results, setResults] = useState<Record<string, LiveResult>>({});
  const [busy, setBusy] = useState(false);
  const [unlocked, setUnlocked] = useState(true);

  async function run(armId: string) {
    setBusy(true);
    try {
      await runLiveTurn({
        prompt: prompt.text,
        mustContain: prompt.mustContain,
        arm: ARM_SLUG[armId],
        onUpdate: (r) => {
          setResults((prev) => ({ ...prev, [armId]: r }));
          if (r.needsAudioUnlock) setUnlocked(false);
        },
      });
    } finally {
      setBusy(false);
    }
  }

  async function runBoth() {
    setBusy(true);
    try {
      // Sequential on purpose: two rooms at once would have the arms competing
      // for the same uplink, and neither number would mean anything.
      for (const arm of ARMS) {
        await runLiveTurn({
          prompt: prompt.text,
          mustContain: prompt.mustContain,
          arm: ARM_SLUG[arm.id],
          onUpdate: (r) => {
            setResults((prev) => ({ ...prev, [arm.id]: r }));
            if (r.needsAudioUnlock) setUnlocked(false);
          },
        });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {!unlocked && (
        <button
          className="unlock"
          onClick={async () => {
            // Must run inside this tap. startAudio() called anywhere else is
            // silently ignored by the browser's autoplay policy.
            const ok = await enableAudioPlayback();
            if (ok) setUnlocked(true);
          }}
        >
          Your browser blocked the audio — tap to turn sound on
        </button>
      )}
      {ARMS.map((arm) => {
        const r = results[arm.id];
        const state = r?.state ?? "idle";
        const label =
          state === "connecting" ? "connecting…"
          : state === "thinking" ? "thinking…"
          : state === "speaking" ? "speaking"
          : state === "error" ? "" : "";

        return (
          <div className="arm live" key={arm.id} data-arm={arm.id}>
            <div className="arm-head">
              <span className="arm-name">
                {arm.name}
                <span className="live-chip">live</span>
              </span>
              <span className="arm-note">
                {/* Name what failed and which arm. Never a silent fallback. */}
                {state === "error" ? (
                  <span className="fail">{arm.name} failed: {r?.error ?? "unknown error"}</span>
                ) : r?.passed === true ? (
                  <span className="verdict pass">assertion passed</span>
                ) : r?.passed === false ? (
                  // A fast wrong answer is a result, not an error: the audio
                  // still played and the timing still stands.
                  <span className="verdict fail">assertion failed — answer still played</span>
                ) : (
                  <span>{label}</span>
                )}
              </span>
            </div>

            <div className="player">
              <button
                className="play"
                aria-label={`Run ${arm.name} live`}
                disabled={busy}
                onClick={() => void run(arm.id)}
              >
                <svg viewBox="0 0 12 14" fill="currentColor">
                  <path d="M0 0l12 7-12 7z" />
                </svg>
              </button>
              <div className="track">
                <div className="live-stages">
                  <span>browser TTFA <b>{seconds(r?.ttfa_s ?? null)}</b></span>
                  <span>model TTFT <b>{seconds(r?.ttft_s ?? null)}</b></span>
                  <span>TTS TTFB <b>{seconds(r?.tts_ttfb_s ?? null)}</b></span>
                </div>
                {r?.answer && <div className="live-stages"><span>{r.answer}</span></div>}
              </div>
              <div className="ttfa">{seconds(r?.ttfa_s ?? null)}</div>
            </div>
          </div>
        );
      })}

      <button className="both" onClick={() => void runBoth()} disabled={busy}>
        Run both live, one after the other
      </button>

      <p className="caption">
        Measured in your browser over WebRTC. Same LiveKit pipeline as the
        recorded runs, but this timing also carries your network and the WebRTC
        transport, so it runs slower and it isn&rsquo;t the same measurement.
        Don&rsquo;t compare these to the benchmark numbers — compare them to
        each other. Both arms pay the same transport cost, so the gap between
        them still belongs to the model.
      </p>
    </div>
  );
}
