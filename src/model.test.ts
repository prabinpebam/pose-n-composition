import { describe, expect, it } from 'vitest';
import * as T from 'three';
import {
  applyCharacterModelColorTransition,
  applyChibiDefaultRenderStyle,
  applyLightPartPosition,
  applyPose,
  clone,
  clothPoseKey,
  garmentFitLimit,
  setFitOffset,
  computeRoomObjectWorldPosition,
  copyPoseNodes,
  createDefaultScene,
  createItem,
  DEFAULT_AO_ENABLED,
  DEFAULT_FEMALE_OUTFIT_COLOR,
  DEFAULT_FEMALE_SKIN_COLOR,
  DEFAULT_GI_ENABLED,
  DEFAULT_GI_INTENSITY,
  DEFAULT_HAIR_COLOR,
  DEFAULT_MALE_OUTFIT_COLOR,
  DEFAULT_MALE_SKIN_COLOR,
  DEFAULT_RENDER_QUALITY,
  DEFAULT_RENDER_STYLE,
  DEFAULT_SHADOW_SOFTNESS,
  defaultCharacterOutfitColor,
  formatRoomObjectTargetRef,
  HAIR_STYLE_IDS,
  hasCharacterOutfitSlot,
  isTargetedLight,
  LIGHT_DEFAULTS,
  linkLightTarget,
  parseTargetObjectRef,
  resolveLightActiveVector,
  resolveLightPartForItem,
  switchLightType,
  syncLinkedLightTargets,
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
  swapItemBodyKind,
  validatePoseFile,
  validatePortable,
  transformItems,
  createPrimitiveItem,
  createDefaultModifierSpec,
  groupItemsIntoBoole,
  swapBooleOperands,
  extractBooleOperands,
  findItemOrOperand,
  updateItemOrOperand,
} from './model';
import { createDefaultPrimitiveSpec, createPrimitiveEditableMesh } from './modeling/primitives';
import { sanitizeWorkingView } from './storage';
import { makeFigure, setFigurePose } from './rig';
import {
  applyStudioEnvironmentLighting,
  STUDIO_FILL_INTENSITY,
  STUDIO_HEMI_INTENSITY,
  STUDIO_ILLUSTRATION_FILL_INTENSITY,
} from './engine';
import { StudioShadingController } from './npr';

it('keys the bake to equipped fit edits and resets one node without changing another slot', () => {
  const figure = initialScene().items.find(i=>i.kind==='female')!;
  figure.wardrobe = {tank:true, outer:'trenchHeld'};
  const initialKey = clothPoseKey(figure);
  figure.wardrobe = setFitOffset(figure.wardrobe,'skirt','0',[.02,0,0]);
  expect(clothPoseKey(figure)).toBe(initialKey);
  const beforeEdit = figure.wardrobe;
  figure.wardrobe = setFitOffset(beforeEdit,'tank','1',[garmentFitLimit('tank'),0,0]);
  const editedKey = clothPoseKey(figure);
  expect(editedKey).not.toBe(initialKey);
  expect(beforeEdit.fit?.tank).toBeUndefined();
  figure.position = [2,.1,-3];
  expect(clothPoseKey(figure)).toBe(editedKey);
  figure.wardrobe.drape = {poseKey:editedKey,layers:{}};
  figure.wardrobe = setFitOffset(figure.wardrobe,'tank','1');
  expect(figure.wardrobe.drape).toBeUndefined();
  expect(figure.wardrobe.fit).toEqual(beforeEdit.fit);
  expect(clothPoseKey(figure)).toBe(initialKey);
});

