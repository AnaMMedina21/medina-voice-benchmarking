/**
 * Deterministic decorative waveform, ported unchanged from the original demo.
 *
 * These bars are NOT derived from the audio file. They are a seeded PRNG keyed
 * on prompt + arm, so a given row always draws the same shape across reloads.
 * The measurement on this row is the wait before the bars, not the bars.
 */

function seeded(seed: string): () => number {
  let h = 2166136261;
  for (const ch of seed) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function heights(seed: string, count: number): number[] {
  const rand = seeded(seed);
  return Array.from({ length: count }, (_, i) => {
    const envelope = Math.sin((i / count) * Math.PI) * 0.55 + 0.45;
    return Math.round((0.18 + rand() * 0.82) * envelope * 100);
  });
}
