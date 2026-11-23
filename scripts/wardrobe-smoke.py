"""Capture studio wardrobe evidence in a new headless Edge profile. Pass URL and output directory."""
import sys
from pathlib import Path
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

url, directory = sys.argv[1:3]
stress = '--stress' in sys.argv[3:]
out = Path(directory)
out.mkdir(parents=True, exist_ok=True)
shots = [
    ('Tank top', {'tank': True}, 'front'),
    ('Jacket', {'outer': 'jacket'}, 'front'),
    ('Unbuttoned trench', {'outer': 'trench'}, 'front'),
    ('Pencil skirt', {'skirt': True}, 'front'),
    *[(f'{outer.title()} layers', {'tank': True, 'skirt': True, 'outer': outer}, view)
      for outer in ('jacket', 'trench') for view in ('front', 'rear', 'posed', 'posed rear')],
]
if stress:
    shots = [(title, {'tank': True, 'skirt': True, 'outer': outer}, view)
             for title, view, outer in [
                 ('Arm raised', 'raised', 'jacket'), ('Bent elbow', 'bent', 'trench'),
                 ('Twist', 'twist rear', 'jacket'), ('One thigh raised', 'thigh', 'trench'),
                 ('Seated', 'seated', 'trench'), ('Seated', 'seated rear', 'trench'),
                 ('Seated', 'seated', 'jacket'), ('Reset', 'reset', 'jacket'),
                 ('Chubby', 'chubby', 'trench'), ('Chibi', 'chibi', 'jacket'),
                 ('Rigid root', 'transformed', 'trench'), ('Reset', 'reset rear', 'trench')]]

with sync_playwright() as api:
    browser = api.chromium.launch(channel='msedge', headless=True, args=['--enable-unsafe-swiftshader'])
    page = browser.new_page(viewport={'width': 1600, 'height': 950})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.goto(url, wait_until='domcontentloaded')
    page.wait_for_function("!!document.querySelector('.canvas-host')?.__studio?.state", timeout=120000)
    page.get_by_role('listitem').filter(has_text='Female 1').first.click()
    page.get_by_label('Tank top', exact=True).check()
    page.get_by_label('Pencil skirt', exact=True).check()
    outer = page.get_by_role('combobox', name='Outer garment')
    outer.click()
    page.get_by_role('option', name='Jacket', exact=True).click()
    outer.click()
    page.get_by_role('option', name='Unbuttoned trench coat', exact=True).click()
    page.get_by_role('button', name='Undo (Ctrl Z)', exact=True).click()
    assert outer.inner_text().strip() == 'Jacket'
    page.get_by_role('button', name='Redo (Ctrl Shift Z)', exact=True).click()
    assert outer.inner_text().strip() == 'Unbuttoned trench coat'
    page.wait_for_function("!!document.querySelector('.autosave-badge.saved')", timeout=15000)
    page.reload(wait_until='domcontentloaded')
    page.wait_for_function("""document.querySelector('.canvas-host')?.__studio?.state?.items
      .some(i=>i.kind==='female' && i.wardrobe?.tank && i.wardrobe?.skirt && i.wardrobe?.outer==='trench')""")
    page.get_by_role('listitem').filter(has_text='Female 1').first.click()
    page.get_by_label('Tank top', exact=True).uncheck()
    page.get_by_label('Pencil skirt', exact=True).uncheck()
    outer.click()
    page.get_by_role('option', name='No outer garment', exact=True).click()
    page.wait_for_function("""[...document.querySelector('.canvas-host').__studio.entries.values()]
      .filter(e=>e.figure).every(e=>!e.figure.skin.children.some(m=>m.name.startsWith('Wardrobe:')))""")
    print('UI equip, swap, undo, redo, reload, removal passed', flush=True)
    page.evaluate("""() => {
      const s = document.querySelector('.canvas-host').__studio, state = structuredClone(s.state);
      const i = state.items.find(i => i.kind === 'female');
      state.items = state.items.filter(o => o.kind === 'light' || o === i);
      i.position=[0,0,0]; i.rotation=[0,0,0]; i.scale=[1,1,1]; i.hairStyle='none';
      for (const j in i.pose) i.pose[j]=[0,0,0];
      window.wardrobeFixture=state;
    }""")
    for idx, (name, slots, view) in enumerate(shots):
        page.evaluate("""([slots,view]) => {
          const s=document.querySelector('.canvas-host').__studio;
          const state=structuredClone(window.wardrobeFixture), i=state.items.find(i=>i.kind==='female');
          i.wardrobe=slots;
          if(slots.tank && slots.skirt) i.dressMapId='none';
          if(view.includes('posed')){
            i.pose.leftShoulder=[-.14,.05,.56]; i.pose.rightShoulder=[0,0,-.22];
            i.pose.leftElbow=[-.83,.05,0]; i.pose.leftHip=[-.26,0,.12]; i.pose.leftKnee=[.32,0,0];
            i.pose.chest=[.02,.14,.03];
          }
          if(view==='raised'||view==='chibi') i.pose.leftShoulder=[0,0,1.9];
          if(view==='bent') { i.pose.leftShoulder=[0,0,.5]; i.pose.leftElbow=[-1.55,.42,0] }
          if(view.includes('twist')) { i.pose.chest=[0,.48,0]; i.pose.leftElbow=[-.54,.96,0] }
          if(view==='thigh'||view.includes('seated')||view==='chubby') {
            i.pose.leftHip=[-1.3,0,.1]; i.pose.leftKnee=[1.5,0,0];
            if(view.includes('seated')) { i.pose.rightHip=[-1.3,0,-.1]; i.pose.rightKnee=[1.5,0,0] }
          }
          if(view==='chubby'||view==='chibi') i.bodyType=view;
          if(view==='transformed') { i.position=[1,.2,.3]; i.rotation=[0,.44,.1] }
          s.sync(state); s.select(null); s.helpers=false;
          const rear=view.includes('rear'), side=/posed|thigh|seated|chubby|bent/.test(view)?1.2:.09;
          const [x,y,z]=i.position;
          s.setOrbitView([x+side,y+1.1,z+(rear?-2.45:2.45)],[x,y+.91,z]);
        }""", [slots, view])
        page.wait_for_function("""(count) => {
          const e=[...document.querySelector('.canvas-host').__studio.entries.values()].find(e=>e.figure);
          return e.figure.skin.children.filter(m=>m.name.startsWith('Wardrobe:')).length===count
        }""", arg=len(slots))
        page.evaluate("() => document.querySelector('.canvas-host').__studio.render()")
        shot = out/f'{idx:02d}.png'
        page.locator('.canvas-host canvas').first.screenshot(path=shot)
        print(name, view, flush=True)
    browser.close()
    assert not errors, errors

sheet = Image.new('RGB', (4*300, 3*440), '#20252b')
draw = ImageDraw.Draw(sheet)
for idx, (name, _, view) in enumerate(shots):
    img = Image.open(out/f'{idx:02d}.png')
    w, h = img.size
    img = img.crop(((w-.72*h)/2, 0, (w+.72*h)/2, h)).resize((300, 414), Image.Resampling.LANCZOS)
    x, y = idx%4*300, idx//4*440
    sheet.paste(img, (x, y))
    draw.text((x+10,y+420), f'{name} | {view}', fill='white')
sheet.save(out/('wardrobe-stress.jpg' if stress else 'wardrobe-studio.jpg'), quality=93)
