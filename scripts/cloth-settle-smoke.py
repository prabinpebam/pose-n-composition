"""Run against a private production preview. Captures real viewport/controls without owner storage."""
import sys
import json
from pathlib import Path
from time import perf_counter
from PIL import Image, ImageDraw, ImageChops
from playwright.sync_api import sync_playwright

url, directory = sys.argv[1:3]
out = Path(directory)
out.mkdir(parents=True, exist_ok=True)
studio = "document.querySelector('.canvas-host').__studio"
female = f"{studio}.state.items.find(i=>i.kind==='female')"
drape = f"({female}).wardrobe?.drape"
hash_geometry = """() => {
 const s=document.querySelector('.canvas-host').__studio;
 const f=s.getFigure(s.state.items.find(i=>i.kind==='female').id);
 return f.skin.children.filter(c=>c.name.startsWith('Wardrobe:')).map(c=>{
   let h=2166136261;
   for(const v of c.geometry.attributes.position.array) h=Math.imul(h^Math.round(v*1e6),16777619);
   return c.name+':'+h;
 }).sort().join('|');
}"""
with sync_playwright() as api:
    browser = api.chromium.launch(channel='msedge', headless=True, args=['--enable-unsafe-swiftshader'])
    page = browser.new_page(viewport={'width': 1600, 'height': 1020})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(url, wait_until='domcontentloaded')
    page.wait_for_function(f"!!document.querySelector('.canvas-host')?.__studio?.state", timeout=120000)
    page.get_by_role('listitem').filter(has_text='Female 1').first.click()
    page.evaluate("""() => {
      const s=document.querySelector('.canvas-host').__studio, state=structuredClone(s.state);
      const i=state.items.find(i=>i.kind==='female');state.items=state.items.filter(o=>o.kind==='light'||o===i);
      i.position=[0,0,0]; i.rotation=[0,0,0]; i.scale=[1,1,1]; i.hairStyle='none'; i.dressMapId='none';
      for(const j in i.pose) i.pose[j]=[0,0,0];
      i.pose.leftShoulder=[0,0,.52]; i.pose.leftElbow=[-1.5,.4,0];
      i.pose.leftHip=[-1.3,0,.1]; i.pose.rightHip=[-1.3,0,-.1];
      i.pose.leftKnee=[1.5,0,0]; i.pose.rightKnee=[1.5,0,0];
      s.options.change(state);
    }""")
    page.get_by_label('Tank top', exact=True).check()
    page.get_by_label('Pencil skirt', exact=True).check()
    page.get_by_role('combobox', name='Outer garment').click()
    page.get_by_role('option', name='Unbuttoned trench coat').click()
    page.wait_for_function(f"{studio}.getFigure(({female}).id).skin.children.filter(c=>c.name.startsWith('Wardrobe:')).length===3")
    field = page.locator('.wardrobe-controls').first
    view = page.locator('.canvas-host canvas').first
    def shot(file):
        page.evaluate(f"""() => {{ const s={studio}; s.helpers=false; s.transform.detach();
           s.setOrbitView([1.48,1.14,1.83],[0,.96,.1]); s.render(); }}""")
        view.screenshot(path=out/file)
    shot('authored.png')
    for id, preset in [('Tank','Crimson'),('Skirt','Charcoal'),('Trench','Emerald')]:
        page.get_by_role('button', name=f'{id} color: {preset}', exact=True).click()
    def trench_color():
        return page.evaluate(f"{studio}.getFigure(({female}).id).skin.getObjectByName('Wardrobe: trench').material[0].color.getHexString()")
    assert trench_color() == '1d7a5f'
    undo = page.get_by_role('button', name='Undo (Ctrl Z)', exact=True)
    redo = page.get_by_role('button', name='Redo (Ctrl Shift Z)', exact=True)
    undo.click()
    assert trench_color() == 'bc9369'
    redo.click()
    before = page.evaluate(hash_geometry)
    shot('fitted.png')
    settle = page.get_by_role('button', name='Settle cloth', exact=True)
    settle.click()
    page.get_by_role('button',name='Cancel settle',exact=True).click()
    page.wait_for_function(f"!{studio}.clothJob && !{drape}")
    assert page.evaluate(hash_geometry)==before
    settle.evaluate("""btn=>{btn.click();document.querySelector('.canvas-host').__studio.select(null,null)}""")
    page.wait_for_function(f"!{studio}.clothJob && !{drape}")
    page.get_by_role('listitem').filter(has_text='Female 1').first.click()
    # Swapping the outer slot during a run must not deliver a stale trench bake.
    settle.evaluate("""btn=>{btn.click();const s=document.querySelector('.canvas-host').__studio;
      const next=structuredClone(s.state);next.items.find(i=>i.kind==='female').wardrobe.outer='jacket';s.options.change(next);}""")
    page.wait_for_function(f"({female}).wardrobe.outer==='jacket' && !{studio}.clothJob && !{drape}")
    page.get_by_role('button',name='Jacket color: Cobalt',exact=True).click()
    page.wait_for_function(f"{studio}.getFigure(({female}).id).skin.getObjectByName('Wardrobe: jacket')?.material[0].color.getHexString()==='1f4fd6'")
    undo.click()
    undo.click()
    page.wait_for_function(f"!!{studio}.getFigure(({female}).id).skin.getObjectByName('Wardrobe: trench')")
    # Trigger the real button and change the pose synchronously while worker is running.
    settle.evaluate("""btn=>{btn.click(); const s=document.querySelector('.canvas-host').__studio;
      const next=structuredClone(s.state);next.items.find(i=>i.kind==='female').pose.chest=[0,.17,0];s.options.change(next);}""")
    page.wait_for_function(f"!{studio}.clothJob && !{drape}")
    undo.click()
    page.wait_for_function(f"({female}).pose.chest[1]===0")
    start = perf_counter()
    settle.click()
    page.wait_for_function(f"!!{drape}", timeout=60000)
    print('End-to-end settle seconds', round(perf_counter()-start,2),flush=True)
    after = page.evaluate(hash_geometry)
    assert after != before
    actual=page.evaluate(f"Object.fromEntries(Object.entries({drape}.layers).map(([k,l])=>[k,l.pattern]))")
    print('Loaded production pattern fingerprints:',actual,flush=True)
    shot('settled.png')
    field.screenshot(path=out/'controls.png')
    reset = page.get_by_role('button', name='Reset drape', exact=True)
    reset.click()
    assert page.evaluate(hash_geometry) == before
    undo.click()
    assert page.evaluate(hash_geometry) == after
    redo.click()
    assert page.evaluate(hash_geometry) == before
    undo.click()
    page.wait_for_function(f"!!{drape}")
    page.wait_for_function("!!document.querySelector('.autosave-badge.saved')", timeout=20000)
    # A saved badge can briefly be from the previous history entry. Observe the
    # real IndexedDB commit before starting a new document, not an arbitrary delay.
    page.wait_for_function("""async () => {
      const db=await new Promise((ok,no)=>{const r=indexedDB.open('pose-n-composition-v1',1);
        r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)});
      try {const name=db.objectStoreNames[0], record=await new Promise((ok,no)=>{
        const r=db.transaction(name).objectStore(name).get('__autosave__:working_scene');
        r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)});
        return !!record?.scene.items.find(i=>i.kind==='female')?.wardrobe?.drape;
      } finally {db.close()}
    }""",timeout=15000)
    page.reload(wait_until='domcontentloaded')
    page.wait_for_function("!!document.querySelector('.canvas-host')?.__studio?.state", timeout=120000)
    try:
        page.wait_for_function(f"!!{drape} && {studio}.getFigure(({female}).id).skin.children.filter(c=>c.name.startsWith('Wardrobe:')).length===3")
    except Exception:
        print('Reload diagnostics:', page.evaluate(f"""() => {{const s={studio},i={female};
          return [!!i.wardrobe?.drape,i.wardrobe?.outer,s.getFigure(i.id).skin.children.map(c=>c.name),
          document.querySelector('.notice')?.textContent,document.body.innerText.slice(-450)];}}"""),errors,flush=True)
        raise
    assert page.evaluate(hash_geometry) == after and trench_color() == '1d7a5f'
    page.wait_for_function(f"{studio}.getPerfSnapshot().idlePaused", timeout=20000)
    first=page.evaluate(f"{studio}.getPerfSnapshot().totalFrames")
    page.wait_for_timeout(1250)
    frames=page.evaluate(f"{studio}.getPerfSnapshot().totalFrames")-first
    assert frames == 0 and not page.evaluate(f"!!{studio}.clothJob")
    page.get_by_role('button',name='Scene & Pose Library',exact=True).click()
    with page.expect_download() as event:
        page.get_by_role('button',name='Scene JSON',exact=True).click()
    download=event.value.path()
    exported=json.loads(download.read_bytes())
    saved=next(i for i in exported['items'] if i['kind']=='female')['wardrobe']
    assert set(saved['drape']['layers'])=={'tank','skirt','trench'} and saved['colors']['trench']=='#1d7a5f'
    page.evaluate(f"""() => {{ const s={studio}, next=structuredClone(s.state);
      delete next.items.find(i=>i.kind==='female').wardrobe; s.options.change(next); }}""")
    page.wait_for_function(f"!({female}).wardrobe")
    page.get_by_label('Import JSON file').set_input_files({'name':'cloth.scene.json','mimeType':'application/json','buffer':download.read_bytes()})
    page.wait_for_function(f"!!{drape} && {studio}.getFigure(({female}).id).skin.children.filter(c=>c.name.startsWith('Wardrobe:')).length===3")
    assert page.evaluate(hash_geometry) == after
    print('Reset, undo, redo, canceled edit, replay, tint, idle frames (1.25s):', frames,flush=True)
    assert not errors, errors
    browser.close()

images = [Image.open(out/name).convert('RGB') for name in ['authored.png','fitted.png','settled.png']]
assert ImageChops.difference(images[1],images[2]).getbbox()
w,h=images[0].size
sheet = Image.new('RGB',(1260,660),'#20252b')
for i,img in enumerate(images):
    crop=img.crop(((w-.64*h)/2,0,(w+.64*h)/2,h))
    crop.thumbnail((307,600))
    sheet.paste(crop,(i*318,36))
    ImageDraw.Draw(sheet).text((i*318+8,14),['Authored colors','Recolored / fitted','Same pose / settled'][i],fill='white')
controls=Image.open(out/'controls.png').convert('RGB')
controls.thumbnail((302,600))
sheet.paste(controls,(954,36))
ImageDraw.Draw(sheet).text((962,14),'3D wardrobe controls',fill='white')
sheet=sheet.crop((0,0,1260,max(36+controls.height,36+crop.height)+8))
sheet.save(out/'cloth-settle.jpg',quality=94)
