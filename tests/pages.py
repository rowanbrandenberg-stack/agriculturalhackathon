# Checks the page tabs and that live mode hides the demo playback controls.
import json, os
from playwright.sync_api import sync_playwright
ROOT = 'file://' + os.path.dirname(os.path.dirname(os.path.abspath(__file__))) + '/index.html'
ok = bad = 0
def ck(name, cond):
    global ok, bad
    if cond: ok += 1
    else: bad += 1; print('  FAIL', name)
import datetime
d0 = datetime.datetime.now().replace(minute=0, second=0, microsecond=0, hour=0)
T = [(d0 + datetime.timedelta(hours=i)).strftime('%Y-%m-%dT%H:00') for i in range(48)]
pt = {'hourly': {'time': T, 'temperature_2m': [70.0] * 48, 'temperature_80m': [66.0] * 48, 'wind_speed_10m': [5.0] * 48, 'wind_speed_80m': [15.0] * 48, 'wind_direction_10m': [330] * 48, 'wind_direction_80m': [300] * 48}}
WX = json.dumps([pt] * 29)
def om(route): route.fulfill(status=200, content_type='application/json', body=WX)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    pg = b.new_page(viewport={'width': 1280, 'height': 900})
    pg.route('**/api.open-meteo.com/**', om)
    pg.route('**/*.supabase.co/**', lambda r: r.fulfill(status=204 if r.request.method == 'OPTIONS' else 200, content_type='application/json', headers={'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*'}, body='[]'))
    pg.goto(ROOT); pg.wait_for_timeout(600)
    pg.evaluate('window.__sow.pages(true)')
    vis = lambda s: pg.is_visible(s)
    ck('tabs are shown', vis('#pages'))
    ck('Now page shows the decision and hides the guide', vis('.hero') and not vis('#pestSec') and not vis('#rulesSec'))
    pg.click('#pages button[data-page="plan"]')
    ck('Plan page shows job setup opened and hides the decision', vis('#jobSec') and not vis('.hero') and pg.evaluate("document.getElementById('jobSec').open"))
    pg.click('#pages button[data-page="guide"]')
    ck('Guide page shows the crop guide only', vis('#pestSec') and vis('#chemSec') and not vis('#jobSec'))
    pg.click('#pages button[data-page="records"]')
    ck('Records page', vis('#fileSec') and vis('#recordSec') and not vis('#pestSec'))
    pg.click('#pages button[data-page="community"]')
    ck('Community page', vis('#nbrSec') and vis('#netSec') and vis('#waitSec'))
    pg.click('#pages button[data-page="now"]')
    ck('back to Now', vis('.hero') and vis('#play') and vis('#scen'))
    pg.click('#play'); pg.wait_for_timeout(300)
    ck('demo plays', pg.evaluate('window.__sow.state().playing'))
    pg.click('#modeLive'); pg.wait_for_function("window.__sow.state().source === 'live'", timeout=8000)
    st = pg.evaluate('window.__sow.state()')
    ck('going live stops playback', st['playing'] is False)
    ck('live hides Play, speed, scenarios and Reset demo', not vis('#play') and not vis('#speed') and not vis('#scen') and not vis('#demoReset'))
    ck('live title', 'Today and tomorrow' in pg.inner_text('#tlTitle'))
    pg.click('#modeSim'); pg.wait_for_timeout(400)
    ck('demo controls return', vis('#play') and vis('#speed') and vis('#scen'))
    pg.screenshot(path='/home/claude/pg_now.png')
    pg.click('#pages button[data-page="plan"]'); pg.wait_for_timeout(200); pg.screenshot(path='/home/claude/pg_plan.png')
    b.close()
print(ok, 'passed,', bad, 'failed')
