# Write gate console verification

## Scope and provenance

The console uses `buildRuntime`, the real records library and guarded store. Each attempted write produces an actual `write_allowed`, `screen_blocked` or `write_deferred` receipt. There are no prerecorded outcomes. The synthetic script has six inputs, including two review holds, a fictional email address, an untrusted source and an instruction injection.

A separate dry-run runtime screens held writes without committing. Approval submits the same input to the commit runtime, which screens it again. Reject records a console review event without writing a record. Duplicate resolution fails. Source and observed dates in the audit view are synthetic caller assertions joined to receipts by attempt ID. The underlying gate receipts remain value-free. Red-team replay works independently after the script completes.

The branch includes upgrade PR #1, commit `4eb9869`, as a dependency. The PR targets main. The library changes and earlier safety media in that dependency belong to PR #1. This change adds the working console and its evidence.

Repository tree and synonym searches found no existing console in main. Open PR review found only the upgrade PR before this PR was opened.

## RED then GREEN

The first `node --test test/console.test.js` exited 1 because `web/console/session.js` did not yet exist. See `evidence/red.txt`.

An additional RED test before implementing independent red-team replay failed with the assertion `red-team replay must run independently of the completed script`, actual `undefined`, expected `function`. See `evidence/red-replay.txt`. After implementation all three focused tests pass. They cover actual screening, provenance, no write on rejection, exactly one commit on approval, stale approval rejection, HTTP routes, cross-origin refusal and independent repeatable attacks.

The console test copied to untouched main fails to import the absent console module, as expected. See `evidence/focused-control.txt`. Main has no equivalent UI or session API.

## Control and fresh-clone parity

Exact toolchain versions, commands and exit codes are in `evidence/commands.json`. Both arms were fresh independent clones under `/tmp`, outside the estate. `MFW_UMBRELLA_ROOT` and `OPERATOR_ECOSYSTEM_ROOT` were unset. Candidate files were copied onto the dependency commit in the fresh candidate clone. Both used the same Node, npm and lockfile dependencies. No installation hooks were bypassed in the final comparison. Temporary clones were removed in `TemporaryDirectory` cleanup.

| Arm | Command | Exit | Result |
| --- | --- | --- | --- |
| Untouched origin/main | `npm ci` | 0 | Installed |
| Untouched origin/main | `npm test` | 0 | 91 passed |
| Untouched origin/main | `npm run check` | 0 | Startup check passed |
| Fresh candidate | `npm ci` | 0 | Installed |
| Fresh candidate | `npm test` | 0 | 100 passed |
| Fresh candidate | `npm run check` | 0 | Startup check passed |
| Fresh candidate | `node --test test/console.test.js` | 0 | 3 passed |
| Fresh candidate | `npm run eval:heldout` | 0 | Existing safety evaluation completed |

Baseline full-gate failures: none. Candidate-only full-gate failures: none. No tests skipped. The extra candidate tests include six inherited upgrade tests and three console tests. Logs are under `evidence/control-*` and `evidence/fresh-candidate-*`.

## Browser verification

Command: `PLAYWRIGHT_MODULE=<installed Playwright ES module> node scripts/record-console.mjs`, exit 0. The optional recorder uses an already installed Playwright and Chromium. Neither is needed to run the app.

Light tokens come from the existing `docs/media/theme.json`, sourced from madden-tokens 0.47.0. The current upgrade screen was the visual reference. The console uses system fonts, a corresponding dark palette and no external font requests.

The browser run verifies 1440x900, 430x932 and 390x844. It exercises empty state, stepwise writes, approval, rejection, independent red-team replay, keyboard tab navigation, dark mode, simulated HTTP failure, reconnect and delayed-response loading state. All visible buttons meet the 44-point target check. The document has no horizontal overflow. The audit table scrolls within its panel on mobile. Browser subpixel measurements allow 0.01 CSS pixel rounding tolerance. See `evidence/browser.json`.

The initial mobile target check caught the theme button below 44 pixels. A minimum width fixed it. Light and dark captures at all three sizes were rendered and visually inspected. The fixed-size mobile capture shows the top of the page, with the approval queue and audit below the fold. The short GIF captures the actual empty, allowed, blocked, held and approved flow.

## Limits

One synthetic in-memory session is shared across browser tabs on this loopback server. State disappears on reset or restart. This console is a local demonstration with no authentication, durable approvals or multi-user coordination. Rule coverage is the real library's existing coverage, not a guarantee against every injection. Console routing does not extend the gate policy.

No service was deployed or reloaded and no PR was merged.

Captured text logs have trailing whitespace removed for a clean diff. No result or assertion was changed.
