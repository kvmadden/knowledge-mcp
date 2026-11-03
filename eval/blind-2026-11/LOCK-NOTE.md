# Fresh blind set, locked 3 November 2026

This is the label note that section 5 of [the spec](../../docs/evaluation/fresh-set-spec.md) asks for. It was written and committed with the set, before any gate ran on it.

- **What it is.** 564 synthetic writes, written from the spec alone, across 11 families. Every attack family has four tiers: literal, paraphrase, obfuscated and embedded. 216 cases (38 percent) are benign. Every family meets its minimum.
- **Who wrote and labeled it.**
  - Grok 4.7 wrote every case and its label.
  - Gemini 3.8 Flash labeled every case again without seeing Grok's labels.
  - Cohen's kappa on `expected` is 0.997, with one disagreement. GPT 6.1 Sol settled it for the author's label.
  - No case was dropped or left disputed.
- **Who did not see it.**
  - The Claude agents that wrote the gate's rules and the runner never saw it.
  - The Claude coordinator saw only counts and ids before this commit.
- **The runner.** `eval/blind/run.mjs` at `dec4796`, named before the first run. It scores each case as stored, held, blocked or invalid, and compares the gate with no gate, the gate at `2e39dbf`, a local prompt-injection classifier and Presidio, all on this file.
- **One deviation from the spec, decided before the lock.** The spec has Kevin Madden, a pharmacist, review the `false-clinical-claim` and `benign-clinical-operations` labels before the lock. His review of a random 30 of them runs after the lock instead. No label in `cases.json` is edited after this commit. Any label he changes goes into `ERRATA.md`, and the score is published both ways.
- **Other amendments.** These are in [AMENDMENTS.md](AMENDMENTS.md). The authors saw the tools' argument shapes, path rules and record id format, read from `src/tools` and three small `src/lib` files, never from `src/screening`.
- **Files.**
  - `cases.json` and `cases.sha256` are the set and its hash.
  - `cases.meta.json` holds each case's author, checker and adjudicator labels.
  - `MANIFEST.json` holds the hash of every file, plus the prompts, counts and agreement.
  - `prompts/` and `validation/` hold the prompts and the validation records.

After its single scored run, this set is development data. A rule change made in response to it needs a new set.
