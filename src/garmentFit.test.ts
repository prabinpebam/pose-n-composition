import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as T from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { buildExternalFigure } from './external-rig';
import { buildFitTopology, applyGarmentFit } from './garmentFit';
import { HELD_TRENCH } from './heldTrenchFit';
import { getGarmentNodes, getGarmentOffset, prepareCloth, syncWardrobe, updateWardrobePose } from './mannequin-wardrobe';
import { clothPoseKey, garmentFitLimit, heldTrenchGesture, initialScene, neutralPose, validatePortable, type Garment, type Vec3 } from './model';
import { setFigurePose } from './rig';
import { solveCloth } from './clothSettle';
import { loadMannequinTestFixtures } from './testMannequinFixtures';

afterEach(() => vi.unstubAllGlobals());

async function fixture() {
  const figure = buildExternalFigure('female', (await loadMannequinTestFixtures()).get('female')!, '#cca885');
  new T.Scene().add(figure.root);
  figure.deformation = { bodyType: 'realistic', limitMode: 'anatomical' };
  setFigurePose(figure, neutralPose());
  vi.stubGlobal('fetch', async (url: URL) => new Response(new Uint8Array(readFileSync(
    resolve(__dirname, 'wardrobe-assets', url.pathname.split('/').pop()!)))));
  const item = initialScene().items.find(i => i.kind === 'female')!;
  item.wardrobe = { tank: true, skirt: true, outer: 'jacket' };
  const sync = () => syncWardrobe(figure, item.wardrobe, () => {}, error => { throw error; }, clothPoseKey(item));
  const mesh = (id: Garment) => figure.skin.getObjectByName(`Wardrobe: ${id}`) as T.Mesh<T.BufferGeometry>;
  sync();
  await vi.waitFor(() => expect(getGarmentNodes(figure, 'jacket').length).toBeGreaterThan(0));
  return { figure, item, sync, mesh };
}

it('samples stable sparse displayed edge/interior handles on both sides and back of every preset', async () => {
  const { figure, item, sync, mesh } = await fixture();
  for (const id of ['tank', 'skirt', 'jacket', 'trench', 'trenchHeld'] as const) {
    if (id === 'trench' || id === 'trenchHeld') {
      item.wardrobe!.outer = id;
      if (id === 'trenchHeld') {
        Object.assign(item, heldTrenchGesture());
        setFigurePose(figure, item.pose!, item.handPose);
      }
      sync();
    }
    await vi.waitFor(() => expect(getGarmentNodes(figure, id).length).toBeGreaterThan(0));
    const nodes = getGarmentNodes(figure, id), position = mesh(id).geometry.getAttribute('position');
    expect(nodes.length).toBeGreaterThan(12);
    expect(nodes.length).toBeLessThanOrEqual(82);
    expect(nodes.some(n => n.kind === 'edge')).toBe(true);
    expect(nodes.some(n => n.kind === 'surface')).toBe(true);
    expect(nodes.some(n => n.world.x < -.08)).toBe(true);
    expect(nodes.some(n => n.world.x > .08)).toBe(true);
    expect(nodes.some(n => n.kind === 'surface' && n.world.z < -.04), id).toBe(true);
    for (const node of nodes) expect(node.world.distanceTo(mesh(id).localToWorld(
      new T.Vector3().fromBufferAttribute(position, Number(node.id))))).toBeLessThan(1e-7);
    const ids = nodes.map(n => n.id);
    figure.root.rotation.set(.12, .63, -.09);
    figure.root.scale.set(1.3, .8, 1.1);
    figure.root.position.set(2, -.3, 1);
    updateWardrobePose(figure);
    expect(getGarmentNodes(figure, id).map(n => n.id)).toEqual(ids);
    const normal = mesh(id).geometry.getAttribute('normal'), normalMatrix = new T.Matrix3().getNormalMatrix(mesh(id).matrixWorld);
    for (const node of getGarmentNodes(figure, id)) {
      expect(node.normal.length()).toBeCloseTo(1, 6);
      expect(node.normal.distanceTo(new T.Vector3().fromBufferAttribute(normal, Number(node.id))
        .applyNormalMatrix(normalMatrix))).toBeLessThan(1e-7);
    }
    figure.root.position.set(0, 0, 0); figure.root.rotation.set(0, 0, 0); figure.root.scale.set(1, 1, 1);
    updateWardrobePose(figure);
  }
  expect(getGarmentNodes(figure, 'trenchHeld').filter(n =>
    n.id === String(HELD_TRENCH.left) || n.id === String(HELD_TRENCH.right)).map(n => n.kind)).toEqual(['edge', 'edge']);
});

