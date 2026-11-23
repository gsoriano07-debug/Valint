#!/usr/bin/env python3
"""Build the single-file Dealbook CRM page.

The page published as a claude.ai Artifact must be one HTML file, so this script inlines the
tab modules in src/views/*.js into src/core.html at the <!--VIEW_MODULES--> marker.

  python3 build.py                                   # all modules -> dealbook-crm.html
  python3 build.py --only expenses --out /tmp/x.html # core + one module (for testing)
"""
import argparse
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent
ORDER = ['overview', 'revenue', 'expenses', 'invoices', 'cash', 'forecast',
         'unit', 'market', 'milestones', 'team', 'assumptions']
MARKER = '<!--VIEW_MODULES-->'


def build(only=None, out=None):
    core = (ROOT / 'src' / 'core.html').read_text()
    if MARKER not in core:
        sys.exit('src/core.html is missing the ' + MARKER + ' marker')
    views = ROOT / 'src' / 'views'
    names = [n for n in ORDER if (views / f'{n}.js').exists()]
    names += sorted(p.stem for p in views.glob('*.js') if p.stem not in ORDER)
    if only:
        names = [n for n in names if n in only]
    blocks = []
    for n in names:
        js = (views / f'{n}.js').read_text()
        if '</script' in js.lower():
            sys.exit(f'src/views/{n}.js contains "</script", which would end the inline script early')
        blocks.append(f'<script>\n/* ---- tab module: {n} ---- */\n{js.rstrip()}\n</script>')
    html = core.replace(MARKER, '\n'.join(blocks))
    target = pathlib.Path(out) if out else ROOT / 'dealbook-crm.html'
    target.write_text(html)
    print(f'built {target} with {len(names)} module(s): {", ".join(names) or "none"} ({len(html):,} bytes)')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', help='comma-separated module names to include')
    ap.add_argument('--out', help='output path (default dealbook-crm.html)')
    a = ap.parse_args()
    build(set(a.only.split(',')) if a.only else None, a.out)
