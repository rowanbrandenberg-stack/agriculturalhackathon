"""Acceptance checks for demo isolation, location switching and decision consistency.
Run: python3 tests/acceptance.py [url]. The weather service and the community database are mocked.
Nothing is ever sent to the production database."""
import asyncio, json, sys, os, datetime, csv, io
from playwright.async_api import async_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'file://' + os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'index.html'))
res = []
def ck(name, cond, detail=''):
    res.append((name, bool(cond))); print(('  ok   ' if cond else '  FAIL ') + name + ('' if cond else '  -> ' + str(detail)[:400]))
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width': 1366, 'height': 900})
        d0 = datetime.datetime.now().replace(minute=0, second=0, microsecond=0, hour=0)
        T = [(d0 + datetime.timedelta(hours=i)).strftime('%Y-%m-%dT%H:00') for i in range(48)]
        pt = {'hourly': {'time': T, 'temperature_2m': [70.0] * 48, 'temperature_80m': [66.0] * 48, 'wind_speed_10m': [5.0] * 48, 'wind_speed_80m': [15.0] * 48, 'wind_direction_10m': [330] * 48, 'wind_direction_80m': [300] * 48}}
        WX = json.dumps([pt] * 29)
        now = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
        REPORTS = json.dumps([
            {'id': 1, 'created_at': now, 'kind': 'crew', 'lat': 32.69, 'lon': -114.62, 'note': 'yuma crew'},
            {'id': 2, 'created_at': now, 'kind': 'drift', 'lat': 32.70, 'lon': -114.62, 'note': 'yuma drift'},
            {'id': 3, 'created_at': now, 'kind': 'inversion', 'lat': 32.69, 'lon': -114.63, 'note': 'yuma still air'},
            {'id': 4, 'created_at': now, 'kind': 'drift', 'lat': 31.98, 'lon': -110.29, 'note': 'benson drift'}])
        net = {'wx_ok': True, 'wx_delay': 0, 'sb_ok': True, 'sb_delay': 0, 'posts': 0, 'gets': 0}
        async def wx(route):
            if net['wx_delay']: await asyncio.sleep(net['wx_delay'])
            if net['wx_ok']: await route.fulfill(status=200, content_type='application/json', body=WX)
            else: await route.abort()
        async def sb(route):
            H = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*'}
            if route.request.method == 'OPTIONS': await route.fulfill(status=204, headers=H); return
            if route.request.method == 'POST': net['posts'] += 1; await route.fulfill(status=201, content_type='application/json', body='[]', headers=H); return
            net['gets'] += 1
            if net['sb_delay']: await asyncio.sleep(net['sb_delay'])
            if net['sb_ok']: await route.fulfill(status=200, content_type='application/json', body=REPORTS, headers=H)
            else: await route.abort()
        await ctx.route('**/api.open-meteo.com/**', wx); await ctx.route('**/*.supabase.co/**', sb)
        pg = await ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL); await pg.wait_for_timeout(1200)
        st = lambda: pg.evaluate('window.__sow.state()')
        txt = lambda sel: pg.inner_text(sel)
        tc = lambda sel: pg.evaluate('s => document.querySelector(s).textContent', sel)
        rows = lambda: pg.evaluate('window.__sowCsv()')
        async def parsed(): return list(csv.DictReader(io.StringIO(await rows())))
        click = lambda sel: pg.evaluate("s => document.querySelector(s).click()", sel)

        print('Demo isolation')
        s = await st()
        ck('fresh demo: 6:10 AM, decision STOP, weather STOP, ground GO', s['time'] == '6:10 AM' and s['status'] == 'STOP' and s['weather'] == 'STOP' and s['ground'] == 'GO', s)
        r = await parsed()
        ck('fresh demo: one record row, tagged demo with its location and source', len(r) == 1 and r[0]['mode'] == 'demo' and r[0]['demo_data'] == 'true' and 'Demo block' in r[0]['location'] and r[0]['data_source'] == 'Simulated tower readings' and r[0]['weather_status'] == 'STOP', r)
        ck('actual reports were fetched but none are used in the demo', net['gets'] >= 1 and s['used'] == 0, (net, s))
        await click('.jump[data-min="660"]'); await pg.wait_for_timeout(300); s = await st()
        ck('11 AM with actual crew, drift and still air reports nearby: decision GO, weather GO, no concerns', s['time'] == '11:00 AM' and s['status'] == 'GO' and s['weather'] == 'GO' and s['concerns'] == 0, s)
        js = await txt('#jobStrip')
        ck('11 AM: sufficient window for the default 2 hour job', 'SUFFICIENT WINDOW' in js and 'This 2 hour job fits' in js, js)
        ck('main screen says demo does not use actual reports', 'actual community reports are not used' in await txt('#splitLine'))
        await click('.jump[data-min="975"]'); await pg.wait_for_timeout(300); s = await st()
        ck('4:15 PM: upper wind STOP while the ground wind check passes', s['status'] == 'STOP' and s['weather'] == 'STOP' and s['ground'] == 'GO' and 'Wind above your limit at 30 ft' in await tc('#reasons'), s)
        ck('top reason is shown first with a count of additional concerns', 'View additional concerns' in await txt('#reasons'), await txt('#reasons'))
        await pg.select_option('#speed', '120'); await click('.jump[data-min="1060"]')
        for _ in range(60):
            await pg.wait_for_timeout(500); s = await st()
            if not s['playing']: break
        ev = [x['event'] for x in await parsed()]
        ck('evening playback: GO to CAUTION to STOP with matching alerts', s['status'] == 'STOP' and any('ALERT GO to CAUTION' in e for e in ev) and any('ALERT CAUTION to STOP' in e for e in ev), (s, [e for e in ev if e != 'Reading']))
        await click('#demoReset'); await pg.wait_for_timeout(200); a1 = await st()
        await click('.jump[data-min="660"]'); await click('#demoReset'); await pg.wait_for_timeout(200); a2 = await st()
        ck('reset demo restores the same state every time', a1 == a2 and a1['time'] == '6:10 AM' and a1['status'] == 'STOP' and a1['logLen'] == 1, (a1, a2))
        await pg.evaluate("document.getElementById('optNotify').checked = true"); await click('.jump[data-min="660"]'); await click('#sprayBtn'); await pg.wait_for_timeout(400)
        await click('.qbtn.q2'); await pg.wait_for_timeout(400)
        ck('demo application start and demo report taps send nothing', net['posts'] == 0 and 'Nothing was sent' in await tc('#quickMsg'), (net, await tc('#quickMsg')))
        await click('#sprayBtn'); await click('#demoReset')
        await pg.evaluate("document.getElementById('optNotify').checked = false")
        ck('sharing is off unless the user ticks it', await pg.evaluate("document.getElementById('optNotify').defaultChecked") is False)

        print('Missing sensor')
        await click('.jump[data-min="660"]'); await pg.evaluate("const c=document.getElementById('optDropHi'); c.checked=true; c.dispatchEvent(new Event('change'))"); await pg.wait_for_timeout(300); s = await st()
        ck('disconnected upper sensor: UNABLE, never GO', s['status'] == 'UNABLE' and s['weather'] == 'UNABLE', s)
        ck('disconnected sensor: tells the user to check or restore it', 'Check or restore the sensor' in await txt('#statusAction') and 'Check or restore' in await txt('#jobStrip'))
        ck('disconnected sensor: comparison statistic unavailable, not 0.0 hours', 'Comparison unavailable: insufficient sensor data' in await txt('#tlfoot') and '0.0 hours' not in await txt('#tlfoot'), await txt('#tlfoot'))
        await pg.evaluate("const c=document.getElementById('optDropHi'); c.checked=false; c.dispatchEvent(new Event('change'))"); await click('#demoReset')

        print('Location switching')
        await click('#modeLive'); await pg.wait_for_timeout(900); s = await st()
        ck('live: loaded for the farm area with only that location\'s report in use', s['source'] == 'live' and s['used'] == 1 and s['feed'] is True, s)
        r = await parsed()
        ck('live: first record is one settled assessment with no Yuma reports in it', len(r) == 1 and r[0]['event'] == 'LIVE MODEL DATA LOADED' and r[0]['overall_decision'] == s['status'] and 'Crew' not in r[0]['site_concerns'] and 'People reported' not in r[0]['alert_reasons'] and 'Still air' not in r[0]['alert_reasons'], r)
        ck('live: record tagged with mode, location, source and feed state', r[0]['mode'] == 'live' and 'SouthWinds' in r[0]['location'] and r[0]['data_source'] == 'Live regional model' and r[0]['community_feed'] == 'checked' and r[0]['demo_data'] == 'false', r[0])
        ck('live: weather GO, drift report is a site concern, decision CAUTION', s['weather'] == 'GO' and s['concerns'] == 1 and s['status'] == 'CAUTION', s)
        js = await txt('#jobStrip')
        ck('weather window with an open concern does not imply the concern clears', 'WEATHER WINDOW ONLY' in js and 'Weather may be suitable during this window. Site concerns still require resolution.' in js and 'job fits' not in js, js)
        ck('ground comparison is like for like: same weather result, no credit for community reports', 'Same weather result' in await txt('#groundMiss'), await txt('#groundMiss'))
        rb = await tc('#rulesBox')
        ck('model rules: upper wind and shear marked not available, heights named', rb.count('NOT AVAILABLE') == 3 and 'Needs two sensors on a tower' in rb and 'at 10 m (model wind)' in rb and '80 m (about 260 ft) temperature greater than 2 m' in rb, rb[:600])
        ck('model rules: model uncertainty described, no sensor accuracy claim', 'Model uncertainty' in rb and 'Sensor accuracy' not in rb and 'sensor uncertainty' not in rb and 'do not replace measurements in the orchard' in rb)
        ck('default wind limits labelled as general guidance', 'general guidance, not confirmed for your product' in await txt('#rulesLine'))
        ck('ground comparison names the model wind height, not 5 ft', 'at 10 m' in await txt('#groundText'), await txt('#groundText'))
        await click('#modeSim'); await pg.wait_for_timeout(500); s = await st()
        ck('back to demo: 6:10 AM STOP, no reports in use, sensor wording restored', s['source'] == 'sim' and s['time'] == '6:10 AM' and s['used'] == 0 and 'Sensor accuracy' in await tc('#rulesBox') and 'NOT AVAILABLE' in await tc('#rulesBox'), s)

        print('Rapid switching and failures')
        net['wx_delay'] = 0.8
        await click('#modeLive'); await pg.wait_for_timeout(100); await click('#modeSim'); await pg.wait_for_timeout(1500); s = await st()
        ck('live then demo before the reply: the late reply is ignored', s['source'] == 'sim' and s['time'] == '6:10 AM' and s['logLen'] == 1 and not await pg.evaluate("document.getElementById('modeLive').disabled"), s)
        await click('#modeLive'); await pg.wait_for_timeout(100); await click('#modeSim'); await pg.wait_for_timeout(100); await click('#modeLive'); await pg.wait_for_timeout(1800); s = await st()
        r = await parsed()
        ck('live, demo, live in quick succession: ends live with exactly one load record', s['source'] == 'live' and len([x for x in r if 'LIVE MODEL DATA LOADED' in x['event']]) == 1, (s, [x['event'] for x in r]))
        await click('#modeSim'); await pg.wait_for_timeout(300)
        net['wx_delay'] = 0; net['sb_ok'] = False
        await click('#modeLive'); await pg.wait_for_timeout(900); s = await st(); r = await parsed()
        ck('failed community feed: shown as unavailable, not as zero reports', 'Community feed unavailable' in await txt('#splitLine') and r[0]['community_feed'] == 'unavailable' and 'community feed unavailable' in r[0]['event'] and s['feed'] is False, (await txt('#splitLine'), r[0]))
        net['sb_ok'] = True; await click('#modeSim'); await pg.wait_for_timeout(300)
        net['wx_ok'] = False; await click('#modeLive'); await pg.wait_for_timeout(700); s = await st()
        ck('failed weather request: stays on the demo and says so', s['source'] == 'sim' and 'could not be loaded' in await txt('#alertBar'), s)
        net['wx_ok'] = True

        print('Records and layout')
        ck('crop and pest reference tables list 10 crops and 16 pests with sources', await pg.evaluate("document.querySelectorAll('#cropT tbody tr').length") == 10 and await pg.evaluate("document.querySelectorAll('#pestT tbody tr').length") == 16 and await pg.evaluate("document.querySelectorAll('#pestT a[href*=\"arizona.edu\"]').length") == 16)
        so = await tc('#svOut')
        ck('savings estimate computes from the inputs and says when it does not pay', '$800' in so and '$720' in so and '$1,180 behind' in so and '2.4 saved jobs' in so, so)
        await pg.evaluate("const i=document.getElementById('svBad'); i.value='60'; i.dispatchEvent(new Event('input'))"); so = await tc('#svOut')
        ck('savings estimate updates when an input changes', '$2,880' in so and '$980 ahead' in so, so)
        head = (await rows()).split('\r\n')[0].split(',')
        ck('CSV export still works and carries the new tags', head[0] == 'measurement_timestamp' and head[-5:] == ['overall_decision', 'site_concerns', 'mode', 'location', 'community_feed'] and len(await parsed()) >= 1, head)
        order = await pg.evaluate("['statusCard','tower','jobStrip','tl','recent','jobSec'].map(id => Math.round(document.getElementById(id).getBoundingClientRect().top + scrollY))")
        ck('main screen order: decision, orchard picture, job strip, scenarios, alerts, then setup', order == sorted(order), order)
        ck('no posts were ever sent to the community database', net['posts'] == 0, net)
        ck('no page errors', not errs, errs)
        m = await ctx.new_page(); await m.set_viewport_size({'width': 390, 'height': 844}); await m.goto(URL); await m.wait_for_timeout(900)
        ck('mobile: decision, readings and scenario controls present with no sideways scroll', await m.is_visible('#statusWord') and await m.is_visible('#tower') and await m.is_visible('.jump') and await m.evaluate('document.documentElement.scrollWidth') <= 390, await m.evaluate('document.documentElement.scrollWidth'))
        await m.screenshot(path='/home/claude/a_mobile.png', full_page=True); await pg.screenshot(path='/home/claude/a_desktop.png', full_page=True)
        await b.close()
    f = [n for n, c in res if not c]; print(f'\n{len(res) - len(f)} passed, {len(f)} failed')
asyncio.run(main())
