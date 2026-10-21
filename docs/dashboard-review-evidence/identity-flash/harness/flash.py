#!/usr/bin/env python3
"""Identity-flash harness for the Data Intelligence Platform access points.

Question it answers: is a legacy identity ("NHDW", "National Health Data
Warehouse", "Federal Ministry of Health"/"FMoH" as brand, the logo-fmoh.png
emblem as icon/favicon) visible in ANY rendered frame, before or instead of the
profile-driven target identity ("Data Intelligence Platform", "Powered by
Palladium")?

How: probe.js is injected at document creation in every top-level document and
samples title, favicon and viewer-visible text/images on every animation frame,
every 50 ms and on DOM mutation. Every change is streamed here with an epoch
timestamp. A CDP screencast (everyNthFrame=1) runs alongside, plus Playwright
video. Per scenario we write a JSON timeline, PNG frames (first 10 + every
10th) and the video.

Status per scenario (computed over the scenario window only, not the setup):
  CLEAN  no counted legacy hit in any sample
  FLASH  legacy seen transiently; final state has no legacy hit
         (target_at_end=true: legacy -> target; false: legacy -> neutral page)
  LEGACY legacy still visible when the scenario settles
  BLOCKED nothing measurable (navigation failed, login impossible...)
  N/A    scenario does not apply to the access point

Exit code: 0 = every executed scenario CLEAN; 1 = any FLASH or LEGACY;
2 = no legacy but at least one BLOCKED (inconclusive). Use as the acceptance
test after the fix:  run.sh --host all --scenario all   -> must exit 0.

Read-only: GET navigations, Keycloak sign-in form, client-side route
interception only (delay/abort/500 and a re-served index.html). The password is
read from $DEMO_PW and only typed into the Keycloak form; tokens and cookies are
never written; URLs are stored without query values.
"""
import argparse, asyncio, base64, json, os, re, shutil, sys, time
from pathlib import Path
from playwright.async_api import async_playwright

HB = os.environ.get('FLASH_HOSTBASE', '20.84.70.78.nip.io')
PW = os.environ.get('DEMO_PW', '')
HERE = Path(__file__).resolve().parent
PROBE = (HERE / 'probe.js').read_text()
VIEW = {'width': 1440, 'height': 900}

def U(h, p='/'):
    return f'https://{h}.{HB}{p}'

# ---------------------------------------------------------------- access points
# kind: public | staff | kc | gate | dbt
AP = {
    'public':       dict(kind='public', host='public', deep='/?page=data#data', nav='.gov-nav a'),
    'internal-bi':  dict(kind='staff', host='internal-bi', realm='moh-staff', user='analyst.ana', tok='nhdw_bi_at',
                         deep='/?page=disease#disease', nav='aside.bi-sidebar nav a'),
    'admin':        dict(kind='staff', host='admin', realm='privileged-ops', user='superadmin', tok='nhdw_admin_at',
                         deep='/#users-access', nav='aside.admin-side a:not([href])'),
    'workshop':     dict(kind='staff', host='workshop', realm='moh-staff', user='analyst.ana', tok='nhdw_workshop_at',
                         deep='/#settings', nav='aside.ws-side a:not([href]), aside.ws-side nav a'),
    'kc-moh-staff': dict(kind='kc', host='keycloak', realm='moh-staff', client='internal-bi'),
    'kc-privileged-ops': dict(kind='kc', host='keycloak', realm='privileged-ops', client='admin'),
    'dbt-docs':     dict(kind='dbt', host='dbt-docs', user='superadmin', root='/', deep='/?project=marts', low=None),
    'mlflow':       dict(kind='gate', host='mlflow', user='superadmin', root='/', deep='/#/experiments', low=None),
    'prometheus':   dict(kind='gate', host='prometheus', user='superadmin', root='/', deep='/alerts', low='genet.e'),
    'alertmanager': dict(kind='gate', host='alertmanager', user='superadmin', root='/', deep='/#/status', low='genet.e'),
    'seaweedfs':    dict(kind='gate', host='seaweedfs', user='superadmin', root='/', deep='/?dir=/', low='genet.e'),
    'headlamp':     dict(kind='gate', host='admin', user='superadmin', root='/k8s', deep='/k8s/c/main/namespaces', low='genet.e',
                         prefix='/k8s'),
}
SCEN = ['cold', 'sso', 'reload', 'hard', 'deep', 'nav', 'slow', 'fail-abort', 'fail-500', 'warm', 'newasset',
        'jsfail', 'expired', 'expired-sso', 'signin-error', 'forbidden', 'kc-error', 'e404']
