"""Read results.csv and print a markdown summary to stdout. Standard library only.

Purpose
    Turn the raw per-turn rows written by agent.py into the table that goes in
    the writeup. No pandas, no plotting, no network, no rewriting of results.csv.

Metrics summarised (all seconds, all read straight from the CSV)
    ttfa_s          turn start -> first audio byte out of TTS. The headline.
    ttft_s          LLM request send -> first content delta
    tts_handoff_s   first LLM delta -> first speakable chunk into TTS
    tts_ttfb_s      first text into TTS -> first audio byte
    total_s         turn start -> last LLM token

    Headline numbers are pass-gated: only turns whose deterministic assertion
    passed and whose error field is empty. Ungated counts appear in a footnote,
    because a fast wrong answer is not a result.

    An empty CSV field means the value was never measured. It is skipped, and
    the n it was skipped from is reported. It is never read as zero.

Usage
    .venv/bin/python analyze.py                  # reads results.csv
    .venv/bin/python analyze.py other.csv        # reads another file
"""

import csv
import statistics
import sys

RESULTS_FILE = "results.csv"

# Ordered as the pipeline runs, so the table reads as a turn does.
METRICS = (
    ("ttfa_s", "Time to first audio (headline)"),
    ("ttft_s", "LLM time to first token"),
    ("tts_handoff_s", "LLM first delta -> TTS"),
    ("tts_ttfb_s", "TTS time to first byte"),
    ("total_s", "Turn start -> last token"),
)

CONTROL_FIELDS = ("prompt_tokens", "completion_tokens")


def read_rows(path):
    with open(path, newline="") as handle:
        return list(csv.DictReader(handle))


def to_float(value):
    """Empty field means unmeasured. Returns None, never 0.0."""
    if value is None or value.strip() == "":
        return None
    return float(value)


def is_clean(row):
    """A pass-gated row: the assertion passed and nothing errored."""
    return row["passed"] == "True" and row["error"].strip() == ""


