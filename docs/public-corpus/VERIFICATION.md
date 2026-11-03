# Public corpus verification

The public collection contains 134 committed passages from three canonical public sources. The fictional seed collection stays separate. The demo and read-only MCP tool use deterministic BM25 and return an exact excerpt with citation metadata. Public source material never becomes trusted write provenance.

## Scope search

Base and control: `9c19d0ba1d86eedffe090b9086389400e4405dbf`, fetched from origin/main before implementation and checked again before publishing.

`git ls-tree -r --name-only origin/main` and `git grep -n -i -E 'public.corpus|dailymed|openfda|immunization|coverage determination' origin/main` found no public retrieval collection. The only open PR was clinical scenario PR #3. No dependency on that branch is required. No duplicate public corpus owner was found.

## RED and integration failures

Before implementation, `node --test test/public-corpus.test.js` exited 1 with three failing tests. The first assertion was `public corpus manifest must be committed`. Citation and offline eval tests failed because the implementation modules did not exist. See [red.txt](evidence/red.txt).

The first integration run exposed four failures from adding a registered read tool: two fixed tool counts, missing write-path harness fixture coverage, and the corresponding read-only audit. These are recorded in [integration-red.txt](evidence/integration-red.txt). Counts now include the new tool and the existing audit tests exercise it.

The first fresh clone passed all 105 tests but failed the two new npm commands because package.json had not been included in the initial code commit. Those command failures are retained in `evidence/fresh-integration-red-*`. Commit `6fe1924` adds the missing scripts and package contents. The final fresh clone rerun passed all commands. No failing run is counted as green.

## Control and candidate

Both arms used Node v24.14.1, the same locked dependencies installed with `npm ci`, and the repository's synthetic fixtures. Both ran in fresh clones in the system temporary folder, written `<control>` and `<candidate>` in the command records, with the workspace root variables unset. Temporary clones were removed by Python `TemporaryDirectory` after preserving logs. The final tested code is `6fe1924f9fd08ca1b849d62b5fdc215f42477964`. Later evidence commits change documentation only.

Text logs have trailing whitespace removed without changing test outcomes. Exact argument arrays, exit codes and log paths are recorded in [control-commands.json](evidence/control-commands.json) and [fresh-candidate-commands.json](evidence/fresh-candidate-commands.json).

| Check | Untouched main | Fresh candidate |
| --- | --- | --- |
| `npm ci` | 0 | 0 |
| `node --test test/console.test.js test/startup.test.js test/stdio.test.js test/write-paths.test.js` | 0 | 0 |
| `node --test test/public-corpus.test.js` | RED before implementation | 0, 4 passed |
| `npm test` | 0, 100 passed | 0, 105 passed |
| `npm run check` | 0 | 0 |
| `npm run eval:legacy` | 0 | 0, identical result |
| `npm run eval:heldout` | 0 | 0, identical result |
| `npm run eval:public` | Not present | 0 |
| `npm run corpus:check` | Not present | 0, all three upstream extractions match |
| `git diff --check` | Clean | 0, clean |

Baseline full-gate failures: none. Final candidate-only failures: none. No tests skipped. Existing eval fixture files and reports are unchanged. The held-out safety result still has 5 false blocks and 10 misses, exactly as the control reports. Those pre-existing results are not reclassified as public retrieval performance.

The offline test forbids `fetch`, HTTP, HTTPS and socket connections in the evaluation subprocess. Manifest tests verify allowed canonical source paths, licenses, retrieval dates, unique passage IDs and SHA256 bytes. Citation tests and the evaluator resolve returned text and source metadata to committed files. MCP and HTTP tests exercise the actual retrieval implementation and verify no store mutation and collection isolation.

## Public evaluation

The 18 authored regression questions include six questions per source. Each expectation contains the exact passage ID and source text. Stale expectations fail evaluation. This is not a held-out benchmark or a medical correctness evaluation.

| Metric | Result | Definition |
| --- | --- | --- |
| Retrieval hit rate at 3 | 18/18, 100% | At least one of three retrieved passages matches an expected passage |
| Citation accuracy | 18/18, 100% | Answer citation matches an expected ID and exact text |
| Exact citation resolution | 18/18, 100% | Citation text, title, URL and license resolve to the committed passage and manifest |

See [public-eval.json](evidence/public-eval.json) and the fresh clone output in [fresh-candidate-10.txt](evidence/fresh-candidate-10.txt). These metrics do not modify or incorporate the existing safety evaluations.

## Browser evidence

Visual changes reuse the existing `docs/media/theme.json` palette and console typography. The existing write gate screenshot was the reference. Command: `PLAYWRIGHT_MODULE=<installed Playwright ES module> node scripts/record-public-corpus.mjs`, exit 0.

The recorder passed at 1440x900, 430x932 and 390x844 with no page errors or horizontal overflow, keyboard form submission, minimum 44-point controls, collection switching, empty results, failed request recovery and light/dark screenshots. Screenshots were rendered and visually inspected. See [browser.json](evidence/browser.json) and the six `docs/media/public-corpus-*` images.

## Limits

The corpus contains selected prose and label sections, not complete source documents. Source URLs and retrieval timestamps are preserved. Only refresh verification uses the network. Upstream changes require review and may make the reproducibility check fail. CDC attribution, free availability and the required non-endorsement notice appear in the source documentation and demo. The demo does not generate clinical recommendations. No paid API or external service is used for answering.