APPLIES = {
    'public': ['cold', 'reload', 'hard', 'deep', 'nav', 'slow', 'fail-abort', 'fail-500', 'warm', 'newasset', 'jsfail', 'e404'],
    'staff':  ['cold', 'sso', 'reload', 'hard', 'deep', 'nav', 'slow', 'fail-abort', 'fail-500', 'warm', 'newasset', 'jsfail',
               'expired', 'expired-sso', 'signin-error', 'e404'],
    'kc':     ['cold', 'reload', 'hard', 'kc-error', 'e404'],
    'dbt':    ['cold', 'sso', 'reload', 'hard', 'deep', 'warm', 'e404'],
    'gate':   ['cold', 'sso', 'reload', 'hard', 'deep', 'warm', 'forbidden', 'e404'],
}
PROFILE_RE = re.compile(r'/(gw|api/proxy|api)/profile')

def redact(u):
    return re.sub(r'([?&][^=&#]+)=[^&#]*', r'\1', u.split('://', 1)[-1])[:160]

# ---------------------------------------------------------------- recorder
class Rec:
    def __init__(self, ap, sc, out):
        self.ap, self.sc, self.out = ap, sc, out
        self.samples, self.marks, self.frames, self.net, self.notes = [], [], [], [], []
        self.fdir = out / 'frames' / f'{ap}__{sc}'
        self.fdir.mkdir(parents=True, exist_ok=True)
        self.fi = 0
        self.t0 = None

    def mark(self, name):
        t = time.time() * 1000
        if name == 'scenario':
            self.t0 = t
        self.marks.append({'name': name, 't': t})

    def add(self, s):
        s['rx'] = time.time() * 1000
        self.samples.append(s)

    async def frame(self, cdp, p):
        try:
            await cdp.send('Page.screencastFrameAck', {'sessionId': p['sessionId']})
        except Exception:
            pass
        i = self.fi; self.fi += 1
        ts = (p.get('metadata') or {}).get('timestamp')
        tms = ts * 1000 if ts else time.time() * 1000
        f = {'i': i, 't': tms}
        if i < 10 or i % 10 == 0:
            name = f'f{i:05d}.png'
            (self.fdir / name).write_bytes(base64.b64decode(p['data']))
            f['png'] = name
        self.frames.append(f)

# ---------------------------------------------------------------- browser glue
async def new_ctx(br, rec, storage=None, video=True):
    vdir = rec.out / 'video-tmp' / f'{rec.ap}__{rec.sc}'
    kw = dict(ignore_https_errors=True, viewport=VIEW)
    if video:
        kw.update(record_video_dir=str(vdir), record_video_size=VIEW)
    if storage:
        kw['storage_state'] = storage
    ctx = await br.new_context(**kw)
    await ctx.expose_binding('__flashEmit', lambda src, s: rec.add(s))
    await ctx.add_init_script(PROBE)
    return ctx

