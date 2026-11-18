import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildExternalFigure, SOURCE_BONES } from './external-rig';
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
});
afterAll(() => vi.unstubAllGlobals());
const make = (body: Body) => buildExternalFigure(body, templates.get(body)!, '#aabbcc');
function vertexWorld(f: Figure, skin: T.SkinnedMesh): T.Vector3 {
  const p = new T.Vector3().fromBufferAttribute(skin.geometry.getAttribute('position'), 0);
  return skin.localToWorld(skin.applyBoneTransform(0, p));
}
describe.each(['male', 'female'] as const)('ready-made %s rig', body => {
  it('uses the real source skeleton and three independently poseable skinned surfaces', () => {
    const f = make(body), bounds = new T.Box3().setFromObject(f.root);
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
});
