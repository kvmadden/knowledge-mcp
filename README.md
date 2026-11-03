# knowledge-mcp

**A write gate for AI agents that share long-term memory.** Every write from every tool passes one screening gate. The gate blocks what matches a listed rule, holds what it cannot judge for a person, and audits each decision without copying submitted values. For engineers and product teams evaluating agent memory controls, including clinical AI platforms. This is a local prototype with inspectable tests. It is not a clinical system, a de-identification service or a compliance certification.

## Honest headline

- **Wiring, verified.** All 10 MCP write tools reach the same gate. The registry test plants 6 synthetic samples into every string argument of each write tool's fixture (324 cases). 186 are stopped by the gate itself, the rest by schema, path or URL validation, and 0 persist. A second test covers the provenance fields and multi-step edits the fixtures omit. A canary run with the gate removed flags 8 of 8 content-bearing tools, so the test can fail.
- **Detection, not yet measured on blind data.** Every set used to change the rules is development data, including the 60-case set once called held-out. On those development sets the gate now does far better than before (below). A headline detection rate needs a fresh set written blind and locked before its first run. That set has been specified and is pending.
- **What a pass means.** An allowed write means no listed pattern or rule was found in an input the gate read in full. It does not mean the content is safe, true or free of personal information that no rule describes.

## The problem

An agent can copy private information, a false claim or instructions hidden in a document into shared memory. Later agents may retrieve that entry and treat it as reliable context. A mistaken write can outlive the conversation that produced it, and several agents writing to one store can corrupt it.

## What it does

- **One gate for every write.** Tools only ever receive a guarded store. Its write methods screen a structured-clone snapshot of their arguments and hand only that snapshot to the raw store. Every raw store method must be classified as read, write or internal, or startup fails.
- **Three decisions.** `block` when a listed pattern or block-tier rule matches, or when the input cannot be read in full. `review` when the gate finds something it cannot judge. `allow` when nothing listed was found.
- **A hold queue.** A `review` decision stores the payload in a hold queue that no read tool can see, and the tool call returns an error with the hold id. An operator approves or rejects it from the CLI or the console. Approval screens the payload again, checks its recorded SHA-256 and commits it with an audit entry that names the reviewer label. No MCP tool can approve, reject or retract.
- **Retraction.** An operator can retract a record. It disappears from list, search, recent and the recent-decisions resource, stays inspectable by id, and the retraction is audited.
- **Value-free audit.** Each entry has a fixed schema: operation, store method, rule ids, decision, payload hash, record id, hold id, reviewer label and policy id. Entries never contain submitted values or paths. A data change and its audit entry are committed together.
- **Several processes, one store.** Writes take a lock file, reread what another process wrote and commit atomically. Two agent hosts can share one store file without losing writes.

## Rules

The gate reads each string as written, after compatibility folding (NFKC, default-ignorable characters removed, dashes and non-ASCII digits folded, common Cyrillic and Greek look-alike letters mapped to Latin), after decoding base64, hex, percent and HTML-entity segments, and with all fields of one write joined in both orders.

