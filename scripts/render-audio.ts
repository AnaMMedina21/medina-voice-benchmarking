/**
 * Synthesizes one MP3 per prompt per arm from the text each model actually
 * produced, and writes them to public/audio/{arm}_{promptId}.mp3.
 *
 * WHY THIS EXISTS: the benchmark harness did not persist audio. Its audio sink
 * counted frames and discarded them, by design - grading was done on text and
 * the audio was never inspected. So the clips on the page are a re-synthesis,
 * not the bytes that were timed. The page's caption has to say so.
 *
 * Faithful means: the same voice id and model id the harness used, and the
 * exact answer_text of the MEDIAN-ttfa rep, markdown included. Mercury emitted
 * "**Paris**"; that string is what went to ElevenLabs during the run, so it is
 * what goes now. Cleaning it here would make the audio nicer than the run was.
 *
 * The timings are NOT re-derived from these files. Every number on the page
 * still comes from results.csv.
 *
 * Usage: node scripts/render-audio.ts [--force]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

const OUT_DIR = "public/audio";
const ENV_FILE = ".env.local";

// Identical to the constants the harness ran with. Overridable by env so the
// worker and this script cannot drift apart silently.
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "hpp4J3VqNfWAUOO0d1Us";
const MODEL_ID = process.env.ELEVENLABS_MODEL_ID || "eleven_flash_v2_5";
const OUTPUT_FORMAT = "mp3_44100_128";

/** Reads KEY=VALUE lines. Tolerates junk lines rather than throwing on them. */
function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
}

async function synthesize(text: string, apiKey: string): Promise<Buffer> {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=${OUTPUT_FORMAT}`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: MODEL_ID }),
    }
  );
  if (!res.ok) {
    throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  loadEnvFile(ENV_FILE);
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error(
      `ELEVENLABS_API_KEY is not set. Add it to ${ENV_FILE} or the environment.`
    );
  }

  const { PROMPTS, ARMS } = await import("../lib/run-data.ts");
  mkdirSync(OUT_DIR, { recursive: true });

  const force = process.argv.includes("--force");
  let written = 0;
  let skipped = 0;

  for (const prompt of PROMPTS) {
    for (const arm of ARMS) {
      const result = prompt.results[arm.id];
      const out = `${OUT_DIR}/${arm.id}_${prompt.id}.mp3`;

      // Preserve missingness: a turn with no measured audio gets no file, and
      // the page renders the gap rather than a clip that stands in for one.
      if (!result.answerText || result.audio_rep === null) {
        console.log(`skip  ${arm.id}_${prompt.id} — no measured row to synthesize`);
        skipped++;
        continue;
      }
      if (existsSync(out) && !force) {
        console.log(`have  ${out}`);
        skipped++;
        continue;
      }
      const audio = await synthesize(result.answerText, apiKey);
      writeFileSync(out, audio);
      console.log(
        `wrote ${out}  rep ${result.audio_rep}  ${(audio.length / 1024).toFixed(0)}KB`
      );
      written++;
    }
  }
  console.log(`\n${written} written, ${skipped} skipped. voice=${VOICE_ID} model=${MODEL_ID}`);
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
