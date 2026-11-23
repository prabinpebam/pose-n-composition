"""Run against a local studio URL: python scripts/joint-target-smoke.py http://127.0.0.1:5173/

Uses a fresh headless Edge profile, the default Male 1 fixture, and Playwright.
Only reads the studio for measurements; gestures and history go through the UI.
"""
import json
import math
import re
import sys

from playwright.sync_api import sync_playwright


def settle(page):
    page.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")


def select(page, joint):
    page.get_by_role("combobox", name="Editing joint").click()
    label = re.sub(r"([A-Z])", r" \1", joint)
    page.get_by_role("option", name=re.compile(rf"^{label}$", re.I)).click()
    page.wait_for_function("j => document.querySelector('.canvas-host').__studio.joint === j", arg=joint)
    settle(page)


def observe(page):
    return page.evaluate("""() => {
      const s = document.querySelector('.canvas-host').__studio, e = s.entries.get(s.selected);
      const world = b => b.getWorldPosition(b.position.clone());
      const pos = Object.fromEntries(Object.entries(e.figure.bones).map(([j,b]) => [j, world(b).toArray()]));
      const q = e.figure.bones[s.joint].quaternion.toArray();
      return {pos, q, camera:s.editorCamera.matrixWorld.toArray(), mode:s.transform.getMode()};
    }""")


def handle(page, mode):
    # Pick a visible, raycastable handle, not an assumed screen pixel.
    return page.evaluate("""mode => {
      const s=document.querySelector('.canvas-host').__studio, t=s.transform;
      const e=s.entries.get(s.selected), g=t.getHelper().children[0];
      if (t.getMode()!==mode || !t.object) throw Error('No '+mode+' gizmo attached');
      const rect=s.renderer.domElement.getBoundingClientRect(), project=v=>{
        const p=v.clone().project(s.editorCamera);
        return [rect.x+(1+p.x)*rect.width/2,rect.y+(1-p.y)*rect.height/2];
      };
      const origin=project(t.object.getWorldPosition(t.object.position.clone()));
      const markers=e.markers.filter(m=>m.visible).map(m=>project(m.getWorldPosition(m.position.clone())));
      const diff=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
      const ray=new (t.getRaycaster().constructor)(); ray.layers.enableAll();
      for (const axis of (mode==='rotate'? ['Z','E','X','Y']:['X','Y','Z'])) {
        for(const mesh of g.gizmo[mode].children.filter(c=>c.name===axis&&c.visible)){
          const v=mesh.geometry.attributes.position;
          for(let i=0;i<v.count;i+=2){
            const w=mesh.localToWorld(mesh.position.clone().fromBufferAttribute(v,i)), p=project(w);
            if(diff(p,origin)<25 || markers.some(m=>diff(p,m)<15)
               || document.elementFromPoint(...p)!==s.renderer.domElement) continue;
            ray.setFromCamera(w.clone().project(s.editorCamera),s.editorCamera);
            if(ray.intersectObjects(g.picker[mode].children,true).find(h=>h.object.visible)?.object.name===axis)
              return {p,origin,axis};
          }
        }
      }
      throw Error('No unobstructed '+mode+' handle for '+s.joint);
    }""", mode)


def drag(page, mode, anchors=None):
    drift = {j: 0.0 for j in anchors or {}}
    def sample():
        if drift:
            poses = observe(page)['pos']
            for j in drift:
                drift[j] = max(drift[j], math.dist(poses[j], anchors[j]))
    h = handle(page, mode)
    x, y = h["p"]
    dx, dy = x - h["origin"][0], y - h["origin"][1]
    if mode == "rotate":
        end = (x + dx * (math.cos(.16)-1) - dy * math.sin(.16),
               y + dy * (math.cos(.16)-1) + dx * math.sin(.16))
    else:
        end = (x + 20 * dx/math.hypot(dx,dy), y + 20 * dy/math.hypot(dx,dy))
    page.mouse.move(x, y)
    page.mouse.down()
    try:
        assert page.evaluate("""axis => {const t=document.querySelector('.canvas-host').__studio.transform;
            return t.dragging && t.axis===axis}""", h["axis"]), f"{mode}: handle did not capture pointer"
        for step in range(1, 9):
            page.mouse.move(x + (end[0]-x)*step/8, y + (end[1]-y)*step/8)
            sample()
    finally:
        page.mouse.up()
    settle(page)
    sample()
    assert all(d <= .0008 for d in drift.values()), f"{mode}: pin drift in metres: {drift}"
    return drift


def undo(page, before):
    page.get_by_role('button', name='Undo (Ctrl Z)', exact=True).click()
    settle(page)
    after = observe(page)
    assert max(math.dist(value, after["pos"][j]) for j, value in before["pos"].items()) < 1e-5, \
        "One Undo did not restore pre-drag joint positions"
    assert math.dist(before['q'], after['q']) < 1e-5, "Undo did not restore rotation"