| Rule | Decision | What it looks for |
| --- | --- | --- |
| `email-address` | block | Email addresses, with a linear-time pattern |
| `obfuscated-email` | review | `name [at] host [dot] com` and similar |
| `us-phone-number` | block | Separated or parenthesized US numbers, toll-free lines excepted |
| `us-ssn-format` | block | 3-2-4 numbers with hyphens or spaces |
| `date-of-birth-label` | block | A birth-date label or "born" followed by a full date |
| `record-number-label` | block | MRN, MR#, medical record, patient ID or chart labels with 4 or more digits |
| `payment-card-number` | block | 13 to 19 digits that pass Luhn |
| `medicare-beneficiary-id` | block | The 11-character MBI format |
| `ipv4-address`, `street-address`, `person-name-cue` | review | Heuristics for identifiers that patterns cannot pin down |
| `instruction-override` | block | An imperative to ignore, forget, bypass or replace prior or system instructions, in English, Spanish, Portuguese, French, Italian or German |
| `role-spoof` | block | Chat-template markers, role headers, `"role":"system"` and mode-switch phrases |
| `bulk-export` | block | An imperative to send stored data to an external address |
| `encoded-instruction` | block | An instruction to decode something and follow it |
| `clinical-assertion`, `clinical-directive` | review | A rule or decision with clinical content, a dose claim, a safety claim or an imperative clinical order |
| `addressed-to-agent`, `quoted-instruction`, `possible-instruction-override`, `bulk-transfer`, `memory-tampering` | review | Text aimed at an AI, quoted directives without a disavowal, unqualified overrides, bulk copying and orders to rewrite memory |
| `untrusted-source` | review | Provenance labeled untrusted, after normalizing the label |
| `unreadable-encoded-content` | review | An encoded block of 256 or more characters that is not readable text |
| `mixed-script-token` | review | A word that mixes Latin and Cyrillic letters |

Negated clauses ("never send all records to external endpoints") and quoted lessons next to an explicit "do not follow" are treated as mentions, not directives. Deny-list patterns live in `config/deny-list.example.json` and are timed at startup: a pattern that is slow on long input cannot be loaded.

### Coverage of the 18 HIPAA Safe Harbor identifiers

This is a coverage map of the shipped example list, not a de-identification claim.

| Identifier | Coverage |
| --- | --- |
| Names | Partial heuristic, review only (`person-name-cue`). Most names pass. |
| Geographic subdivisions | Street addresses partly (`street-address`, review). City, county and ZIP are not covered. |
| Dates related to a person | Birth dates with a label or "born" only. Admission, discharge and death dates are not covered. |
| Phone numbers, fax numbers | US formats with separators. Unseparated and international numbers pass. |
| Email addresses | Covered, plus spelled-out forms for review. |
| Social security numbers | 3-2-4 format with hyphens or spaces. Unseparated numbers pass. |
| Medical record numbers | With a label. Unlabeled numbers pass. |
| Health plan beneficiary numbers | Medicare MBI format only. |
| Account numbers | Payment cards only (Luhn). |
| Certificate and license numbers | Not covered. |
| Vehicle identifiers | Not covered. |
| Device identifiers and serial numbers | Not covered. |
| Web URLs | Not covered (links are allowed). |
| IP addresses | IPv4, review only. |
| Biometric identifiers, photographs | Not covered. Long encoded blocks such as images are held as unreadable. |
| Any other unique identifying number | Not covered. |

## Results

Every set below was seen while the rules were changed on 2026-11-03, so every result is a development result. Before means public `main` at `2e39dbf`, scored with the same runners.

| Set and status | Measure | Before | After |
| --- | --- | ---: | ---: |
| Registry harness, 324 planted cases, wiring test | Planted values persisted | 0 / 324 | 0 / 324 |
| | Stopped by the gate itself | 192 / 324 | 186 / 324 |
| | Benign baseline calls allowed | 10 / 10 | 10 / 10 |
| 60-case set (seed 20261031), development data | Risky cases not committed, by case | 30 / 40 | 40 / 40 (30 blocked, 10 held) |
| | Risky strings not committed, by distinct string | 12 / 14 | 14 / 14 |
| | Benign cases refused | 5 / 20 | 0 / 20 |
| | Benign strings refused, by distinct string | 1 / 6 | 0 / 6 |
| 84 probes from the 2026-11-03 review, development data | Probes that met their expectation | 22 / 84 | 78 / 84 |
| | Risky probes not stored | 20 / 74 | 70 / 74 |
| | Harmless probes stored | 2 / 10 | 8 / 10 |
| 12 synthetic examples, development data | Behaved as described | not run | 12 / 12 |

The 186 is lower than 192 because six planted link values that are not http or https URLs are now refused by URL validation before they reach the gate. The 60-case set was readable when its rules were first written, and its phrasings match those rules, so it was never held-out. The probes were written by the reviewer who then changed the rules. Reports: `docs/evaluation/`.