async def new_page(ctx, rec):
    pg = await ctx.new_page()
    cdp = await ctx.new_cdp_session(pg)
    cdp.on('Page.screencastFrame', lambda p: asyncio.ensure_future(rec.frame(cdp, p)))
    await cdp.send('Network.enable')
    async def start_sc(*_):
        try:
            await cdp.send('Page.startScreencast', {'format': 'png', 'maxWidth': VIEW['width'], 'maxHeight': VIEW['height'], 'everyNthFrame': 1})
        except Exception as e:
            rec.notes.append('screencast: ' + str(e)[:80])
    await start_sc()
    pg.on('framenavigated', lambda fr: fr == pg.main_frame and asyncio.ensure_future(start_sc()))
    def on_resp(r):
        try:
            if r.request.resource_type in ('document',) or PROFILE_RE.search(r.url) or 'logo-fmoh' in r.url:
                h = r.headers
                rec.net.append({'t': time.time() * 1000, 'st': r.status, 'type': r.request.resource_type, 'u': redact(r.url),
                                'cc': h.get('cache-control'), 'etag': bool(h.get('etag')), 'lm': h.get('last-modified'),
                                'fromCache': None})
        except Exception:
            pass
    pg.on('response', on_resp)
    def on_fail(r):
        if PROFILE_RE.search(r.url) or r.resource_type == 'document':
            rec.net.append({'t': time.time() * 1000, 'st': 'failed', 'u': redact(r.url), 'err': str(r.failure)[:60]})
    pg.on('requestfailed', on_fail)
    return pg, cdp

async def settle(pg, ms=3500, idle=15000):
    try:
        await pg.wait_for_load_state('networkidle', timeout=idle)
    except Exception:
        pass
    await pg.wait_for_timeout(ms)

async def on_kc(pg):
    try:
        await pg.wait_for_selector('#username', timeout=12000)
        return True
    except Exception:
        return False

async def kc_login(pg, user):
    if not await on_kc(pg):
        return 'no-login-form'
    await pg.fill('#username', user)
    await pg.fill('#password', PW)
    await pg.click('#kc-login, button[type=submit], input[type=submit]')
    try:
        await pg.wait_for_url(lambda u: 'keycloak.' not in u, timeout=30000)
    except Exception:
        el = await pg.query_selector('#input-error, .kc-feedback-text, .alert-error')
        return 'kc-stuck: ' + ((await el.inner_text())[:60] if el else pg.url.split('?')[0][-50:])
    return 'ok'

def root_url(a):
    if a['kind'] == 'kc':
        return (U('keycloak', f"/realms/{a['realm']}/protocol/openid-connect/auth") +
                f"?client_id={a['client']}&response_type=code&scope=openid&redirect_uri=https%3A%2F%2F{a['client']}.{HB}%2F"
                "&code_challenge=flashprobeflashprobeflashprobeflashprobe123&code_challenge_method=S256")
    return U(a['host'], a.get('root', '/'))

