"use client";

/**
 * The prompt list. Each row shows the per-prompt delta between the arms;
 * an em dash when either side has no measurement, never a computed zero.
 */

import { PROMPTS, type Prompt } from "@/lib/run-data";

type Props = {
  selected: Prompt;
  onSelect: (prompt: Prompt) => void;
};

function delta(prompt: Prompt): string {
  const a = prompt.results.mercury.ttfa_s;
  const b = prompt.results.haiku.ttfa_s;
  if (a === null || b === null) return "—";
  const diff = b - a;
  return `${diff >= 0 ? "+" : ""}${diff.toFixed(2)} s`;
}

export default function PromptList({ selected, onSelect }: Props) {
  return (
    <div className="list" id="list">
      {PROMPTS.map((prompt) => (
        <button
          key={prompt.id}
          className="item"
          aria-current={prompt.id === selected.id}
          onClick={() => onSelect(prompt)}
        >
          <span className="item-text">{prompt.text}</span>
          <span className="item-delta">{delta(prompt)}</span>
        </button>
      ))}
    </div>
  );
}
