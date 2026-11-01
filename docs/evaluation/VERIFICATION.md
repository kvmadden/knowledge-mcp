# Verification record

Run on 2026-10-31 with Node `v24.14.1` and npm `11.11.0`, macOS. Public-main control revision: `9dc0ac6`. Frozen set commit: `ced04b5`. Frozen runtime implementation commit: `5e05949`.

## Scope and duplicate check

Fetched `origin/main` in the named knowledge-mcp clone, enumerated its tree, searched screening, audit, provenance, dry-run, approval and injection synonyms, and checked open PRs. None covered this scope. Searched current umbrella source, parked and archived capabilities and state/briefs after fetching its main. Checked dispatcher queued and started jobs and recent run evidence. The only knowledge-mcp builder job was this run. Portfolio jobs referenced the existing claim and did not own its runtime. No ledger row was claimed, edited or closed.

Used the dispatcher-created isolated worktree from the named clone. Local evidence is saved under `/Volumes/HubData/evidence/knowledge-mcp-upgrade`, the evidence allocation in the dispatcher's admitted storage plan. The storage receipt is `storage-plan-knowledge-mcp-upgrade-58798450-f738-40e2-8038-9c713dfe5915.json` in that evidence home. Public, synthetic evidence is committed here so review does not require access to that Mac.

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

Ran the same six tests against the untouched control through a temporary wrapper that changes only import and seed paths. The synthetic fixture bytes and assertions were identical. The wrapper is preserved in the local evidence directory and the scratch copy is removed after use.

```sh
env -u MFW_UMBRELLA_ROOT -u OPERATOR_ECOSYSTEM_ROOT node --test /tmp/knowledge-mcp-focused-control.test.mjs
```

Exit 1, 6 failed, 0 passed. These are the absent new behaviors, not pre-existing failures of main's own gate. A first wrapper attempt resolved a relative seed URL outside the checkout. Its path was corrected and the recorded control run contains the intended assertion failure instead of an import or fixture error.

## Full repository gate and evaluation

Created an independent fresh clone at `/tmp/knowledge-mcp-control-20261031`, outside the estate, checked out `9dc0ac6` detached and left its source tree clean. Both runs use the same Node/npm binaries and unchanged lockfile dependencies. No sibling repository, registered host or estate root is needed.

```sh
env -u MFW_UMBRELLA_ROOT -u OPERATOR_ECOSYSTEM_ROOT npm ci --prefix /tmp/knowledge-mcp-control-20261031
env -u MFW_UMBRELLA_ROOT -u OPERATOR_ECOSYSTEM_ROOT npm test --prefix /tmp/knowledge-mcp-control-20261031
env -u MFW_UMBRELLA_ROOT -u OPERATOR_ECOSYSTEM_ROOT npm run check --prefix /tmp/knowledge-mcp-control-20261031
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
EVAL_RUNTIME_ROOT=/tmp/knowledge-mcp-control-20261031 node eval/legacy.mjs docs/evaluation/legacy-before.json 9dc0ac6
```

Exit 0. The held-out before report was generated before any runtime change in the original worktree at `9dc0ac6`. Both sets and all counts are in [the evaluation report](README.md). The original `test/write-paths.test.js` and `test/_helpers.js` remain byte-for-byte unchanged from main.

Fresh candidate clone of `2b5bd7d`, outside the estate:

```sh
git clone --quiet --no-local . /tmp/knowledge-mcp-candidate-20261031
env -u MFW_UMBRELLA_ROOT -u OPERATOR_ECOSYSTEM_ROOT npm ci --prefix /tmp/knowledge-mcp-candidate-20261031
env -u MFW_UMBRELLA_ROOT -u OPERATOR_ECOSYSTEM_ROOT npm test --prefix /tmp/knowledge-mcp-candidate-20261031
env -u MFW_UMBRELLA_ROOT -u OPERATOR_ECOSYSTEM_ROOT npm run check --prefix /tmp/knowledge-mcp-candidate-20261031
```

All exited 0, with 97 passed, 0 failed and 0 skipped. Both fresh clone source trees remained clean. Raw outputs are committed in `evidence/`, including RED-first, focused GREEN, focused control, both full suites and fresh candidate. `KNOWLEDGE_WRITE_MODE=dry-run npm run check` also exited 0, with no seeded records or files. The final evidence-only commit changes no executable source or fixtures.

## Visual recording

The reference is the existing console demo and shared registry light-theme tokens, imported before rendering. Executed the four real MCP calls, generated the HTML from their actual transcript, then captured all four steps at 1440×900, 430×932 and 390×844. The recorder verifies Tab focus, Enter cycling, no horizontal overflow and a button measuring approximately 151×48 pixels. All checks passed. Desktop and both phone sizes were visually inspected. Phone pages scroll vertically to show the audit log.

```sh
node scripts/safety-demo.mjs --record
node scripts/render-safety-demo.mjs
PLAYWRIGHT_MODULE=/Volumes/HubData/work/worktrees/projects-site-case-context-screenshots/node_modules/playwright/index.mjs node scripts/record-safety-demo.mjs /Volumes/HubData/evidence/knowledge-mcp-upgrade
/tmp/knowledge-mcp-media-20261031/bin/python scripts/demo-gif.py /Volumes/HubData/evidence/knowledge-mcp-upgrade
```

Exit 0 for each. Recording tooling used an existing Playwright installation and a disposable Pillow environment. Neither is needed by the runtime or tests. The GIF has four frames, 11.6 seconds total, at 1440×1022 to include the complete audit entry. The viewport used for desktop review is 1440×900. The first PNG and complete GIF are in `docs/media/`.

## Remaining limits

The gate does not verify facts, decode instructions or authenticate provenance. Audit and data changes are not one atomic transaction. No live database or clinical workflow was exercised. See the README for the browser boundary, trust model and approval limitations. No merge, deployment, service reload, paid API or live migration was performed.