# ---------------------------------------------------------------- scenarios
async def run_scenario(br, apn, sc, out, sso_cache):
    a = AP[apn]
    rec = Rec(apn, sc, out)
    kind = a['kind']
    res = {'ap': apn, 'scenario': sc, 'kind': kind}
    if sc not in APPLIES[kind]:
        res['status'] = 'N/A'
        shutil.rmtree(rec.fdir, ignore_errors=True)
        return res, rec
    root = root_url(a)
    ctx = None
    try:
        login_user = a.get('user')
        # ---- contexts that need an SSO session reuse cookies from one cold login (memory only)
        needs_sso = kind in ('staff', 'dbt', 'gate') and sc not in ('cold', 'expired', 'signin-error', 'forbidden')
        storage = None
        if needs_sso:
            storage = sso_cache.get(apn)
            if storage is None:
                storage = await make_sso(br, a, out)
                sso_cache[apn] = storage
            if storage is None:
                res['status'] = 'BLOCKED'; res['why'] = 'could not obtain SSO session'
                return res, rec
        if sc == 'expired':
            storage = None
        ctx = await new_ctx(br, rec, storage=storage)
        if sc == 'hard':
            pass
        # ---- per-scenario routing (client-side only)
        if sc == 'slow':
            async def slow(route):
                await asyncio.sleep(5)
                try: await route.continue_()
                except Exception: pass
            await ctx.route(PROFILE_RE, slow)
        elif sc == 'fail-abort':
            await ctx.route(PROFILE_RE, lambda r: r.abort())
        elif sc == 'fail-500':
            await ctx.route(PROFILE_RE, lambda r: r.fulfill(status=500, content_type='application/json', body='{"detail":"flash-test"}'))
        elif sc == 'jsfail':
            await ctx.route(re.compile(r'/assets/index-[^/]+\.js'), lambda r: r.abort())
        elif sc in ('expired', 'expired-sso'):
            # A JWT-shaped but unsigned, already-expired token (not a real credential).
            hdr = base64.urlsafe_b64encode(b'{"alg":"none","typ":"JWT"}').decode().rstrip('=')
            pl = base64.urlsafe_b64encode(json.dumps({'exp': 1700000000, 'iat': 1699990000, 'preferred_username': 'flash-test'}).encode()).decode().rstrip('=')
            fake = f'{hdr}.{pl}.flashtest'
            await ctx.add_init_script(f"""(() => {{ try {{ if (location.host.startsWith('{a['host']}.') && !sessionStorage.getItem('__flash_seeded')) {{
                sessionStorage.setItem('__flash_seeded','1'); sessionStorage.setItem('{a['tok']}','{fake}'); }} }} catch(e){{}} }})();""")
        elif sc == 'signin-error':
            await ctx.add_init_script(f"""(() => {{ try {{ if (location.host.startsWith('{a['host']}.') && !sessionStorage.getItem('__flash_seeded')) {{
                sessionStorage.setItem('__flash_seeded','1'); sessionStorage.setItem('pkce_fail','1'); }} }} catch(e){{}} }})();""")
        pg, cdp = await new_page(ctx, rec)

        # ---- setup phase (not scored) for scenarios that act on an already-loaded page
        if sc in ('reload', 'hard', 'nav', 'warm'):
            rec.mark('setup')
            await pg.goto(root, wait_until='domcontentloaded', timeout=60000)
            await settle(pg, 3000)

        rec.mark('scenario')
        if sc in ('cold', 'sso', 'jsfail', 'expired-sso'):
            await pg.goto(root, wait_until='domcontentloaded', timeout=60000)
            if sc == 'cold' and kind in ('staff', 'dbt', 'gate'):
                await settle(pg, 1500, idle=8000)
                rec.mark('kc-form-filled')
                res['login'] = await kc_login(pg, login_user)
            await settle(pg, 5000 if sc != 'slow' else 8000)
        elif sc in ('slow', 'fail-abort', 'fail-500'):
            await pg.goto(root, wait_until='domcontentloaded', timeout=60000)
            await settle(pg, 8000 if sc == 'slow' else 5000)
        elif sc == 'reload':
            await pg.reload(wait_until='domcontentloaded')
            await settle(pg, 4000)
        elif sc == 'hard':
            await cdp.send('Network.setCacheDisabled', {'cacheDisabled': True})
            await pg.reload(wait_until='domcontentloaded')
            await settle(pg, 4000)
        elif sc == 'deep':
            await pg.goto(U(a['host'], a['deep']), wait_until='domcontentloaded', timeout=60000)
            await settle(pg, 5000)
        elif sc == 'nav':
            links = await pg.query_selector_all(a['nav'])
            res['nav_links'] = len(links)
            clicked = []
            for i in range(min(len(links), 7)):
                links = await pg.query_selector_all(a['nav'])
                if i >= len(links): break
                try:
                    txt = (await links[i].inner_text()).strip()[:30]
                    await links[i].click(timeout=5000)
                    rec.mark('click:' + txt)
                    clicked.append(txt)
                    await settle(pg, 2000, idle=6000)
                except Exception as e:
                    rec.notes.append(f'click {i}: {str(e)[:60]}')
            res['clicked'] = clicked
            if not clicked:
                res['status'] = 'BLOCKED'; res['why'] = 'no nav links clickable'
        elif sc == 'warm':
            await pg.goto(root, wait_until='domcontentloaded')   # same tab, warm HTTP cache
            await settle(pg, 4000)
        elif sc == 'newasset':
            async def new_index(route):
                req = route.request
                if req.resource_type != 'document' or a['host'] + '.' not in req.url:
                    return await route.continue_()
                r = await route.fetch()
                body = await r.text()
                body2 = re.sub(r'(src="/assets/index-[^"]+\.js)"', r'\1?v=flash-new"', body)
                await route.fulfill(response=r, body=body2)
            await ctx.route('**/*', new_index)
            await pg.goto(root, wait_until='domcontentloaded', timeout=60000)
            await settle(pg, 5000)
        elif sc == 'expired':
            await pg.goto(root, wait_until='domcontentloaded', timeout=60000)
            await settle(pg, 4000)
            res['ended_on_kc'] = 'keycloak.' in pg.url
        elif sc == 'signin-error':
            await pg.goto(U(a['host'], '/?code=flash-bogus&state=flash-bogus'), wait_until='domcontentloaded', timeout=60000)
            await settle(pg, 4000)
            res['error_page'] = bool(await pg.query_selector('text=Sign-in didn'))
        elif sc == 'forbidden':
            if not a.get('low'):
                res['status'] = 'N/A'; res['why'] = 'no low-privilege account available for this gate'
            else:
                await pg.goto(U(a['host'], '/oauth2gate/login?rd=' + a.get('root', '/').replace('/', '%2F') + '&realm=moh-staff'),
                              wait_until='domcontentloaded', timeout=60000)
                res['login'] = await kc_login(pg, a['low'])
                await settle(pg, 3000)
                res['http_title'] = await pg.title()
        elif sc == 'kc-error':
            await pg.goto(U('keycloak', f"/realms/{a['realm']}/protocol/openid-connect/auth?client_id=flash-nope&response_type=code&redirect_uri=x"),
                          wait_until='domcontentloaded')
            await settle(pg, 2500)
        elif sc == 'e404':
            await pg.goto(U(a['host'], (a.get('prefix') or '') + '/flash-does-not-exist-404'), wait_until='domcontentloaded', timeout=60000)
            await settle(pg, 4000)
        rec.mark('end')
        res['final_url'] = redact(pg.url)
        try:
            res['sw_registrations'] = await pg.evaluate("() => navigator.serviceWorker ? navigator.serviceWorker.getRegistrations().then(r => r.length) : -1")
        except Exception:
            res['sw_registrations'] = None
        try:
            await cdp.send('Page.stopScreencast')
        except Exception:
            pass
        await asyncio.sleep(0.3)
        vids = [p_.video for p_ in ctx.pages if p_.video]
        await ctx.close(); ctx = None
        vnames = []
        for k, v in enumerate(vids):
            try:
                src = Path(await v.path())
                dst = out / 'video' / f'{apn}__{sc}{"" if k == 0 else "-" + str(k)}.webm'
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(src), dst)
                vnames.append(str(dst.relative_to(out)))
            except Exception as e:
                rec.notes.append('video: ' + str(e)[:60])
        res['video'] = vnames
    except Exception as e:
        res['status'] = 'BLOCKED'; res['why'] = f'{type(e).__name__}: {str(e)[:160]}'
        if ctx:
            try: await ctx.close()
            except Exception: pass
    return res, rec