it('previews absolute targets in a posed local frame, clamps travel, follows changed poses and restores untouched fits', async () => {
  const { figure, item, sync, mesh } = await fixture();
  figure.root.position.set(1.2, -.2, 2);
  figure.root.rotation.set(.2, .7, -.1); figure.root.scale.set(1.2, .85, 1.1);
  item.pose = { ...neutralPose(), leftShoulder: [0, 0, .55], leftElbow: [-1.4, .2, 0] };
  setFigurePose(figure, item.pose); sync();
  const node = getGarmentNodes(figure, 'jacket').sort((a, b) => b.world.x - a.world.x)[0];
  const before = Float32Array.from(mesh('jacket').geometry.getAttribute('position').array);
  const target = node.world.clone().add(new T.Vector3(.013, -.012, .018));
  const offset = getGarmentOffset(figure, 'jacket', node.id, target);
  const storedSlots = structuredClone(item.wardrobe!);
  syncWardrobe(figure, { ...storedSlots, fit: { jacket: { [node.id]: offset } } }, () => {}, error => { throw error; });
  expect(item.wardrobe).toEqual(storedSlots);
  const shown = getGarmentNodes(figure, 'jacket').find(n => n.id === node.id)!;
  expect(shown.world.distanceTo(target)).toBeLessThan(1e-6);
  expect(shown.normal.distanceTo(new T.Vector3()
    .fromBufferAttribute(mesh('jacket').geometry.getAttribute('normal'), Number(node.id))
    .applyNormalMatrix(new T.Matrix3().getNormalMatrix(mesh('jacket').matrixWorld)))).toBeLessThan(1e-7);
  const preview = mesh('jacket').geometry.getAttribute('position').array;
  const distances = Array.from({ length: preview.length / 3 }, (_, i) =>
    Math.hypot(...[0, 1, 2].map(d => preview[i * 3 + d] - before[i * 3 + d])));
  expect(distances.filter(d => d > 1e-5).length).toBeGreaterThan(10);
  expect(distances.filter(d => d === 0).length).toBeGreaterThan(distances.length / 2);
  const clamped = getGarmentOffset(figure, 'jacket', node.id, target.clone().addScalar(100));
  expect(Math.hypot(...clamped)).toBeCloseTo(garmentFitLimit('jacket'), 10);
  expect(() => getGarmentOffset(figure, 'jacket', 'invalid', target)).toThrow('Unknown garment fit node');
  expect(() => getGarmentOffset(figure, 'jacket', node.id, new T.Vector3(NaN, 0, 0))).toThrow('Invalid garment fit target');
  sync();
  expect(Array.from(mesh('jacket').geometry.getAttribute('position').array)).toEqual(Array.from(before));
  item.wardrobe!.fit = { jacket: { [node.id]: offset } }; sync();
  item.pose = { ...neutralPose(), leftShoulder: [0, 0, 1.3], leftElbow: [-.6, .3, 0] };
  setFigurePose(figure, item.pose); sync();
  const moved = getGarmentNodes(figure, 'jacket').find(n => n.id === node.id)!;
  expect(moved.world.distanceTo(shown.world)).toBeGreaterThan(.04);
  getGarmentOffset(figure, 'jacket', node.id, moved.world).forEach((v, d) => expect(v).toBeCloseTo(offset[d], 6));
  figure.root.rotation.set(-.3, -.7, .2); figure.root.scale.set(.8, 1.4, .9);
  updateWardrobePose(figure);
  const transformed = getGarmentNodes(figure, 'jacket').find(n => n.id === node.id)!;
  getGarmentOffset(figure, 'jacket', node.id, transformed.world).forEach((v, d) => expect(v).toBeCloseTo(offset[d], 6));
  for (const bodyType of ['chibi', 'chubby', 'realistic'] as const) {
    figure.deformation!.bodyType = bodyType;
    setFigurePose(figure, item.pose); sync();
    const displayed = getGarmentNodes(figure, 'jacket').find(n => n.id === node.id)!.world;
    getGarmentOffset(figure, 'jacket', node.id, displayed).forEach((v, d) => expect(v).toBeCloseTo(offset[d], 6));
  }
});

