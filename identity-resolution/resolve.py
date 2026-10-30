"""Excerpt from CreatorOps (private): identity resolution for the CRM build.
Collected creators, team spreadsheets, PDF rosters and marketplace reports become one row per person, with ids that
stay the same between rebuilds. The readers for each source and the Google Sheet sync are not included."""
import json, os, re

DATA = os.environ.get('CRM_DATA', '.')  # where crm-ids.json is kept

STATUS_RANK = {'New': 0, 'Shortlisted': 1, 'Quoted on HashFame': 1, 'Emailed': 2, 'Emailed (manual)': 2, 'Bounced': 3, 'Replied': 4,
               'Interested': 5, 'Quote received': 6, 'Not interested': 7, 'Do not contact': 8}

def clean_name(v):
    """Display names often carry a tagline or emojis ("Asha Rao | Certified Fitness Coach")."""
    s = re.split(r'\s[|•·–—]\s|\s-\s|\|', str(v or ''))[0]
    s = ''.join(ch for ch in s if ch.isalnum() or ch in " .'&-")
    return re.sub(r'\s+', ' ', s).strip()

HANDLE_RE = re.compile(r'^[a-z0-9._]{1,30}$')

def ig_handle(v):
    s = str(v or '').strip()
    m = re.search(r'instagram\.com/@?([A-Za-z0-9._]+)', s, re.I)
    if m and m.group(1).lower() in ('reel', 'reels', 'p', 'tv', 'stories', 'explore'):
        return ''  # a post or reel link names no account
    if m:
        s = m.group(1)
    elif '/' in s or ' ' in s:
        return ''
    s = s.lstrip('@').strip().lower().rstrip('.')
    return s if HANDLE_RE.match(s) else ''

def yt_key(v):
    m = re.search(r'youtube\.com/(@[\w.-]+|channel/[\w-]+|c/[\w.-]+|user/[\w.-]+)', str(v or ''), re.I)
    return m.group(1).lower() if m else ''

def name_key(v):
    return re.sub(r'[^a-z0-9]', '', str(v or '').lower())

def clean_num(v):
    if v is None or v == '':
        return None
    if isinstance(v, (int, float)):
        return int(v)
    s = str(v).strip().lower().replace(',', '')
    m = re.match(r'^([\d.]+)\s*(k|m|mn|lakh|lac|l|cr|b)?\b', s)
    if not m:
        return None
    mult = {'k': 1e3, 'm': 1e6, 'mn': 1e6, 'lakh': 1e5, 'lac': 1e5, 'l': 1e5, 'cr': 1e7, 'b': 1e9}.get(m.group(2) or '', 1)
    try:
        return int(float(m.group(1)) * mult)
    except ValueError:
        return None

def merge(groups):
    """Folds rows that are the same person; the first source in the list wins where both have a value."""
    merged, index = [], {}
    def keys(p):
        k = []
        if p.get('_handle'): k.append('ig:' + p['_handle'])
        # A HashFame username is nearly always the creator's Instagram handle too.
        if p.get('_hf'): k += ['hf:' + p['_hf'], 'ig:' + p['_hf']]
        if yt_key(p.get('yt link')): k.append('yt:' + yt_key(p['yt link']))
        if p.get('email'): k.append('em:' + str(p['email']).strip().lower())
        if not k and name_key(p.get('name')): k.append('nm:' + name_key(p['name']))
        return k
    dupes = 0
    for p in (p for g in groups for p in g):
        ks = keys(p)
        # Two different Instagram handles are two people, even with one email (agencies manage many creators).
        same = lambda h: not (p.get('_handle') and h.get('_handle') and p['_handle'] != h['_handle'])
        hit = next((index[k] for k in ks if k in index and same(index[k])), None)
        if hit is None:
            merged.append(dict(p))
            hit = merged[-1]
        else:
            dupes += 1
            for f, v in p.items():
                if v in (None, ''):
                    continue
                if f == 'lead source':
                    if v not in hit['lead source']:
                        hit['lead source'] += ' + ' + v
                elif f == 'notes':
                    hit['notes'] = '; '.join(x for x in [hit.get('notes'), v] if x)
                elif f == 'status':
                    if STATUS_RANK.get(v, 0) > STATUS_RANK.get(hit.get('status'), 0):
                        hit['status'] = v
                elif hit.get(f) in (None, ''):
                    hit[f] = v
        for k in keys(hit):
            index[k] = hit
    return merged, dupes

def assign_ids(people):
    """Gives every row its id (T0001...). A person keeps their id even when a later run knows more keys for them."""
    ids_file = os.path.join(DATA, 'crm-ids.json')
    ids = json.load(open(ids_file, encoding='utf-8')) if os.path.exists(ids_file) else {}
    nxt = max([int(v[1:]) for v in ids.values()] + [0]) + 1
    for p in people:
        keys = [k for k in [
            'ig:' + p['_handle'] if p.get('_handle') else '', 'hf:' + p['_hf'] if p.get('_hf') else '',
            'yt:' + yt_key(p.get('yt link')) if yt_key(p.get('yt link')) else '',
            'em:' + str(p['email']).lower() if p.get('email') else '', 'nm:' + name_key(p.get('name')) if name_key(p.get('name')) else '',
        ] if k]
        # Email and name keys are shared by different people (agencies, common names), so they only give an id
        # to a row that has no handle of its own.
        strong = [k for k in keys if k[:3] in ('ig:', 'hf:', 'yt:')]
        found = next((ids[k] for k in (strong or keys) if k in ids), None)
        if not found:
            found = f'T{nxt:04d}'
            nxt += 1
        p['id'] = found
        for k in (strong or keys):
            ids.setdefault(k, found)
    with open(ids_file, 'w', encoding='utf-8') as f:
        json.dump(ids, f)
