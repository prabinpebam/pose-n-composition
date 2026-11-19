import { describe, expect, it } from 'vitest';
import * as T from 'three';
import {
  applyPose,
  clone,
  copyPoseNodes,
  createItem,
  DEFAULT_FEMALE_OUTFIT_COLOR,
  DEFAULT_FEMALE_SKIN_COLOR,
  DEFAULT_HAIR_COLOR,
  DEFAULT_MALE_OUTFIT_COLOR,
  DEFAULT_MALE_SKIN_COLOR,
  HAIR_STYLE_IDS,
  initialScene,
  flipItems,
  JOINTS,
  neutralPose,
  parseFile,
  parsePoseFile,
  pastePoseNodes,
  poseFile,
  PRESETS,
  preset,
  PROP_KINDS,
  validatePoseFile,
  validatePortable,
  transformItems,
} from './model';
import { makeFigure, setFigurePose } from './rig';

describe('group transforms and pose clipboard', () => {
  it.each([0, 1, 2] as const)('reflects rotated and nonuniformly scaled objects across group axis %s and round-trips', axis => {
    const a = createItem('male'), b = createItem('chair'), untouched = createItem('light');
    a.position = [-2, 1, 0]; b.position = [4, 3, 2];
    a.rotation = [0.2, -0.5, 0.6]; a.scale = [-1, 1.5, 0.8];
    b.rotation = [-0.3, 0.4, 0.7]; b.scale = [0.5, 1, 2];
    const items = [a, b, untouched], original = clone(items), ids = [a.id, b.id];
    const flipped = flipItems(items, ids, axis);
    expect(items).toEqual(original); expect(flipped[2]).toEqual(untouched);
    flipped[0].scale.forEach((value, k) => expect(value).toBeCloseTo(a.scale[k] * (k === axis ? -1 : 1)));
    const center = [1, 2, 1];
    expect(flipped[0].position[axis]).toBeCloseTo(2 * center[axis] - a.position[axis]);
    const matrix = (item: typeof a) => new T.Matrix4().compose(new T.Vector3(...item.position), new T.Quaternion().setFromEuler(new T.Euler(...item.rotation)), new T.Vector3(...item.scale));
    const roundtrip = flipItems(flipped, ids, axis);
    for (let n = 0; n < 2; n++) matrix(roundtrip[n]).elements.forEach((v, k) => expect(v).toBeCloseTo(matrix(items[n]).elements[k], 8));
    const scene = initialScene(); scene.items = flipped;
    expect(() => validatePortable(scene)).not.toThrow();
    flipped[0].scale[axis] = 0;
    expect(() => validatePortable(scene)).toThrow('scale magnitude');
  });
  it('rotates positions, orientations and spotlight targets as one world-space group', () => {
    const a = createItem('chair'), b = createItem('light');
    a.position = [1, 0, 0]; a.scale = [1, -1, 1]; b.position = [-1, 0, 0]; b.target = [1, 1, 0];
    const rotated = transformItems([a, b], [a.id, b.id], new T.Matrix4().makeRotationY(Math.PI / 2));
    expect(rotated[0].position[2]).toBeCloseTo(-1);
    expect(rotated[1].position[2]).toBeCloseTo(1);
    expect(rotated[1].target![2]).toBeCloseTo(-1);
    expect(rotated[0].rotation[1]).toBeCloseTo(Math.PI / 2);
    expect(rotated[0].scale).toEqual(a.scale);
  });
  it('copies selected joints only without changing target legs, opposite arm, appearance or placement', () => {
    const source = createItem('male'), target = createItem('female');
    source.pose = preset('Reach'); target.pose = preset('Running');
    const before = clone(target);
    const nodes = ['leftShoulder', 'leftElbow', 'leftWrist', 'head'] as const;
    const clipboard = copyPoseNodes(source, nodes), pasted = pastePoseNodes(target, clipboard);
    for (const joint of JOINTS) expect(pasted.pose![joint]).toEqual(nodes.some(j => j === joint) ? source.pose[joint] : before.pose![joint]);
    expect({ ...pasted, pose: before.pose }).toEqual(before);
    source.pose.head[0] = 99;
    expect(clipboard.pose.head[0]).not.toBe(99);
    expect(pastePoseNodes(target, copyPoseNodes(before)).pose).toEqual(before.pose);
  });
});

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
  it('round-trips sculpted hairStyle, defaults legacy v1 figures, and excludes hairStyle from pose files', () => {
    const scene = initialScene();
    for (const style of HAIR_STYLE_IDS) {
      scene.items[0].hairStyle = style;
      const parsed = parseFile(JSON.stringify(scene));
      if (parsed.type !== 'scene') throw new Error('Expected scene');
      expect(parsed.items[0].hairStyle).toBe(style);
    }
    const pFile = poseFile(scene.items[0], 'Style-agnostic pose');
    expect(pFile).not.toHaveProperty('hairStyle');
    scene.items[1].hairStyle = 'buns';
    expect(applyPose(scene.items[1], pFile).hairStyle).toBe('buns');

    const legacy = initialScene();
    delete legacy.items[0].hairStyle;
    delete legacy.items[1].hairStyle;
    const upgraded = validatePortable(legacy);
    if (upgraded.type !== 'scene') throw new Error('Expected scene');
    expect(upgraded.items[0].hairStyle).toBe('parted');
    expect(upgraded.items[1].hairStyle).toBe('long');

    const invalid = { ...initialScene(), items: [{ ...initialScene().items[0], hairStyle: 'mohawk-9000' }] };
    expect(() => validatePortable(invalid)).toThrow('Invalid file');
  });
  it('provides 10 distinct studio presets within anatomical joint bounds', () => {
    expect(PRESETS).toHaveLength(10);
    const signatures = new Set<string>();
    for (const name of PRESETS) {
      const p = preset(name);
      signatures.add(JSON.stringify(p));
      for (const j of JOINTS) {
        for (const rad of p[j]) {
          expect(Math.abs(rad)).toBeLessThanOrEqual(Math.PI);
        }
      }
    }
    expect(signatures.size).toBe(PRESETS.length);
  });
  it('round-trips true-color skin and outfitColor, defaults legacy v1 scenes, and keeps pose JSON appearance-free', () => {
    const scene = initialScene();
    expect(scene.items[0].color).toBe(DEFAULT_MALE_SKIN_COLOR);
    expect(scene.items[1].color).toBe(DEFAULT_FEMALE_SKIN_COLOR);
    expect(scene.items[0].outfitColor).toBe(DEFAULT_MALE_OUTFIT_COLOR);
    expect(scene.items[1].outfitColor).toBe(DEFAULT_FEMALE_OUTFIT_COLOR);

    scene.items[0].color = '#8d5524';
    scene.items[0].outfitColor = '#1d6f5e';
    scene.items[1].color = '#f5d0ba';
    scene.items[1].outfitColor = '#6a359c';
    const reloaded = parseFile(JSON.stringify(scene));
    expect(reloaded).toEqual(scene);

    const exportedPose = poseFile(scene.items[0], 'Heroic export');
    expect(exportedPose).not.toHaveProperty('color');
    expect(exportedPose).not.toHaveProperty('outfitColor');
    expect(exportedPose).not.toHaveProperty('hairColor');
    expect(exportedPose).not.toHaveProperty('hairStyle');

    const crossApplied = applyPose(scene.items[1], parsePoseFile(JSON.stringify(exportedPose)));
    expect(crossApplied.pose).toEqual(scene.items[0].pose);
    expect(crossApplied.color).toBe('#f5d0ba');
    expect(crossApplied.outfitColor).toBe('#6a359c');

    const legacy = clone(scene);
    delete legacy.items[0].outfitColor;
    delete legacy.items[1].outfitColor;
    const upgraded = validatePortable(legacy);
    if (upgraded.type !== 'scene') throw new Error('Expected scene');
    expect(upgraded.items[0].outfitColor).toBe(DEFAULT_MALE_OUTFIT_COLOR);
    expect(upgraded.items[1].outfitColor).toBe(DEFAULT_FEMALE_OUTFIT_COLOR);
  });
  it.each([null, '#123', 'crimson', 42, { hex: '#112233' }])('rejects malformed present outfitColor %j', outfitColor => {
    const scene = initialScene();
    const candidate = { ...scene, items: [{ ...scene.items[0], outfitColor }] };
    expect(() => validatePortable(candidate)).toThrow('expected #rrggbb color');
  });
  it('validates dedicated pose JSON files and rejects scene JSON or malformed pose files cleanly', () => {
    const male = createItem('male');
    male.pose = preset('Heroic');
    const serialized = JSON.stringify(poseFile(male, 'Heroic study'), null, 2);
    const parsed = parsePoseFile(serialized);
    expect(parsed.type).toBe('pose');
    expect(parsed.name).toBe('Heroic study');
    expect(parsed.pose).toEqual(male.pose);

    const female = createItem('female');
    const beforeFemale = clone(female);
    expect(() => parsePoseFile(JSON.stringify(initialScene()))).toThrow('expected a pose JSON file');
    expect(() => validatePoseFile({ schemaVersion: 1, rigVersion: 1, type: 'pose', name: 'Bad', body: 'male', pose: {} })).toThrow('Invalid file');
    expect(female).toEqual(beforeFemale);
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
