# Synthetic safety recording

`safety-demo.gif` is a four-frame recording of the actual MCP transcript rendered in `safety-demo.html`. It is an animated screenshot sequence, not a video of a live model. Each frame is held for 2.6 or 3.2 seconds, for 11.6 seconds total. The replay is also usable with Tab and Enter. All four attempts run in independent runtimes. A human-review step is illustrated by a separate resubmission, not an implemented approval service.

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
