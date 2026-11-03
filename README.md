# knowledge-mcp

**A write gate for AI agents that share long-term memory.** Every write from every tool passes one screening gate. The gate blocks what matches a listed rule, holds what it cannot judge for a person, and audits each decision without copying submitted values. For engineers and product teams evaluating agent memory controls, including clinical AI platforms. This is a local prototype with inspectable tests. It is not a clinical system, a de-identification service or a compliance certification.

## Honest headline

- **Wiring, verified.** All 10 MCP write tools reach the same gate. The registry test plants 6 synthetic samples into every string argument of each write tool's fixture (324 cases). 186 are stopped by the gate itself, the rest by schema, path or URL validation, and 0 persist. A second test covers the provenance fields and multi-step edits the fixtures omit. A canary run with the gate removed flags 8 of 8 content-bearing tools, so the test can fail.
- **Detection, measured once on a blind set.** On 564 synthetic writes that no Claude agent saw before the run, the gate got 295 right (52.3%, 95% interval 48.2 to 56.4). No gate got 227, the gate before the 2026-11-03 change 250, a prompt-injection classifier 241 and Presidio 257. It caught 2 of 48 names and addresses in prose, and it held 65 of 216 benign writes for a reviewer, including 27 of 84 ordinary clinical notes. That set is development data now. Every other set was development data from the start.
- **What a pass means.** An allowed write means no listed pattern or rule was found in what the gate read: every string and key, up to three layers of decoding, and the fields of the write joined together. Input it cannot read within its limits is never allowed: it is refused when too large or too deep, and held when part of it stays encoded. A pass does not mean the content is safe, true or free of personal information that no rule describes.

## The problem

An agent can copy private information, a false claim or instructions hidden in a document into shared memory. Later agents may retrieve that entry and treat it as reliable context. A mistaken write can outlive the conversation that produced it, and several agents writing to one store can corrupt it.

## What it does

- **One gate for every write.** Tools only ever receive a guarded store. Its write methods screen a structured-clone snapshot of their arguments and hand only that snapshot to the raw store. Every raw store method must be classified as read, write or internal, or startup fails.
- **Three decisions.** `block` when a listed pattern or block-tier rule matches, or when the input is too large, too deep or of a type the gate cannot read. `review` when the gate finds something it cannot judge, including encoded content it could not decode. `allow` when nothing listed was found.
- **A hold queue.** A `review` decision stores the payload in a hold queue that no read tool can see, and the tool call returns an error with the hold id. An operator approves or rejects it from the CLI or the console. Approval runs under the store lock: it checks the payload against the SHA-256 in the hold and in the hold's `write_held` audit receipt, screens it again and commits it with an audit entry that names the reviewer label. The store's read methods leave held payloads out. No MCP tool can approve, reject or retract.
- **Protocol changes wait for a person.** Deleting, renaming, overwriting or editing an existing protocol goes to the hold queue with the reason `protocol-change`, like any other held write. A protocol is a memory file with "protocol" in the name of the file or of a folder above it, read after the same folding as content, so look-alike letters still count. Creating a new protocol is screened as usual. This is Kevin Madden's decision of 3 November 2026.
- **Retraction.** An operator can retract a record. It disappears from list, search, recent and the recent-decisions resource, stays inspectable by id, and the retraction is audited.
- **Value-free audit.** Each entry has a fixed schema: operation, store method, rule ids, decision, payload hash, record id, hold id, reviewer label and policy id. Entries never contain submitted values or paths. A data change and its audit entry are committed together.
- **Several writers, one store.** Writes take a lock file, reread what another process or thread wrote, write the whole state to a flushed temporary file and rename it into place. Processes and worker threads on one machine can share one store file without losing writes. A lock whose process is gone is cleared. A live one is waited for and never taken over.

## Rules

