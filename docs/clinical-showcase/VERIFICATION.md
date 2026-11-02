# Verification record

Date: 2026-11-01. Base: origin/main `9c19d0ba1d86eedffe090b9086389400e4405dbf`. Node v24.14.1, npm 11.11.0. Both control and candidate used `npm ci` against the unchanged package-lock.json and the same synthetic fixtures. No gate, config, evaluation data, public contract or dependency changed.

Selected text evidence is copied beside this file for PR inspection, with trailing whitespace removed. Original logs, full viewport and full-page images, replay captures, original RED output and recording checks were kept in a local evidence directory outside the repository.

## RED then GREEN

Before implementation:

```sh
node --test test/clinical-showcase.test.js
```

Exit 1, two failures. The first assertion expected `/care.coordination/i` and received `The fictional Atlas team ships a reviewed draft every Friday.` The second expected a named care coordinator in the HTML. The same new test replayed against untouched base also exits 1. After implementation, the clinical case, existing console and safety-flow tests pass, including both identifier rules, blocked fax, held provenance and single approval resubmission.

## Control and candidate commands

Control is a fresh clone outside the estate at `/private/tmp/knowledge-clinical-control`, detached at the exact base SHA. Candidate is another fresh clone at `/private/tmp/knowledge-clinical-candidate`, detached at that SHA with the candidate diff and new clinical test applied. Both temporary clones are deleted after preserving evidence.

Run in each clone:

```sh
unset MFW_UMBRELLA_ROOT OPERATOR_ECOSYSTEM_ROOT
npm ci
node --test test/console.test.js test/safety-flow.test.js
npm test
npm run check
npm run eval:heldout
```

Candidate focused verification additionally includes `test/clinical-showcase.test.js`. All final commands exit 0. Control full suite: 100 passed, zero failed. Candidate full suite: 102 passed, zero failed. No baseline or candidate-only test failures remain. Held-out output is identical: 60 cases, 35 blocked, 25 allowed, five false blocks, ten misses. These are unchanged deterministic-control results, not clinical accuracy.

An initial control setup selected the canonical clone's stale local main at 9dc0ac6. Its focused command and held-out command exited 1 because those files and script did not exist there. That was a setup error, not a baseline result. The clone was moved to the fetched SHA above, dependencies reinstalled, and all control commands rerun successfully.

## Rendered and inspected

Anchors were the existing light desktop screenshot, `docs/media/theme.json` and console stylesheet. Existing palette and layout are retained. New visual styling uses existing CSS variables.

```sh
node scripts/safety-demo.mjs --record
node scripts/render-safety-demo.mjs
EVIDENCE_HOME=<evidence directory> PLAYWRIGHT_MODULE=<installed Playwright ES module> node scripts/record-console.mjs
PLAYWRIGHT_MODULE=<installed Playwright ES module> node scripts/record-safety-demo.mjs <evidence directory>/replay
/private/tmp/knowledge-clinical-media/bin/python scripts/console-gif.py
/private/tmp/knowledge-clinical-media/bin/python scripts/demo-gif.py <evidence directory>/replay
```

All final recording commands exit 0. Pillow was installed in a disposable local venv solely to assemble screenshots. Playwright used an existing installed browser dependency, no runtime sibling dependency was added. Scripts work with a normal Playwright installation via the default module name.

Six viewport screenshots cover light and dark at 1440x900, 430x932 and 390x844. Browser checks show no horizontal document overflow or undersized visible buttons. Approval is activated with keyboard Enter. Rejection, arrow-key tabs, empty state, loading, error and reconnect are exercised. Both GIFs are regenerated. The console GIF adds a final fax/injection view. Full-page captures preserve mobile review cards and provenance below the fold.

A recording assertion initially expected the exact single rule `untrusted-source`. The new fax correctly returns that rule plus `instruction-override`. The recorder now waits for the actual combined receipt. Visual inspection also found a dark screenshot taken before request completion, corrected by waiting for the settled state. A subsequent capture exposed a detached button during rerender. The recorder now waits until red-team replay settles before measuring targets. These recording failures did not require gate changes.

## Scope and preflight

Fetched origin/main and inspected its complete tree plus function and synonym searches for Atlas, safety demo, write gate and clinical. Checked open repository PRs and local worktrees. Prior showcase and evaluation work is already represented in base 9c19d0b. No open PR or separate active clinical-scenario implementation was found.

Final checks:

```sh
git diff --check
git diff --quiet origin/main -- src config eval package.json package-lock.json
```

Both exit 0. No merge, force push, hook bypass, deployment, service reload, paid API, PHI or external message was used. The assessment describes unimplemented clinical and production capabilities rather than implying they were validated.
