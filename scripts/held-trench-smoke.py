"""Usage: python scripts/held-trench-smoke.py <production-build-dir> <evidence-dir>"""
import functools
import json
import math
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

build, out = map(Path, sys.argv[1:3])
out.mkdir(exist_ok=True, parents=True)
class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass

with ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(build))) as server, sync_playwright() as api:
    threading.Thread(target=server.serve_forever, daemon=True).start()
    browser = api.chromium.launch(channel='msedge',headless=True,args=['--enable-unsafe-swiftshader'])
    page = browser.new_page(viewport={'width':1540,'height':1040})
    errors = []
    page.on('pageerror',lambda e: errors.append(str(e)))
    page.goto(f'http://127.0.0.1:{server.server_port}/',wait_until='domcontentloaded')
    def ready():
        page.wait_for_function("!!document.querySelector('.canvas-host')?.__studio?.state",timeout=120000)
        page.evaluate("""()=>{window.st=document.querySelector('.canvas-host').__studio;
            window.f=()=>st.state.items.find(i=>i.kind==='female');window.fig=()=>st.getFigure(f().id);
            window.coat=()=>fig()?.skin.getObjectByName('Wardrobe: '+f().wardrobe?.outer);
            window.snap=()=>{const i=f();return [i.pose,i.handPose??null,i.position,i.wardrobe]};}""")
    def select():
        page.get_by_role('listitem').filter(has_text='Female 1').first.click()
    def btn(name):
        return page.get_by_role('button',name=name,exact=True)
    def outer(label):
        page.get_by_role('combobox',name='Outer garment').click()
        page.get_by_role('option',name=label,exact=True).click()
        page.wait_for_function('!!coat()')
    def sample(height=None):
        return page.evaluate("""height=>{const m=coat(),a=m.geometry.attributes.position,v=m.position.clone(),
          p=i=>m.localToWorld(v.clone().fromBufferAttribute(a,i)), palm=side=>{const h=fig().handRigs[side];return h.wristBone.getWorldPosition(v.clone()).lerp(h.fingers.middle.phalanges[0].bone.getWorldPosition(v.clone()),.72)};
          const edge=p(10812), opp=p(10543), grip=f().wardrobe.grip??'both',bindings={both:[[edge,'left'],[opp,'right']],left:[[edge,'left']],right:[[opp,'right']],leftCross:[[opp,'left']],rightCross:[[edge,'right']]}[grip];
          const cutY=height??bindings[0][0].y, ix=m.geometry.index.array,clear=[Infinity,Infinity];
          for(let k=0;k<ix.length;k+=3){if(ix[k]>=10400)continue;
            for(let j=0;j<3;j++){const u=ix[k+j],w=ix[k+(j+1)%3],y=a.getY(u),dy=a.getY(w)-y,t=(cutY-y)/dy;
              if(!(t>=0&&t<1)||a.getZ(u)+t*(a.getZ(w)-a.getZ(u))<.055)continue;
              const x=a.getX(u)+t*(a.getX(w)-a.getX(u));clear[+(x>0)]=Math.min(clear[+(x>0)],Math.abs(x));}}
          const shoulder=fig().bones.leftShoulder.getWorldPosition(v.clone());
          let nearest=0,dist=Infinity;
          for(let i=0;i<10930;i++){const d=p(i).distanceTo(shoulder);if(d<dist){nearest=i;dist=d}}
          const skin=fig().skin, feet=[Infinity,Infinity];
          for(let i=0;i<skin.geometry.attributes.position.count;i++){skin.getVertexPosition(i,v);skin.localToWorld(v);
            const side=+(v.x>0);feet[side]=Math.min(feet[side],v.y)}
          return {errorMm:Math.max(...bindings.map(([v,s])=>1000*v.distanceTo(palm(s)))),contact:bindings.map(([v,s])=>[s,1000*v.y,1000*v.distanceTo(palm(s))]),cutY,shellMm:1000*(clear[0]+clear[1]),widthMm:1000*(edge.x-opp.x),edge:edge.toArray(),
            shoulder:p(nearest).toArray(),feetMm:feet.map(x=>1000*x)};}""",height)
    def profile():
        return page.evaluate("""rails=>{const g=coat().geometry,a=g.attributes.position;
          const scan=y=>{let left=Infinity,right=-Infinity;for(const [u,v] of rails){
          const t=(y-a.getY(u))/(a.getY(v)-a.getY(u));
          if(!(t>=0&&t<1))continue;
          const x=a.getX(u)+t*(a.getX(v)-a.getX(u));if(x>=0)left=Math.min(left,x);else right=Math.max(right,x)}
          return [y,left*1000,right*1000,(left-right)*1000]};
          const b=(c)=>{const i=12945+2*65+c;return [a.getX(i),a.getY(i),a.getZ(i)]};
          return {sections:Array.from({length:47},(_,i)=>scan(.44+i*.020)),belt:[b(4),b(15),b(49),b(60)]}}""",rails)
    def frame(name, angle=False, full=False):
        page.evaluate("""([angle,full])=>{st.setHelpers(false,false);st.transform.detach();
          st.setOrbitView(full?(angle?[1.41,1.03,2.37]:[0,1.0,2.76]):(angle?[.89,1.42,1.35]:[0,1.35,1.70]),full?[0,.87,0]:[0,1.31,0]);st.render()}""",[angle,full])
        page.locator('.canvas-host canvas').first.screenshot(path=out/(name+'.png'))
    def solve():
        btn('Settle cloth').click()
        page.wait_for_function('!!f().wardrobe.drape',timeout=45000)
    ready(); select()
    page.evaluate("""()=>{const n=structuredClone(st.state), i=n.items.find(i=>i.kind==='female');
      n.items=n.items.filter(o=>o===i||o.kind==='light');i.position=[0,0,0];i.rotation=[0,0,0];
      for(const j in i.pose)i.pose[j]=[0,0,0];i.pose.rightElbow=[-.24,0,0];st.options.change(n);}""")
    page.get_by_label('Tank top',exact=True).check()
    page.get_by_label('Pencil skirt',exact=True).check()
    plain='Unbuttoned trench coat'
    held='Trench coat — held open'
    outer(plain)
    # Identify the two open shell boundaries on the neutral ordinary mesh once,
    # so a crossed sleeve is not mistaken for a placket during later measurements.
    rails=page.evaluate("""()=>{const g=coat().geometry,a=g.attributes.position,ix=g.index.array,edges=new Map;
      for(let k=0;k<ix.length;k+=3)for(let j=0;j<3;j++){const u=ix[k+j],v=ix[k+(j+1)%3];
      if(Math.max(u,v)>=10400 || Math.min(a.getZ(u),a.getZ(v))<.03 || Math.max(Math.abs(a.getX(u)),Math.abs(a.getX(v)))>.08)continue;
      const key=Math.min(u,v)*65536+Math.max(u,v);edges.set(key,(edges.get(key)??0)+1)}
      const lines=[...edges].filter(([,n])=>n===1).map(([k])=>[Math.floor(k/65536),k%65536]);
      for(let i=0;i<30;i++)for(const c of [0,64])lines.push([10930+i*65+c,10930+(i+1)*65+c]);return lines}""")
    before=page.evaluate('snap()')
    frame('plain')
    outer(held)
    gesture=page.evaluate('snap()')
    assert gesture[0]!=before[0] and gesture[1]['left']['thumbOpposition']>.5
    assert not page.get_by_text('Garment pins',exact=True).count() and not btn('Pick garment point').count()
    initial=sample()
    assert max(map(abs,initial['feetMm']))<1,initial
    frame('held')
    frame('held-angle',True)
    full_profiles={'held':profile()}
    frame('full-held',full=True);frame('full-held-angle',True,True)
    btn('Undo (Ctrl Z)').click()
    assert page.evaluate('snap()')==before
    btn('Redo (Ctrl Shift Z)').click()
    page.wait_for_function('!!coat()')
    assert page.evaluate('snap()')==gesture
    outer(plain)
    same_pose_plain=sample(initial['cutY'])
    assert page.evaluate('snap().slice(0,3)')==gesture[:3]
    frame('plain-same-pose')
    frame('plain-angle',True)
    full_profiles['plain']=profile()
    frame('full-plain',full=True);frame('full-plain-angle',True,True)
    assert initial['widthMm']-same_pose_plain['widthMm']>95
    assert math.dist(initial['shoulder'],same_pose_plain['shoulder'])<.0001
    btn('Undo (Ctrl Z)').click()
    page.wait_for_function('!!coat()')
    solve()
    full_profiles['settled']=profile()
    frame('full-settled',full=True);frame('full-settled-angle',True,True)
    page.evaluate("""()=>{const n=structuredClone(st.state);n.items.find(i=>i.kind==='female').pose.leftElbow[0]-=.12;st.options.change(n)}""")
    page.wait_for_function('!f().wardrobe.drape')
    live=sample(); solve(); settled=sample()
    assert math.dist(initial['edge'],live['edge'])>.03,(initial,live)
    assert math.dist(live['shoulder'],settled['shoulder'])<.0001,(live,settled)
    edited=page.evaluate('snap()')
    page.wait_for_function("""async()=>{const db=await new Promise(ok=>{const r=indexedDB.open('pose-n-composition-v1',1);r.onsuccess=()=>ok(r.result)});
      try{return await new Promise(ok=>{const r=db.transaction(db.objectStoreNames[0]).objectStore(db.objectStoreNames[0]).get('__autosave__:working_scene');
      r.onsuccess=()=>ok(r.result?.scene.items.find(i=>i.kind==='female')?.wardrobe?.drape?.poseKey===f().wardrobe.drape.poseKey)})}finally{db.close()}}""",timeout=20000)
    page.reload(wait_until='domcontentloaded'); ready(); select()
    page.wait_for_function('!!coat() && !!f().wardrobe.drape')
    assert page.evaluate('snap()')==edited
    frame('edited-reloaded')
    replay=sample()
    btn('Reset drape').click()
    assert not page.evaluate('!!f().wardrobe.drape')
    reset=sample()
    btn('Undo (Ctrl Z)').click()
    assert page.evaluate('snap()')==edited
    btn('Scene & Pose Library').click()
    with page.expect_download() as ev:
        btn('Scene JSON').click()
    data=ev.value.path().read_bytes()
    page.evaluate("""()=>{const n=structuredClone(st.state);delete n.items.find(i=>i.kind==='female').wardrobe;st.options.change(n)}""")
    page.get_by_label('Import JSON file').set_input_files({'name':'coat.scene.json','mimeType':'application/json','buffer':data})
    page.wait_for_function("!!coat() && !!f().wardrobe.drape")
    assert page.evaluate('snap()')==edited
    for state in [initial,live,settled,replay,reset,sample()]:
        assert state['errorMm']<.1,state
    page.reload(wait_until='domcontentloaded');ready();select()
    cases={}
    for key,side,edge in [('left','Left','left'),('right','Right','right'),('leftCross','Left','right'),('rightCross','Right','left')]:
        page.get_by_role('combobox',name='Opening gesture').click()
        page.get_by_role('option',name=f'{side} hand — {edge} lapel',exact=True).click()
        page.wait_for_function("k=>f().wardrobe.grip===k",arg=key)
        assert list(page.evaluate('f().handPose'))==[side.lower()]
        first=sample()
        full_profiles[key]=profile()
        frame(key)
        solve();draped=sample()
        for s in [first,draped]:
            assert s['errorMm']<.1 and 1290<s['contact'][0][1]<1410,s
        outer(plain);ordinary=sample(first['cutY'])
        btn('Undo (Ctrl Z)').click();page.wait_for_function('!!coat()')
        page.evaluate("""side=>{const n=structuredClone(st.state);n.items.find(i=>i.kind==='female').pose[side+'Elbow'][0]-=.085;st.options.change(n)}""",side.lower())
        page.wait_for_function('!f().wardrobe.drape');solve();moved=sample()
        outer(plain);ordinary_moved=sample(moved['cutY'])
        btn('Undo (Ctrl Z)').click();page.wait_for_function('!!coat()')
        for a,b in [(first,ordinary),(draped,ordinary),(moved,ordinary_moved)]:
            assert a['errorMm']<.1 and a['widthMm']>b['widthMm']+30 and a['shellMm']>b['shellMm']+25,(key,a,b)
        cases[key]={'equip':first,'plain':ordinary,'settled':draped,'editedSettled':moved,'editedPlain':ordinary_moved}
    for key,fit in full_profiles.items():
        if key=='plain': continue
        rows=fit['sections']
        for col in [1,2]:
            path=[r[col] for r in rows]
            assert max(path)-min(path)<25,(key,col,path)
        end1,loop1,loop2,end2=fit['belt']
        assert min(loop1[1]-end1[1],loop2[1]-end2[1])>.18
        assert min(end1[0],-end2[0])>.16
    assert not errors,errors
    browser.close()
    server.shutdown()