it('rotates the edit vector with the posed chest, not the identity GPU pass-through rig', async () => {
  const {figure,item,sync} = await fixture();
  const node = getGarmentNodes(figure,'tank').filter(n => n.world.y > 1.31)
    .sort((a,b) => b.world.z - a.world.z)[0];
  const offset: Vec3 = [0,0,.04];
  const point = () => getGarmentNodes(figure,'tank').find(n => n.id === node.id)!.world;
  const delta = () => {
    delete item.wardrobe!.fit; sync();
    const base = point();
    item.wardrobe!.fit = {tank:{[node.id]:offset}}; sync();
    return point().sub(base);
  };
  const initial = delta();
  item.pose = {...neutralPose(),chest:[0,.48,0]};
  setFigurePose(figure,item.pose);
  const rotated = delta();
  expect(rotated.length()).toBeCloseTo(initial.length(),6);
  expect(rotated.angleTo(initial)).toBeGreaterThan(.15);
});

it('overrides held grips with fit nodes, pins only edited fit nodes for settling and replays a fit-specific drape', async () => {
  const { figure, item, sync, mesh } = await fixture();
  Object.assign(item, heldTrenchGesture('leftCross'));
  item.wardrobe = { outer: 'trenchHeld', grip: 'leftCross' };
  setFigurePose(figure, item.pose!, item.handPose); sync();
  await vi.waitFor(() => expect(getGarmentNodes(figure, 'trenchHeld').length).toBeGreaterThan(0));
  const oldInput = prepareCloth(figure, item), oldFit = oldInput.layers[0].positions.slice();
  const node = getGarmentNodes(figure, 'trenchHeld').find(n => n.id === String(HELD_TRENCH.right))!;
  const target = node.world.clone().add(new T.Vector3(.015, .005, .025));
  const offset = getGarmentOffset(figure, 'trenchHeld', node.id, target);
  item.wardrobe.fit = { trenchHeld: { [node.id]: offset } }; sync();
  expect(getGarmentNodes(figure, 'trenchHeld').find(n => n.id === node.id)!.world.distanceTo(target)).toBeLessThan(1e-6);
  const input = prepareCloth(figure, item), layer = input.layers[0];
  expect(layer.pattern).toBe(oldInput.layers[0].pattern);
  expect(layer.pattern).toMatch(/^[0-9a-f]{1,8}$/);
  expect(layer.travel[Number(node.id)]).toBe(0);
  const unedited = getGarmentNodes(figure, 'trenchHeld').find(n =>
    n.id !== node.id && oldInput.layers[0].travel[Number(n.id)] > .02)!;
  expect(layer.travel[Number(unedited.id)]).toBe(oldInput.layers[0].travel[Number(unedited.id)]);
  item.wardrobe.drape = solveCloth(input); sync();
  expect(() => validatePortable({ ...initialScene(), items: [item] })).not.toThrow();
  expect(getGarmentNodes(figure, 'trenchHeld').find(n => n.id === node.id)!.world.distanceTo(target)).toBeLessThan(1e-6);
  const settled = Float32Array.from(mesh('trenchHeld').geometry.getAttribute('position').array);
  delete item.wardrobe.drape; sync();
  item.wardrobe.drape = solveCloth(input); sync();
  expect(Array.from(mesh('trenchHeld').geometry.getAttribute('position').array)).toEqual(Array.from(settled));
  delete item.wardrobe.fit; delete item.wardrobe.drape; sync();
  expect(Array.from(mesh('trenchHeld').geometry.getAttribute('position').array)).toEqual(Array.from(oldFit));
  expect(prepareCloth(figure, item).layers[0].pattern).toBe(oldInput.layers[0].pattern);
});