async def make_sso(br, a, out):
    """One cold login in a throwaway context; returns cookies (memory only)."""
    ctx = await br.new_context(ignore_https_errors=True, viewport=VIEW)
    try:
        pg = await ctx.new_page()
        await pg.goto(root_url(a), wait_until='domcontentloaded', timeout=60000)
        st = await kc_login(pg, a['user'])
        await settle(pg, 2000, idle=8000)
        if st != 'ok':
            return None
        return await ctx.storage_state()
    finally:
        await ctx.close()

# ---------------------------------------------------------------- scoring
def basename(s):
    return (s or '').split('/')[-1]

def score(res, rec):
    if res.get('status') in ('N/A', 'BLOCKED'):
        return res
    t0 = rec.t0 or (rec.samples[0]['t'] if rec.samples else 0)
    S = sorted([s for s in rec.samples if s['t'] >= t0 - 5], key=lambda s: s['t'])
    if not S:
        res['status'] = 'BLOCKED'; res['why'] = 'no samples'
        return res
    end = max(m['t'] for m in rec.marks if m['name'] == 'end') if any(m['name'] == 'end' for m in rec.marks) else S[-1]['t']
    def counted(s): return [h for h in s['hits'] if h.get('c', True)]
    leg = [s for s in S if counted(s)]
    tgt = [s for s in S if any(k in s['tg'] for k in ('Data Intelligence Platform', 'Palladium'))]
    # legacy-visible duration: sum of intervals where the latest sample has counted hits
    dur = 0.0
    for i, s in enumerate(S):
        nxt = S[i + 1]['t'] if i + 1 < len(S) else end
        if counted(s): dur += max(0.0, nxt - s['t'])
    last = S[-1]
    res['samples'] = len(S)
    res['screencast_frames'] = len(rec.frames)
    res['first_sample_ms'] = round(S[0]['t'] - t0)
    if leg:
        res['first_legacy_ms'] = round(leg[0]['t'] - t0)
        res['legacy_visible_ms'] = round(dur)
        res['legacy_keys'] = sorted({f"{h['k']}@{h['z']}" for s in leg for h in counted(s)})
        res['legacy_strings'] = sorted({h['s'] for s in leg for h in counted(s)})[:20]
        # LEGACY = legacy still on screen when the scenario settles; FLASH = legacy only transiently.
        # target_at_end tells "legacy -> target" apart from "legacy -> neutral page" (stock tool UI, raw 404).
        res['status'] = 'LEGACY' if counted(last) else 'FLASH'
        res['target_at_end'] = bool(last['tg'])
        if res['status'] == 'FLASH':
            after = [s for s in S if s['t'] > leg[-1]['t']]
            res['flash_until_ms'] = round(after[0]['t'] - t0) if after else None
    else:
        res['status'] = 'CLEAN'
    if tgt:
        res['first_target_ms'] = round(tgt[0]['t'] - t0)
    # per zone (title / favicon / chrome / overlay / img / page / content): first and last legacy sample
    # and whether it is still on screen at the end -> distinguishes a transient flash inside one slot
    # (e.g. bundled "NHDW" header replaced by the profile) from a slot that stays legacy.
    zones = {}
    for i, s in enumerate(S):
        nxt = S[i + 1]['t'] if i + 1 < len(S) else end
        for z in {h['z'] for h in counted(s)}:
            d = zones.setdefault(z, {'first_ms': round(s['t'] - t0), 'visible_ms': 0, 'keys': set()})
            d['last_ms'] = round(nxt - t0); d['visible_ms'] += round(max(0, nxt - s['t']))
            d['keys'] |= {h['k'] for h in counted(s) if h['z'] == z}
    for z, d in zones.items():
        d['persists_at_end'] = any(h['z'] == z for h in counted(last)); d['keys'] = sorted(d['keys'])
    res['zones'] = zones
    info = sorted({f"{h['k']}@{h['z']}" for s in S for h in s['hits'] if not h.get('c', True)})
    if info:
        res['content_mentions_not_counted'] = info
    res['final_identity'] = {'title': last['title'], 'fav': [basename(f) for f in last['fav']], 'ids': [i['t'] for i in last['ids']],
                             'target': last['tg'], 'legacy': [f"{h['k']}@{h['z']}" for h in counted(last)]}
    # compressed identity timeline
    tl, prev = [], None
    for s in S:
        key = (s['u'], s['title'], tuple(basename(f) for f in s['fav']), tuple(i['t'] for i in s['ids']), s['ov'],
               tuple(sorted({h['k'] + '@' + h['z'] for h in s['hits']})), tuple(sorted(s['tg'])))
        if key != prev:
            tl.append({'t_ms': round(s['t'] - t0), 'url': s['u'], 'title': s['title'], 'favicon': [basename(f) for f in s['fav']],
                       'identity_slots': [i['t'] for i in s['ids']], 'overlay': s['ov'], 'legacy': list(key[5]),
                       'target': list(key[6]), 'body_text_len': s['len']})
            prev = key
    res['timeline'] = tl[:400]
    # annotate saved screencast frames with the DOM state at that moment
    fr = []
    for f in rec.frames:
        if 'png' not in f: continue
        before = [s for s in S if s['t'] <= f['t'] + 5]
        st = before[-1] if before else None
        fr.append({'png': f"frames/{rec.ap}__{rec.sc}/{f['png']}", 't_ms': round(f['t'] - t0),
                   'legacy': sorted({h['k'] + '@' + h['z'] for h in counted(st)}) if st else None})
    res['frames_saved'] = fr
    res['marks'] = [{'name': m['name'], 't_ms': round(m['t'] - t0)} for m in rec.marks]
    res['net'] = [dict(n, t_ms=round(n['t'] - t0)) for n in rec.net if n['t'] >= t0 - 5][:60]
    for n in res['net']: n.pop('t', None)
    res['notes'] = rec.notes[:10]
    return res