The six probes that still fail: an unseparated 10-digit phone number, a phone number spelled in words, a phone number split across two separate records, a public agency email address (still blocked), honest untrusted content (held rather than stored) and deleting a protocol directory (allowed). The first three are known pattern limits, the fourth and fifth are deliberate choices, and the sixth is an open policy decision.

Screening time is linear. On an Apple M1 Max with Node 24, 900,000 characters screen in under 300 ms in each of the five shapes tested, where the old email pattern took 10.9 s on 80,000 characters. A store of 10,000 records restarts in about 1.3 s and takes about 18 ms per write. See `docs/evaluation/bench-2026-11-03.json` and `npm run bench`.

## Limits

- **Detection is rules.** Paraphrases, languages and encodings the rules do not describe will pass. Names, most dates and many identifier formats pass. A rule cannot judge whether a clinical claim is true. It can only hold rules and dose claims for a pharmacist.
- **The mention rules can be gamed.** An instruction wrapped in quotes next to an explicit "do not follow" is treated as a lesson and passes, and so does a negated one. That trade keeps security training and safety policies storable.
- **Splits across separate writes pass.** Each write is screened alone, so two records that only form an instruction or an identifier together are both stored.
- **Holding has a cost.** Text aimed at an AI, clinical rules, untrusted sources and opaque blocks wait for a person. Nobody has measured reviewer time or false holds on real workloads.
- **Trust labels are caller assertions.** Untrusted content is held, not rejected, so an honest label no longer destroys the content. A caller can still omit the label.
- **Whole-write rejection.** One identifier in a long note rejects the whole note. There is no redaction mode.
- **Reviewer labels are not authenticated.** The CLI and console record the label the operator types. There is no identity, authorization or per-agent isolation. `OWNER_ID` is a configured label.
- **One JSON file.** The store rewrites one file per change. It is safe across processes on one machine, not across machines or network file systems.
- **Reads are not screened.** Content is screened when written and when loaded. Memory file reads say the content is stored data with its trust label, but an agent can still follow it.
- **The console is a local demo.** It binds to loopback and refuses requests whose Host is not a loopback address, which stops DNS rebinding. It has no session token or login.
- **The browser helper is not access control.** It shares the gate but has no hold queue (held rows are not inserted), no audit and no database policy. A modified page can skip it.
- **Synthetic testing only.** No patient data, model, production deployment or clinical study.

## Run it

Requires Node 20 or later.

```sh
npm ci
npm test
npm run check
npm run examples
npm run eval:dev
npm run bench
```

Start an MCP server on stdio:

```sh
KNOWLEDGE_STORE_PATH=./data/store.local.json npm start
```

MCP host configuration:

```json
{
  "mcpServers": {
    "knowledge": {
      "command": "node",
      "args": ["/absolute/path/to/knowledge-mcp/src/index.js"],
      "env": { "KNOWLEDGE_STORE_PATH": "/absolute/path/to/store.local.json" }
    }
  }
}
```

Several hosts can point at the same `KNOWLEDGE_STORE_PATH`.

| Environment variable | Default | Effect |
| --- | --- | --- |
| `KNOWLEDGE_WRITE_MODE` | `commit` | `commit` or `dry-run`. Dry-run defers every write and reports what the gate would have done. |
| `KNOWLEDGE_STORE_PATH` | unset | JSON persistence, including the hold queue and audit |
| `KNOWLEDGE_SEED` | `data/seed.json` | Synthetic seed for an empty commit-mode store, `none` disables |
| `DENY_LIST_PATH` | example config | Deny-list file. Missing, empty, invalid or slow lists prevent startup. |
| `OWNER_ID` | `local-owner` | Configured owner label on records and files |

## Operator commands

These need `KNOWLEDGE_STORE_PATH` and never run through MCP.