sheet=Image.new('RGB',(1200,570),'#202427')
for k,(name,label) in enumerate([('plain-same-pose','Plain coat | same gesture'),('held','Held open | on equip'),('edited-reloaded','Arm edited | settled and reloaded')]):
    im=Image.open(out/(name+'.png')).convert('RGB')
    w,h=im.size
    im=im.crop(((w-h*.73)/2,0,(w+h*.73)/2,h))
    im.thumbnail((398,535))
    sheet.paste(im,(400*k+(400-im.width)//2,32))
    ImageDraw.Draw(sheet).text((400*k+16,10),label,fill='white')
sheet.save(out/'held-trench-comparison.jpg',quality=95)
def grid(filename, pictures):
    sheet=Image.new('RGB',(1000,936),'#202427')
    for k,(name,label) in enumerate(pictures):
        im=Image.open(out/(name+'.png')).convert('RGB')
        w,h=im.size
        im=im.crop(((w-h*.94)/2,h*.07,(w+h*.94)/2,h*.89))
        im.thumbnail((498,436))
        x,y=500*(k%2),468*(k//2)
        sheet.paste(im,(x+(500-im.width)//2,y+29))
        ImageDraw.Draw(sheet).text((x+12,y+8),label,fill='white')
    sheet.save(out/filename,quality=95)
grid('matched-lapels.jpg',[('plain-same-pose','Ordinary | same gesture'),('held','Held open | both hands'),('plain-angle','Ordinary | three-quarter'),('held-angle','Held open | three-quarter')])
grid('single-grips.jpg',[('left','Left hand, left lapel'),('right','Right hand, right lapel'),('leftCross','Left hand, right lapel'),('rightCross','Right hand, left lapel')])
sheet=Image.new('RGB',(1290,1310),'#202427')
for k,(name,label) in enumerate([('plain','Ordinary coat'),('held','Held open, fitted'),('settled','Held open, settled')]):
    for row,suffix in enumerate(['','-angle']):
        im=Image.open(out/('full-'+name+suffix+'.png')).convert('RGB')
        w,h=im.size; im=im.crop(((w-h*.62)/2,0,(w+h*.62)/2,h));im.thumbnail((425,620))
        sheet.paste(im,(430*k+(430-im.width)//2,655*row+30))
        ImageDraw.Draw(sheet).text((430*k+12,655*row+8),label+(' | three-quarter' if row else ' | front'),fill='white')
sheet.save(out/'full-length.jpg',quality=95)
evidence=dict(plain=same_pose_plain,held=initial,edited=live,settled=settled,reloaded=replay,reset=reset,singles=cases)
evidence['fullLength']=full_profiles
(out/'checks.json').write_text(json.dumps(evidence,indent=2))
for key,s in cases.items():
    print(key,[(k,round(v['widthMm']),round(v['shellMm']),round(v['errorMm'],5)) for k,v in s.items()])
