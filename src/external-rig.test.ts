import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildExternalFigure, setFigureHairStyle, SOURCE_BONES } from './external-rig';
import { HAIR_STYLES, registerHairTemplate, type HairAssetId } from './hair';
import { getJointRotation, setFigurePose, type Figure } from './rig';
import { JOINTS, neutralPose, PRESETS, preset, type Body } from './model';

interface FixtureGLTF {
  buffers: { uri: string }[];
  images?: unknown[]; textures?: unknown[]; materials?: unknown[];
  meshes: { primitives: { material?: number }[] }[];
}
const templates = new Map<Body, T.Group>();
beforeAll(async () => {
  vi.stubGlobal('ProgressEvent', class extends Event {
    lengthComputable: boolean; loaded: number; total: number;
    constructor(type: string, init: ProgressEventInit = {}) {
      super(type); this.lengthComputable = init.lengthComputable ?? false; this.loaded = init.loaded ?? 0; this.total = init.total ?? 0;
    }
  });
  const directory = resolve('public', 'models', 'external', 'quaternius-universal-base');
  for (const body of ['male', 'female'] as const) {
    const source = JSON.parse(readFileSync(resolve(directory, `Superhero_${body === 'male' ? 'Male' : 'Female'}_FullBody.gltf`), 'utf8')) as FixtureGLTF;
    source.buffers.forEach(b => { b.uri = `data:application/octet-stream;base64,${readFileSync(resolve(directory, b.uri)).toString('base64')}`; });
    // Node tests exercise the original geometry/rig; real browser QA decodes textures.
    delete source.images; delete source.textures; delete source.materials;
    source.meshes.forEach(m => m.primitives.forEach(p => { delete p.material; }));
    templates.set(body, (await new GLTFLoader().parseAsync(JSON.stringify(source), '')).scene);
  }
  const hairIds: HairAssetId[] = ['SimpleParted', 'Long', 'Buns', 'Buzzed', 'BuzzedFemale', 'Beard'];
  for (const id of hairIds) {
    const source = JSON.parse(readFileSync(resolve(directory, `Hair_${id}.gltf`), 'utf8')) as FixtureGLTF;
    source.buffers.forEach(b => { b.uri = `data:application/octet-stream;base64,${readFileSync(resolve(directory, b.uri)).toString('base64')}`; });
    delete source.images; delete source.textures; delete source.materials;
    source.meshes.forEach(m => m.primitives.forEach(p => { delete p.material; }));
    const parsed = await new GLTFLoader().parseAsync(JSON.stringify(source), '');
    registerHairTemplate(id, parsed.scene);
  }
});
afterAll(() => vi.unstubAllGlobals());
const make = (body: Body) => buildExternalFigure(body, templates.get(body)!, '#aabbcc');
function vertexWorld(f: Figure, skin: T.SkinnedMesh): T.Vector3 {
  const p = new T.Vector3().fromBufferAttribute(skin.geometry.getAttribute('position'), 0);
  return skin.localToWorld(skin.applyBoneTransform(0, p));
}
describe.each(['male', 'female'] as const)('ready-made %s rig', body => {
  it('uses the real source skeleton and three independently poseable skinned surfaces', () => {
    const f = make(body), bounds = new T.Box3().setFromObject(f.skin);
    expect(f.skins).toHaveLength(3);
    expect(f.root.scale.toArray()).toEqual([1, 1, 1]);
    expect(bounds.max.y - bounds.min.y).toBeCloseTo(body === 'male' ? 1.85 : 1.75, 2);
    expect(bounds.min.y).toBeCloseTo(0, 3);
    for (const j of JOINTS) expect(f.bones[j].name).toBe(SOURCE_BONES[j]);
    const sourceRoot = f.root.getObjectByName('root')!;
    expect(sourceRoot.quaternion.angleTo(new T.Quaternion())).toBeGreaterThan(1);
    expect(f.skins.every(s => s.skeleton.bones.length > JOINTS.length)).toBe(true);
  });
  it('isolates left elbow and carries every skin through the complete logical root transform', () => {
    const f = make(body);
    const left = f.bones.leftWrist.getWorldPosition(new T.Vector3()), right = f.bones.rightWrist.getWorldPosition(new T.Vector3());
    const pose = neutralPose(); pose.leftElbow[0] = -1.2; setFigurePose(f, pose);
    expect(f.bones.leftWrist.getWorldPosition(new T.Vector3()).distanceTo(left)).toBeGreaterThan(0.1);
    expect(f.bones.rightWrist.getWorldPosition(new T.Vector3()).distanceTo(right)).toBeLessThan(1e-8);
    const before = f.skins.map(s => vertexWorld(f, s));
    f.root.position.set(2, 0.3, -1); f.root.rotation.set(0.2, 0.7, -0.1); f.root.scale.set(1.2, 0.9, 1.1); setFigurePose(f, pose);
    f.skins.forEach((s, i) => expect(vertexWorld(f, s).distanceTo(before[i].applyMatrix4(f.root.matrix))).toBeLessThan(1e-5));
  });
  it('round-trips every v1 semantic preset relative to nonidentity source rest rotations', () => {
    const f = make(body);
    for (const name of PRESETS) {
      const pose = preset(name); setFigurePose(f, pose);
      for (const j of JOINTS) {
        const expected = new T.Quaternion().setFromEuler(new T.Euler(...pose[j]));
        const actual = new T.Quaternion().setFromEuler(new T.Euler(...getJointRotation(f, j)));
        expect(actual.angleTo(expected)).toBeLessThan(1e-6);
      }
    }
  });
  it('updates posed bounds and permits picking the reached wrist beyond neutral bounds', () => {
    const f = make(body), before = f.skin.boundingSphere!.clone();
    setFigurePose(f, preset('Reach'));
    expect(f.skin.boundingSphere!.equals(before)).toBe(false);
    const hand = f.bones.leftWrist.getWorldPosition(new T.Vector3());
    const hits = new T.Raycaster(hand.clone().add(new T.Vector3(0, 0, 2)), new T.Vector3(0, 0, -1)).intersectObject(f.skin);
    expect(hits.some(h => h.point.distanceTo(hand) < 0.15)).toBe(true);
  });
  it('clones skeleton, materials and geometry without cross-figure mutations', () => {
    const a = make(body), b = make(body), secondColor = b.tintMaterials[0].color.clone();
    setFigurePose(a, preset('Reach')); a.tintMaterials[0].color.set('#ff0000');
    getJointRotation(b, 'leftElbow').forEach(angle => expect(angle).toBeCloseTo(0, 10));
    expect(b.tintMaterials[0].color.equals(secondColor)).toBe(true);
    expect(a.skin.geometry).not.toBe(b.skin.geometry); expect(a.skin.skeleton).not.toBe(b.skin.skeleton);
    expect(a.bones.leftElbow).not.toBe(b.bones.leftElbow);
  });
  it('fits scalp above the real skull and carries it with head, neck and root poses', () => {
    const f = make(body), scalp = f.root.getObjectByName('Scalp hair');
    if (!(scalp instanceof T.Mesh)) throw new Error('Missing scalp hair');
    expect(scalp.parent).toBe(f.bones.head);
    const bounds = new T.Box3().setFromObject(scalp), skull = new T.Box3().setFromObject(f.skin);
    expect(bounds.max.y - skull.max.y).toBeGreaterThan(0.004);
    expect(bounds.max.y - skull.max.y).toBeLessThan(0.06);
    expect(bounds.max.x - bounds.min.x).toBeGreaterThan(0.12);
    expect(bounds.min.y).toBeGreaterThan(skull.max.y - 0.45);
    const sampleIdx = Math.min(200, scalp.geometry.getAttribute('position').count - 1);
    const localPoint = new T.Vector3().fromBufferAttribute(scalp.geometry.getAttribute('position'), sampleIdx);
    const before = scalp.localToWorld(localPoint.clone());
    const headLocal = f.bones.head.worldToLocal(before.clone());
    const brows = f.skins.find(s => s.name === 'Eyebrows')!, eyes = f.skins.find(s => s.name === 'Eyes')!;
    const eyeY = new T.Box3().setFromObject(eyes).getCenter(new T.Vector3()).y;
    const facialPoints = Array.from({ length: brows.geometry.getAttribute('position').count }, (_, i) =>
      brows.getVertexPosition(i, new T.Vector3()).applyMatrix4(brows.matrixWorld));
    const lower = facialPoints.reduce((a, b) => a.y < b.y ? a : b), upper = facialPoints.reduce((a, b) => a.y > b.y ? a : b);
    expect(lower.y).toBeLessThan(eyeY); expect(upper.y).toBeGreaterThan(eyeY);
    const facialLocal = [lower, upper].map(p => f.bones.head.worldToLocal(p.clone()));
    const facialIndices = [facialPoints.indexOf(lower), facialPoints.indexOf(upper)];
    const pose = neutralPose(); pose.neck = [0.2, -0.3, 0.1]; pose.head = [-0.4, 0.8, 0.15];
    f.root.position.set(1, 0.3, -2); f.root.rotation.set(0.1, 0.5, 0.2); f.root.scale.set(1.2, 0.8, 1.1);
    setFigurePose(f, pose);
    const moved = scalp.localToWorld(localPoint.clone());
    expect(moved.distanceTo(before)).toBeGreaterThan(1);
    expect(moved.distanceTo(f.bones.head.localToWorld(headLocal))).toBeLessThan(1e-6);
    facialIndices.forEach((index, i) => {
      const actual = brows.getVertexPosition(index, new T.Vector3()).applyMatrix4(brows.matrixWorld);
      expect(actual.distanceTo(f.bones.head.localToWorld(facialLocal[i]))).toBeLessThan(1e-5);
    });
  });
  it('tints source brows/lashes and scalp together, separately from body and duplicate materials', () => {
    const a = make(body), b = make(body), bodyColor = a.tintMaterials[0].color.clone();
    const brows = a.skins.find(s => s.name === 'Eyebrows')!;
    const scalp = a.root.getObjectByName('Scalp hair') as T.Mesh;
    expect(a.hairMaterials).toContain(brows.material);
    expect(a.hairMaterials).toContain(scalp.material);
    const original = b.hairMaterials.map(m => m.color.getHexString());
    a.hairMaterials.forEach(m => { expect(b.hairMaterials).not.toContain(m); m.color.set('#cc44dd'); });
    expect(a.tintMaterials[0].color.equals(bodyColor)).toBe(true);
    expect(b.hairMaterials.map(m => m.color.getHexString())).toEqual(original);
    a.tintMaterials.forEach(m => m.color.set('#00ff00'));
    expect(a.hairMaterials.every(m => m.color.getHexString() === 'cc44dd')).toBe(true);
    scalp.geometry.dispose(); a.hairMaterials.forEach(m => m.dispose());
    expect(b.hairMaterials.map(m => m.color.getHexString())).toEqual(original);
    expect(b.root.getObjectByName('Scalp hair')).not.toBe(scalp);
  });
});
