"use client";

/**
 * Two fields, both required. The second one is the assertion.
 *
 * Written by a person, before the call, checked deterministically against the
 * model's text — the same discipline the harness used. Without it a live turn
 * is a timing with no correctness check, which is the opposite of the point.
 * No model judges another model's output anywhere in this project.
 */

import { useState } from "react";

type Props = { onAdd: (prompt: string, mustContain: string) => void };

export default function AddLivePrompt({ onAdd }: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [mustContain, setMustContain] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (!text.trim()) return setError("A prompt is required.");
    if (!mustContain.trim()) {
      return setError(
        "An expected substring is required — without it the turn is a timing with no correctness check."
      );
    }
    onAdd(text.trim(), mustContain.trim());
    setText("");
    setMustContain("");
    setError(null);
    setOpen(false);
  }

  if (!open) {
    return (
      <button className="add" onClick={() => setOpen(true)}>
        Add prompt
      </button>
    );
  }

  return (
    <div className="live-form">
      <label htmlFor="live-prompt">Prompt — sent to both models</label>
      <input
        id="live-prompt"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What's the capital of France?"
      />

      <label htmlFor="live-expect">Expected answer contains</label>
      <input
        id="live-expect"
        value={mustContain}
        onChange={(e) => setMustContain(e.target.value)}
        placeholder="Paris"
      />
      <p className="hint">
        Checked as a case-insensitive substring of the model&rsquo;s text, never
        against the synthesized audio. Required: it is what makes a live turn a
        result rather than a stopwatch reading.
      </p>

      {error && <p className="hint" style={{ color: "#b00020" }}>{error}</p>}

      <div className="row">
        <button className="both" onClick={submit}>Add</button>
        <button className="both ghost" onClick={() => { setOpen(false); setError(null); }}>
          Cancel
        </button>
      </div>
    </div>
  );
}
