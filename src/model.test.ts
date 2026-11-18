import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { applyPose, clone, createItem, DEFAULT_HAIR_COLOR, initialScene, JOINTS, neutralPose, parseFile, poseFile, PRESETS, preset, PROP_KINDS, validatePortable } from './model';
import { makeFigure, setFigurePose } from './rig';

describe('portable scene and pose contracts', () => {
  it('round-trips both bodies, all semantic rotations and full scene composition', () => {
    const scene = initialScene();
    scene.items = ['male', 'female', ...PROP_KINDS, 'light'].map((k, n) => {
      const item = createItem(k as typeof scene.items[number]['kind'], n);
      item.position = [n, n / 4, n === 0 ? 0 : -n]; item.rotation = [0.1, 0.2, 0.3]; item.scale = [0.9, 1.1, 1.2]; item.color = '#aabbcc';
      if (item.pose) JOINTS.forEach((j, i) => { item.pose![j] = [(i + 1) / 10, -(i + 1) / 20, (i + 1) / 30]; });
      return item;
    });
    scene.camera.dof = true; scene.camera.focalLength = 85; scene.camera.focus = 5; scene.camera.aspect = '4:5';
    const loaded = parseFile(JSON.stringify(scene));
    expect(loaded).toEqual(scene);
    for (const body of ['male', 'female'] as const) {
      const original = scene.items.find(i => i.kind === body)!;
      const portable = parseFile(JSON.stringify(poseFile(original, 'Joint study')));
      expect(portable.type).toBe('pose');
      if (portable.type !== 'pose') throw new Error('Expected pose');
      const target = createItem(body); target.position = [2, 3, 4];
      const applied = applyPose(target, portable);
      expect(applied.pose).toEqual(original.pose); expect(applied.position).toEqual([2, 3, 4]);
    }
  });
  it.each([
    ['unsupported schema', (s: ReturnType<typeof initialScene>) => { s.schemaVersion = 2 as 1; }],
    ['unknown rig', (s: ReturnType<typeof initialScene>) => { s.rigVersion = 2 as 1; }],
    ['non-finite coordinate', (s: ReturnType<typeof initialScene>) => { s.items[0].position[0] = Infinity; }],
    ['missing joint', (s: ReturnType<typeof initialScene>) => { delete (s.items[0].pose as Partial<ReturnType<typeof neutralPose>>).leftElbow; }],
    ['oversized scale', (s: ReturnType<typeof initialScene>) => { s.items[0].scale[0] = 100; }],
    ['duplicate ID', (s: ReturnType<typeof initialScene>) => { s.items[1].id = s.items[0].id; }],
    ['bad color', (s: ReturnType<typeof initialScene>) => { s.items[0].color = 'url(javascript:bad)'; }],
    ['bad clips', (s: ReturnType<typeof initialScene>) => { s.camera.near = 10; s.camera.far = 2; }],
  ])('rejects %s without mutating existing scene', (_, mutate) => {
    const existing = initialScene(), before = clone(existing), candidate = clone(existing); mutate(candidate);
    expect(() => validatePortable(candidate)).toThrow('Invalid file'); expect(existing).toEqual(before);
  });
  it('rejects non-JSON, oversized text and unbounded object/light lists', () => {
    expect(() => parseFile('{bad')).toThrow('not valid JSON');
    expect(() => parseFile(' '.repeat(1_000_001))).toThrow('1 MB');
    const scene = initialScene(); scene.items = Array.from({ length: 65 }, () => createItem('chair'));
    expect(() => validatePortable(scene)).toThrow('64');
    scene.items = Array.from({ length: 9 }, () => createItem('light'));
    expect(() => validatePortable(scene)).toThrow('8 lights');
  });
  it('validates every preset against every joint and isolates mutable pose copies', () => {
    for (const p of PRESETS) {
      const figure = createItem('female'); figure.pose = preset(p);
      expect(validatePortable(poseFile(figure, p))).toEqual(poseFile(figure, p));
    }
    const one = preset('Reach'), two = preset('Reach'); one.leftElbow[0] = 2;
    expect(two.leftElbow[0]).not.toBe(2);
  });
  it('round-trips independent hair colors, defaults old scenes and keeps appearance out of pose files', () => {
    const scene = initialScene();
    scene.items[0].hairColor = '#bb3311'; scene.items[1].hairColor = '#ccddee';
    expect(parseFile(JSON.stringify(scene))).toEqual(scene);
    const file = poseFile(scene.items[0], 'Appearance-free pose');
    expect(file).not.toHaveProperty('hairColor');
    const female = applyPose(scene.items[1], file);
    expect(female.hairColor).toBe('#ccddee'); expect(female.color).toBe(scene.items[1].color);
    delete scene.items[0].hairColor; delete scene.items[1].hairColor;
    const old = clone(scene), loaded = validatePortable(scene);
    if (loaded.type !== 'scene') throw new Error('Expected scene');
    expect(loaded.items.slice(0, 2).map(i => i.hairColor)).toEqual([DEFAULT_HAIR_COLOR, DEFAULT_HAIR_COLOR]);
    expect(loaded.items[0].pose).toEqual(scene.items[0].pose);
    expect(loaded.items[0].position).toEqual(scene.items[0].position);
    expect(scene).toEqual(old);
  });
  it.each([null, '#fff', 'red', { color: '#ffffff' }])('rejects malformed present hair color %j', hairColor => {
    const scene = initialScene(), candidate = { ...scene, items: [{ ...scene.items[0], hairColor }] };
    expect(() => validatePortable(candidate)).toThrow('expected #rrggbb color');
    expect(scene.items[0].hairColor).toBe(DEFAULT_HAIR_COLOR);
  });
});
describe('actual procedural rig and camera', () => {
  it.each(['male', 'female'] as const)('%s left elbow affects left wrist, not right wrist; root keeps skin together', body => {
    const figure = makeFigure(body, '#aabbcc'); setFigurePose(figure, neutralPose());
    const beforeLeft = figure.bones.leftWrist.getWorldPosition(new T.Vector3());
    const beforeRight = figure.bones.rightWrist.getWorldPosition(new T.Vector3());
    const p = neutralPose(); p.leftElbow[0] = -1; setFigurePose(figure, p);
    expect(figure.bones.leftWrist.getWorldPosition(new T.Vector3()).distanceTo(beforeLeft)).toBeGreaterThan(0.1);
    expect(figure.bones.rightWrist.getWorldPosition(new T.Vector3()).distanceTo(beforeRight)).toBeLessThan(1e-8);
    figure.skin.skeleton.update();
    const vertex = new T.Vector3().fromBufferAttribute(figure.skin.geometry.getAttribute('position'), 0);
    figure.skin.applyBoneTransform(0, vertex); figure.skin.localToWorld(vertex);
    figure.root.position.x = 2; figure.root.updateMatrixWorld(true); figure.skin.skeleton.update();
    const moved = new T.Vector3().fromBufferAttribute(figure.skin.geometry.getAttribute('position'), 0);
    figure.skin.applyBoneTransform(0, moved); figure.skin.localToWorld(moved);
    expect(moved.x - vertex.x).toBeCloseTo(2); expect(moved.y).toBeCloseTo(vertex.y); expect(moved.z).toBeCloseTo(vertex.z);
    expect(figure.skin.isSkinnedMesh).toBe(true); expect(figure.skin.skeleton.bones).toHaveLength(JOINTS.length);
  });
  it('has distinct anatomical shoulder and hip proportions, not renamed copies', () => {
    const male = makeFigure('male', '#aabbcc'), female = makeFigure('female', '#aabbcc');
    expect(male.bones.leftShoulder.position.x).toBeGreaterThan(female.bones.leftShoulder.position.x);
    expect(female.bones.leftHip.position.x).toBeGreaterThan(male.bones.leftHip.position.x);
    expect(male.skin.geometry.getAttribute('position').array).not.toEqual(female.skin.geometry.getAttribute('position').array);
  });
  it('updates posed bounds and raycasts an extended arm outside the neutral silhouette', () => {
    const f = makeFigure('female', '#aabbcc'); setFigurePose(f, neutralPose());
    const old = f.skin.boundingSphere!.clone();
    setFigurePose(f, preset('Reach'));
    expect(f.skin.boundingSphere!.equals(old)).toBe(false);
    const hand = new T.Vector3(0, -0.045, 0.009).applyMatrix4(f.bones.leftWrist.matrixWorld);
    const ray = new T.Raycaster(hand.clone().add(new T.Vector3(0, 0, 2)), new T.Vector3(0, 0, -1));
    const hits = ray.intersectObject(f.skin);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some(h => h.point.distanceTo(hand) < 0.15)).toBe(true);
  });
  it('has mixed upper/lower bone weights at elbows and knees for continuous bending', () => {
    const f = makeFigure('male', '#aabbcc');
    const indices = f.skin.geometry.getAttribute('skinIndex'), weights = f.skin.geometry.getAttribute('skinWeight');
    for (const [upper, lower] of [['leftShoulder', 'leftElbow'], ['leftHip', 'leftKnee']] as const) {
      let blended = 0;
      for (let i = 0; i < indices.count; i++) if (indices.getX(i) === JOINTS.indexOf(upper) && indices.getY(i) === JOINTS.indexOf(lower) && weights.getY(i) > 0 && weights.getY(i) < 1) blended++;
      expect(blended).toBeGreaterThan(32);
    }
  });
  it('50 mm at 36 mm gauge 3:2 has correct vertical FOV and lens affects projection', () => {
    const camera = new T.PerspectiveCamera(); camera.filmGauge = 36; camera.aspect = 1.5; camera.setFocalLength(50);
    expect(camera.fov).toBeCloseTo(26.99147, 4); const matrix = camera.projectionMatrix.clone();
    camera.setFocalLength(85); expect(camera.projectionMatrix.equals(matrix)).toBe(false); expect(camera.getFocalLength()).toBeCloseTo(85);
    camera.aspect = 0.8; camera.setFocalLength(85); expect(camera.getFocalLength()).toBeCloseTo(85);
  });
});
