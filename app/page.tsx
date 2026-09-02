"use client";

/**
 * Ported from index.html. Same markup, same CSS, same behaviour: two player
 * rows per prompt, the measured wait rendered as empty space before each
 * waveform, a prompt list with per-prompt deltas, and Play both.
 *
 * The numbers come from lib/run-data.ts, generated from results.csv at build
 * time. Nothing on this page measures anything.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import AddLivePrompt from "@/components/AddLivePrompt";
import LivePlayers, { type LivePrompt } from "@/components/LivePlayers";
import Players from "@/components/Players";
import PromptList from "@/components/PromptList";
import Legend from "@/components/Legend";
import Results from "@/components/Results";
import { ARMS, META, PROMPTS, type ArmId, type Prompt } from "@/lib/run-data";

export default function Page() {
  const [mode, setMode] = useState<"recorded" | "live">("recorded");
  const [livePrompts, setLivePrompts] = useState<LivePrompt[]>([]);
  const [selectedLive, setSelectedLive] = useState<LivePrompt | null>(null);
  const [selected, setSelected] = useState<Prompt>(PROMPTS[0]);
  const [bothRunning, setBothRunning] = useState(false);
  const playRef = useRef<((armId: ArmId) => Promise<void>) | null>(null);

  const registerPlay = useCallback((fn: (armId: ArmId) => Promise<void>) => {
    playRef.current = fn;
  }, []);

  // One shared scale for every wait bar, so two rows are comparable by eye.
  const maxTtfa = useMemo(() => {
    const all = PROMPTS.flatMap((p) => ARMS.map((a) => p.results[a.id].ttfa_s));
    const measured = all.filter((v): v is number => v !== null);
    return measured.length ? Math.max(...measured) : 1;
  }, []);

  async function playBoth() {
    setBothRunning(true);
    for (const arm of ARMS) {
      if (playRef.current) await playRef.current(arm.id);
    }
    setBothRunning(false);
  }

  return (
    <div className="shell">
      <h1 id="title">{mode === "live" ? (selectedLive?.text ?? "Live mode") : selected.text}</h1>
      <div className="modes">
        <button
          className="mode"
          aria-pressed={mode === "recorded"}
          onClick={() => setMode("recorded")}
        >
          Recorded
        </button>
        <button
          className="mode"
          aria-pressed={mode === "live"}
          onClick={() => setMode("live")}
        >
          Live
        </button>
      </div>
      <div className="runmeta" id="runmeta">
        <span>{META.prompts} prompts</span>
        <span>{META.reps} reps</span>
        <span>{META.turns} turns</span>
      </div>

      {mode === "recorded" ? (
        <Players prompt={selected} maxTtfa={maxTtfa} registerPlay={registerPlay} />
      ) : selectedLive ? (
        <LivePlayers key={selectedLive.id} prompt={selectedLive} />
      ) : (
        <p className="caption">
          Write a prompt and the answer you expect, and it runs against both
          models right here. You&rsquo;ll hear the difference instead of reading
          about it.
        </p>
      )}

      {mode === "recorded" && (
        <button className="both" onClick={() => void playBoth()} disabled={bothRunning}>
          Play both, one after the other
        </button>
      )}

      {mode === "recorded" && (
      <p className="caption">
        Recorded playback. That silence before each answer isn&rsquo;t padding
        — it&rsquo;s that turn&rsquo;s measured time to first audio, replayed at
        true scale from <code>results.csv</code>. The speech is a re-synthesis:
        the harness timed the audio but didn&rsquo;t keep it, so each clip was
        rendered again from that turn&rsquo;s exact text, same voice, same
        model. The timing is measured. The audio is a reproduction. Not a live
        session.
      </p>
      )}

      {mode === "recorded" ? (
        <PromptList selected={selected} onSelect={setSelected} />
      ) : (
        <>
          <div className="list">
            {livePrompts.map((p) => (
              <button
                key={p.id}
                className="item"
                aria-current={selectedLive?.id === p.id}
                onClick={() => setSelectedLive(p)}
              >
                <span className="item-text">{p.text}</span>
                <span className="item-delta">must contain &ldquo;{p.mustContain}&rdquo;</span>
              </button>
            ))}
          </div>
          <AddLivePrompt
            onAdd={(text, mustContain) => {
              const next = { id: `live-${livePrompts.length + 1}`, text, mustContain };
              setLivePrompts((prev) => [...prev, next]);
              setSelectedLive(next);
            }}
          />
        </>
      )}

      <Results />
      <Legend />
    </div>
  );
}
