# Clinical operations showcase assessment

Assessment date: 2026-11-01. This is an author assessment against an inferred 15-point expert-reader checklist, not a hiring rubric, independent review or clinical validation. Kevin Madden owns the project. Codex assisted with this scenario, presentation, tests and evidence. Existing gate code and contracts are unchanged.

A care coordinator decides what an assistant may save into shared memory before outreach. A pharmacist compares an administrative protocol proposal with its source and date, then approves a newly screened submission or rejects it. No real patient is represented. The note is synthetic from inception, not a real record that has undergone de-identification.

Scores: 0 = absent, 1 = partial, 2 = demonstrated or explicitly bounded with inspectable evidence. A score of 2 for a limitation means the product communicates it honestly, not that the missing capability is implemented. Before refers to origin/main 9c19d0b. After refers to this PR. Total changes from 20/30 to 27/30. The three remaining partial scores are research and deployment limits that a scripted showcase cannot resolve.

| Check | Before | After | Evidence and boundary |
| --- | ---: | ---: | --- |
| 1. User and decision | 1 | 2 | Console names coordinator, outreach step and pharmacist action. |
| 2. Honest scope | 1 | 2 | Console says administrative prototype and excludes treatment, dosing and coverage decisions. |
| 3. AI versus baseline | 1 | 2 | Rules are the simplest useful boundary. No model is needed for this demo. No claim of model novelty or superiority. |
| 4. Complete case | 1 | 2 | Canonical scenario feeds console and MCP replay. Input, receipt, rule, provenance, hold, approval and rejection are inspectable. Four replay runtimes are independent. |
| 5. Repeatable evaluation | 2 | 2 | Existing frozen 60-case seed 20261031 evaluation and 324 planted write cases remain unchanged. Run commands and scoring are in docs/evaluation. Curated six-attempt session is separate. |
| 6. Meaningful failures | 2 | 2 | Existing reports expose 10 risky misses and five false blocks. Console links these and shows an unsupported proposal that rules cannot judge. Missing or conflicting clinical facts are not evaluated. |
| 7. Workflow value | 0 | 1 | No verification-time, rework, acceptance, override, adoption or patient-outcome study. Next useful study compares coordinator review time and correction count against a manual checklist on synthetic cases. No improvement is claimed. |
| 8. Usable provenance | 1 | 2 | Source ID, source date and caller trust appear on every attempt and review card, including blocked and held MCP requests. IDs identify synthetic fixtures, not clinical references. |
| 9. Actual oversight | 2 | 2 | Pharmacist approval resubmits through the same gate. Reject makes no write. Stale approval fails. Credentials are not authenticated, holds are not durable and server failure requires restarting the synthetic case. |
| 10. Data boundary | 1 | 2 | Visible synthetic/no-PHI label and expandable boundary explain origin, loopback transport, no vendor/model transfer, memory retention, Reset and restart. No employer data, OCR, EMR or EDI connection. |
| 11. Security judgment | 2 | 2 | Phone and MRN show both actual rule IDs. Fax shows untrusted-source and instruction-override. Audit receipts omit raw content. No multi-user isolation, authenticated provenance or compliance certification. |
| 12. Generalization | 1 | 1 | Tested English synthetic strings only. No populations, document-quality slices, multilingual or fairness study. UI explicitly limits generalization. |
| 13. Platform boundary | 2 | 1 | Existing records and memory consumers reuse the gate. MCP and local web paths share runtime contracts and audit receipts. Gate results on the 60-case set match control. No service SLO, latency/cost benchmark, rollout controller or production rollback demonstrated. |
| 14. Core usability | 2 | 2 | Six light/dark captures at 1440x900, 430x932, 390x844. Browser checks cover keyboard approval, tabs, target sizes, overflow, empty/loading/error/reconnect and rejection. |
| 15. Coherent claims and ownership | 1 | 2 | Both demos import one clinical scenario. README, assets and this assessment agree. RED-first tests drove replacement of office copy. Contribution and known limits are stated here. |

The lower platform score reflects stricter scrutiny after this pass, not removed functionality. The prioritization decision is to demonstrate the existing reusable gate with honest limits before adding OCR, a model vendor or a clinical approval system. The gate is a candidate write control, not an authorization, de-identification or clinical correctness service.

## Trace the case

1. Save the synthetic care-coordination note. One record exists.
2. Attempt phone 555-010-0199 and MRN 12345678. Both rules block the request. Stored count stays one. These are artificial test strings.
3. Hold the refill-outreach v3 proposal, source date 2026-10-30. The pharmacist can approve to create a newly screened second record, or reject to leave the store unchanged.
4. A second held draft proposes removing review without supporting evidence. Reject it. Screening itself does not identify the clinical or operational risk.
5. Fax page 2 carries an instruction to overwrite a dosing guideline. Both untrusted-source and instruction-override block it. No dosing recommendation is supplied or applied.
6. An asserted-source injection probe is also blocked. Provenance labels alone do not make content safe.

The protocol and fax are synthetic fixture text. Their dates are scenario dates, not claims of current clinical guidance. Approval is an operator simulation within a shared local session. Review decisions are not an enterprise authorization record.