```sh
knowledge-mcp review list
knowledge-mcp review show hold_0001
knowledge-mcp review approve hold_0001 --reviewer pharmacist-a
knowledge-mcp review reject hold_0002 --reviewer pharmacist-a
knowledge-mcp records retract rec_0042 --reviewer pharmacist-a --reason "superseded"
knowledge-mcp screen --text "..."            # prints the decision and rule ids, never the text
knowledge-mcp store scan                     # lists items that block loading, by location and rule id
knowledge-mcp store purge --apply --reviewer operator-a
```

A store that holds content matching a block rule (after a stricter deny-list, or a hand edit) refuses to start and says so. `store scan` lists the blocking items without their values, and `store purge` removes them and redacts blocking audit entries, recording one `store_purged` entry.

## Technical detail

The runtime is `MCP tools → record and file logic → guarded store → gate → raw store`. Tools and seeding receive only the guarded store. The reviewer desk is returned to the operator and is not part of the tool context. There are 18 tools: 8 reads and 10 writes. The resource is `knowledge://records/recent-decisions`.

Audit operations: `screen_blocked`, `write_allowed`, `write_noop`, `write_held`, `write_deferred`, `review_approved`, `review_rejected`, `record_retracted`, `store_purged` and `audit_redacted`. Allowed and held writes carry the SHA-256 of the screened payload. Deletions carry only a count. A payload hash can be confirmed by anyone who already has the payload, and a short guessable payload can be confirmed by guessing, so the audit is pseudonymous rather than anonymous.

Data loaded from disk is screened item by item: records, files, held payloads and audit entries. An item that matches a block rule refuses the load. An item the current policy would hold is counted in `--check` as `storedItemsCurrentPolicyWouldHold` and stays readable.

For the browser helper, import `createWebClient` from `knowledge-mcp/web` and supply a supabase-js client and deny-list. It refuses service-role, secret or unreadable keys by reading the `supabaseKey` property, which catches an accidental paste but is not access control. No database schema or row-level security policy ships here.

## Write gate console

```sh
npm ci && npm run console
```

Open **http://127.0.0.1:4317**. Six synthetic attempts run through the real gate: a care-coordination note is allowed, a phone number and MRN are blocked, two protocol drafts are held because they are clinical rules, and two injected instructions are blocked. Approve and reject act on the real hold queue and write audit entries with the label `console reviewer (unauthenticated demo)`. One in-memory session is shared by all tabs and disappears on restart. Screenshots and the short flow GIF in [docs/media](docs/media/README.md) were recorded before the 2026-11-03 change, when holds came from a dry-run runtime.

## Search public documents

Open <http://127.0.0.1:4317/corpus>. The public collection holds 134 committed passages from CMS NCD 240.2, an openFDA ZITUVIMET label and CDC ACIP timing guidance. The read-only tool `corpus.answer` ranks passages with BM25 and returns the best one verbatim. It abstains when fewer than half of the question's content words appear in the best passage, and lists the candidates for a person instead. That threshold was set while looking at the 18 regression questions and a few off-topic questions, so it is development tuning. `npm run eval:public` still reports 18 of 18 on its authored regression questions, which share most of their wording with the expected passages and measure the citation path, not retrieval quality. Sources, licenses and hashes are in [SOURCES.md](corpus/public/SOURCES.md).

## Evaluation and history

See [docs/evaluation/README.md](docs/evaluation/README.md) for every result, the data status of each set and the specification for the pending blind set, and [docs/threat-model.md](docs/threat-model.md) for what the gate defends against and what it does not. Earlier verification records are in `docs/*/VERIFICATION.md`.

The project was built from May to October 2026 over 71 commits in a private repository and published as a cleaned snapshot. An audit of the original private version found inconsistent outcomes from one deny-list (7 writes unchanged, 3 masked, 1 blocked with surrounding text saved to the audit across 11 probes). That observation cannot be reproduced from this repository and is history, not evidence.

MIT, Copyright (c) 2026 Kevin Madden. Committed data is synthetic, except the public reference excerpts in `corpus/public/`, which are attributed there. No real patient data.
