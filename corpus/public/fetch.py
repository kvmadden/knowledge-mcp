#!/usr/bin/env python3
"""Fetch allowlisted public documents using only the Python standard library.

Run with --check to detect upstream drift without modifying committed snapshots.
"""
import argparse
from datetime import datetime, timezone
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import subprocess
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
SOURCES = [
    dict(id='cms-oxygen', family='cms-ncd', title='CMS NCD 240.2: Home Use of Oxygen (version 2)',
         url='https://www.cms.gov/medicare-coverage-database/view/ncd.aspx?ncdid=169&ncdver=2',
         license='Public domain (US government NCD text only)', licenseUrl='https://www.copyright.gov/title17/92chap1.html#105'),
    dict(id='metformin', family='openfda-label', title='ZITUVIMET (sitagliptin and metformin hydrochloride): prescribing label',
         url='https://api.fda.gov/drug/label.json?search=id:8c26dc1a-fba3-4266-bfaf-624b0941ef8b&limit=1',
         license='Public domain / CC0 1.0 (openFDA)', licenseUrl='https://open.fda.gov/license/'),
    dict(id='cdc-timing', family='cdc-acip', title='CDC ACIP: Timing and Spacing of Immunobiologics',
         url='https://www.cdc.gov/vaccines/hcp/imz-best-practices/timing-spacing-immunobiologics.html',
         license='Public domain (CDC authored text)', licenseUrl='https://www.cdc.gov/other/agencymaterials.html'),
]

class Text(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
    def handle_data(self, data):
        self.parts.append(data)

def clean(html):
    parser = Text()
    parser.feed(html)
    return re.sub(r'\s+', ' ', ''.join(parser.parts)).strip()

def extract(source, raw):
    if source['family'] == 'openfda-label':
        label = json.loads(raw)['results'][0]
        return [(key.replace('_', ' ').title(), clean(text))
                for key in ['boxed_warning', 'indications_and_usage', 'dosage_and_administration',
                            'contraindications', 'warnings_and_cautions', 'drug_interactions',
                            'pediatric_use', 'geriatric_use', 'overdosage', 'information_for_patients']
                for text in label.get(key, [])]
    if source['family'] == 'cms-ncd':
        sections = []
        for field in ['lblItemServiceDescription', 'lblIndicationsLimitations']:
            match = re.search(r'id="' + field + r'"[^>]*>(.*?)</span>', raw, re.S)
            if not match:
                raise ValueError('CMS NCD section missing: ' + field)
            sections.extend((field, clean(p)) for p in re.findall(r'<(?:p|li)\b[^>]*>(.*?)</(?:p|li)>', match[1], re.S))
        # Do not ingest billing codes, CPT material, page chrome, or LCDs.
        return [(section, text) for section, text in sections
                if len(text) > 10 and not re.search(r'\b(CPT|HCPCS|LCD)\b|\b\d{5}\b', text)]
    content = raw.split('<div id="content"', 1)[1].split('<div class="page-content-sources', 1)[0]
    # Prose paragraphs only. No third party references, figures, or tables.
    content = re.sub(r'<table\b.*?</table>', '', content, flags=re.S)
    content = re.sub(r'<sup\b.*?</sup>', '', content, flags=re.S)
    return [('ACIP timing and spacing', clean(p)) for p in re.findall(r'<p\b[^>]*>(.*?)</p>', content, re.S)
            if len(clean(p)) > 100]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    previous = json.loads((ROOT / 'manifest.json').read_text()) if (ROOT / 'manifest.json').exists() else None
    sources = []
    snapshots = {}
    for source in SOURCES:
        host = urlparse(source['url']).hostname
        assert host in {'www.cms.gov', 'api.fda.gov', 'www.cdc.gov'}
        # curl uses the platform TLS and proxy settings consistently across hosts.
        raw = subprocess.check_output(['curl', '--fail', '--silent', '--show-error',
                                       '--location', '--proto', '=https', '--proto-redir', '=https',
                                       '--max-time', '60', source['url']]).decode('utf-8')
        passages = [dict(id=f"{source['id']}-{i:03d}", section=section, text=text)
                    for i, (section, text) in enumerate(extract(source, raw), 1)]
        if not passages:
            raise ValueError('Empty extraction: ' + source['id'])
        data = (json.dumps(passages, ensure_ascii=False, indent=2) + '\n').encode()
        digest = hashlib.sha256(data).hexdigest()
        file = source['id'] + '.json'
        if args.check:
            old = next(s for s in previous['sources'] if s['id'] == source['id'])
            if old['sha256'] != digest or (ROOT / file).read_bytes() != data:
                raise ValueError('Upstream drift: ' + source['id'])
        else:
            snapshots[file] = data
        sources.append(dict(source, file=file, retrievedAt=datetime.now(timezone.utc).isoformat(), sha256=digest))
        print(source['id'], len(passages), digest)
    if not args.check:
        for file, data in snapshots.items():
            (ROOT / file).write_bytes(data)
        (ROOT / 'manifest.json').write_text(json.dumps(dict(collection='public', schemaVersion=1, sources=sources), indent=2) + '\n')
        lines = ['# Public corpus sources', '', 'Immutable local snapshots for an offline retrieval demo. These excerpts are not a complete clinical reference. Recheck current primary sources before clinical use.', '',
                 'Refresh with `python3 corpus/public/fetch.py`. Verify live extraction with `python3 corpus/public/fetch.py --check`. Requires Python 3 and curl, with no package installation. Upstream changes require reviewing passages and eval expectations before committing a refresh.', '',
                 'Source: CDC. CDC materials are available free at the linked CDC page. Use of these materials does not imply endorsement by CDC, HHS or the United States Government. No substantive changes are made to source wording.', '',
                 'CMS extraction includes only NCD item description and coverage prose. Billing code paragraphs, LCDs and CPT content are excluded. CDC extraction includes prose paragraphs only, excluding tables, references and figures. Drug label sections retain their original wording. Whitespace is normalized and HTML markup removed.', '']
        for s in sources:
            lines.extend([f"## {s['title']}", '', f"- URL: {s['url']}", f"- Retrieved: {s['retrievedAt']}", f"- License: {s['license']}", f"- License basis: {s['licenseUrl']}", f"- File: `{s['file']}`", f"- SHA256 of committed passage file: `{s['sha256']}`", ''])
        (ROOT / 'SOURCES.md').write_text('\n'.join(lines))

if __name__ == '__main__':
    main()
