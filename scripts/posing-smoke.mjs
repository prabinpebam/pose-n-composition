// Run with a Playwright Page in an isolated browser, never an owner's working tab.
export async function runPosingSmoke(page, {
  screenshotDirectory, bodies = ['Male 1', 'Female 1'],
  joints = ['leftShoulder', 'leftElbow', 'leftWrist', 'head', 'neck', 'leftHip', 'leftKnee', 'leftAnkle'],
} = {}) {
  const errors = [];
  const onError = error => errors.push(String(error));
  const onConsole = message => { if (message.type() === 'error') errors.push(message.text()); };
  page.on('pageerror', onError); page.on('console', onConsole);
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const observe = joint => page.evaluate(j => {
    const host = document.querySelector('.canvas-host');
    let fiber = host[Object.keys(host).find(key => key.startsWith('__reactFiber$'))], studio;
    while (fiber && !studio) {
      for (let hook = fiber.memoizedState; hook; hook = hook.next) {
        if (hook.memoizedState?.current?.editorCamera) studio = hook.memoizedState.current;
      }
      fiber = fiber.return;
    }
    if (!studio) throw new Error('Studio observation unavailable');
    const s = studio, rect = s.renderer.domElement.getBoundingClientRect();
    const project = p => { const n = p.clone().project(s.editorCamera); return { x: rect.left + (n.x + 1) * rect.width / 2, y: rect.top + (1 - n.y) * rect.height / 2 }; };
    const entry = s.entries.get(s.selected), figure = entry.figure;
    const marker = entry.markers.find(m => m.userData.joint === j);
    const node = project(marker.getWorldPosition(marker.position.clone()));
    const sample = f => {
      const positions = [], opposite = [], skin = f.skin;
      const indices = skin.geometry.getAttribute('skinIndex'), weights = skin.geometry.getAttribute('skinWeight');
      const side = j.startsWith('left') ? '_r' : j.startsWith('right') ? '_l' : null;
      for (let i = 0; i < skin.geometry.getAttribute('position').count; i += 13) {
        const p = skin.getVertexPosition(i, skin.position.clone()).applyMatrix4(skin.matrixWorld).toArray();
        positions.push(...p);
        if (side && skin.skeleton.bones[indices.getX(i)].name.endsWith(side) && weights.getX(i) > 0.99) opposite.push(...p);
      }
      return { positions, opposite };
    };
    let ring = null;
    if (s.joint === j) {
      const gizmo = s.transform.getHelper().children[0];
      const candidates = ['Z', 'X', 'Y', 'E']
        .map(axis => {
          const mesh = gizmo.gizmo.rotate.children.find(c => c.name === axis && c.visible);
          if (!mesh) return null;
          const positions = mesh.geometry.getAttribute('position');
          const radii = [];
          for (let i = 0; i < positions.count; i += Math.max(1, Math.floor(positions.count / 16))) {
            const world = mesh.localToWorld(mesh.position.clone().fromBufferAttribute(positions, i));
            const p = project(world);
            radii.push(Math.hypot(p.x - node.x, p.y - node.y));
          }
          const roundness = radii.length ? Math.min(...radii) / Math.max(1, Math.max(...radii)) : 0;
          return { axis, mesh, roundness };
        })
        .filter(Boolean)
        .sort((a, b) => b.roundness - a.roundness);
      for (const { axis, mesh } of candidates) {
        const positions = mesh.geometry.getAttribute('position');
        for (let i = 0; i < positions.count; i += 4) {
          const world = mesh.localToWorld(mesh.position.clone().fromBufferAttribute(positions, i));
          const p = project(world), ndc = world.clone().project(s.editorCamera);
          if (Math.hypot(p.x - node.x, p.y - node.y) < 24) continue;
          if (p.x < rect.left + 20 || p.x > rect.right - 20 || p.y < rect.top + 20 || p.y > rect.bottom - 20) continue;
          if (entry.markers.some(m => { const q = project(m.getWorldPosition(m.position.clone())); return Math.hypot(q.x - p.x, q.y - p.y) < 14; })) continue;
          const ray = new (s.transform.getRaycaster().constructor)(); ray.setFromCamera(ndc, s.editorCamera);
          const hit = ray.intersectObjects(gizmo.picker.rotate.children, true).find(h => h.object.visible);
          if (hit?.object.name === axis) { ring = { ...p, axis }; break; }
        }
        if (ring) break;
      }
    }
    const scalp = figure.root.getObjectByName('Scalp hair');
    return {
      node, ring, joint: s.joint, selected: s.selected, attached: s.transform.object === figure.bones[j],
      color: marker.material.color.getHexString(), dragging: s.transform.dragging, orbit: s.orbit.enabled,
      axis: s.transform.axis, camera: s.editorCamera.matrixWorld.toArray(), state: structuredClone(s.state),
      skin: sample(figure), otherSkins: [...s.entries].filter(([id, e]) => id !== s.selected && e.figure).map(([id, e]) => [id, sample(e.figure).positions]),
      scalp: scalp.matrixWorld.toArray(),
    };
  }, joint);
  const difference = (a, b) => Math.max(...a.map((value, i) => Math.abs(value - b[i])));
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const results = [];
  try {
    await page.locator('.boot-overlay').waitFor({ state: 'hidden' });
    for (const name of bodies) {
      await page.getByRole('listitem').filter({ hasText: name }).first().click();
      await page.getByRole('button', { name: 'Frame F', exact: true }).click();
      await settle();
      for (const joint of joints) {
        let before = await observe(joint);
        await page.mouse.click(before.node.x, before.node.y);
        await settle();
        before = await observe(joint);
        assert(before.joint === joint && before.attached && before.color === 'ff826b', `${name}/${joint}: point selection/attachment failed`);
        assert(before.ring, `${name}/${joint}: no reachable rotation ring`);
        if (screenshotDirectory && ['leftShoulder', 'head', 'leftAnkle'].includes(joint)) {
          await page.screenshot({ path: `${screenshotDirectory}\\${name.replaceAll(' ', '-')}-${joint}-before.png` });
          await settle(); before = await observe(joint);
        }
        const { x, y, axis } = before.ring, dx = x - before.node.x, dy = y - before.node.y, angle = 0.35;
        await page.mouse.move(x, y); await page.mouse.down();
        const during = await observe(joint);
        assert(during.dragging && !during.orbit && during.axis === axis, `${name}/${joint}: ring did not own drag at ${x},${y}; expected ${axis}, got ${during.axis}, dragging=${during.dragging}, orbit=${during.orbit}`);
        for (let step = 1; step <= 16; step++) {
          const a = angle * step / 16;
          await page.mouse.move(before.node.x + dx * Math.cos(a) - dy * Math.sin(a), before.node.y + dx * Math.sin(a) + dy * Math.cos(a));
        }
        await page.mouse.up(); await settle();
        const after = await observe(joint), motion = difference(before.skin.positions, after.skin.positions);
        assert(motion > 0.003, `${name}/${joint}: skinned surface did not move (${motion})`);
        assert(difference(before.camera, after.camera) < 1e-8, `${name}/${joint}: camera moved during bone drag`);
        assert(!after.dragging && after.orbit, `${name}/${joint}: navigation not restored`);
        assert(JSON.stringify(before.otherSkins) === JSON.stringify(after.otherSkins), `${name}/${joint}: another figure moved`);
        if (before.skin.opposite.length) assert(difference(before.skin.opposite, after.skin.opposite) < 1e-5, `${name}/${joint}: opposite limb moved`);
        const bItem = before.state.items.find(i => i.id === before.selected), aItem = after.state.items.find(i => i.id === after.selected);
        assert(JSON.stringify([bItem.position, bItem.rotation, bItem.scale]) === JSON.stringify([aItem.position, aItem.rotation, aItem.scale]), `${name}/${joint}: root changed`);
        for (const key of Object.keys(bItem.pose)) if (key !== joint) assert(JSON.stringify(bItem.pose[key]) === JSON.stringify(aItem.pose[key]), `${name}/${joint}: unrelated pose ${key} changed`);
        if (joint === 'head' || joint === 'neck') assert(difference(before.scalp, after.scalp) > 0.01, `${name}/${joint}: hair did not follow`);
        await page.getByRole('button', { name: 'Undo', exact: true }).click(); await settle();
        const undone = await observe(joint);
        assert(difference(before.skin.positions, undone.skin.positions) < 1e-5, `${name}/${joint}: one undo did not restore drag`);
        await page.getByRole('button', { name: 'Redo', exact: true }).click(); await settle();
        const redone = await observe(joint);
        assert(difference(after.skin.positions, redone.skin.positions) < 1e-5, `${name}/${joint}: redo did not restore drag`);
        results.push({ name, joint, axis, maxSkinMotionMeters: Number(motion.toFixed(5)), node: before.node });
        if (screenshotDirectory && ['leftShoulder', 'head', 'leftAnkle'].includes(joint)) await page.screenshot({ path: `${screenshotDirectory}\\${name.replaceAll(' ', '-')}-${joint}-after.png` });
      }
    }
    assert(errors.length === 0, `Browser errors: ${errors.join('\n')}`);
    return { gestures: results, errors };
  } finally {
    await page.mouse.up();
    page.off('pageerror', onError); page.off('console', onConsole);
  }
}
