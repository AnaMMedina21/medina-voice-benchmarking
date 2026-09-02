/**
 * Glossary for the abbreviations used on this page.
 *
 * Each entry says what the term means AND where its boundaries are, because
 * the boundaries are what make the numbers comparable or not. "Time to first
 * audio" is uninformative without knowing which two events it spans.
 */

const TERMS: { term: string; expansion?: string; body: React.ReactNode }[] = [
  {
    term: "arm",
    body: (
      <>
        One of the two configurations under test. Everything downstream is held
        constant — same voice, same TTS model, same system prompt, same prompts,
        same pipeline code — so the arm names the only thing that differs: the
        LLM. Here, Mercury 2 or Haiku 4.5.
      </>
    ),
  },
  {
    term: "LLM",
    expansion: "large language model",
    body: (
      <>
        The model that writes the answer, before any speech exists. It is the
        single variable in this comparison; every other stage is shared.
      </>
    ),
  },
  {
    term: "TTFA",
    expansion: "time to first audio",
    body: (
      <>
        Turn start to the first audio byte leaving text-to-speech. The headline
        number, because it is the part a person actually sits through. In live
        mode this is measured in your browser and additionally includes your
        network and the WebRTC transport.
      </>
    ),
  },
  {
    term: "TTFT",
    expansion: "time to first token",
    body: (
      <>
        Request sent to the first content delta coming back from the LLM. This
        is the model&rsquo;s own responsiveness with none of the pipeline around
        it, which is why the gap here is the most model-attributable number on
        the page.
      </>
    ),
  },
  {
    term: "TTFB",
    expansion: "time to first byte",
    body: (
      <>
        Used here for text-to-speech: the first speakable text handed to
        ElevenLabs, to the first audio byte back. Both arms use the same voice
        and model, so this is the constant — it is published so you can subtract
        it and see what is left.
      </>
    ),
  },
  {
    term: "p95",
    expansion: "95th percentile",
    body: (
      <>
        The value 95% of turns came in under. Computed by nearest rank, so it is
        always a value that was actually observed rather than one interpolated
        between two others. At this sample size it indicates the shape of the
        tail; it is not a stable tail estimate, which is why the column carries
        its n.
      </>
    ),
  },
];

export default function Legend() {
  return (
    <section className="legend">
      <h2>Legend</h2>
      <dl>
        {TERMS.map(({ term, expansion, body }) => (
          <div key={term}>
            <dt>{term}</dt>
            <dd>
              {expansion && <span className="expand">{expansion} — </span>}
              {body}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