def check_pose_shortcuts(page):
    select(page, 'leftWrist')
    mode = page.get_by_role('combobox', name='Pose mode')
    canvas = page.locator('.canvas-host canvas').first
    pin = page.get_by_role('button', name=re.compile(r'^Pin left wrist position$', re.I))
    unpin = page.get_by_role('button', name=re.compile(r'^Unpin left wrist position$', re.I))
    check = """([joint, mode, attached]) => {
      const s = document.querySelector('.canvas-host').__studio;
      return s.joint === joint && (joint ? s.positionPosing === (mode === 'translate') : true)
        && (attached ? !!s.transform.object && s.transform.getMode() === mode : !s.transform.object);
    }"""
    def press(key, joint, transform_mode, attached=True):
        canvas.focus()
        page.keyboard.press(key)
        page.wait_for_function(check, arg=[joint, transform_mode, attached])
        if joint:
            assert ('Position (IK)' if transform_mode == 'translate' else 'Rotation (FK)') in mode.inner_text()

    press('w', 'leftWrist', 'translate')
    field = page.locator('input:is([type="text"],[type="number"]):visible:not(:disabled):not([readonly])').first
    field.focus()
    page.keyboard.press('e')
    assert page.evaluate(check, ['leftWrist', 'translate', True]), 'Typing E changed the pose mode'
    press('e', 'leftWrist', 'rotate')
    pin.click()
    press('w', 'leftWrist', 'translate', attached=False)
    press('e', 'leftWrist', 'rotate')
    unpin.click()
    page.keyboard.press('Escape')
    press('w', None, 'translate')
    press('e', None, 'rotate')
    print('W/E: retained wrist and matched inspector/gizmo in both modes, honored pin/typing guard, root W/E unchanged', flush=True)


def main(url):
    with sync_playwright() as api:
        browser = api.chromium.launch(channel='msedge', headless=True, args=['--enable-unsafe-swiftshader'])
        page = browser.new_page(viewport={'width': 1600, 'height': 950})
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        page.goto(url, wait_until='domcontentloaded')
        page.wait_for_function("!!document.querySelector('.canvas-host')?.__studio?.state", timeout=120000)
        page.get_by_role('listitem').filter(has_text='Male 1').first.click()
        page.get_by_role('button', name='Frame Selected (F)', exact=True).click()
        page.get_by_role('button', name=re.compile('Open Joint & Animation Pose Controls')).click()
        check_pose_shortcuts(page)
        select(page, 'chest')
        before = observe(page)
        drag(page, 'rotate')
        after = observe(page)
        free_motion = math.dist(before['pos']['leftWrist'], after['pos']['leftWrist'])
        assert free_motion > .005, f"FK gesture did not move descendant wrist: {free_motion}"
        undo(page, before)
        print(json.dumps({'freeFkWristMotion': free_motion}), flush=True)

        anchors = {}
        for j in ['leftWrist', 'rightAnkle']:
            select(page, j)
            anchors[j] = observe(page)['pos'][j]
            label = re.sub(r"([A-Z])", r" \1", j)
            if j == 'leftWrist':
                x, y = page.evaluate("""j => {
                    const s=document.querySelector('.canvas-host').__studio;
                    const marker=s.entries.get(s.selected).markers.find(m=>m.userData.joint===j);
                    const p=marker.getWorldPosition(marker.position.clone()).project(s.editorCamera);
                    const r=s.renderer.domElement.getBoundingClientRect();
                    return [r.left+(1+p.x)*r.width/2,r.top+(1-p.y)*r.height/2];
                }""", j)
                page.mouse.click(x, y, button='right')
            else:
                page.get_by_role('button', name=re.compile(rf'^Pin {label} position$', re.I)).click()
            page.get_by_role('button', name=re.compile(rf'^Unpin {label} position$', re.I)).wait_for()
        for mode, option, j in [('translate', 'Position (IK)', 'rightWrist'),
                                ('translate', 'Position (IK)', 'hips'), ('rotate', 'Rotation (FK)', 'chest')]:
            page.get_by_role('combobox', name='Pose mode').click()
            page.get_by_role('option', name=option, exact=True).click()
            if j == 'rightWrist':
                select(page, 'leftWrist')
                assert page.evaluate("!document.querySelector('.canvas-host').__studio.transform.object"), \
                    'Pinned IK wrist still has an attached translation handle'
            select(page, j)
            before = observe(page)
            drift = drag(page, mode, anchors)
            after = observe(page)
            assert math.dist(before['camera'], after['camera']) < 1e-7, 'Camera moved during pose gesture'
            motion = (math.dist(before['pos'][j], after['pos'][j]) if mode == 'translate'
                      else math.dist(before['q'], after['q']))
            print(json.dumps({'mode': mode, 'joint': j, 'motion': motion, 'peakPinDriftM': drift}), flush=True)
            assert motion > .003, f'{mode} did not change {j}'
            if j == 'rightWrist':
                assert math.dist(before['pos']['hips'], after['pos']['hips']) < 1e-6, 'Hand drag moved the whole figure'
            undo(page, before)
        select(page, 'leftWrist')
        before = observe(page)
        drift = drag(page, 'rotate', anchors)
        after = observe(page)
        dot = abs(sum(a*b for a, b in zip(before['q'], after['q'])))
        degrees = math.degrees(2 * math.acos(min(1, dot)))
        assert degrees > .1, 'Pinned wrist could not rotate in FK'
        print(json.dumps({'pinnedWristRotationDeg': degrees, 'peakPinDriftM': drift}), flush=True)
        undo(page, before)
        assert not errors, errors


if __name__ == '__main__':
    main(sys.argv[1])