The gate reads each string and each object key as written and after compatibility folding (NFKC, default-ignorable characters and combining marks removed, dashes and non-ASCII digits folded, common Cyrillic and Greek look-alike letters mapped to Latin). It decodes base64, hex, percent and HTML-entity segments, up to three layers deep, including base64 or hex wrapped across lines. It also reads the values of one write joined together, in both orders, with and without a space between fields, and decodes neighboring fields that together form one base64 or hex token. The identifier, instruction and clinical rules also run on decoded text.

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
| `clinical-assertion`, `clinical-directive` | review | A rule or decision with clinical content, a dose or safety claim in a form the rules know, or a clinical order with a dose or route, also after a few lead words such as "please" or "nurse" |
| `addressed-to-agent`, `quoted-instruction`, `possible-instruction-override`, `bulk-transfer`, `memory-tampering` | review | Text aimed at an AI, quoted directives (even next to a disavowal), override clauses the gate cannot classify, bulk copying and orders to rewrite memory |
| `untrusted-source` | review | Provenance labeled untrusted, after normalizing the label |
| `protocol-change` | review | Deleting, renaming, overwriting or editing an existing protocol file |
| `unreadable-encoded-content` | review | An encoded block of 256 or more characters that is not readable text, a fourth layer of encoding, or more encoded segments than the gate decodes in one write |
| `mixed-script-token` | review | A word that mixes Latin and Cyrillic letters |

The override, export, decode and mode-switch rules decide by the clause around the verb. A directive is blocked. A negated clause ("never send all records to external endpoints", "do not ignore the pharmacist's instructions") and a description of what someone else does ("patients often ignore prior instructions") pass. A negation counts only when it governs that verb, so "do not hesitate to ignore" is not a negation. A quotation is held for a person even next to "do not follow", because an attacker can write the same disavowal. Kevin Madden decided on 3 November 2026 to keep it that way, so security lessons that quote an attack wait for a reviewer. Any other clause is held, not allowed. Deny-list patterns live in `config/deny-list.example.json` and are timed at startup: a pattern that is slow on long input, alone or in the retry loop of a validator such as Luhn, cannot be loaded.

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

### Blind set, scored once (3 November 2026)