it('retains a garment and supported edits when an imported numeric vertex is not an editable node', async () => {
  const { figure, item, sync, mesh } = await fixture();
  const nodes = getGarmentNodes(figure, 'jacket'), node = nodes[0];
  const known = new Set(nodes.map(n => n.id));
  const invalid = Array.from({ length: mesh('jacket').geometry.getAttribute('position').count }, (_, i) => String(i))
    .find(id => !known.has(id))!;
  const errors: Error[] = [], offset: Vec3 = [.01, 0, 0];
  item.wardrobe!.fit = { jacket: { [node.id]: offset, [invalid]: [.02, 0, 0], '65535': [.01, 0, 0] } };
  expect(() => validatePortable({ ...initialScene(), items: [item] })).not.toThrow();
  const guarded = () => syncWardrobe(figure, item.wardrobe, () => {}, e => errors.push(e), clothPoseKey(item));
  guarded(); guarded(); updateWardrobePose(figure);
  expect(errors).toHaveLength(1);
  expect(errors[0].message).toContain('Ignored unsupported jacket fit nodes');
  expect(mesh('jacket')).toBeDefined();
  const world = getGarmentNodes(figure, 'jacket').find(n => n.id === node.id)!.world;
  getGarmentOffset(figure, 'jacket', node.id, world).forEach((v, d) => expect(v).toBeCloseTo(offset[d], 6));
  prepareCloth(figure, item);
  const imported = structuredClone(item.wardrobe);
  item.wardrobe = { tank: true, skirt: true }; sync();
  item.wardrobe = imported; guarded();
  await vi.waitFor(() => expect(getGarmentNodes(figure, 'jacket').length).toBeGreaterThan(0));
  expect(errors).toHaveLength(2);
  expect(mesh('jacket')).toBeDefined();
  delete item.wardrobe!.fit; sync();
});

it('releases an edited held lapel from independent palm motion while untouched lapels still follow hands', async () => {
  const { figure, item, sync } = await fixture();
  Object.assign(item, heldTrenchGesture());
  item.wardrobe = { outer: 'trenchHeld' };
  setFigurePose(figure, item.pose!, item.handPose); sync();
  await vi.waitFor(() => expect(getGarmentNodes(figure, 'trenchHeld').length).toBeGreaterThan(0));
  const right = String(HELD_TRENCH.right), left = String(HELD_TRENCH.left);
  item.wardrobe.fit = { trenchHeld: { [right]: [.04, .02, .06] } }; sync();
  const point = (id: string) => getGarmentNodes(figure, 'trenchHeld').find(n => n.id === id)!.world;
  const palm = () => figure.handRigs!.right.wristBone.getWorldPosition(new T.Vector3())
    .lerp(figure.handRigs!.right.fingers.middle!.phalanges[0].bone.getWorldPosition(new T.Vector3()), .72);
  const before = point(right), palmBefore = palm(), leftBefore = point(left);
  item.pose!.rightWrist = [.8, .35, -.4];
  setFigurePose(figure, item.pose!, item.handPose); sync();
  expect(palm().distanceTo(palmBefore)).toBeGreaterThan(.005);
  expect(point(right).distanceTo(before)).toBeLessThan(.0001);
  expect(point(left).distanceTo(leftBefore)).toBeLessThan(.0001);
  item.pose!.leftWrist = [-.7, -.3, .4];
  setFigurePose(figure, item.pose!, item.handPose); sync();
  expect(point(left).distanceTo(leftBefore)).toBeGreaterThan(.005);
  expect(point(right).distanceTo(before)).toBeLessThan(.0001);
});

it('spreads edit feedback along connected fabric only, without freezing unedited handles', () => {
  const rest: number[] = [], indices: number[] = [], size = 17;
  for (let sheet = 0; sheet < 2; sheet++) {
    const start = rest.length / 3;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) rest.push(x * .02, y * .02, sheet * .002);
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
      const a = start + y * size + x;
      indices.push(a, a + 1, a + size, a + 1, a + size + 1, a + size);
    }
  }
  const authored = Float32Array.from(rest), topology = buildFitTopology(authored, indices);
  const node = topology.nodes.find(n => Number(n.id) < size * size)!;
  const frames = Array.from({ length: rest.length / 3 }, () => new T.Quaternion());
  const result = authored.slice(), travel = new Float32Array(frames.length).fill(.04), value: Vec3 = [0, 0, .03];
  applyGarmentFit('tank', topology, authored, frames, { [node.id]: value }, result, travel);
  expect(result[Number(node.id) * 3 + 2]).toBeCloseTo(.03);
  expect(Array.from(result.subarray(size * size * 3))).toEqual(Array.from(authored.subarray(size * size * 3)));
  expect(travel.filter(v => v === 0).length).toBe(1);
  expect(Array.from(result.subarray(0, size * size * 3)).filter((v, i) => v !== authored[i]).length).toBeGreaterThan(10);
});
