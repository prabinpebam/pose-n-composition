"""Usage: python scripts/garment-fit-smoke.py <production-build-dir> <evidence-dir> [--baseline|--edit-preview]

Serves a task-only ephemeral loopback origin and uses a fresh headless browser
context. No existing tabs, profiles, or owner storage are opened.
"""
import functools
import json
import math
import struct
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw
from playwright.sync_api import sync_playwright


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


def main():
    build, out = map(Path, sys.argv[1:3])
    if not (build / "index.html").is_file():
        raise ValueError("Expected a production build containing index.html")
    out.mkdir(parents=True, exist_ok=True)
    baseline = "--baseline" in sys.argv[3:]
    edit_preview = "--edit-preview" in sys.argv[3:]
    evidence = {"checks": {}, "pageErrors": []}
    tank_files = list((build / "assets").glob("tank-*.bin"))
    if len(tank_files) != 1:
        raise ValueError("Expected exactly one built tank pattern asset")
    tank_bytes = tank_files[0].read_bytes()
    handler = functools.partial(QuietHandler, directory=str(build.resolve()))
    with ThreadingHTTPServer(("127.0.0.1", 0), handler) as server, sync_playwright() as api:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        browser = api.chromium.launch(
            channel="msedge", headless=True, args=["--enable-unsafe-swiftshader"]
        )
        context = browser.new_context(viewport={"width": 1600, "height": 1040})
        page = context.new_page()
        neutral_bind_inverses = None
        page.on("pageerror", lambda error: evidence["pageErrors"].append(str(error)))
        evidence["origin"] = f"http://127.0.0.1:{server.server_port}"
        try:
            page.goto(evidence["origin"], wait_until="domcontentloaded")

            def ready():
                page.wait_for_function(
                    "!!document.querySelector('.canvas-host')?.__studio?.state", timeout=120000
                )
                page.evaluate("""() => {
                  window.st = document.querySelector('.canvas-host').__studio;
                  window.f = () => st.state.items.find(i => i.kind === 'female');
                  window.fig = () => st.getFigure(f().id);
                  window.fit = () => f().wardrobe?.fit ?? {};
                  window.mesh = () => fig().skin.getObjectByName('Wardrobe: tank');
                  window.geom = () => Array.from(mesh().geometry.attributes.position.array);
                  window.geomError = expected => {
                    const actual=mesh().geometry.attributes.position.array;
                    if(actual.length!==expected.length)throw new Error('Garment vertex count changed');
                    let max=0,vertex=-1;
                    for(let i=0;i<actual.length;i+=3){
                      const d=1000*Math.hypot(actual[i]-expected[i],actual[i+1]-expected[i+1],actual[i+2]-expected[i+2]);
                      if(d>max){max=d;vertex=i/3}
                    }
                    return {maxVertexErrorMm:max,vertex,bitExact:Array.from(actual).every((v,i)=>v===expected[i])};
                  };
                }""")
                if neutral_bind_inverses is not None:
                    page.wait_for_function("!!fig()?.skin", timeout=120000)
                    page.evaluate("""values => {
                      const M=fig().skin.matrixWorld.constructor;
                      window.trueBindInverses=values.map(v=>new M().fromArray(v));
                    }""", neutral_bind_inverses)

            def button(name):
                return page.get_by_role("button", name=name, exact=True)

            def select():
                page.get_by_role("listitem").filter(has_text="Female 1").first.click()

            view = page.locator(".canvas-host canvas").first

            def frame(name, handles=False):
                page.evaluate("""handles => {
                  st.setOrbitView([0,1.18,1.76],[0,1.16,0]);
                  st.garmentHandles && (st.garmentHandles.visible = handles);
                  window.shotObject=st.transform.object;
                  if(!handles)st.transform.detach();
                  st.render();
                }""", handles)
                view.screenshot(path=out / f"{name}.png")
                page.evaluate("""() => {
                  if(st.fitSelection)st.garmentHandles.visible=true;
                  if(shotObject)st.transform.attach(shotObject);
                  st.render();
                }""")
                print(f"Screenshot: {out / (name + '.png')}", flush=True)

            def fit_snapshot():
                return page.evaluate("fit()")

            def edit():
                if button("Edit Tank fit").count():
                    button("Edit Tank fit").click()
                page.wait_for_function(
                    "st.garmentHandles.isGroup && st.garmentHandles.children.length > 0"
                )
                page.evaluate("() => {st.setOrbitView([0,1.18,1.76],[0,1.16,0]);st.render()}")

            def choose(kind):
                return page.evaluate("""kind => {
                  const r=st.renderer.domElement.getBoundingClientRect();
                  const nodes=st.garmentHandles.children.filter(h=>h.visible && h.userData.kind===kind)
                    .map(h=>({node:h.userData.node,p:h.position.clone()}))
                    .filter(h=>h.p.z>.05 && h.p.y>1 && h.p.y<1.5 && Math.abs(h.p.x)<.2)
                    .sort((a,b)=>b.p.z-a.p.z);
                  if(!nodes.length)throw new Error('No visible '+kind+' node');
                  const h=nodes[0],p=h.p.clone().project(st.editorCamera);
                  return {node:h.node,kind,world:h.p.toArray(),
                    x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2};
                }""", kind)

            def start_drag(handle, dx, dy):
                page.mouse.move(20, 20)
                page.mouse.move(handle["x"], handle["y"])
                page.mouse.down()
                page.wait_for_function(
                    "node => !!st.fitPlane && st.fitSelection?.node===node", arg=handle["node"]
                )
                target = page.evaluate("""([x,y]) => {
                  const p=st.fitRay({clientX:x,clientY:y}).ray.intersectPlane(
                    st.fitPlane.plane,st.fitPlane.grab.clone()).add(st.fitPlane.grab);
                  return p.toArray();
                }""", [handle["x"] + dx, handle["y"] + dy])
                page.mouse.move(handle["x"] + dx, handle["y"] + dy, steps=12)
                page.wait_for_function("!!st.fitPreview")
                return target

            def node_world(node):
                return page.evaluate("""node => {
                  const m=mesh(),p=m.position.clone().fromBufferAttribute(
                    m.geometry.attributes.position,Number(node));
                  return m.localToWorld(p).toArray();
                }""", node)

            def drag(kind, dx, dy):
                if button("Finish editing").count():
                    button("Finish editing").click()
                edit()
                handle = choose(kind)
                before = fit_snapshot()
                target = start_drag(handle, dx, dy)
                assert fit_snapshot() == before, "Transient drag changed persistent state"
                preview = page.evaluate("st.fitPreview.fit.tank")
                page.mouse.up()
                page.wait_for_function("!st.fitPlane && !st.fitPreview")
                actual = page.evaluate("fit().tank")
                assert actual == preview and actual != before.get("tank", {}), (preview, actual)
                assert math.dist(actual[handle["node"]], [0, 0, 0]) > .002
                clamped = math.hypot(*actual[handle["node"]]) >= .075 - 1e-6
                expected = target
                if clamped:
                    expected = page.evaluate("""([base,target]) => {
                      const m=mesh(),V=m.position.constructor,b=new V(...base);
                      const delta=m.worldToLocal(new V(...target)).sub(b).clampLength(0,.075);
                      return m.localToWorld(b.add(delta)).toArray();
                    }""", [bases[handle["node"]], target])
                error_mm = 1000 * math.dist(node_world(handle["node"]), expected)
                assert error_mm < .1, (handle, expected, error_mm)
                key = kind + ("ClampedPointerDrag" if clamped else "PointerDrag")
                evidence["checks"][key] = {
                    "handle": handle, "offset": actual[handle["node"]], "targetErrorMm": error_mm
                }
                return handle

            def node_bases(nodes):
                return page.evaluate("""nodes => Object.fromEntries(nodes.map(node => {
                  const a=mesh().geometry.attributes.position;
                  return [node,[a.getX(+node),a.getY(+node),a.getZ(+node)]];
                }))""", nodes)

            def target_errors(bases):
                bindings = {
                    node: list(struct.unpack_from("<9H", tank_bytes, 24 + int(node) * 18))
                    for node in bases
                }
                result = page.evaluate("""([bases,bindings]) => {
                  const skin=fig().skin,m=mesh(),V=m.position.constructor,
                    Q=skin.quaternion.constructor,M=skin.matrixWorld.constructor;
                  skin.updateWorldMatrix(true,false);m.updateWorldMatrix(true,false);
                  const inverse=skin.matrixWorld.clone().invert();
                  const rotations=skin.skeleton.bones.map((b,i)=>{
                    b.updateWorldMatrix(true,false);
                    return new Q().setFromRotationMatrix(new M().extractRotation(
                      inverse.clone().multiply(b.matrixWorld).multiply(trueBindInverses[i])
                        .multiply(skin.bindMatrix)));
                  });
                  const joints=skin.geometry.getAttribute('skinIndex'),
                    weights=skin.geometry.getAttribute('skinWeight');
                  return Object.fromEntries(Object.entries(bases).map(([node,base])=>{
                    const binds=bindings[node],q=new Q(0,0,0,0);let reference;
                    for(let k=0;k<4;k++)for(let j=0;j<4;j++){
                      const donor=binds[k],w=binds[k+4]/65535*weights.getComponent(donor,j);
                      if(!w)continue;
                      const rotation=rotations[joints.getComponent(donor,j)];
                      reference??=rotation;const sign=reference.dot(rotation)<0?-1:1;
                      q.x+=rotation.x*w*sign;q.y+=rotation.y*w*sign;
                      q.z+=rotation.z*w*sign;q.w+=rotation.w*w*sign;
                    }
                    const offset=fit().tank?.[node]??[0,0,0];
                    const expected=m.localToWorld(new V(...base).add(new V(...offset).applyQuaternion(q.normalize())));
                    const actual=m.localToWorld(new V().fromBufferAttribute(m.geometry.attributes.position,+node));
                    return [node,{errorMm:expected.distanceTo(actual)*1000,base,offset,frame:q.toArray(),
                      frameAngleRadians:2*Math.acos(Math.min(1,Math.abs(q.w))),
                      expected:expected.toArray(),actual:actual.toArray()}];
                  }));
                }""", [bases, bindings])
                assert all(v["errorMm"] < .1 for v in result.values()), result
                return result

            def autosaved(expected):
                page.wait_for_function("""async expected => {
                  const db=await new Promise((ok,no)=>{
                    const r=indexedDB.open('pose-n-composition-v1',1);
                    r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);
                  });
                  try {
                    const record=await new Promise((ok,no)=>{
                      const store=db.objectStoreNames[0];
                      const r=db.transaction(store).objectStore(store).get('__autosave__:working_scene');
                      r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);
                    });
                    const w=record?.scene.items.find(i=>i.kind==='female')?.wardrobe;
                    return JSON.stringify(w?.fit??{})===JSON.stringify(expected.fit) &&
                      JSON.stringify(w?.drape)===JSON.stringify(expected.drape);
                  }finally{db.close()}
                }""", arg=expected, timeout=20000)

            def gizmo_drag(node):
                assert page.evaluate("st.transform.mode") == "translate"
                candidates = page.evaluate("""() => {
                  const r=st.renderer.domElement.getBoundingClientRect();
                  st.transform.getHelper().updateMatrixWorld(true);
                  return st.transform._gizmo.gizmo.translate.children
                    .filter(c=>c.name==='X' && c.isMesh && c.visible).map(c=>{
                      c.geometry.computeBoundingBox();
                      const p=c.localToWorld(c.geometry.boundingBox.getCenter(c.position.clone()))
                        .project(st.editorCamera);
                      return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2};
                    });
                }""")
                point = None
                for candidate in candidates:
                    page.mouse.move(candidate["x"], candidate["y"])
                    if page.evaluate("st.transform.axis") == "X":
                        point = candidate
                        break
                assert point, "No real X-axis gizmo pointer hit"
                before = fit_snapshot()
                initial = node_world(node)
                page.mouse.down()
                page.wait_for_function("st.transform.dragging && !st.fitPlane")
                page.mouse.move(point["x"] + 12, point["y"], steps=10)
                page.wait_for_function("!!st.fitPreview")
                assert fit_snapshot() == before
                page.mouse.up()
                assert fit_snapshot() != before and not page.evaluate("st.transform.dragging || !!st.fitPreview")
                actual = node_world(node)
                assert abs(actual[0] - initial[0]) > .005
                assert abs(actual[1] - initial[1]) < .0001 and abs(actual[2] - initial[2]) < .0001
                evidence["checks"]["translateGizmoPointerDrag"] = {
                    "node": node, "axis": "X", "movementMm": 1000 * math.dist(initial, actual)
                }
                button("Undo (Ctrl Z)").click()
                assert fit_snapshot() == before

            ready()
            select()
            page.evaluate("""() => {
              const n=structuredClone(st.state), i=n.items.find(i=>i.kind==='female');
              n.items=n.items.filter(o=>o===i||o.kind==='light');
              i.position=[0,0,0];i.rotation=[0,0,0];i.scale=[1,1,1];
              i.hairStyle='none';i.dressMapId='none';
              for(const j in i.pose)i.pose[j]=[0,0,0];
              st.options.change(n);
            }""")
            page.get_by_label("Tank top", exact=True).check()
            page.get_by_label("Pencil skirt", exact=True).check()
            page.wait_for_function("!!mesh() && !!fig().skin.getObjectByName('Wardrobe: skirt')")
            page.evaluate("() => {st.setHelpers(false,false);st.transform.detach()}")
            frame("early-studio")
            page.screenshot(path=out / "early-controls.png")
            if baseline:
                evidence["checks"]["baseline"] = True
            else:
                edit()
                frame("before-fit")
                frame("before-handles", True)
                neutral_bind_inverses = page.evaluate("""() => {
                  fig().skin.updateWorldMatrix(true,false);
                  window.trueBindInverses=fig().skin.skeleton.bones.map(b=>{
                    b.updateWorldMatrix(true,false);return b.matrixWorld.clone().invert();
                  });
                  return trueBindInverses.map(m=>m.toArray());
                }""")
                handles = [choose("edge"), choose("surface")]
                bases = node_bases([h["node"] for h in handles])
                original_geometry = page.evaluate("geom()")
                isolation = page.evaluate("""() => ({
                  item: (()=>{const i=structuredClone(f());delete i.wardrobe;return i})(),
                  skirt: Array.from(fig().skin.getObjectByName('Wardrobe: skirt').geometry.attributes.position.array)
                })""")
                edge = drag("edge", 22, -12)
                frame("edge-edited", True)
                surface = drag("surface", -18, -10)
                frame("edited-preview", True)
                page.screenshot(path=out / "edited-controls.png")
                page.locator(".wardrobe-controls").screenshot(path=out / "fit-controls.png")
                assert page.evaluate("geom()") != original_geometry
                frame("after-fit")
                evidence["checks"]["neutralTargets"] = target_errors(bases)
                if not edit_preview:
                    edited = fit_snapshot()
                    edited_geometry = page.evaluate("geom()")
                    button("Undo (Ctrl Z)").click()
                    assert set(fit_snapshot()["tank"]) == {edge["node"]}
                    button("Redo (Ctrl Shift Z)").click()
                    assert fit_snapshot() == edited and page.evaluate("geom()") == edited_geometry
                    button("Reset node").click()
                    assert surface["node"] not in fit_snapshot()["tank"]
                    button("Undo (Ctrl Z)").click()
                    assert fit_snapshot() == edited and page.evaluate("geom()") == edited_geometry
                    evidence["checks"]["resetUndoRedo"] = True
                    gizmo_drag(surface["node"])
                    assert fit_snapshot() == edited

                    limited = drag("edge", 180, 0)
                    offset = fit_snapshot()["tank"][limited["node"]]
                    assert abs(math.hypot(*offset) - .075) < 1e-7, offset
                    assert "At limit" in page.locator(".wardrobe-controls").inner_text()
                    evidence["checks"]["clamp"] = {"limitMm": 75, "actualMm": 1000 * math.hypot(*offset)}
                    evidence["checks"]["clampedTargets"] = target_errors(bases)
                    button("Undo (Ctrl Z)").click()
                    assert fit_snapshot() == edited

                    button("Finish editing").click()
                    edit()
                    handle = choose("surface")
                    start_drag(handle, 25, 16)
                    page.keyboard.press("Escape")
                    page.mouse.up()
                    assert fit_snapshot() == edited and page.evaluate("geom()") == edited_geometry
                    assert not page.evaluate("!!st.fitPreview || !!st.fitPlane || st.transform.dragging")
                    evidence["checks"]["escapeCancel"] = True

                    button("Finish editing").click()
                    edit()
                    handle = choose("surface")
                    start_drag(handle, 25, 16)
                    page.evaluate("() => st.select(null,null)")
                    page.mouse.up()
                    assert fit_snapshot() == edited and page.evaluate("geom()") == edited_geometry
                    assert not page.evaluate("!!st.fitPreview || !!st.fitSelection || st.garmentHandles.visible")
                    evidence["checks"]["selectionStaleCancel"] = True
                    select()
                    edit()
                    handle = choose("surface")
                    start_drag(handle, 20, 16)
                    page.evaluate("""() => {
                      const n=structuredClone(st.state);
                      delete n.items.find(i=>i.kind==='female').wardrobe.tank;st.options.change(n);
                    }""")
                    page.wait_for_function("!f().wardrobe.tank && !mesh() && !st.fitPreview && !st.fitPlane")
                    evidence["unequipBeforePointerUp"] = page.evaluate("""() => ({
                      wardrobe:f().wardrobe,selection:st.fitSelection,preview:!!st.fitPreview,plane:!!st.fitPlane
                    })""")
                    page.mouse.up()
                    evidence["unequipAfterPointerUp"] = page.evaluate("""() => ({
                      wardrobe:f().wardrobe,selection:st.fitSelection,preview:!!st.fitPreview,plane:!!st.fitPlane
                    })""")
                    assert fit_snapshot() == edited and not page.evaluate("!!mesh() || !!st.fitSelection || !!st.fitPreview")
                    button("Undo (Ctrl Z)").click()
                    page.wait_for_function("!!mesh()")
                    assert fit_snapshot() == edited and page.evaluate("geom()") == edited_geometry
                    evidence["checks"]["unequippedStaleCancel"] = True
                    edit()
                    handle = choose("surface")
                    start_drag(handle, 20, 16)
                    page.evaluate("""() => {
                      const n=structuredClone(st.state);
                      n.items.find(i=>i.kind==='female').pose.chest=[0,.32,0];st.options.change(n);
                    }""")
                    page.wait_for_function("f().pose.chest[1]===.32 && !st.fitPreview && !st.fitPlane")
                    page.mouse.up()
                    assert fit_snapshot() == edited and not page.evaluate("!!st.fitPreview || !!st.fitPlane")
                    evidence["checks"]["poseStaleCancel"] = True
                    moved_state = page.evaluate("structuredClone(st.state)")
                    page.evaluate("""() => {
                      const n=structuredClone(st.state),w=n.items.find(i=>i.kind==='female').wardrobe;
                      delete w.fit;delete w.drape;st.options.change(n);
                    }""")
                    frame("new-pose-before")
                    moved_bases = node_bases(list(bases))
                    page.evaluate("n => st.options.change(n)", moved_state)
                    page.wait_for_function("expected => JSON.stringify(fit())===JSON.stringify(expected)", arg=edited)
                    frame("new-pose-after")
                    evidence["checks"]["newPoseTargets"] = target_errors(moved_bases)
                    assert any(v["frameAngleRadians"] > .05 for v in evidence["checks"]["newPoseTargets"].values())
                    assert any(
                        math.dist(v["actual"], evidence["checks"]["neutralTargets"][node]["actual"]) > .005
                        for node, v in evidence["checks"]["newPoseTargets"].items()
                    )

                    button("Finish editing").click()
                    # Return to the matched neutral pose without dropping the persistent offsets.
                    page.evaluate("""() => {
                      const n=structuredClone(st.state);
                      n.items.find(i=>i.kind==='female').pose.chest=[0,0,0];st.options.change(n);
                    }""")
                    assert page.evaluate("""expected => {
                      const i=structuredClone(f());delete i.wardrobe;
                      return JSON.stringify(i)===JSON.stringify(expected.item) &&
                        JSON.stringify(Array.from(fig().skin.getObjectByName('Wardrobe: skirt').geometry.attributes.position.array))
                        ===JSON.stringify(expected.skirt);
                    }""", isolation)
                    evidence["checks"]["bodyPoseOtherGarmentIsolation"] = True
                    page.evaluate("""() => {
                      const n=structuredClone(st.state),peer=structuredClone(f());
                      peer.id='garment-fit-smoke-peer';peer.name='Fit isolation peer';
                      peer.position=[3,0,0];delete peer.wardrobe.fit;delete peer.wardrobe.drape;
                      n.items.push(peer);st.options.change(n);
                    }""")
                    page.wait_for_function("""!!st.getFigure('garment-fit-smoke-peer')?.skin.getObjectByName('Wardrobe: tank')""")
                    peer_before = page.evaluate("""() => ({
                      item:st.state.items.find(i=>i.id==='garment-fit-smoke-peer'),
                      geometry:Array.from(st.getFigure('garment-fit-smoke-peer').skin
                        .getObjectByName('Wardrobe: tank').geometry.attributes.position.array)
                    })""")
                    select()
                    edit()
                    handle = choose("surface")
                    start_drag(handle, 10, 8)
                    page.mouse.up()
                    assert page.evaluate("""expected =>
                      JSON.stringify(st.state.items.find(i=>i.id==='garment-fit-smoke-peer'))===JSON.stringify(expected.item) &&
                      JSON.stringify(Array.from(st.getFigure('garment-fit-smoke-peer').skin
                        .getObjectByName('Wardrobe: tank').geometry.attributes.position.array))===JSON.stringify(expected.geometry)
                    """, peer_before)
                    button("Undo (Ctrl Z)").click()
                    assert fit_snapshot() == edited
                    button("Finish editing").click()
                    page.evaluate("""() => {
                      const n=structuredClone(st.state);
                      n.items=n.items.filter(i=>i.id!=='garment-fit-smoke-peer');st.options.change(n);
                    }""")
                    evidence["checks"]["otherFigureIsolation"] = True

                    button("Settle cloth").click()
                    button("Cancel settle").click()
                    page.wait_for_function("!st.clothJob && !f().wardrobe.drape")
                    assert fit_snapshot() == edited and page.evaluate("geom()") == edited_geometry
                    button("Settle cloth").click()
                    page.wait_for_function("!!f().wardrobe.drape", timeout=60000)
                    assert fit_snapshot() == edited
                    evidence["checks"]["settledTargets"] = target_errors(bases)
                    settle_geometry = page.evaluate("geom()")
                    assert settle_geometry != edited_geometry
                    frame("settled-fit")
                    select()
                    edit()
                    handle = choose("surface")
                    start_drag(handle, 12, 8)
                    page.mouse.up()
                    assert not page.evaluate("!!f().wardrobe.drape")
                    button("Undo (Ctrl Z)").click()
                    assert fit_snapshot() == edited and page.evaluate("geom()") == settle_geometry
                    assert page.evaluate("!!f().wardrobe.drape")
                    button("Finish editing").click()
                    button("Reset drape").click()
                    assert fit_snapshot() == edited and page.evaluate("geom()") == edited_geometry
                    evidence["checks"]["settleCancelFitInvalidationUndo"] = True
                    page.evaluate("""() => {
                      const n=structuredClone(st.state);
                      n.items.find(i=>i.kind==='female').pose.chest=[0,.32,0];st.options.change(n);
                    }""")
                    assert fit_snapshot() == edited and not page.evaluate("!!f().wardrobe.drape")
                    button("Settle cloth").click()
                    page.wait_for_function("!!f().wardrobe.drape && !st.clothJob", timeout=60000)
                    evidence["checks"]["newPoseSettledTargets"] = target_errors(moved_bases)
                    frame("new-pose-settled")
                    persisted_geometry = page.evaluate("geom()")
                    baked = page.evaluate("structuredClone(f().wardrobe.drape)")
                    persisted_pose = page.evaluate("structuredClone(f().pose)")
                    autosaved({"fit": edited, "drape": baked})
                    page.reload(wait_until="domcontentloaded")
                    ready()
                    page.wait_for_function("!!mesh() && !!f().wardrobe.drape")
                    evidence["reloadGeometry"] = page.evaluate("geomError", persisted_geometry)
                    evidence["reloadTargets"] = target_errors(moved_bases)
                    page.wait_for_function("expected => geomError(expected).maxVertexErrorMm<.1",
                                           arg=persisted_geometry)
                    assert fit_snapshot() == edited
                    assert page.evaluate("f().wardrobe.drape") == baked and page.evaluate("f().pose") == persisted_pose
                    evidence["bakePersistence"] = {
                        "poseKey": baked["poseKey"], "patterns": {key: layer["pattern"] for key, layer in baked["layers"].items()},
                        "fit": edited, "pose": persisted_pose, "reloadRawDrapeEqual": True
                    }
                    evidence["checks"]["reloadPersistenceWithBake"] = True
                    frame("reloaded-fit")

                    pristine = browser.new_context(viewport={"width": 1600, "height": 1040})
                    try:
                        untouched = pristine.new_page()
                        untouched.goto(evidence["origin"], wait_until="domcontentloaded")
                        untouched.wait_for_function(
                            "!!document.querySelector('.canvas-host')?.__studio?.state", timeout=120000
                        )
                        assert untouched.evaluate("""() => {
                          const s=document.querySelector('.canvas-host').__studio;
                          return s.state.items.every(i=>!i.wardrobe?.fit);
                        }""")
                        assert fit_snapshot() == edited
                        evidence["checks"]["freshProfileIsolation"] = True
                    finally:
                        pristine.close()

                    select()
                    button("Scene & Pose Library").click()
                    with page.expect_download() as event:
                        button("Scene JSON").click()
                    scene_bytes = event.value.path().read_bytes()
                    scene = json.loads(scene_bytes)
                    wardrobe = next(i for i in scene["items"] if i["kind"] == "female")["wardrobe"]
                    assert wardrobe["fit"] == edited and wardrobe["drape"] == baked
                    (out / "garment-fit.scene.json").write_bytes(scene_bytes)
                    page.evaluate("""() => {
                      const n=structuredClone(st.state);
                      const w=n.items.find(i=>i.kind==='female').wardrobe;
                      delete w.fit;delete w.drape;st.options.change(n);
                    }""")
                    assert fit_snapshot() == {}
                    page.get_by_label("Import JSON file").set_input_files({
                        "name": "garment-fit.scene.json", "mimeType": "application/json", "buffer": scene_bytes
                    })
                    page.wait_for_function("expected => JSON.stringify(fit())===JSON.stringify(expected) && !!f().wardrobe.drape", arg=edited)
                    evidence["importGeometry"] = page.evaluate("geomError", persisted_geometry)
                    evidence["importTargets"] = target_errors(moved_bases)
                    page.wait_for_function("expected => geomError(expected).maxVertexErrorMm<.1",
                                           arg=persisted_geometry)
                    assert page.evaluate("f().wardrobe.drape") == baked
                    assert page.evaluate("f().pose") == persisted_pose
                    evidence["bakePersistence"]["importRawDrapeEqual"] = True
                    evidence["checks"]["jsonRoundTripWithBake"] = True
                    select()
                    edit()
                    assert page.evaluate("st.garmentHandles.visible && st.garmentHandles.children.some(h=>h.visible)")
                    with page.expect_download() as event:
                        button("Export PNG (1600px)").click()
                    event.value.save_as(out / "export-camera-handles-active.png")
                    button("Finish editing").click()
                    assert not page.evaluate("st.garmentHandles.visible")
                    with page.expect_download() as event:
                        button("Export PNG (1600px)").click()
                    event.value.save_as(out / "export-camera.png")
                    exported = Image.open(out / "export-camera.png")
                    assert exported.format == "PNG" and exported.width == 1600
                    assert ImageChops.difference(exported.convert("RGB"),
                                                Image.new("RGB", exported.size, exported.convert("RGB").getpixel((0, 0)))).getbbox()
                    active_export = Image.open(out / "export-camera-handles-active.png").convert("RGBA")
                    inactive_export = exported.convert("RGBA")
                    assert active_export.size == inactive_export.size
                    assert ImageChops.difference(active_export, inactive_export).getbbox() is None
                    assert active_export.tobytes() == inactive_export.tobytes()
                    assert fit_snapshot() == edited and page.evaluate("geomError", persisted_geometry)["maxVertexErrorMm"] < .1
                    assert page.evaluate("f().wardrobe.drape") == baked
                    evidence["checks"]["exportPng"] = {"width": exported.width, "height": exported.height}
                    evidence["checks"]["exportPngHandlesPixelEquality"] = True
                    images = [Image.open(out / f"{name}.png").convert("RGB") for name in
                              ["before-fit", "after-fit", "new-pose-before", "new-pose-after"]]
                    w, h = images[0].size
                    crop = ((w - h * .65) / 2, h * .20, (w + h * .65) / 2, h * .64)
                    for left, right in [(images[0], images[1]), (images[2], images[3])]:
                        assert left.size == right.size
                        assert ImageChops.difference(left.crop(crop), right.crop(crop)).getbbox()
                    sheet = Image.new("RGB", (1400, 620), "#202427")
                    for i, (image, label) in enumerate(zip(images, [
                        "Neutral | authored", "Neutral | fitted", "New pose | authored", "New pose | fitted"
                    ])):
                        image = image.crop(((w - h * .58) / 2, 0, (w + h * .58) / 2, h))
                        image.thumbnail((345, 580))
                        sheet.paste(image, (350 * i + (350 - image.width) // 2, 32))
                        ImageDraw.Draw(sheet).text((350 * i + 12, 10), label, fill="white")
                    sheet.save(out / "garment-fit-comparison.jpg", quality=95)
                    evidence["checks"]["matchedScreenshots"] = True
            assert not evidence["pageErrors"], evidence["pageErrors"]
            evidence["status"] = "baseline" if baseline else "edited-preview" if edit_preview else "passed"
            print(json.dumps({"status": evidence["status"], "checks": list(evidence["checks"])}), flush=True)
        except Exception as error:
            evidence["failure"] = str(error)
            evidence["diagnostics"] = page.evaluate("""() => ({
              wardrobe:window.f?.()?.wardrobe,selection:window.st?.fitSelection,
              preview:!!window.st?.fitPreview,plane:!!window.st?.fitPlane,
              notice:document.querySelector('.notice')?.textContent
            })""")
            page.screenshot(path=out / "failure.png")
            raise
        finally:
            (out / "checks.json").write_text(json.dumps(evidence, indent=2), encoding="utf-8")
            context.close()
            browser.close()
            server.shutdown()
            thread.join(timeout=5)


if __name__ == "__main__":
    main()
