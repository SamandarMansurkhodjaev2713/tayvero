from playwright.sync_api import sync_playwright
from pathlib import Path
import json
import argparse
import shutil

parser = argparse.ArgumentParser(description="Render the standalone theme fixture; not authenticated CRM E2E.")
parser.add_argument("--html", required=True, type=Path)
parser.add_argument("--out", required=True, type=Path)
parser.add_argument("--chromium", default=shutil.which("chromium"))
args = parser.parse_args()
if not args.chromium:
    parser.error("Supply an installed Chromium executable via --chromium.")
O = args.out
O.mkdir(parents=True, exist_ok=True)
results=[]
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=args.chromium,headless=True,args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':1440,'height':1080},device_scale_factor=1)
 errors=[];page.on('pageerror',lambda err:errors.append(str(err)))
 page.set_content(args.html.read_text(encoding='utf-8'), wait_until='load')
 for palette in ['graphite','grove','sand','indigo']:
  for mode in ['light','dark']:
   for width in [1440,768,390]:
    page.set_viewport_size({'width':width,'height':1080})
    page.locator(f'input[name=palette][value={palette}]').check()
    page.locator(f'input[name=mode][value={mode}]').check()
    page.wait_for_timeout(30)
    actual=page.evaluate('({palette:document.documentElement.dataset.palette,dark:document.documentElement.classList.contains("dark"),overflow:document.documentElement.scrollWidth>innerWidth})')
    assert actual['palette']==palette and actual['dark']==(mode=='dark') and not actual['overflow'],actual
    results.append({'palette':palette,'mode':mode,'width':width,'horizontalPageOverflow':False,'status':'passed'})
    page.evaluate('window.scrollTo(0,0)')
    if width==1440 and ((palette,mode) in [('graphite','light'),('grove','dark'),('sand','light'),('indigo','dark')]):
     page.screenshot(path=str(O/f'appearance-{palette}-{mode}.png'),full_page=True)
    if width==390 and palette=='graphite' and mode=='light':page.screenshot(path=str(O/'appearance-mobile.png'),full_page=True)
 page.set_viewport_size({'width':1440,'height':1080})
 page.locator('input[name=density][value=comfortable]').check();a=page.locator('td').first.bounding_box()['height']
 page.locator('input[name=density][value=compact]').check();b=page.locator('td').first.bounding_box()['height'];assert b<a
 results.append({'check':'density changes rendered row height','comfortablePx':a,'compactPx':b,'status':'passed'})
 page.locator('input[name=navigation][value=compact]').check();assert page.locator('nav').first.bounding_box()['width']==56
 page.locator('input[name=navigation][value=expanded]').check();assert page.locator('nav').first.bounding_box()['width']==192
 results.append({'check':'navigation toggle','status':'passed'})
 assert 'session' in page.locator('#saved-status').inner_text()
 results.append({'check':'storage denial shows session-only feedback','status':'passed'})
 page.keyboard.press('Control+k');assert page.locator('dialog').evaluate('(el)=>el.open');page.keyboard.press('Escape');assert not page.locator('dialog').evaluate('(el)=>el.open')
 results.append({'check':'keyboard search dialog and escape','status':'passed'})
 page.locator('#reset').click();assert page.locator('input[name=palette][value=graphite]').is_checked();assert page.locator('input[name=mode][value=system]').is_checked()
 page.emulate_media(color_scheme='dark',reduced_motion='reduce');page.wait_for_function('document.documentElement.classList.contains("dark")')
 results.append({'check':'reset + system scheme + reduced-motion CSS','status':'passed'})
 assert not errors,errors
 browser.close()
(O/'browser-fixture-report.json').write_text(json.dumps({'scope':'Standalone token/layout fixture via set_content. No server or navigation-policy changes. Real-origin localStorage persistence and authenticated Next E2E are NOT verified.','browser':'system Chromium via Python Playwright','checks':results,'pageErrors':errors},indent=2))
print(f'{len(results)} browser fixture checks passed')