it('rejects out-of-bounds or malformed portable garment offsets', () => {
  const scene = initialScene(), item = scene.items.find(i=>i.kind==='female')!;
  for (const layer of [{'0':[.06,.06,0]}, {'1e3':[0,.01,0]}, {'1':[0,Infinity,0]}]) {
    Object.assign(item,{wardrobe:{tank:true,fit:{tank:layer}}});
    expect(()=>validatePortable(scene)).toThrow();
  }
});

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
  it('defaults legacy figures to realistic anatomy and rejects malformed new options', () => {
    const scene = initialScene();
    delete scene.items[0].bodyType; delete scene.items[0].anatomicalLimits;
    const restored = validatePortable(scene);
    if (restored.type !== 'scene') throw new Error('Expected scene');
    expect(restored.items[0].bodyType).toBe('realistic');
    expect(restored.items[0].anatomicalLimits).toBe(true);
    for (const patch of [{ bodyType: 'unknown' }, { bodyType: null }, { anatomicalLimits: 'false' }, { anatomicalLimits: null }]) {
      expect(() => validatePortable({ ...scene, items: [{ ...scene.items[0], ...patch }] })).toThrow('Invalid file');
    }
  });
  it('persists and validates renderQuality, giEnabled, giIntensity, aoEnabled, and shadowSoftness with backward-compatible defaults', () => {
    const legacy = initialScene() as unknown as Record<string, unknown>;
    delete legacy.renderQuality;
    delete legacy.giEnabled;
    delete legacy.giIntensity;
    delete legacy.aoEnabled;
    delete legacy.shadowSoftness;
    const migrated = validatePortable(legacy);
    if (migrated.type !== 'scene') throw new Error('Expected scene');
    expect(migrated.renderQuality).toBe(DEFAULT_RENDER_QUALITY);
    expect(migrated.giEnabled).toBe(DEFAULT_GI_ENABLED);
    expect(migrated.giIntensity).toBe(DEFAULT_GI_INTENSITY);
    expect(migrated.aoEnabled).toBe(DEFAULT_AO_ENABLED);
    expect(migrated.shadowSoftness).toBe(DEFAULT_SHADOW_SOFTNESS);

    const configured = validatePortable({
      ...initialScene(),
      renderQuality: 'ultra',
      giEnabled: false,
      giIntensity: 1.85,
      aoEnabled: false,
      shadowSoftness: 2.2,
    });
    if (configured.type !== 'scene') throw new Error('Expected scene');
    expect(configured.renderQuality).toBe('ultra');
    expect(configured.giEnabled).toBe(false);
    expect(configured.giIntensity).toBe(1.85);
    expect(configured.aoEnabled).toBe(false);
    expect(configured.shadowSoftness).toBe(2.2);

    expect(() => validatePortable({ ...initialScene(), renderQuality: 'extreme' })).toThrow('Invalid file');
    expect(() => validatePortable({ ...initialScene(), giIntensity: 9.9 })).toThrow('Invalid file');
    expect(() => validatePortable({ ...initialScene(), shadowSoftness: -1 })).toThrow('Invalid file');
  });
  it('adds a chosen archetype while keeping pose files strictly appearance-free', () => {
    const figure = createItem('female', 0, 'chibi');
    figure.anatomicalLimits = false;
    expect(figure.bodyType).toBe('chibi');
    const file = poseFile(figure, 'Study');
    expect(Object.keys(file).sort()).toEqual(['schemaVersion', 'rigVersion', 'type', 'name', 'body', 'pose'].sort());
    const target = createItem('male', 0, 'obese'), before = clone(target);
    expect({ ...applyPose(target, file), pose: before.pose }).toEqual(before);
  });
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
  it('swaps base figure kind in-place while preserving identity, transform, pose, bodyType, colors, hair, and joint limits', () => {
    const female = createItem('female', 1, 'busty');
    female.position = [1.8, 0.48, -1.2];
    female.rotation = [0.05, 1.1, -0.05];
    female.scale = [-1, 1.05, 1];
    female.pose = preset('Contrapposto');
    female.anatomicalLimits = false;
    // Simulate legacy item with implicit outfitColor/hairStyle before swap
    delete female.outfitColor;
    delete female.hairStyle;

    const swapped = swapItemBodyKind(female, 'male', 0.465);
    expect(swapped.id).toBe(female.id);
    expect(swapped.kind).toBe('male');
    expect(swapped.position).toEqual([1.8, 0.465, -1.2]);
    expect(swapped.rotation).toEqual(female.rotation);
    expect(swapped.scale).toEqual(female.scale);
    expect(swapped.pose).toEqual(female.pose);
    expect(swapped.bodyType).toBe('busty');
    expect(swapped.color).toBe(DEFAULT_FEMALE_SKIN_COLOR);
    expect(swapped.outfitColor).toBe(DEFAULT_FEMALE_OUTFIT_COLOR);
    expect(swapped.hairStyle).toBe('long');
    expect(swapped.hairColor).toBe(DEFAULT_HAIR_COLOR);
    expect(swapped.anatomicalLimits).toBe(false);

    const scene = initialScene();
    scene.items[1] = swapped;
    expect(() => validatePortable(scene)).not.toThrow();
    expect(() => swapItemBodyKind(createItem('chair'), 'female')).toThrow('Only character figures');
  });
  it('creates a fresh default scene and switches realistic renderStyle to anime illustration when chibi is selected or added', () => {
    const first = createDefaultScene();
    const second = createDefaultScene();
    expect(first.name).toBe('Untitled study');
    expect(first.renderStyle?.mode).toBe('realistic');
    expect(first.items.map(i => i.kind)).toEqual(['male', 'female', 'light']);
    expect(first.items[0].id).not.toBe(second.items[0].id);

    // Non-chibi body types leave realistic mode unchanged
    applyChibiDefaultRenderStyle(first, 'heroic');
    expect(first.renderStyle?.mode).toBe('realistic');

    // Chibi promotes default realistic PBR mode to anime cel-shading ('illustration')
    applyChibiDefaultRenderStyle(first, 'chibi');
    expect(first.renderStyle?.mode).toBe('illustration');

    // Intentional non-realistic modes (e.g., clay or outline) are preserved
    first.renderStyle = { ...first.renderStyle!, mode: 'clay' };
    applyChibiDefaultRenderStyle(first, 'chibi');
    expect(first.renderStyle.mode).toBe('clay');
  });
  it('round-trips spot, directional, and point lights and preserves legacy light compatibility', () => {
    const scene = initialScene();
    const spot = createItem('light', 0);
    spot.angle = 35;
    spot.penumbra = 0.25;
    spot.distance = 45;
    spot.decay = 2;
    spot.castShadow = false;

    const directional = {
      ...createItem('light', 1),
      ...switchLightType(createItem('light', 1), 'directional'),
      shadowExtent: 16,
    };
    const point = {
      ...createItem('light', 2),
      ...switchLightType(createItem('light', 2), 'point'),
      distance: 0,
      decay: 1.5,
    };
    // Legacy light without lightType or extended parameters
    const legacy = {
      id: crypto.randomUUID(),
      name: 'Legacy Light',
      kind: 'light' as const,
      color: '#ffffff',
      position: [2, 4, 2] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      scale: [1, 1, 1] as [number, number, number],
      intensity: 40,
      target: [0, 1, 0] as [number, number, number],
    };

    scene.items = [spot, directional, point, legacy];
    const loaded = parseFile(JSON.stringify(scene));
    expect(loaded.type).toBe('scene');
    if (loaded.type !== 'scene') throw new Error('Expected scene');

    expect(loaded.items[0]).toMatchObject({ lightType: 'spot', angle: 35, penumbra: 0.25, distance: 45, decay: 2, castShadow: false });
    expect(loaded.items[1]).toMatchObject({ lightType: 'directional', intensity: 3, shadowExtent: 16 });
    expect(loaded.items[2]).toMatchObject({ lightType: 'point', intensity: 30, distance: 0, decay: 1.5 });
    expect(loaded.items[3]).toMatchObject({
      lightType: LIGHT_DEFAULTS.lightType,
      castShadow: LIGHT_DEFAULTS.castShadow,
      angle: LIGHT_DEFAULTS.angle,
      penumbra: LIGHT_DEFAULTS.penumbra,
      distance: LIGHT_DEFAULTS.distance,
      decay: LIGHT_DEFAULTS.decay,
      shadowExtent: LIGHT_DEFAULTS.shadowExtent,
    });

    // Scales intensity sensibly across directional <-> spot/point switches
    const toDir = switchLightType(spot, 'directional');
    expect(toDir.lightType).toBe('directional');
    expect(toDir.intensity).toBe(3);
    const backToSpot = switchLightType({ ...spot, ...toDir }, 'spot');
    expect(backToSpot.lightType).toBe('spot');
    expect(backToSpot.intensity).toBe(30);

    // Rejects invalid lightType or out-of-range parameters
    const badType = clone(scene);
    (badType.items[0] as unknown as Record<string, unknown>).lightType = 'area';
    expect(() => validatePortable(badType)).toThrow();
    const badAngle = clone(scene);
    badAngle.items[0].angle = 120;
    expect(() => validatePortable(badAngle)).toThrow();
  });

  it('resolves and updates Source vs Target transform vectors for targeted lights and resets on Omni', () => {
    const spot = createItem('light');
    spot.position = [2.2, 3.2, 2.4];
    spot.target = [-1.4, 0.85, 0.6];

    expect(isTargetedLight(spot)).toBe(true);
    expect(resolveLightPartForItem(spot, 'source')).toBe('source');
    expect(resolveLightPartForItem(spot, 'target')).toBe('target');
    expect(resolveLightActiveVector(spot, 'source')).toEqual([2.2, 3.2, 2.4]);
    expect(resolveLightActiveVector(spot, 'target')).toEqual([-1.4, 0.85, 0.6]);

    // Editing while Source is selected mutates position only, leaving target intact
    const afterSourceMove = { ...spot, ...applyLightPartPosition(spot, 'source', [4.0, 2.5, 1.0]) };
    expect(afterSourceMove.position).toEqual([4.0, 2.5, 1.0]);
    expect(afterSourceMove.target).toEqual([-1.4, 0.85, 0.6]);

    // Editing while Target is selected mutates target only, leaving position intact
    const afterTargetMove = { ...afterSourceMove, ...applyLightPartPosition(afterSourceMove, 'target', [0.5, 1.2, -2.0]) };
    expect(afterTargetMove.position).toEqual([4.0, 2.5, 1.0]);
    expect(afterTargetMove.target).toEqual([0.5, 1.2, -2.0]);

    // Parallel light (directional) supports identical Source/Target transform binding
    const parallel = { ...afterTargetMove, ...switchLightType(afterTargetMove, 'directional') };
    expect(isTargetedLight(parallel)).toBe(true);
    expect(resolveLightPartForItem(parallel, 'target')).toBe('target');
    expect(resolveLightActiveVector(parallel, 'target')).toEqual([0.5, 1.2, -2.0]);

    // Switching to Omni (point) cleanly resets sub-selection back to Source
    const omni = { ...afterTargetMove, ...switchLightType(afterTargetMove, 'point') };
    expect(isTargetedLight(omni)).toBe(false);
    expect(resolveLightPartForItem(omni, 'target')).toBe('source');
    expect(resolveLightActiveVector(omni, 'target')).toEqual([4.0, 2.5, 1.0]);

    // Working view persistence preserves target selection for spot/directional and falls back to source for omni
    const draftScene = createDefaultScene();
    const sceneLight = draftScene.items.find(i => i.kind === 'light')!;
    expect(
      sanitizeWorkingView({ selectedId: sceneLight.id, selectedLightPart: 'target' }, draftScene).selectedLightPart,
    ).toBe('target');
    Object.assign(sceneLight, switchLightType(sceneLight, 'point'));
    expect(
      sanitizeWorkingView({ selectedId: sceneLight.id, selectedLightPart: 'target' }, draftScene).selectedLightPart ?? 'source',
    ).toBe('source');
  });

  it('links spotlight target coordinate to scene objects and room objects, tracks movement, and preserves coordinate on unlink or deletion', () => {
    const scene = createDefaultScene();
    const character = scene.items.find(i => i.kind === 'female')!;
    const spot = scene.items.find(i => i.kind === 'light')!;
    const cube = createItem('chair');
    cube.position = [1.75, 0.45, -1.25];
    scene.items.push(cube);

    // Rejects self-linking
    expect(() => linkLightTarget(scene.items, spot.id, spot.id)).toThrow(/cannot link its target to itself/i);
    expect(spot.targetObjectId).toBeUndefined();

    // Linking to prop snaps target coordinate immediately
    linkLightTarget(scene.items, spot.id, cube.id);
    expect(spot.targetObjectId).toBe(cube.id);
    expect(spot.target).toEqual([1.75, 0.45, -1.25]);

    // Manual target edits are ignored while constrained to an object, while source remains movable
    expect(applyLightPartPosition(spot, 'target', [9, 9, 9])).toEqual({});
    expect(applyLightPartPosition(spot, 'source', [3, 4, 5])).toEqual({ position: [3, 4, 5] });

    // Moving the linked object updates spotlight target automatically
    cube.position = [-2.4, 1.15, 0.9];
    syncLinkedLightTargets(scene.items);
    expect(spot.target).toEqual([-2.4, 1.15, 0.9]);

    // Group/matrix transform of linked character updates spotlight target
    linkLightTarget(scene.items, spot.id, character.id);
    expect(spot.target).toEqual(character.position);
    const delta = new T.Matrix4().makeTranslation(1.5, 0.3, -0.8);
    const movedItems = transformItems(scene.items, [character.id], delta);
    const movedCharacter = movedItems.find(i => i.id === character.id)!;
    const movedSpot = movedItems.find(i => i.id === spot.id)!;
    expect(movedSpot.target).toEqual(movedCharacter.position);

    // Portable JSON validation round-trips targetObjectId cleanly and rejects self-links
    scene.items = movedItems;
    const validated = validatePortable(JSON.parse(JSON.stringify(scene)));
    expect(validated.type).toBe('scene');
    if (validated.type === 'scene') {
      const roundTrippedSpot = validated.items.find(i => i.id === spot.id)!;
      expect(roundTrippedSpot.targetObjectId).toBe(character.id);
      expect(roundTrippedSpot.target).toEqual(movedCharacter.position);
    }
    const selfLinkedJson = JSON.parse(JSON.stringify(scene));
    selfLinkedJson.items.find((i: { id: string }) => i.id === spot.id).targetObjectId = spot.id;
    expect(() => validatePortable(selfLinkedJson)).toThrow(/cannot link target to itself/i);

    // Deleting the linked object clears targetObjectId while keeping the last resolved target coordinate
    scene.items = scene.items.filter(i => i.id !== character.id);
    syncLinkedLightTargets(scene.items);
    const survivingSpot = scene.items.find(i => i.id === spot.id)!;
    expect(survivingSpot.targetObjectId).toBeUndefined();
    expect(survivingSpot.target).toEqual(movedCharacter.position);

    // Room object reference formatting, world coordinate tracking, and room-object deletion cleanup
    const room = { ...createItem('room'), roomId: 'livingRoom', position: [1, 0, -2] as [number, number, number] };
    scene.items.push(room);
    const roomObjRef = formatRoomObjectTargetRef(room.id, 'furn:sofa:0');
    expect(parseTargetObjectRef(roomObjRef)).toEqual({
      kind: 'room-object',
      roomId: room.id,
      objectId: 'furn:sofa:0',
    });
    const resolveBase = (rId: string, oId: string) =>
      rId === room.id && oId === 'furn:sofa:0' ? ([2, 0.5, 1] as [number, number, number]) : null;
    linkLightTarget(scene.items, survivingSpot.id, roomObjRef, resolveBase);
    expect(survivingSpot.targetObjectId).toBe(roomObjRef);
    expect(survivingSpot.target).toEqual([3, 0.5, -1]);

    room.roomObjects = { 'furn:sofa:0': { position: [0.5, 0, -0.5] } };
    expect(computeRoomObjectWorldPosition(room, [2, 0.5, 1], 'furn:sofa:0')).toEqual([3.5, 0.5, -1.5]);
    syncLinkedLightTargets(scene.items, resolveBase);
    expect(survivingSpot.target).toEqual([3.5, 0.5, -1.5]);

    room.roomObjects['furn:sofa:0'] = { ...room.roomObjects['furn:sofa:0'], deleted: true };
    syncLinkedLightTargets(scene.items, resolveBase);
    expect(survivingSpot.targetObjectId).toBeUndefined();
    expect(survivingSpot.target).toEqual([3.5, 0.5, -1.5]);
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

describe('C4D modeling items, modifiers, Boole hierarchies, and portable validation', () => {
  it('round-trips parametric primitives with Fillet/Chamfer, EditableMesh, Modifiers, Imported assets, and nested Boole operands', () => {
    const scene = initialScene();
    const filletCube = createPrimitiveItem('cube', 0);
    if (filletCube.primitive?.kind === 'cube') {
      filletCube.primitive = {
        kind: 'cube',
        params: { ...filletCube.primitive.params, fillet: true, filletRadius: 0.12, filletSubdivisions: 3 },
      };
    }
    filletCube.modifiers = [
      createDefaultModifierSpec('subdivision'),
      createDefaultModifierSpec('mirror'),
      createDefaultModifierSpec('bend'),
    ];
    filletCube.roughness = 0.35;
    filletCube.metalness = 0.4;
    filletCube.phongAngleDeg = 45;

    const cutterCyl = createPrimitiveItem('cylinder', 1);
    cutterCyl.position = [0.25, 0.5, 0.1];
    cutterCyl.rotation = [0.2, 0.4, 0];

    const grouped = groupItemsIntoBoole([filletCube, cutterCyl], [filletCube.id, cutterCyl.id], 'subtract');
    expect(grouped.booleItem.kind).toBe('boole');
    expect(grouped.booleItem.booleanOp).toBe('subtract');
    expect(grouped.booleItem.operands).toHaveLength(2);

    const editableTorus: ReturnType<typeof createItem> = {
      ...createItem('mesh', 2),
      name: 'Editable Torus',
      editableMesh: createPrimitiveEditableMesh(createDefaultPrimitiveSpec('torus')),
      modifiers: [createDefaultModifierSpec('bevel')],
    };

    const importedItem: ReturnType<typeof createItem> = {
      ...createItem('imported', 3),
      name: 'Sculpt Bust',
      assetId: 'asset-bust-01',
      sourceFormat: 'glb',
      fileName: 'bust.glb',
    };

    scene.items = [...grouped.items, editableTorus, importedItem];
    const parsed = parseFile(JSON.stringify(scene));
    expect(parsed.type).toBe('scene');
    if (parsed.type !== 'scene') throw new Error('Expected scene');
    expect(parsed.items).toHaveLength(3);
    expect(parsed.items[0]!.kind).toBe('boole');
    expect(parsed.items[0]!.operands?.[0]?.modifiers).toHaveLength(3);
    expect(parsed.items[1]!.editableMesh?.faces.length).toBeGreaterThan(0);
    expect(parsed.items[2]!.assetId).toBe('asset-bust-01');
  });

  it('finds, updates, swaps, and extracts nested Boole operands while preserving world transforms', () => {
    const a = createPrimitiveItem('cube', 0);
    a.position = [1.2, 0.5, -0.4];
    const b = createPrimitiveItem('sphere', 1);
    b.position = [1.5, 0.7, -0.2];

    const { items, booleItem } = groupItemsIntoBoole([a, b], [a.id, b.id], 'subtract');
    const foundB = findItemOrOperand(items, b.id);
    expect(foundB?.parentBoole?.id).toBe(booleItem.id);
    expect(foundB?.operandIndex).toBe(1);

    const working = clone(items);
    expect(updateItemOrOperand(working, b.id, cur => { cur.color = '#ff3366'; })).toBe(true);
    expect(findItemOrOperand(working, b.id)?.item.color).toBe('#ff3366');

    const swapped = swapBooleOperands(findItemOrOperand(working, booleItem.id)!.item);
    expect(swapped.operands?.[0]?.id).toBe(b.id);
    expect(swapped.operands?.[1]?.id).toBe(a.id);

    // Move parent Boole by +2 on X and extract operands back to world space
    expect(
      updateItemOrOperand(working, booleItem.id, cur => {
        cur.position = [cur.position[0] + 2, cur.position[1], cur.position[2]];
      }),
    ).toBe(true);
    const extracted = extractBooleOperands(working, booleItem.id);
    const extractedA = extracted.items.find(i => i.id === a.id)!;
    const extractedB = extracted.items.find(i => i.id === b.id)!;
    expect(extractedA.position[0]).toBeCloseTo(3.2, 5);
    expect(extractedA.position[1]).toBeCloseTo(0.5, 5);
    expect(extractedB.position[0]).toBeCloseTo(3.5, 5);
    expect(extractedB.position[1]).toBeCloseTo(0.7, 5);
  });

  it('defaults, migrates, round-trips, and transitions character outfitColor cleanly across clothed and unclothed models', () => {
    // Clothed vs unclothed slot detection
    expect(hasCharacterOutfitSlot('mannequin-female')).toBe(true);
    expect(hasCharacterOutfitSlot('pseudonym-nightgown')).toBe(true);
    expect(hasCharacterOutfitSlot('quaternius-superhero-male')).toBe(true);
    expect(hasCharacterOutfitSlot('quaternius-superhero-female')).toBe(true);
    expect(hasCharacterOutfitSlot('thanhhuy-old-man')).toBe(false);

    // Default outfitColor is untouched '#ffffff' ("Original") for external characters and studio default for mannequins
    expect(defaultCharacterOutfitColor('female', 'pseudonym-nightgown')).toBe('#ffffff');
    expect(defaultCharacterOutfitColor('female', 'quaternius-superhero-female')).toBe('#ffffff');
    expect(defaultCharacterOutfitColor('female', 'mannequin-female')).toBe(DEFAULT_FEMALE_OUTFIT_COLOR);

    // Portable JSON migration when outfitColor is omitted: external -> '#ffffff', mannequin -> studio default
    const rawScene = initialScene();
    rawScene.items[0]!.modelId = 'quaternius-superhero-male';
    delete rawScene.items[0]!.outfitColor;
    delete rawScene.items[1]!.outfitColor;
    const migrated = validatePortable(JSON.parse(JSON.stringify(rawScene)));
    if (migrated.type !== 'scene') throw new Error('Expected scene');
    expect(migrated.items[0]!.outfitColor).toBe('#ffffff');
    expect(migrated.items[1]!.outfitColor).toBe(DEFAULT_FEMALE_OUTFIT_COLOR);

    // Custom dress hex round-trips cleanly and survives clothed-to-clothed transitions, then resets on unclothed models
    rawScene.items[1]!.modelId = 'pseudonym-nightgown';
    rawScene.items[1]!.outfitColor = '#b8294b';
    const roundTripped = validatePortable(JSON.parse(JSON.stringify(rawScene)));
    if (roundTripped.type !== 'scene') throw new Error('Expected scene');
    expect(roundTripped.items[1]!.outfitColor).toBe('#b8294b');

    const charItem = roundTripped.items[1]!;
    charItem.modelId = 'quaternius-superhero-female';
    applyCharacterModelColorTransition(charItem, 'pseudonym-nightgown', 'quaternius-superhero-female');
    expect(charItem.outfitColor).toBe('#b8294b');

    charItem.kind = 'male';
    charItem.modelId = 'thanhhuy-old-man';
    applyCharacterModelColorTransition(charItem, 'quaternius-superhero-female', 'thanhhuy-old-man');
    expect(charItem.outfitColor).toBe('#ffffff');
  });
});

describe('sceneLightsOnly contract and studio environment zeroing', () => {
  it('defaults sceneLightsOnly to false, migrates legacy scenes, round-trips JSON, and rejects non-booleans', () => {
    const fresh = initialScene();
    expect(fresh.sceneLightsOnly).toBe(false);

    // Legacy scene JSON without sceneLightsOnly defaults cleanly to false
    const legacyRaw = JSON.parse(JSON.stringify(fresh)) as Record<string, unknown>;
    delete legacyRaw.sceneLightsOnly;
    const migrated = validatePortable(legacyRaw);
    if (migrated.type !== 'scene') throw new Error('Expected scene');
    expect(migrated.sceneLightsOnly).toBe(false);

    // Explicit true & false round-trip through parseFile / JSON export
    const enabledRaw = { ...fresh, sceneLightsOnly: true };
    const parsedTrue = parseFile(JSON.stringify(enabledRaw));
    if (parsedTrue.type !== 'scene') throw new Error('Expected scene');
    expect(parsedTrue.sceneLightsOnly).toBe(true);

    const parsedFalse = parseFile(JSON.stringify({ ...fresh, sceneLightsOnly: false }));
    if (parsedFalse.type !== 'scene') throw new Error('Expected scene');
    expect(parsedFalse.sceneLightsOnly).toBe(false);

    // Malformed values fail validation
    for (const bad of ['true', 1, null, {}]) {
      expect(() => validatePortable({ ...fresh, sceneLightsOnly: bad })).toThrow(
        'sceneLightsOnly must be boolean',
      );
    }
  });

  it('zeroes hemisphere, studio fill, and environment IBL when sceneLightsOnly is true and restores cleanly when false', () => {
    const hemi = new T.HemisphereLight('#d8e5ff', '#615448', STUDIO_HEMI_INTENSITY);
    const fill = new T.DirectionalLight('#ffffff', STUDIO_FILL_INTENSITY);
    const scene = new T.Scene();
    const dummyEnv = new T.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    scene.environment = dummyEnv;
    scene.environmentIntensity = 1;

    // Enable sceneLightsOnly across realistic, clay, and illustration
    for (const mode of ['realistic', 'clay', 'illustration'] as const) {
      scene.environment = dummyEnv;
      scene.environmentIntensity = 1;
      applyStudioEnvironmentLighting({ hemi, fill, scene }, true, mode);
      expect(hemi.intensity).toBe(0);
      expect(hemi.visible).toBe(false);
      expect(fill.intensity).toBe(0);
      expect(fill.visible).toBe(false);
      expect(scene.environment).toBeNull();
      expect(scene.environmentIntensity).toBe(0);
    }

    // Restore studio lighting in realistic & clay modes
    applyStudioEnvironmentLighting({ hemi, fill, scene }, false, 'realistic');
    expect(hemi.visible).toBe(true);
    expect(hemi.intensity).toBe(STUDIO_HEMI_INTENSITY);
    expect(fill.visible).toBe(true);
    expect(fill.intensity).toBe(STUDIO_FILL_INTENSITY);

    // Restore studio lighting in illustration mode (cel-safe lower fill)
    applyStudioEnvironmentLighting({ hemi, fill, scene }, false, 'illustration');
    expect(hemi.visible).toBe(true);
    expect(hemi.intensity).toBe(STUDIO_HEMI_INTENSITY);
    expect(fill.visible).toBe(true);
    expect(fill.intensity).toBe(STUDIO_ILLUSTRATION_FILL_INTENSITY);

    dummyEnv.dispose();
  });

  it('zeros cel-shader ambient shadow floor and emissive fallback in StudioShadingController when sceneLightsOnly is enabled', () => {
    const controller = new StudioShadingController();
    expect(controller.uniforms.uSceneLightsOnly.value).toBe(0);

    controller.update({ ...DEFAULT_RENDER_STYLE, mode: 'illustration' }, '#343231', true);
    expect(controller.uniforms.uSceneLightsOnly.value).toBe(1);

    controller.update({ ...DEFAULT_RENDER_STYLE, mode: 'realistic' }, '#343231', false);
    expect(controller.uniforms.uSceneLightsOnly.value).toBe(0);

    const mat = new T.MeshStandardMaterial({ color: '#cccccc' });
    controller.attachStudioShading(mat);
    const fakeShader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: '',
      fragmentShader: `#include <common>\n#include <lights_physical_fragment>\nvec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;`,
    };
    mat.onBeforeCompile(fakeShader as unknown as T.WebGLProgramParametersWithUniforms, {} as T.WebGLRenderer);
    expect(fakeShader.uniforms.uSceneLightsOnly).toBe(controller.uniforms.uSceneLightsOnly);
    expect(fakeShader.fragmentShader).toContain('uSceneLightsOnly > 0.5');
    expect(fakeShader.fragmentShader).toContain('? vec3(0.0)');
    mat.dispose();
  });
});


