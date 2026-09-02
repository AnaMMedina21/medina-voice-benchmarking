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
    if (!text.trim()) return setError("The prompt can't be empty.");
    if (!mustContain.trim()) {
      return setError(
        "Tell us what the answer has to contain. Without it we can time the turn but we can't tell you whether it was right."
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
      <label htmlFor="live-prompt">Prompt — both models get this, word for word</label>
      <input
        id="live-prompt"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What's the capital of France?"
      />

      <label htmlFor="live-expect">The answer has to contain</label>
      <input
        id="live-expect"
        value={mustContain}
        onChange={(e) => setMustContain(e.target.value)}
        placeholder="Paris"
      />
      <p className="hint">
        Decide what a correct answer looks like before you hear one. It&rsquo;s
        checked as a case-insensitive substring of the model&rsquo;s text, never
        against the audio. Required, because a turn with no assertion is a
        stopwatch reading — it tells you how fast, never whether it was right.
        Pick the exact wording carefully: ask for a number and you may get
        &ldquo;6&rdquo; where you expected &ldquo;six.&rdquo;
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
