// Run with an isolated Playwright Page, never an owner's working tab.
export async function runBatch2ASmoke(page) {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const observe = () => page.evaluate(() => {
    const s = document.querySelector('.canvas-host').__studio;
    return { state: structuredClone(s.state), ids: [...s.selectedIds], camera: s.editorCamera.matrixWorld.toArray(), orbit: s.orbit.enabled, dragging: s.transform.dragging, pivot: s.transform.object === s.groupPivot };
  });
  const pickFigure = name => page.getByRole('listitem').filter({ hasText: name }).first().click();
  const undo = async () => { await page.getByRole('button', { name: 'Undo', exact: true }).click(); await settle(); };
  const before = await observe();
  assert(before.state.items.some(i => i.name === 'Male 1') && before.state.items.some(i => i.name === 'Female 1'), 'Expected default two-figure scene');
  await pickFigure('Male 1');
  await page.getByRole('listitem').filter({ hasText: 'Female 1' }).first().click({ modifiers: ['Shift'] });
  await settle();
  let observed = await observe();
  assert(observed.ids.length === 2 && observed.pivot, 'Shift Outliner selection did not attach group pivot');
  const selectedIds = observed.ids;
  const positionField = page.getByRole('spinbutton', { name: 'Group position (m) X', exact: true });
  const positionBase = observed.state;
  await positionField.focus(); await positionField.blur(); await settle();
  assert(JSON.stringify((await observe()).state) === JSON.stringify(positionBase), 'Unedited rounded centroid input moved the group');
  await positionField.fill('1.25'); await positionField.press('Enter'); await settle();
  const offsetItems = (await observe()).state.items.filter(i => selectedIds.includes(i.id));
  assert(Math.abs(offsetItems.reduce((sum, i) => sum + i.position[0], 0) / offsetItems.length - 1.25) < 1e-8, 'Group position field did not offset the centroid');
  await positionField.focus(); await positionField.blur(); await settle();
  assert(JSON.stringify((await observe()).state.items.filter(i => selectedIds.includes(i.id))) === JSON.stringify(offsetItems), 'Group position field applied the offset twice');
  await undo();
  assert(JSON.stringify((await observe()).state) === JSON.stringify(positionBase), 'Group position undo was not one step');
  for (const axis of ['X', 'Y', 'Z']) {
    const base = (await observe()).state;
    await page.getByRole('region', { name: 'Multi-selection', exact: true }).getByRole('button', { name: `Flip ${axis}`, exact: true }).click();
    await settle();
    const flipped = (await observe()).state;
    const a = 'XYZ'.indexOf(axis), selected = base.items.filter(i => selectedIds.includes(i.id));
    const center = selected.reduce((sum, i) => sum + i.position[a], 0) / selected.length;
    for (const item of selected) {
      const actual = flipped.items.find(i => i.id === item.id);
      assert(Math.abs(actual.position[a] - (2 * center - item.position[a])) < 1e-5, `Group Flip ${axis}: incorrect position`);
      assert(actual.scale.reduce((p, v) => p * v, 1) * item.scale.reduce((p, v) => p * v, 1) < 0, `Group Flip ${axis}: parity not reflected`);
    }
    await undo();
    assert(JSON.stringify((await observe()).state) === JSON.stringify(base), `Group Flip ${axis}: undo not atomic`);
  }
  const gizmoPoint = () => page.evaluate(() => {
    const s = document.querySelector('.canvas-host').__studio, camera = s.editorCamera;
    const rect = s.renderer.domElement.getBoundingClientRect(), mode = s.transform.mode;
    const gizmo = s.transform.getHelper().children[0];
    const project = p => { const n = p.clone().project(camera); return { x: rect.left + (n.x+1)*rect.width/2, y: rect.top + (1-n.y)*rect.height/2 }; };
    const center = project(s.groupPivot.getWorldPosition(s.groupPivot.position.clone()));
    for (const axis of mode === 'rotate' ? ['Y', 'Z', 'X', 'E'] : ['X', 'Z', 'Y']) {
      const mesh = gizmo.gizmo[mode].children.find(c => c.name === axis && c.visible && c.geometry);
      if (!mesh) continue;
      const positions = mesh.geometry.getAttribute('position');
      for (let i=0; i<positions.count; i+=3) {
        const world = mesh.localToWorld(mesh.position.clone().fromBufferAttribute(positions, i));
        const p = project(world);
        if (Math.hypot(p.x-center.x,p.y-center.y)<25 || p.x<rect.left+20 || p.x>rect.right-20 || p.y<rect.top+70 || p.y>rect.bottom-80) continue;
        const ray = new (s.transform.getRaycaster().constructor)(); ray.layers.enable(1);
        ray.setFromCamera(world.clone().project(camera), camera);
        const hit = ray.intersectObjects(gizmo.picker[mode].children,true).find(h => h.object.visible);
        if (hit?.object.name === axis) return { ...p, center, axis, mode };
      }
    }
    throw new Error('No reachable group gizmo handle');
  });
  const gestures = [];
  for (const mode of ['Move W', 'Rotate E']) {
    await page.getByRole('button', { name: mode, exact: true }).click(); await settle();
    const base = await observe(), p = await gizmoPoint();
    await page.mouse.move(p.x, p.y); await page.mouse.down();
    observed = await observe();
    assert(observed.dragging && !observed.orbit, `${mode}: gizmo did not own pointer`);
    if (p.mode === 'rotate') {
      const dx=p.x-p.center.x, dy=p.y-p.center.y;
      for (let n=1;n<=12;n++) { const a=0.35*n/12; await page.mouse.move(p.center.x+dx*Math.cos(a)-dy*Math.sin(a),p.center.y+dx*Math.sin(a)+dy*Math.cos(a)); }
    } else await page.mouse.move(p.x+45,p.y-15,{steps:12});
    await page.mouse.up(); await settle();
    const after = await observe();
    assert(JSON.stringify(after.camera)===JSON.stringify(base.camera), `${mode}: camera moved`);
    assert(after.ids.every(id => JSON.stringify(after.state.items.find(i=>i.id===id).position)!==JSON.stringify(base.state.items.find(i=>i.id===id).position)), `${mode}: group members did not all move`);
    assert(!after.dragging && after.orbit, `${mode}: navigation not restored`);
    await undo();
    assert(JSON.stringify((await observe()).state)===JSON.stringify(base.state), `${mode}: undo was not one step`);
    await page.getByRole('button',{name:'Redo',exact:true}).click(); await settle();
    assert(JSON.stringify((await observe()).state)===JSON.stringify(after.state), `${mode}: redo failed`);
    await undo(); gestures.push({mode,axis:p.axis});
  }
  await page.getByRole('region',{name:'Multi-selection'}).getByRole('button',{name:'Clear selection',exact:true}).click();
  await pickFigure('Male 1');
  const point = await page.evaluate(() => {
    const s=document.querySelector('.canvas-host').__studio, e=[...s.entries.values()].find(e=>e.kind==='female'), rect=s.renderer.domElement.getBoundingClientRect();
    const p=e.figure.bones.head.getWorldPosition(e.root.position.clone()).project(s.editorCamera);
    return {x:rect.left+(p.x+1)*rect.width/2,y:rect.top+(1-p.y)*rect.height/2};
  });
  await page.keyboard.down('Shift'); await page.mouse.click(point.x,point.y); await page.keyboard.up('Shift'); await settle();
  assert((await observe()).ids.length===2,'Viewport Shift-click did not add female');
  await page.keyboard.down('Shift'); await page.mouse.click(point.x,point.y); await page.keyboard.up('Shift'); await settle();
  assert((await observe()).ids.length===1,'Viewport Shift-click did not toggle female off');
  const marquees = [];
  for (const view of ['Editor','Camera C']) {
    await page.getByRole('group',{name:'Viewport mode',exact:true}).getByRole('button',{name:view,exact:true}).click();
    const rect=await page.locator('canvas').boundingBox();
    await page.keyboard.down('Control');
    await page.mouse.move(rect.x+4,rect.y+68); await page.mouse.down();
    await page.mouse.move(rect.x+rect.width-4,rect.y+rect.height-65,{steps:12});
    assert(await page.locator('.selection-marquee').count()===1,`${view}: marquee not visible`);
    await page.mouse.up(); await page.keyboard.up('Control'); await settle();
    assert((await observe()).ids.length>=2,`${view}: marquee did not select both figures`);
    marquees.push(view);
  }
  await page.getByRole('button',{name:'Editor',exact:true}).click();
  await pickFigure('Male 1');
  await page.getByRole('button',{name:'Copy Pose',exact:true}).click();
  const male=(await observe()).state.items.find(i=>i.name==='Male 1');
  await pickFigure('Female 1');
  const target=(await observe()).state;
  await page.getByRole('button',{name:'Paste Pose',exact:true}).click(); await settle();
  assert(JSON.stringify((await observe()).state.items.find(i=>i.name==='Female 1').pose)===JSON.stringify(male.pose),'Full pose clipboard failed');
  await undo(); assert(JSON.stringify((await observe()).state)===JSON.stringify(target),'Full pose undo failed');
  await pickFigure('Male 1');
  await page.locator('.pose-copy-tree summary').click();
  await page.getByRole('button',{name:'Left arm',exact:true}).click();
  await page.getByRole('checkbox',{name:'Head',exact:true}).check();
  await page.getByRole('button',{name:'Copy Selected Nodes (4/17)',exact:true}).click();
  await pickFigure('Female 1');
  const partialBase=(await observe()).state;
  await page.getByRole('button',{name:'Paste Partial Pose',exact:true}).click(); await settle();
  const pasted=(await observe()).state.items.find(i=>i.name==='Female 1');
  for (const joint of Object.keys(pasted.pose)) {
    const expected=['leftShoulder','leftElbow','leftWrist','head'].includes(joint) ? male.pose[joint] : partialBase.items.find(i=>i.name==='Female 1').pose[joint];
    assert(JSON.stringify(pasted.pose[joint])===JSON.stringify(expected),`Partial pose incorrectly changed ${joint}`);
  }
  await undo(); assert(JSON.stringify((await observe()).state)===JSON.stringify(partialBase),'Partial pose undo failed');
  return { outlinerShift:true, viewportShift:true, groupPosition:true, groupFlips:['X','Y','Z'], gestures, marquees, fullPose:true, partialPose:'Left arm + Head; all other 13 joints unchanged' };
}