def percentile_95(values):
    """Nearest-rank p95.

    Nearest rank rather than an interpolating quantile because n here is small
    (24 per arm): interpolation would invent a value between two observations
    and present it with the same authority as a measured one. Nearest rank
    always returns a number that was actually observed.
    """
    if not values:
        return None
    ordered = sorted(values)
    rank = max(1, -(-95 * len(ordered) // 100))  # ceil(0.95 * n), integer math
    return ordered[rank - 1]


def column(rows, field):
    """Every measured value of one field. Unmeasured rows are dropped, not zeroed."""
    return [v for v in (to_float(r.get(field)) for r in rows) if v is not None]


def fmt(value):
    return "—" if value is None else f"{value:.3f}"


def summarise_arm(rows, field):
    values = column(rows, field)
    return {
        "n": len(values),
        "median": statistics.median(values) if values else None,
        "p95": percentile_95(values),
    }


def print_run_summary(rows, arms):
    print("## Run")
    print()
    print(f"- Turns recorded: **{len(rows)}**")
    for arm in arms:
        arm_rows = [r for r in rows if r["arm"] == arm]
        clean = [r for r in arm_rows if is_clean(r)]
        errored = [r for r in arm_rows if r["error"].strip() != ""]
        print(f"- `{arm}`: {len(arm_rows)} turns, {len(clean)} passed, "
              f"{len(errored)} errored")
    print()


def print_metric_table(rows, arms):
    print("## Latency, pass-gated")
    print()
    print("Median and p95 over turns that passed their assertion with no error. "
          "Seconds.")
    print()
    header = "| Metric | " + " | ".join(f"{a} median | {a} p95" for a in arms) + " |"
    print(header)
    print("|---|" + "---|" * (2 * len(arms)))

    clean_by_arm = {a: [r for r in rows if r["arm"] == a and is_clean(r)] for a in arms}
    for field, label in METRICS:
        cells = []
        for arm in arms:
            stats = summarise_arm(clean_by_arm[arm], field)
            cells.append(fmt(stats["median"]))
            cells.append(fmt(stats["p95"]))
        print(f"| `{field}` — {label} | " + " | ".join(cells) + " |")
    print()


def print_headline_delta(rows, arms):
    """The one comparison the benchmark exists to make."""
    if len(arms) != 2:
        return
    a, b = arms
    med = {}
    for arm in (a, b):
        clean = [r for r in rows if r["arm"] == arm and is_clean(r)]
        med[arm] = summarise_arm(clean, "ttfa_s")["median"]
    if med[a] is None or med[b] is None:
        print("Headline delta not computable: one arm has no passing turns.\n")
        return
    faster, slower = (a, b) if med[a] < med[b] else (b, a)
    diff = med[slower] - med[faster]
    ratio = med[slower] / med[faster]
    print("## Headline")
    print()
    print(f"Median `ttfa_s`: `{faster}` **{med[faster]:.3f}s** vs "
          f"`{slower}` **{med[slower]:.3f}s**.")
    print()
    print(f"`{faster}` is **{diff:.3f}s faster** ({ratio:.2f}x) at the median, "
          f"with the same voice, the same TTS model, the same prompts and the "
          f"same pipeline code. The LLM is the only variable.")
    print()


def print_per_prompt(rows, arms):
    print("## Median `ttfa_s` by prompt")
    print()
    print("| Prompt | " + " | ".join(arms) + " |")
    print("|---|" + "---|" * len(arms))
    for prompt_id in dict.fromkeys(r["prompt_id"] for r in rows):
        cells = []
        for arm in arms:
            subset = [r for r in rows
                      if r["prompt_id"] == prompt_id and r["arm"] == arm and is_clean(r)]
            stats = summarise_arm(subset, "ttfa_s")
            cells.append(fmt(stats["median"]))
        print(f"| `{prompt_id}` | " + " | ".join(cells) + " |")
    print()


def print_controls(rows, arms):
    """Evidence that the things we said were held constant actually were.

    The check is per prompt across reps, not across the whole run: the eight
    prompts are different lengths, so a run-wide spread in prompt_tokens says
    nothing. What would matter is the same prompt costing more tokens on a
    later rep - that is context leaking between turns, and it would mean the
    later turns measured a longer prompt rather than a slower model.
    """
    print("## Controls")
    print()
    for arm in arms:
        arm_rows = [r for r in rows if r["arm"] == arm and is_clean(r)]
        by_prompt = {}
        for row in arm_rows:
            value = to_float(row.get("prompt_tokens"))
            if value is not None:
                by_prompt.setdefault(row["prompt_id"], set()).add(value)
        varying = {k: sorted(v) for k, v in by_prompt.items() if len(v) > 1}
        if not by_prompt:
            verdict = "prompt_tokens not reported by this provider"
        elif not varying:
            verdict = (f"prompt_tokens identical across reps for all "
                       f"{len(by_prompt)} prompts — context was fresh each turn")
        else:
            detail = "; ".join(f"{k} {v}" for k, v in sorted(varying.items()))
            verdict = (f"prompt_tokens varies across reps of the same prompt for "
                       f"{len(varying)} of {len(by_prompt)} prompts ({detail})")
        completions = column(arm_rows, "completion_tokens")
        length = (f"completion_tokens median "
                  f"{statistics.median(completions):.0f}, range "
                  f"{min(completions):.0f}–{max(completions):.0f}") if completions else \
                 "completion_tokens not reported"
        print(f"- `{arm}` — {verdict}. {length}.")
    print()
    print("Output length is a control we document rather than enforce. The system "
          "prompt constrains it identically in both arms, but the arms still emit "
          "different numbers of tokens, so `total_s` is confounded by output "
          "length in a way `ttfa_s` and `ttft_s` are not.")
    print()


def print_footnote(rows, arms):
    print("## Footnote — ungated counts")
    print()
    print("Numbers above are pass-gated. These are not.")
    print()
    for arm in arms:
        arm_rows = [r for r in rows if r["arm"] == arm]
        for field, _label in METRICS:
            gated = len([r for r in arm_rows if is_clean(r) and to_float(r.get(field)) is not None])
            ungated = len(column(arm_rows, field))
            if gated != ungated:
                print(f"- `{arm}` `{field}`: {ungated} measured, {gated} pass-gated "
                      f"({ungated - gated} excluded)")
    unmeasured = []
    for arm in arms:
        arm_rows = [r for r in rows if r["arm"] == arm]
        for field, _label in METRICS:
            missing = len(arm_rows) - len(column(arm_rows, field))
            if missing:
                unmeasured.append(f"- `{arm}` `{field}`: {missing} of "
                                  f"{len(arm_rows)} turns unmeasured")
    if unmeasured:
        print("\n".join(unmeasured))
    else:
        print("- Every metric was measured on every turn; no empty fields.")
    print()


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else RESULTS_FILE
    try:
        rows = read_rows(path)
    except FileNotFoundError:
        raise SystemExit(f"{path} not found. Run `python agent.py` first.")
    if not rows:
        raise SystemExit(f"{path} has a header but no rows.")

    arms = list(dict.fromkeys(r["arm"] for r in rows))

    print(f"# Voice latency benchmark — {path}")
    print()
    print_run_summary(rows, arms)
    print_headline_delta(rows, arms)
    print_metric_table(rows, arms)
    print_per_prompt(rows, arms)
    print_controls(rows, arms)
    print_footnote(rows, arms)


if __name__ == "__main__":
    main()