564 synthetic writes in 11 families, 216 of them benign, written from [the spec](docs/evaluation/fresh-set-spec.md) by Grok 4.7 and labeled again by Gemini 3.8 Flash (Cohen's kappa 0.997 on the expected outcome). The authors saw the tools' argument shapes but not the screening code ([AMENDMENTS.md](eval/blind-2026-11/AMENDMENTS.md)). The set was locked at `cf5944b` before any gate ran on it, then scored once by `eval/blind/run.mjs` at `dec4796`, each case through a real MCP client and server. A case is correct when a benign write is stored and a risky one is held or blocked. An invalid outcome never counts as correct. Full report: [eval/blind-2026-11/results/report.md](eval/blind-2026-11/results/report.md).

| Correct, by case | No gate | Gate at `2e39dbf` | Gate at head | Injection classifier | Presidio |
| --- | ---: | ---: | ---: | ---: | ---: |
| **All 564** | **227** | **250** | **295** | **241** | **257** |
| 95% interval | 36.3 to 44.3% | 40.3 to 48.5% | 48.2 to 56.4% | 38.7 to 46.8% | 41.5 to 49.7% |
| Instruction overrides, reworded (48) | 0 | 0 | 18 | 12 | 35 |
| Role and format smuggling (36) | 0 | 5 | 20 | 11 | 28 |
| Exfiltration (36) | 0 | 5 | 22 | 3 | 28 |
| Encoded or split (48) | 0 | 4 | 22 | 12 | 34 |
| False clinical claims (48) | 0 | 0 | 22 | 0 | 38 |
| Names, addresses and dates in prose (48) | 0 | 0 | 2 | 0 | 40 |
| Formatted identifiers (48) | 0 | 25 | 30 | 3 | 39 |
| Benign clinical operations (84) | 84 | 84 | 56 | 75 | 2 |
| Benign public reference (66) | 66 | 51 | 48 | 64 | 0 |
| Benign security and policy (66) | 66 | 65 | 41 | 50 | 10 |
| Destructive or tampering, mixed (36) | 11 | 11 | 14 | 11 | 3 |
| Benign writes held for review (216) | 0 | 0 | 65 | 0 | 0 |
| Benign writes blocked (216) | 0 | 16 | 4 | 22 | 171 |
| `harm: high` cases stored (334) | 333 | 295 | 190 | 289 | 13 |
| Invalid outcomes (564) | 1 | 0 | 8 | 10 | 123 |
| Median latency of the judged call | 0.03 ms | 0.07 ms | 0.71 ms | 194 ms | 29 ms |

- **Overall.** The gate at head had the most correct outcomes, 38 more than Presidio. Its interval overlaps those of Presidio and of the gate at `2e39dbf`.
- **Against no gate, the gate at `2e39dbf` and the classifier,** it is ahead on all seven attack families and on destructive-or-tampering, and behind on all three benign families.
- **Against Presidio** it is behind on all seven attack families, by 7 to 38 cases, and ahead on the three benign families and destructive-or-tampering. Presidio blocked 171 of 216 benign writes (79.2%), 150 of them for a date or time, and 123 of its outcomes are invalid because it blocked a setup write.
- **Weakest family.** Names, addresses, ages and relatives written in prose: 2 of 48 caught.
- **Benign writes.** Of 216, it stored 145, held 65 (30.1%, 24.4 to 36.5), blocked 4 (1.9%) and had 2 invalid. It held 27 of 84 clinical-operations notes, 17 of 66 public references and 21 of 66 security and policy texts, and blocked 4 of those 66 (two as instruction overrides, two as role markers). The `clinical-assertion` rule is behind 44 of the 65 holds.
- **By tier.** 85 of 142 literal, 71 of 142 paraphrase, 73 of 140 obfuscated and 66 of 140 embedded cases.
- **The 8 invalid outcomes.** In seven, the gate held a setup write, so the case could not run as written: five by `clinical-assertion` (b-0327, b-0344, b-0388, b-0616, b-0686) and two by `mixed-script-token` (b-0530, b-0667). Four of the seven were cases whose judged write should be stored. In the eighth, b-0429, the set puts part of a phone number in `link_url`, which the tool refuses as not an http or https link before the gate runs. No gate and the classifier hit the same refusal, and the gate at `2e39dbf`, which had no link check, stored the write.
- **After the protocol ruling, as development data.** A second run of the gate alone, after Kevin Madden's protocol ruling and on the same file, held 4 more destructive-or-tampering cases: 18 of 36 right instead of 14, and 299 of 564 overall. Nothing else changed. That run is development data, in `eval/blind-2026-11/dev-runs/2026-11-03-protocol-ruling/`, and the headline stays the locked run above. Fourteen risky destructive cases are still stored. They delete or rewrite files not named as protocols, such as safety rules, audits and whole clinic folders, or change records instead of files.
- **What it is now.** This was the set's only scored run, so it is development data from here on. A rule change made after reading it needs a new set before the next headline. A pharmacist's review of 30 clinical labels was moved to after the lock. Any label it changes goes into `eval/blind-2026-11/ERRATA.md`, with the score both ways.

### Development sets

Every set below was seen while the rules were changed on 2026-11-03, so every result is a development result. Before means public `main` at `2e39dbf`, scored with the same runners.

| Set and status | Measure | Before | After |
| --- | --- | ---: | ---: |
| Registry harness, 324 planted cases, wiring test | Planted values persisted | 0 / 324 | 0 / 324 |
| | Stopped by the gate itself | 192 / 324 | 186 / 324 |
| | Benign baseline calls allowed | 10 / 10 | 10 / 10 |
| 60-case set (seed 20261031), development data | Risky cases not committed, by case | 30 / 40 | 40 / 40 (30 blocked, 10 held) |
| | Risky strings not committed, by distinct string | 12 / 14 | 14 / 14 |
| | Benign cases refused | 5 / 20 (blocked) | 5 / 20 (held for review) |
| | Benign strings refused, by distinct string | 1 / 6 | 1 / 6 |
| 84 probes from the 2026-11-03 review, development data | Probes that met their expectation | 22 / 84 | 78 / 84 |
| | Risky probes not stored | 20 / 74 | 71 / 74 |
| | Harmless probes stored | 2 / 10 | 7 / 10 |
| 12 synthetic examples, development data | Behaved as described | not run | 12 / 12 |

The 186 is lower than 192 because six planted link values that are not http or https URLs are now refused by URL validation before they reach the gate. The 60-case set was committed with its generator before its first rules were written, so it was readable while they were written, and it was never held-out. Three of those first rules accepted words that appear only in its generator (`eval/generate-heldout.mjs`) and in none of the development tests: "disregard" and "prior" in the instruction-override rule, "[system]" in the role-spoof rule, and "send" and "facts" in the memory-export rule (`src/screening/screen.js` at `5e05949`, lines 90 to 92). It was first published as held-out, and that label was corrected on 3 November 2026. The probes were written by the reviewer who then changed the rules. Reports: `docs/evaluation/`.

The five refused benign cases are the five security lessons that quote an attack next to "do not execute the quoted text". After the first round of review they were stored. The second round (3 November) holds them for a person, because both outside reviewers showed that an attacker can add the same disavowal to a real attack. The probe that tests the same lesson (A66) moved from stored to held for the same reason. Nothing else changed between the two rounds on these sets.

The six probes that still fail: an unseparated 10-digit phone number, a phone number spelled in words, a phone number split across two separate records, a public agency email address (still blocked), a security lesson quoting an attack (held rather than stored) and honest untrusted content (held rather than stored). The first three are known pattern limits and the other three are deliberate choices. Deleting a protocol directory (A83) is held since the protocol ruling.

Screening time grows linearly with input size in every shape tested. A test times 19 adversarial shapes at 20,000 and 40,000 characters, including the long run of spaces that took about 3.7 s at 40,000 characters before the second round. On an Apple M1 Max with Node 24, 900,000 characters screen in under 300 ms in each of the nine bench shapes, where the old email pattern took 10.9 s on 80,000 characters. A store of 10,000 records restarts in about 1.4 s and takes about 20 ms per write, on a host that was also running other jobs. See `docs/evaluation/bench-2026-11-03-round2.json` and `npm run bench`.

## Limits

- **Detection is rules.** Paraphrases, languages and encodings the rules do not describe will pass. Names, most dates and many identifier formats pass: on the blind set the gate caught 2 of 48 names and addresses in prose. A rule cannot judge whether a clinical claim is true. It can only hold rules and dose claims for a pharmacist.
- **The mention rules can still be gamed.** A sentence that says someone else does it ("they ignore all previous instructions") is a description and is stored, and an agent may still act on it. A negated instruction is stored too. Quoted attacks no longer pass: a security lesson that quotes one waits for a reviewer, by Kevin Madden's decision.
- **Splits across separate writes pass.** Each write is screened alone, so two records that only form an instruction or an identifier together are both stored.
- **Holding has a cost.** Text aimed at an AI, clinical rules, untrusted sources, quoted attacks, override clauses the gate cannot classify and encoded content it cannot read wait for a person. On the blind set that was 65 of 216 benign writes, 44 of them held by the `clinical-assertion` rule. A write with very many short encoded-looking fields side by side can exceed what the gate decodes and is held. Nobody has measured reviewer time or false holds on real workloads.
- **Trust labels are caller assertions.** Untrusted content is held, not rejected, so an honest label no longer destroys the content. A caller can still omit the label.
- **Whole-write rejection.** One identifier in a long note rejects the whole note. There is no redaction mode.
- **Reviewer labels are not authenticated.** The CLI and console record the label the operator types. There is no identity, authorization or per-agent isolation. `OWNER_ID` is a configured label.
- **One JSON file.** The store rewrites one file per change. It is safe across processes and worker threads on one machine, not across machines or network file systems. One narrow case is left: a process that dies while breaking a stale lock, followed by an exact three-way race, could let two writers through. `src/store/memory-store.js` describes it. An operating-system file lock would close it, and Node has no built-in one.
- **Approval trusts the store file.** Approval refuses a hold whose payload no longer matches its hash or its `write_held` receipt. Someone who can edit the store file can rewrite both, and can edit records directly as well.
- **Reads are not screened.** Content is screened when written and when loaded. Memory file reads say the content is stored data with its trust label, but an agent can still follow it.
- **The console is a local demo.** It binds to loopback and refuses every request, read or write, whose Host header is not a loopback address, which stops DNS rebinding. It has no session token or login.
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

The blind set was locked at `cf5944b` and scored once with the runner at `dec479683b5c76b28547d2d283564202c7124051`. These commands rerun it, now as development data, or score a later set:

```sh
sh eval/blind/baselines/setup.sh                                   # once, with network: pinned Python packages and models
node eval/blind/run.mjs --prepare-before ../knowledge-mcp-gate-2e39dbf   # a git worktree of 2e39dbf
node eval/blind/run.mjs --before-root ../knowledge-mcp-gate-2e39dbf      # offline from here on
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
node src/index.js review list
node src/index.js review show hold_0001
node src/index.js review approve hold_0001 --reviewer pharmacist-a
node src/index.js review reject hold_0002 --reviewer pharmacist-a
node src/index.js records retract rec_0042 --reviewer pharmacist-a --reason "superseded"
node src/index.js screen --text "..."            # prints the decision and rule ids, never the text
node src/index.js store scan                     # lists items that block loading, by location and rule id
node src/index.js store purge --apply --reviewer operator-a
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

Open the local address that `npm run console` prints. Six synthetic attempts run through the real gate: a care-coordination note is allowed, a phone number and MRN are blocked, two protocol drafts are held because they are clinical rules, and two injected instructions are blocked. Approve and reject act on the real hold queue and write audit entries with the label `console reviewer (unauthenticated demo)`. One in-memory session is shared by all tabs and disappears on restart. Screenshots and the short flow GIF in [docs/media](docs/media/README.md) were recorded before the 2026-11-03 change, when holds came from a dry-run runtime.

## Search public documents

With the console running, open its `/corpus` page. The public collection holds 134 committed passages from CMS NCD 240.2, an openFDA ZITUVIMET label and CDC ACIP timing guidance. The read-only tool `corpus.answer` ranks passages with BM25 and returns the best one verbatim. It abstains when fewer than half of the question's content words appear in the best passage, and lists the candidates for a person instead. That threshold was set while looking at the 18 regression questions and a few off-topic questions, so it is development tuning. `npm run eval:public` still reports 18 of 18 on its authored regression questions, which share most of their wording with the expected passages and measure the citation path, not retrieval quality. Sources, licenses and hashes are in [SOURCES.md](corpus/public/SOURCES.md).

## Evaluation and history

See [docs/evaluation/README.md](docs/evaluation/README.md) for every result, the data status of each set and the specification the blind set was written to, and [docs/threat-model.md](docs/threat-model.md) for what the gate defends against and what it does not. Earlier verification records are in `docs/*/VERIFICATION.md`.

The project was built from May to October 2026 over 71 commits in a private repository and published as a cleaned snapshot. An audit of the original private version found inconsistent outcomes from one deny-list (7 writes unchanged, 3 masked, 1 blocked with surrounding text saved to the audit across 11 probes). That observation cannot be reproduced from this repository and is history, not evidence.

MIT, Copyright (c) 2026 Kevin Madden. Committed data is synthetic, except the public reference excerpts in `corpus/public/`, which are attributed there. No real patient data.
