/**
 * Results section: summary table, distribution strip, provenance, limits.
 *
 * Reads the same generated data the players read. It renders numbers measured
 * by the headless harness; nothing here measures anything.
 */

import { ARMS, META, TURNS, type ArmId, type Turn } from "@/lib/run-data";
import { fmt, median, p95, MIN_SAMPLES } from "@/lib/aggregate";

/** Axis runs 0 to the slowest measured TTFA, rounded up to a whole second. */
function axisMax(turns: Turn[]): number {
  const values = turns.map((t) => t.ttfa_s).filter((v): v is number => v !== null);
  return values.length ? Math.ceil(Math.max(...values)) : 1;
}

function axisTicks(max: number): number[] {
  const step = max <= 2 ? 0.5 : max <= 5 ? 1 : 2;
  const out: number[] = [];
  for (let v = 0; v <= max + 1e-9; v += step) out.push(Number(v.toFixed(2)));
  return out;
}

export default function Results() {
  const byArm = new Map<ArmId, Turn[]>(
    ARMS.map((a) => [a.id, TURNS.filter((t) => t.arm === a.id)])
  );
  const max = axisMax(TURNS);

  const stats = ARMS.map((arm) => {
    const turns = byArm.get(arm.id) ?? [];
    return {
      arm,
      turns,
      passed: turns.filter((t) => t.passed).length,
      total: turns.length,
      medianTtfa: median(turns, "ttfa_s"),
      p95Ttfa: p95(turns, "ttfa_s"),
      medianTtft: median(turns, "ttft_s"),
      // Ungated on purpose: TTS is the constant across both arms, and
      // publishing it lets a reader subtract it from the headline.
      medianTtfb: median(turns, "tts_ttfb_s", false),
    };
  });

  const excluded = stats.reduce(
    (sum, s) =>
      sum + s.medianTtfa.excluded + s.p95Ttfa.excluded +
      s.medianTtft.excluded + s.medianTtfb.excluded,
    0
  );
  const thin = stats.flatMap((s) =>
    [
      ["median TTFA", s.medianTtfa],
      ["p95 TTFA", s.p95Ttfa],
      ["median TTFT", s.medianTtft],
      ["median TTS TTFB", s.medianTtfb],
    ]
      .filter(([, summary]) => (summary as { reason: string | null }).reason !== null)
      .map(([label, summary]) =>
        `${s.arm.name} ${label}: ${(summary as { reason: string | null }).reason}`
      )
  );

  return (
    <section className="results">
      <h2>Results</h2>

      <table className="summary">
        <thead>
          <tr>
            <th>arm</th>
            <th>median TTFA</th>
            <th>
              p95 TTFA
              <br />
              (n={stats.map((s) => s.p95Ttfa.n).join(" / ")})
            </th>
            <th>median LLM TTFT</th>
            <th>
              median TTS TTFB
              <br />
              (all rows)
            </th>
            <th>passed</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((s) => (
            <tr key={s.arm.id}>
              <th scope="row">{s.arm.name}</th>
              <td className={s.medianTtfa.value === null ? "dash" : ""}>
                {fmt(s.medianTtfa.value)}
              </td>
              <td className={s.p95Ttfa.value === null ? "dash" : ""}>
                {fmt(s.p95Ttfa.value)}
              </td>
              <td className={s.medianTtft.value === null ? "dash" : ""}>
                {fmt(s.medianTtft.value)}
              </td>
              <td className={s.medianTtfb.value === null ? "dash" : ""}>
                {fmt(s.medianTtfb.value)}
              </td>
              <td>
                {s.passed} / {s.total}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="note">
        TTFA, p95 and TTFT are computed over turns that passed their assertion.
        TTS TTFB is over all rows. A turn with no measured value for a metric is
        excluded from that metric rather than counted as zero
        {excluded === 0
          ? "; no turn was excluded on this run"
          : `; ${excluded} such exclusion${excluded === 1 ? "" : "s"} on this run`}
        . p95 is nearest-rank, so it is an observed value and not a stable tail
        estimate at this n. A metric with fewer than {MIN_SAMPLES} measured
        values renders as an em dash.
        {thin.length > 0 && ` ${thin.join("; ")}.`}
      </p>

      <div className="strip">
        {ARMS.map((arm) => {
          const turns = byArm.get(arm.id) ?? [];
          const measured = turns.filter(
            (t): t is Turn & { ttfa_s: number } => t.ttfa_s !== null
          );
          const passedValues = measured.filter((t) => t.passed).map((t) => t.ttfa_s);
          const sorted = [...passedValues].sort((a, b) => a - b);
          const mid =
            sorted.length === 0
              ? null
              : sorted.length % 2
                ? sorted[Math.floor(sorted.length / 2)]
                : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;

          return (
            <div className="strip-row" key={arm.id}>
              <span className="strip-name">{arm.name}</span>
              <div className="strip-plot">
                {measured.map((turn, i) => (
                  <div
                    key={`${turn.promptId}-${turn.rep}-${i}`}
                    className={`tick${turn.passed ? "" : " hollow"}`}
                    style={{ left: `${(turn.ttfa_s / max) * 100}%` }}
                    title={`${turn.promptId} rep ${turn.rep}: ${turn.ttfa_s.toFixed(3)}s${
                      turn.passed ? "" : " (failed assertion, not counted)"
                    }`}
                  />
                ))}
                {mid !== null && (
                  <div
                    className="tick median"
                    style={{ left: `${(mid / max) * 100}%` }}
                    title={`${arm.name} median ${mid.toFixed(3)}s`}
                  />
                )}
              </div>
            </div>
          );
        })}
        <div className="axis">
          {axisTicks(max).map((t) => (
            <span key={t} style={{ left: `${(t / max) * 100}%` }}>
              {t}s
            </span>
          ))}
        </div>
      </div>

      <p className="provenance">
        From{" "}
        <a href={META.csvUrl} target="_blank" rel="noreferrer">
          results.csv
        </a>
        , {META.turns} turns across {META.prompts} prompts and {META.reps} reps,
        run from a single client on a wired connection ({META.source}). This page
        renders those numbers; it doesn&rsquo;t measure anything.
      </p>

      <p className="note">What this doesn&rsquo;t measure</p>
      <ul className="limits">
        <li>No concurrency — one turn at a time, never under load.</li>
        <li>A single region and a single time window.</li>
        <li>
          Different provider plugins in front of each model, so plugin overhead
          is part of each arm&rsquo;s number.
        </li>
        <li>
          Framework and TTS overhead is present in both arms, so only the
          difference between them is model-attributable.
        </li>
      </ul>
    </section>
  );
}
