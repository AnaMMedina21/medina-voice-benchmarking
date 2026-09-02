/**
 * Glossary for the abbreviations used on this page.
 *
 * Each entry gives the boundaries, not just the expansion. "Time to first
 * audio" says nothing useful until you know which two events it spans, and the
 * spans are what decide whether two numbers can be compared at all.
 */

const TERMS: { term: string; expansion?: string; body: React.ReactNode }[] = [
  {
    term: "arm",
    body: (
      <>
        One of the two setups being compared. Everything downstream is pinned —
        same voice, same TTS model, same system prompt, same prompts, same
        pipeline code — so the arm names the one thing that changes: the LLM.
        That&rsquo;s the whole design. If anything else drifts, the comparison
        is worthless.
      </>
    ),
  },
  {
    term: "LLM",
    expansion: "large language model",
    body: (
      <>
        The model that writes the answer, before any speech exists. It&rsquo;s
        the only variable here. Every other stage is shared between the arms.
      </>
    ),
  },
  {
    term: "TTFA",
    expansion: "time to first audio",
    body: (
      <>
        Turn start to the first byte of audio leaving text-to-speech. This is
        the headline, because it&rsquo;s the part a person actually sits
        through. Nobody waits on a token count. They wait on silence. In live
        mode the same number also carries your network and the WebRTC
        transport, so it isn&rsquo;t the same measurement.
      </>
    ),
  },
  {
    term: "TTFT",
    expansion: "time to first token",
    body: (
      <>
        Request sent, to the first content coming back from the model. No
        speech stage, no transport — just the model&rsquo;s own responsiveness.
        When the two arms differ here, that difference is the model. When they
        differ only in TTFA, look at the pipeline first.
      </>
    ),
  },
  {
    term: "TTFB",
    expansion: "time to first byte",
    body: (
      <>
        Used here for the speech stage: first speakable text handed to
        ElevenLabs, to the first audio byte back. Both arms use the same voice
        and the same model, so this is the constant. It&rsquo;s published so
        you can subtract it and see what&rsquo;s left.
      </>
    ),
  },
  {
    term: "p95",
    expansion: "95th percentile",
    body: (
      <>
        The value 95% of turns came in under — the slow ones you&rsquo;d notice,
        not the typical one. Computed by nearest rank, so it&rsquo;s always a
        turn that actually happened rather than a number interpolated between
        two others. At this sample size treat it as the shape of the tail, not
        a stable estimate. That&rsquo;s why the column carries its n.
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
