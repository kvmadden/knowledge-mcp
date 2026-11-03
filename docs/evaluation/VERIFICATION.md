# Verification record

Run on 2026-10-31 with Node `v24.14.1` and npm `11.11.0`, macOS. Public-main control revision: `9dc0ac6`. Frozen set commit: `ced04b5`. Frozen runtime implementation commit: `5e05949`.

## Scope and duplicate check

Fetched `origin/main`, enumerated its tree, searched screening, audit, provenance, dry-run, approval and injection synonyms, and checked open PRs. None covered this scope.

Work ran in an isolated worktree, with raw logs kept in a local evidence directory. Public, synthetic evidence is committed here so review does not require access to that directory.

## RED first, then GREEN

Before implementation:

```sh
node --test test/safety-flow.test.js
```

Exit 1, all five initial tests failed. Representative assertion: `Missing expected exception: instruction injection must be refused`. Other failures were an untrusted source stored, missing provenance, a dry-run call reported success, and an invalid write mode accepted. The raw log is `red.log` in the local evidence directory.

After implementation, the suite also covers dry-run startup with the unchanged synthetic seed and working reads:

```sh
node --test test/safety-flow.test.js
```

Exit 0, 6 passed, 0 failed. `green-focused.log` records the output.

Ran the same six tests against the untouched control through a temporary wrapper that changes only import and seed paths. The synthetic fixture bytes and assertions were identical. The wrapper is preserved in the local evidence directory and the scratch copy is removed after use. It sat in the system temporary folder, written `<temp dir>` below. The workspace root variables were unset for this run and for both fresh clones below.

```sh
node --test <temp dir>/knowledge-mcp-focused-control.test.mjs
```

Exit 1, 6 failed, 0 passed. These are the absent new behaviors, not pre-existing failures of main's own gate. A first wrapper attempt resolved a relative seed URL outside the checkout. Its path was corrected and the recorded control run contains the intended assertion failure instead of an import or fixture error.

## Full repository gate and evaluation

Created an independent fresh clone in a temporary folder, written `<control>` below, checked out `9dc0ac6` detached and left its source tree clean. Both runs use the same Node/npm binaries and unchanged lockfile dependencies. Nothing outside the clone is needed.

```sh
npm ci --prefix <control>
npm test --prefix <control>
npm run check --prefix <control>
```

Each command exited 0. Main's suite: 91 passed, 0 failed, 0 skipped. There are no baseline full-gate failures.

Candidate worktree:

```sh
npm ci
node --test test/safety-flow.test.js
npm test
npm run check
npm run demo
node scripts/safety-demo.mjs --record
node eval/legacy.mjs docs/evaluation/legacy-after.json
node eval/run.mjs docs/evaluation/heldout-after.json
shasum -a 256 -c eval/heldout.sha256
git diff --check
```

All exited 0. Full suite: 97 passed, 0 failed, 0 skipped. There are no candidate-only full-gate failures. The held-out runner reports outcomes rather than asserting that a heuristic is perfect, so its exit 0 does not conceal the 10 misses or 5 false blocks published in the report.

Control evaluation used the exact same runners and fixture bytes:

```sh
EVAL_RUNTIME_ROOT=<control> node eval/legacy.mjs docs/evaluation/legacy-before.json 9dc0ac6
```

Exit 0. The held-out before report was generated before any runtime change in the original worktree at `9dc0ac6`. Both sets and all counts are in [the evaluation report](README.md). The original `test/write-paths.test.js` and `test/_helpers.js` remain byte-for-byte unchanged from main.

Fresh candidate clone of `2b5bd7d`, in a temporary folder written `<candidate>`:

```sh
git clone --quiet --no-local . <candidate>
npm ci --prefix <candidate>
npm test --prefix <candidate>
npm run check --prefix <candidate>
```

All exited 0, with 97 passed, 0 failed and 0 skipped. Both fresh clone source trees remained clean. Outputs are committed in `evidence/` with trailing whitespace removed, including RED-first, focused GREEN, focused control, both full suites and fresh candidate. `KNOWLEDGE_WRITE_MODE=dry-run npm run check` also exited 0, with no seeded records or files. The final evidence-only commit changes no executable source or fixtures.

## Visual recording

The reference is the existing console demo and shared registry light-theme tokens, imported before rendering. Executed the four real MCP calls, generated the HTML from their actual transcript, then captured all four steps at 1440×900, 430×932 and 390×844. The recorder verifies Tab focus, Enter cycling, no horizontal overflow and a button measuring approximately 151×48 pixels. All checks passed. Desktop and both phone sizes were visually inspected. Phone pages scroll vertically to show the audit log.

```sh
node scripts/safety-demo.mjs --record
node scripts/render-safety-demo.mjs
PLAYWRIGHT_MODULE=<installed Playwright ES module> node scripts/record-safety-demo.mjs <evidence directory>
<media venv>/bin/python scripts/demo-gif.py <evidence directory>
```

Exit 0 for each. Recording tooling used an existing Playwright installation and a disposable Pillow environment, written `<media venv>` above. Neither is needed by the runtime or tests. The GIF has four frames, 11.6 seconds total, at 1440×1022 to include the complete audit entry. The viewport used for desktop review is 1440×900. The first PNG and complete GIF are in `docs/media/`.

## Remaining limits

The gate does not verify facts, decode instructions or authenticate provenance. Audit and data changes are not one atomic transaction. No live database or clinical workflow was exercised. See the README for the browser boundary, trust model and approval limitations. No merge, deployment, service reload, paid API or live migration was performed.