# ---------------------------------------------------------------- main
async def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--host', default='all', help='comma list of access points or "all": ' + ','.join(AP))
    ap.add_argument('--scenario', default='all', help='comma list or "all": ' + ','.join(SCEN))
    ap.add_argument('--out', default='/out')
    ap.add_argument('--tag', default='', help='suffix for the summary file name')
    ap.add_argument('--list', action='store_true')
    args = ap.parse_args()
    if args.list:
        for k, v in AP.items(): print(k, v['kind'], APPLIES[v['kind']])
        return 0
    hosts = list(AP) if args.host == 'all' else args.host.split(',')
    scs = SCEN if args.scenario == 'all' else args.scenario.split(',')
    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    (out / 'timelines').mkdir(exist_ok=True)
    results = []
    async with async_playwright() as p:
        br = await p.chromium.launch(args=['--no-sandbox'])
        sso = {}
        for h in hosts:
            for sc in scs:
                t = time.time()
                res, rec = await run_scenario(br, h, sc, out, sso)
                res = score(res, rec)
                res['wall_s'] = round(time.time() - t, 1)
                if res['status'] != 'N/A':
                    (out / 'timelines' / f'{h}__{sc}.json').write_text(json.dumps(res, indent=1, ensure_ascii=False))
                    (out / 'raw').mkdir(exist_ok=True)
                    (out / 'raw' / f'{h}__{sc}.json').write_text(json.dumps({'marks': rec.marks, 'samples': rec.samples,
                        'frames': rec.frames}, ensure_ascii=False))
                    if not any(True for _ in rec.fdir.glob('*.png')):
                        shutil.rmtree(rec.fdir, ignore_errors=True)
                results.append({k: res.get(k) for k in ('ap', 'scenario', 'status', 'first_legacy_ms', 'legacy_visible_ms', 'flash_until_ms',
                                                        'first_target_ms', 'legacy_keys', 'why', 'login', 'video', 'samples', 'screencast_frames')})
                print(f"{h:18} {sc:13} {res['status']:8} first_legacy={res.get('first_legacy_ms')} dur={res.get('legacy_visible_ms')} "
                      f"keys={res.get('legacy_keys')} {res.get('why') or ''}", flush=True)
        await br.close()
    shutil.rmtree(out / 'video-tmp', ignore_errors=True)
    (out / f'summary{args.tag}.json').write_text(json.dumps(results, indent=1, ensure_ascii=False))
    st = {r['status'] for r in results}
    if st & {'FLASH', 'LEGACY'}: return 1
    if 'BLOCKED' in st: return 2
    return 0

if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
