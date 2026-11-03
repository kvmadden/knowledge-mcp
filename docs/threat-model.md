# Threat model

What the write gate defends against, what it does not, and where each control lives. Mapped to the OWASP Top 10 for LLM applications: LLM01 prompt injection, LLM02 sensitive information disclosure and LLM04 data and model poisoning.

## Assets

- **Shared agent memory.** Records, memory files and the hold queue in one store, read by every agent connected to it.
- **The audit log.** The evidence of who wrote, held, approved, rejected or retracted what.
- **The trust of later agents.** An agent that reads memory tends to treat it as context it may act on.

## Actors

- **An agent host acting in good faith** that copies something it should not, such as an identifier, a pasted document that carries instructions, or a confident wrong claim.
- **Content an attacker controls** that reaches an agent: a fax, a portal message, a web page or an attachment. The attacker cannot call the server directly. Their words arrive inside an agent's write.
- **An operator** who runs the server, reviews holds and maintains the store. Trusted, and not authenticated by this prototype.

Out of scope: an attacker with shell access, an attacker who can call the raw store in process, and a malicious MCP host (stdio trusts its host).

## Threats and controls

| Threat | OWASP | Control | Where | Residual risk |
| --- | --- | --- | --- | --- |
| A write path skips screening | LLM02, LLM04 | One guarded store, classification enforced at startup, registry test with canary | `src/store/guarded-store.js`, `test/write-paths.test.js` | A raw method misclassified as a read. Behavior is tested for every read method, but the classification is still hand-written. |
| A screened value differs from the stored value | LLM02 | Structured-clone snapshot screened and written | `guarded-store.js` | None known for plain data. Proxies and functions are refused. |
| Formatted identifiers saved to shared memory | LLM02 | Deny-list with folding, decoding, validators and joined fields | `config/deny-list.example.json`, `src/screening/screen.js` | Unseparated, spelled-out, international and unlisted formats. Splits across writes. |
| Names, addresses and other prose identifiers | LLM02 | Review-tier heuristics for cues and street addresses | deny-list review entries | Most names and dates pass. NER is not included. |
| Planted instructions | LLM01, LLM04 | Directive rules (override, role, export, decode-and-follow, activate the quoted text) block. Text aimed at an AI, quoted directives even next to a disavowal, clauses the gate cannot classify and memory-tampering orders are held. Keys, decoded layers and joined fields are read | `screen.js` | Wordings and languages the rules do not describe. Instructions split across records. Indirect instructions with no imperative. A description of someone else doing it ("they ignore prior instructions"). |
| False clinical claims saved as rules | LLM04 | Clinical rules, decisions, dose and safety claims and clinical orders are held for a pharmacist, in decoded text too | `screen.js` structural rules | Claims without the lexicon or an authority marker. The gate never judges truth. |
| Untrusted documents promoted to facts | LLM04 | Untrusted provenance is held for review | `screen.js` | A caller can omit the label. Provenance is not authenticated. |
| Opaque content the gate cannot read | LLM01, LLM02 | Long binary-looking encoded blocks, more encoded segments than the gate decodes and a fourth layer of encoding are held. Oversized or malformed input is rejected | `screen.js` | Short binary blocks under 256 characters and compressed text. |
| Denial of service through slow matching | n/a | Linear patterns and normalization, startup speed check on every deny-list pattern and validator loop, budgets for folding growth and joined decoding, input length limits | `screen.js`, tool schemas | A custom pattern that is slow only on inputs the probes do not cover. |
| Lost or corrupted writes from several agent hosts | n/a | Lock file with a token per acquisition, never taken from a live holder, stale locks broken under a second lock, reread before write, full write and flush, rename as the commit point, rollback before it | `src/store/memory-store.js` | Network file systems and several machines. One JSON file per store. A process that dies while breaking a stale lock, then an exact three-way race. |
| Audit gaps or audit leaks | LLM02 | Fixed-schema entries, always appended, no values or paths, committed with the change, screened at load | `guarded-store.js`, `src/server.js` | Payload hashes of short guessable payloads can be confirmed by guessing. |
| A poisoned record outlives its conversation | LLM04 | Operator retraction, purge for content that blocks loading, scanned and removed under one lock by identity | CLI, `src/store/maintenance.js` | Nothing finds the poisoned record for the operator. Reads are not re-screened. |
| An agent approves its own held write | LLM04 | The reviewer desk is not in the tool context, no tool call resolves a hold, the store's read methods leave held payloads out, and approval checks the payload against its `write_held` receipt under the lock | `src/server.js`, `src/store/guarded-store.js`, `test/boundaries.test.js`, `test/review-round-2.test.js` | Reviewer labels are not authenticated. Someone who can edit the store file can rewrite a hold and its receipt. |

## What a deployment would add

- Authenticated agent and reviewer identities with scoped permissions, through MCP Streamable HTTP and OAuth.
- A real database with row-level isolation per tenant or patient.
- Named-entity recognition for prose identifiers.
- A trained injection classifier as a second opinion.
- Read-side framing or re-screening, so that retrieval never grants authority.
- Retention and deletion policies.
- A measured false-hold rate and reviewer workload, so the cost of holding is known before a pilot.
