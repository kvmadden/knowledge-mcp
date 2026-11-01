# Public corpus sources

Immutable local snapshots for an offline retrieval demo. These excerpts are not a complete clinical reference. Recheck current primary sources before clinical use.

Refresh with `python3 corpus/public/fetch.py`. Verify live extraction with `python3 corpus/public/fetch.py --check`. Requires Python 3 and curl, with no package installation. Upstream changes require reviewing passages and eval expectations before committing a refresh.

Source: CDC. CDC materials are available free at the linked CDC page. Use of these materials does not imply endorsement by CDC, HHS or the United States Government. No substantive changes are made to source wording.

CMS extraction includes only NCD item description and coverage prose. Billing code paragraphs, LCDs and CPT content are excluded. CDC extraction includes prose paragraphs only, excluding tables, references and figures. Drug label sections retain their original wording. Whitespace is normalized and HTML markup removed.

## CMS NCD 240.2: Home Use of Oxygen (version 2)

- URL: https://www.cms.gov/medicare-coverage-database/view/ncd.aspx?ncdid=169&ncdver=2
- Retrieved: 2026-11-01T12:29:19.048349+00:00
- License: Public domain (US government NCD text only)
- License basis: https://www.copyright.gov/title17/92chap1.html#105
- File: `cms-oxygen.json`
- SHA256 of committed passage file: `fd6a5e1e6ae9d22648950d0f5544dcca7af67af1188e60586aa3ed4a902ea6c0`

## ZITUVIMET (sitagliptin and metformin hydrochloride): prescribing label

- URL: https://api.fda.gov/drug/label.json?search=id:8c26dc1a-fba3-4266-bfaf-624b0941ef8b&limit=1
- Retrieved: 2026-11-01T12:29:23.864479+00:00
- License: Public domain / CC0 1.0 (openFDA)
- License basis: https://open.fda.gov/license/
- File: `metformin.json`
- SHA256 of committed passage file: `a32ba3ee87e409ac5472b6af6dd228cb26a732e1f77a120a90aa79855262a66b`

## CDC ACIP: Timing and Spacing of Immunobiologics

- URL: https://www.cdc.gov/vaccines/hcp/imz-best-practices/timing-spacing-immunobiologics.html
- Retrieved: 2026-11-01T12:29:24.056869+00:00
- License: Public domain (CDC authored text)
- License basis: https://www.cdc.gov/other/agencymaterials.html
- File: `cdc-timing.json`
- SHA256 of committed passage file: `ae5daee5de8e2b30c75c424503ec1c54d38de871a5d91d41f4663e1f68cf128b`
