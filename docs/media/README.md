# Synthetic safety recording

> These recordings were made on 2026-10-31, before the 2026-11-03 change. They show the protocol draft held by a dry-run runtime. Today the gate itself holds it in the store hold queue, and `npm run demo:safety` prints the current outcomes. The images have not been re-recorded.

`safety-demo.gif` is a four-frame recording of the actual MCP transcript rendered in `safety-demo.html`. It is an animated screenshot sequence, not a video of a live model. Each frame is held for 2.6 or 3.2 seconds, for 11.6 seconds total. The replay is also usable with Tab and Enter. All four attempts run in independent runtimes. The four cases are a care-coordination note, blocked phone and MRN, a protocol draft held for pharmacist review and an injected fax instruction. The live console demonstrates approval resubmission and rejection. It does not authenticate reviewers or provide a durable approval service.

The repository had a programmatic browser helper and a console demo, with no existing screen to extend. The visual reference is the existing demo's accepted/refused flow. Light-theme tokens are imported from `madden-tokens` version 0.47.0, `src/ui/theme.js`, `resolveTheme('light')`, into the committed `theme.json` snapshot. The renderer reads that snapshot so ordinary clones need no sibling registry. Font stacks use local fallbacks, with no font download. Only presentation is added to the recorded runtime outcomes.

To reproduce, install Playwright and Pillow in your development environment, then run:

```sh
node scripts/safety-demo.mjs --record
node scripts/render-safety-demo.mjs
node scripts/record-safety-demo.mjs /absolute/path/to/evidence
python scripts/demo-gif.py /absolute/path/to/evidence
```

If Playwright is installed outside this project, set `PLAYWRIGHT_MODULE` to its `index.mjs` path. This is optional recording tooling, not a runtime dependency. The recorder checks each of four steps at 1440×900, 430×932 and 390×844, confirms keyboard cycling and a 48-pixel-high button, and rejects horizontal overflow. Phone screenshots show the complete page with normal vertical scrolling. The GIF pads desktop frames to a common height so the complete audit entry is visible.

The committed JSON contains the actual requests, MCP responses, audit entries and stored provenance used to generate the replay. It contains fictional addresses and instructions specifically constructed for this demo. The GIF and PNG can be reused in the portfolio with the same synthetic-data label and limits.

## Live write gate console

These assets capture `npm run console`, using real gate receipts and synthetic care-team inputs:

- `write-gate-light-1440x900.png` and `write-gate-light-390x844.png` are the requested light viewport captures
- `write-gate-light-430x932.png` covers the intermediate mobile size
- `write-gate-dark-*.png` capture all three viewports in dark mode
- `write-gate-flow.gif` shows empty state, allowed write, blocked write, held write, approval and fax/injection blocks

The console imports the light palette documented in `theme.json`, with system fonts and a corresponding dark palette. To reproduce browser checks and captures, install Playwright in your development environment and run `node scripts/record-console.mjs` while the console server is running. `PLAYWRIGHT_MODULE` can point to an existing Playwright ES module. The recorder does not ship as an application dependency.

After recording, `python3 scripts/console-gif.py` assembles the flow GIF from the five generated frame PNGs. This optional step requires Pillow. Individual frame PNGs are scratch capture output and need not be committed.

Public corpus screenshots use the existing console palette in `theme.json`. Run the console and then `PLAYWRIGHT_MODULE=<installed Playwright ES module> node scripts/record-public-corpus.mjs` to reproduce light and dark captures at 1440x900, 430x932 and 390x844. The recorder verifies keyboard submission, 44-point controls, collection switching, no horizontal overflow, empty results and recovery from a failed search.
