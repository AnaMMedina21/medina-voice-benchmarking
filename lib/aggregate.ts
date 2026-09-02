/**
 * Aggregation for the results section.
 *
 * Rules, applied everywhere without exception:
 *   - a metric is summarised over rows where passed === true, unless the caller
 *     asks for all rows (TTS TTFB is the constant, so it is reported ungated)
 *   - null is never coerced to zero. The row is excluded from that metric and
 *     the exclusion is counted
 *   - fewer than MIN_SAMPLES measured values yields null, and the caller renders
 *     an em dash with the reason in the note
 *   - p95 is nearest-rank, so it is always a value that was actually observed
 */

import type { Metric, Turn } from "./run-data";

export const MIN_SAMPLES = 3;

export type Summary = {
  value: number | null;
  n: number;
  excluded: number;
  reason: string | null;
};

function collect(turns: Turn[], key: keyof Turn, passGated: boolean): {
  values: number[];
  excluded: number;
} {
  const eligible = passGated ? turns.filter((t) => t.passed) : turns;
  const values: number[] = [];
  let excluded = 0;
  for (const turn of eligible) {
    const raw = turn[key] as Metric;
    if (raw === null) excluded++;
    else values.push(raw);
  }
  return { values, excluded };
}

function summarise(values: number[], excluded: number, pick: (sorted: number[]) => number): Summary {
  if (values.length < MIN_SAMPLES) {
    return {
      value: null,
      n: values.length,
      excluded,
      reason: `only ${values.length} measured value${values.length === 1 ? "" : "s"}; ` +
              `${MIN_SAMPLES} required`,
    };
  }
  return { value: pick([...values].sort((a, b) => a - b)), n: values.length, excluded, reason: null };
}

export function median(turns: Turn[], key: keyof Turn, passGated = true): Summary {
  const { values, excluded } = collect(turns, key, passGated);
  return summarise(values, excluded, (sorted) => {
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  });
}

/** Nearest-rank p95: returns an observed value, never an interpolated one. */
export function p95(turns: Turn[], key: keyof Turn, passGated = true): Summary {
  const { values, excluded } = collect(turns, key, passGated);
  return summarise(values, excluded, (sorted) => {
    const rank = Math.max(1, Math.ceil(0.95 * sorted.length));
    return sorted[rank - 1];
  });
}

/** "0.52 s", or an em dash when the value was not measured. Never "0.00 s". */
export function fmt(value: number | null, digits = 2): string {
  return value === null ? "—" : `${value.toFixed(digits)} s`;
}
