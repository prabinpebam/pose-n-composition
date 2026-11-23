import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it, vi } from 'vitest';
import { CHARACTERS, MODEL_IDS } from './characterCatalog';
import {
  analyzeOutfitTextureRgba,
  analyzeSkinTextureRgba,
  buildExternalFigure,
  configureAuthoredOutfitMaterial,
  evaluateNormalizedOutfitColorSrgb,
  evaluateNormalizedSkinToneSrgb,
  evaluateSharedAtlasCharacterSrgb,
  setFigureColors,
} from './external-rig';
import { StudioShadingController } from './npr';
import {
  applyCharacterModelColorTransition,
  createItem,
  DEFAULT_FEMALE_OUTFIT_COLOR,
  DEFAULT_FEMALE_SKIN_COLOR,
  DEFAULT_HAIR_COLOR,
  DEFAULT_MALE_OUTFIT_COLOR,
  DEFAULT_MALE_SKIN_COLOR,
  defaultCharacterHairColor,
  defaultCharacterHairStyle,
  defaultCharacterOutfitColor,
  defaultCharacterSkinColor,
  hasAuthoredHair,
  hasCharacterOutfitSlot,
  JOINTS,
  initialScene,
  neutralPose,
  preset,
  sanitizeWorkingDraftCharacterColors,
  validatePortable,
} from './model';
import { adaptCanonicalPoseToMorphology } from './morphology-rig';
import { getJointRotation, measureFigureMinWorldY, setFigurePose } from './rig';

const DUMMY_PNG_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function installNodeImageLoaderStub() {
  if (!globalThis.ProgressEvent) vi.stubGlobal('ProgressEvent', Event);
  if (!globalThis.self) vi.stubGlobal('self', globalThis);
  vi.spyOn(T.ImageLoader.prototype, 'load').mockImplementation((_url, onLoad) => {
    const img = { width: 1, height: 1 } as unknown as HTMLImageElement;
    queueMicrotask(() => onLoad?.(img));
    return img;
  });
}

describe.each(MODEL_IDS.filter(id => CHARACTERS[id].source))('%s source rig', id => {
  it('loads real glTF materials/textures/extensions, preserves original textures, and tracks head attachments cleanly', async () => {
    installNodeImageLoaderStub();
    const character = CHARACTERS[id];
    const path = resolve(id.startsWith('local-') ? '.' : 'public', character.path);
    const bytes = readFileSync(path);
    const jsonLength = path.endsWith('.glb') ? bytes.readUInt32LE(12) : 0;
    const gltf = JSON.parse((jsonLength ? bytes.subarray(20, 20 + jsonLength) : bytes).toString('utf8'));
    for (const image of gltf.images ?? []) {
      if (image.uri) expect(readFileSync(resolve(dirname(path), image.uri)).length).toBeGreaterThan(0);
      else expect(gltf.bufferViews[image.bufferView].byteLength).toBeGreaterThan(0);
    }
    // Keep 100% of glTF textures, samplers, materials, and extensions intact so GLTFLoader
    // validates every texture index and material extension in Node.
    gltf.images = (gltf.images ?? []).map((im: { name?: string }) => ({ name: im.name, uri: DUMMY_PNG_DATA_URI }));
    for (const b of gltf.buffers) {
      b.uri = `data:application/octet-stream;base64,${(
        jsonLength ? bytes.subarray(28 + jsonLength) : readFileSync(resolve(dirname(path), b.uri))
      ).toString('base64')}`;
    }
    const template = (await new GLTFLoader().parseAsync(JSON.stringify(gltf), '')).scene;
    const defaultSkin = defaultCharacterSkinColor(character.body, id);
    const defaultOutfit = defaultCharacterOutfitColor(character.body, id);
    const defaultHair = defaultCharacterHairColor(id);
    expect(defaultSkin).toBe('#ffffff');
    expect(defaultOutfit).toBe('#ffffff');
    if (hasAuthoredHair(id)) expect(defaultHair).toBe('#ffffff');
    else expect(defaultHair).toBe(DEFAULT_HAIR_COLOR);

    const make = () => buildExternalFigure(character.body, template, defaultSkin, defaultOutfit, id);
    const a = make(), b = make();
    expect(a.tintMaterials.every(m => m.color.getHexString() === 'ffffff')).toBe(true);
    expect(a.tintMaterials.every(m => !m.userData.pncOutfitMask)).toBe(true);
    expect(a.outfitColorUniforms.length).toBe(character.source!.authored.outfit.length);
    if (hasCharacterOutfitSlot(id)) {
      expect(a.outfitColorUniforms.length).toBeGreaterThan(0);
    } else {
      expect(a.outfitColorUniforms.length).toBe(0);
    }

    expect(a.morphology).toBeDefined();
    expect(a.morphology?.isCanonicalMannequin).toBe(false);
    expect(Number.isFinite(a.morphology!.envelope.adiposityIndex)).toBe(true);

    // Every source rig must have ZERO vertices weighted to Blender's dummy `neutral_bone`
    // and must keep all bone skinning matrices rigid/uniform at neutralPose.
    for (const mesh of a.skins) {
      const neutralIdx = mesh.skeleton.bones.findIndex(bn => bn.name === 'neutral_bone');
      if (neutralIdx >= 0) {
        const jAttr = mesh.geometry.getAttribute('skinIndex');
        const wAttr = mesh.geometry.getAttribute('skinWeight');
        let neutralWeightSum = 0;
        for (let vi = 0; vi < jAttr.count; vi++) {
          for (let c = 0; c < 4; c++) {
            if (jAttr.getComponent(vi, c) === neutralIdx) neutralWeightSum += wAttr.getComponent(vi, c);
          }
        }
        expect(neutralWeightSum, `${id}/${mesh.name} must have zero weight on static neutral_bone`).toBe(0);
      }
      mesh.updateMatrixWorld(true);
      mesh.skeleton.update();
      const mats = mesh.skeleton.bones.map((bone, idx) =>
        new T.Matrix4().multiplyMatrices(bone.matrixWorld, mesh.skeleton.boneInverses[idx]!),
      );
      const refMat = mats[0]!;
      for (let idx = 1; idx < mats.length; idx++) {
        if (mesh.skeleton.bones[idx]?.name === 'neutral_bone') continue;
        for (let e = 0; e < 16; e++) {
          expect(
            Math.abs(mats[idx]!.elements[e]! - refMat.elements[e]!),
            `${id}/${mesh.name} bone[${idx}] must match rigid bind transform at neutralPose`,
          ).toBeLessThan(1e-3);
        }
      }
    }

    // Quantitative Head-Tracking Invariant:
    // On Fat King, 100% of hair (Cube003 / mesh Cube.007), mirrored eyebrows (Cube001 / mesh Cube.009),
    // and mirrored eyes (Sphere) must remain rigidly locked (0.000 mm drift in head-bone local space) across all poses!
    if (id === 'local-fat-king') {
      const rigidHeadMeshes = a.skins.filter(s => {
        const m = Array.isArray(s.material) ? s.material[0] : s.material;
        return m?.name === 'KingHair' || m?.name === 'Eyes';
      });
      expect(rigidHeadMeshes.length).toBe(3);
      setFigurePose(a, neutralPose());
      a.root.updateMatrixWorld(true);
      a.skins.forEach(s => s.skeleton.update());
      const headInvNeutral = a.bones.head.matrixWorld.clone().invert();
      const neutralHeadLocal = rigidHeadMeshes.map(mesh => {
        const pts: T.Vector3[] = [];
        for (let vi = 0; vi < mesh.geometry.attributes.position.count; vi++) {
          const wp = mesh.getVertexPosition(vi, new T.Vector3()).applyMatrix4(mesh.matrixWorld);
          pts.push(wp.applyMatrix4(headInvNeutral));
        }
        return pts;
      });
      const heavyPose = preset('Running');
      heavyPose.hips = [0.52, -0.45, 0.28];
      heavyPose.spine = [0.38, 0.32, -0.22];
      heavyPose.chest = [0.34, -0.28, 0.19];
      heavyPose.neck = [-0.42, 0.48, -0.25];
      heavyPose.head = [-0.36, -0.55, 0.31];
      for (const testPose of [preset('Walking'), preset('Seated'), preset('Crouch'), heavyPose]) {
        setFigurePose(a, testPose);
        a.root.updateMatrixWorld(true);
        a.skins.forEach(s => s.skeleton.update());
        const headInv = a.bones.head.matrixWorld.clone().invert();
        let maxHeadLocalDriftMeters = 0;
        rigidHeadMeshes.forEach((mesh, mi) => {
          for (let vi = 0; vi < mesh.geometry.attributes.position.count; vi++) {
            const wp = mesh.getVertexPosition(vi, new T.Vector3()).applyMatrix4(mesh.matrixWorld);
            const lp = wp.applyMatrix4(headInv);
            maxHeadLocalDriftMeters = Math.max(maxHeadLocalDriftMeters, lp.distanceTo(neutralHeadLocal[mi]![vi]!));
          }
        });
        expect(maxHeadLocalDriftMeters, 'Fat King hair/brows/eyes must have 0.000 mm head-local drift').toBeLessThan(1e-5);
      }
      setFigurePose(a, neutralPose());
    }

    // Across ALL external characters, verify head/hair/eye meshes follow the posed head (never left behind at neutral rest).
    {
      setFigurePose(a, neutralPose());
      a.root.updateMatrixWorld(true);
      a.skins.forEach(s => s.skeleton.update());
      const headBoneNeutral = a.bones.head.getWorldPosition(new T.Vector3());
      const extremeBend = neutralPose();
      extremeBend.hips = [0.55, 0.35, -0.25];
      extremeBend.spine = [0.35, -0.25, 0.2];
      extremeBend.chest = [0.3, 0.2, -0.15];
      extremeBend.neck = [0.25, -0.35, 0.2];
      extremeBend.head = [0.3, 0.4, -0.25];
      setFigurePose(a, extremeBend);
      a.root.updateMatrixWorld(true);
      a.skins.forEach(s => s.skeleton.update());
      const headBonePosed = a.bones.head.getWorldPosition(new T.Vector3());
      expect(headBonePosed.distanceTo(headBoneNeutral)).toBeGreaterThan(0.25);
      const hairMatSet = new Set<T.Material>(a.hairMaterials);
      for (const mesh of a.skins) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const isPureHeadAttachment =
          mats.every(m => hairMatSet.has(m)) || /eye|brow|lash|beard|moustache|hair|teeth|tongue/i.test(mesh.name);
        if (!isPureHeadAttachment) continue;
        let maxDistFromPosedHead = 0;
        for (let vi = 0; vi < mesh.geometry.attributes.position.count; vi += 7) {
          const wp = mesh.getVertexPosition(vi, new T.Vector3()).applyMatrix4(mesh.matrixWorld);
          maxDistFromPosedHead = Math.max(maxDistFromPosedHead, wp.distanceTo(headBonePosed));
        }
        // Even long flowing hair stays within ~0.75 m of the posed head (whereas disconnected hair stays >0.85 m away at neutral)
        expect(maxDistFromPosedHead, `${id}/${mesh.name} must stay attached near posed head`).toBeLessThan(0.75);
      }
      setFigurePose(a, neutralPose());
    }

    if (['local-base-mesh-fat-male', 'local-base-mesh-fat-female', 'local-fat-king'].includes(id)) {
      expect(a.morphology!.envelope.adiposityIndex).toBeGreaterThan(0.35);
      expect(T.MathUtils.radToDeg(a.morphology!.naturalArmAbductionRad)).toBeGreaterThan(15);
      const relaxed = adaptCanonicalPoseToMorphology(preset('Relaxed'), a.morphology!);
      setFigurePose(a, relaxed);
      const lShoulder = a.bones.leftShoulder.getWorldPosition(new T.Vector3());
      const lElbow = a.bones.leftElbow.getWorldPosition(new T.Vector3());
      const armDir = lElbow.clone().sub(lShoulder).normalize();
      expect(Math.atan2(armDir.x, -armDir.y)).toBeGreaterThan(a.morphology!.naturalArmAbductionRad - 0.05);
      setFigurePose(a, neutralPose());
    }
    if (['local-stylized-women', 'local-bailarina'].includes(id)) {
      expect(measureFigureMinWorldY(a)).toBeCloseTo(0, 3);
      for (const mesh of a.skins) {
        const weights = mesh.geometry.getAttribute('skinWeight');
        const indices = mesh.geometry.getAttribute('skinIndex');
        expect(weights.itemSize).toBe(4);
        expect(indices.itemSize).toBe(4);
        expect(mesh.geometry.getAttribute('uv1')).toBeUndefined();
        let maxRestDisplacement = 0;
        for (let i = 0; i < weights.count; i++) {
          const rest = new T.Vector3().fromBufferAttribute(mesh.geometry.getAttribute('position'), i);
          maxRestDisplacement = Math.max(maxRestDisplacement, mesh.getVertexPosition(i, new T.Vector3()).distanceTo(rest));
          const values = [weights.getX(i), weights.getY(i), weights.getZ(i), weights.getW(i)];
          expect(values.every(v => Number.isFinite(v) && v >= 0)).toBe(true);
          expect(values.reduce((sum, v) => sum + v, 0)).toBeCloseTo(1, 5);
          expect([indices.getX(i), indices.getY(i), indices.getZ(i), indices.getW(i)]
            .every(v => Number.isInteger(v) && v >= 0 && v < mesh.skeleton.bones.length)).toBe(true);
        }
        expect(maxRestDisplacement, 'neutral rest must round to 0.000 mm').toBeLessThan(.0000005);
      }
      const before = b.hairMaterials.map(m => m.color.getHexString());
      setFigureColors(a, '#cc9988', '#224466', '#887733');
      expect(a.hairMaterials.every(m => m.color.getHexString() === '887733')).toBe(true);
      expect(b.hairMaterials.map(m => m.color.getHexString())).toEqual(before);
      expect(a.root.getObjectByName('Scalp hair')).toBeUndefined();
    }
    a.deformation = { bodyType: 'chibi', limitMode: 'free' }; // A dormant mannequin setting must not morph the source.
    const sample = (mesh: T.SkinnedMesh) => {
      const points: T.Vector3[] = [];
      for (let i = 0; i < mesh.geometry.attributes.position.count; i += 13) points.push(mesh.getVertexPosition(i, new T.Vector3()));
      return points;
    };
    const allPoints = (figure: typeof a) => figure.skins.flatMap(sample);
    const baseline = allPoints(b);
    expect(a.skin.geometry).not.toBe(b.skin.geometry);
    expect(a.skin.skeleton).not.toBe(b.skin.skeleton);
    for (const joint of JOINTS) {
      const pose = neutralPose(); pose[joint] = [.32, -.21, .09];
      setFigurePose(a, pose);
      expect(getJointRotation(a, joint)[0]).toBeCloseTo(.32, 5);
      expect(allPoints(a).some((p, i) => p.distanceTo(baseline[i]) > .001), joint).toBe(true);
    }
    expect(allPoints(b)).toEqual(baseline);
    setFigureColors(a, '#aabbcc', '#221144');
    expect(a.tintMaterials[0].color.getHexString()).toBe('aabbcc');
    expect(a.tintMaterials.every(m => m.userData.pncSkinUniforms?.uSkinIsOriginal.value === 0)).toBe(true);
    expect(b.tintMaterials.every(m => m.userData.pncSkinUniforms?.uSkinIsOriginal.value === 1)).toBe(true);

    // Resetting back to '#ffffff' ("Original") restores exact original mode.
    setFigureColors(a, '#ffffff', '#ffffff');
    expect(a.tintMaterials.every(m => m.userData.pncSkinUniforms?.uSkinIsOriginal.value === 1)).toBe(true);

    // Verify shader injection replaces raw multiply and chains cleanly with StudioShadingController (NPR).
    const npr = new StudioShadingController();
    npr.attachStudioShading(a.tintMaterials[0]!);
    const fakeShader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: '',
      fragmentShader:
        '#include <common>\nvoid main() {\n#include <map_fragment>\n#include <lights_physical_fragment>\nvec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;\n}',
    };
    a.tintMaterials[0]!.onBeforeCompile(fakeShader as unknown as T.WebGLProgramParametersWithUniforms, {} as T.WebGLRenderer);
    expect(fakeShader.fragmentShader).toContain('pncEvaluateNormalizedSkinTone');
    expect(fakeShader.fragmentShader).toContain('vec3 pncBaseAlbedo = diffuseColor.rgb;');
    expect(fakeShader.fragmentShader).not.toContain('diffuseColor *= sampledDiffuseColor');

    if (a.outfitColorUniforms.length) {
      setFigureColors(a, '#aabbcc', '#221144');
      expect(a.outfitColorUniforms[0].value.getHexString()).toBe('221144');
      expect(a.outfitIsOriginalUniforms?.every(u => u.value === 0)).toBe(true);
      expect(b.outfitColorUniforms[0].value.getHexString()).toBe('ffffff');
      expect(b.outfitIsOriginalUniforms?.every(u => u.value === 1)).toBe(true);

      const outfitMat = a.skins
        .flatMap(s => (Array.isArray(s.material) ? s.material : [s.material]))
        .find(
          (m): m is T.MeshStandardMaterial =>
            m instanceof T.MeshStandardMaterial &&
            m.name === character.source!.authored.outfit[0],
        )!;
      expect(outfitMat).toBeDefined();
      const outfitNpr = new StudioShadingController();
      outfitNpr.attachStudioShading(outfitMat);
      const outfitShader = {
        uniforms: {} as Record<string, { value: unknown }>,
        vertexShader: '',
        fragmentShader:
          '#include <common>\nvoid main() {\n#include <map_fragment>\n#include <lights_physical_fragment>\nvec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;\n}',
      };
      outfitMat.onBeforeCompile(
        outfitShader as unknown as T.WebGLProgramParametersWithUniforms,
        {} as T.WebGLRenderer,
      );
      expect(outfitShader.uniforms.uOutfitColor).toBe(a.outfitColorUniforms[0]);
      expect(outfitShader.fragmentShader).toContain('pncEvaluateNormalizedOutfitColor');
      expect(outfitShader.fragmentShader).toContain('vec3 pncBaseAlbedo = diffuseColor.rgb;');

      setFigureColors(a, '#ffffff', '#ffffff');
      expect(a.outfitIsOriginalUniforms?.every(u => u.value === 1)).toBe(true);
    }
    if (character.source?.authored.hair.length) {
      expect(a.root.getObjectByName('Scalp hair')).toBeUndefined();
      expect(new Set(a.hairMaterials.map(m => m.name))).toEqual(new Set(character.source.authored.hair));
    } else {
      const scalp = a.root.getObjectByName('Scalp hair');
      expect(scalp?.parent).toBe(a.bones.head);
      if (defaultCharacterHairStyle(character.body, id) === 'none') {
        expect(scalp?.visible).toBe(false);
      }
    }
  });
});

it('preserves untouched #ffffff original textures on model transitions and working-draft hydration', () => {
  const item = createItem('male');
  expect(item.color).toBe(DEFAULT_MALE_SKIN_COLOR);
  expect(item.outfitColor).toBe(DEFAULT_MALE_OUTFIT_COLOR);

  // Mannequin -> Superhero Male (external, no separate outfit slot, wig hair)
  item.kind = 'male';
  item.modelId = 'quaternius-superhero-male';
  applyCharacterModelColorTransition(item, 'mannequin-male', 'quaternius-superhero-male');
  expect(item.color).toBe('#ffffff');
  expect(item.outfitColor).toBe('#ffffff');
  expect(item.hairColor).toBe(DEFAULT_HAIR_COLOR);

  // Superhero Male -> Women in Nightgown (external, native outfit + native hair)
  item.kind = 'female';
  item.modelId = 'pseudonym-nightgown';
  applyCharacterModelColorTransition(item, 'quaternius-superhero-male', 'pseudonym-nightgown');
  expect(item.color).toBe('#ffffff');
  expect(item.outfitColor).toBe('#ffffff');
  expect(item.hairColor).toBe('#ffffff');

  // Women in Nightgown -> Mannequin Female (restores mannequin skin/outfit/hair colors)
  item.kind = 'female';
  item.modelId = 'mannequin-female';
  applyCharacterModelColorTransition(item, 'pseudonym-nightgown', 'mannequin-female');
  expect(item.color).toBe(DEFAULT_FEMALE_SKIN_COLOR);
  expect(item.outfitColor).toBe(DEFAULT_FEMALE_OUTFIT_COLOR);
  expect(item.hairColor).toBe(DEFAULT_HAIR_COLOR);

  // Stale IndexedDB working-draft sanitization
  const staleScene = initialScene();
  staleScene.items[0].modelId = 'quaternius-superhero-male';
  staleScene.items[0].color = DEFAULT_MALE_SKIN_COLOR;
  staleScene.items[0].outfitColor = DEFAULT_MALE_OUTFIT_COLOR;
  staleScene.items[1].modelId = 'pseudonym-nightgown';
  staleScene.items[1].color = DEFAULT_FEMALE_SKIN_COLOR;
  staleScene.items[1].outfitColor = DEFAULT_FEMALE_OUTFIT_COLOR;
  staleScene.items[1].hairColor = '#bd718a';
  sanitizeWorkingDraftCharacterColors(staleScene);
  expect(staleScene.items[0].color).toBe('#ffffff');
  expect(staleScene.items[0].outfitColor).toBe('#ffffff');
  expect(staleScene.items[1].color).toBe('#ffffff');
  expect(staleScene.items[1].outfitColor).toBe('#ffffff');
  expect(staleScene.items[1].hairColor).toBe('#ffffff');
});

it('round trips model identity, migrates older scene items, and rejects unavailable models', () => {
  const scene = initialScene();
  scene.items[0].modelId = 'quaternius-superhero-male';
  delete scene.items[1].modelId;
  const restored = validatePortable(JSON.parse(JSON.stringify(scene)));
  if (restored.type !== 'scene') throw new Error('Expected scene');
  expect(restored.items.map(i => i.modelId)).toEqual(['quaternius-superhero-male', 'mannequin-female', undefined]);
  for (const invalid of ['quaternius-superhero-female', 'unknown']) {
    expect(() => validatePortable({...scene, items: [{...scene.items[0], modelId: invalid}]})).toThrow(/model/);
  }
});

describe('luminance-normalized skin-tone control and shared-atlas masking', () => {
  it('preserves untouched original pixels at #ffffff, genuinely lightens baked tan skin to #ffdecc, and hits #8d5524/#593421 without double-darkening', () => {
    const bakedTan: [number, number, number] = [169, 115, 80]; // Superhero Male baked midtone
    const refHex = '#a97350';

    // 1) Original (#ffffff) -> exact 0.000 shift
    const orig = evaluateNormalizedSkinToneSrgb(bakedTan, refHex, '#ffffff');
    expect(orig[0]).toBeCloseTo(169, 1);
    expect(orig[1]).toBeCloseTo(115, 1);
    expect(orig[2]).toBeCloseTo(80, 1);

    // 2) Fair Peach (#ffdecc = [255, 222, 204]) -> MUST INCREASE RGB above [169, 115, 80] (unlike raw multiply!)
    const fair = evaluateNormalizedSkinToneSrgb(bakedTan, refHex, '#ffdecc');
    expect(fair[0]).toBeGreaterThan(245);
    expect(fair[1]).toBeGreaterThan(215);
    expect(fair[2]).toBeGreaterThan(198);
    expect(fair[0]).toBeCloseTo(255, 0);
    expect(fair[1]).toBeCloseTo(222, 0);
    expect(fair[2]).toBeCloseTo(204, 0);

    // 3) Medium & deep brown tones (#8d5524 = [141, 85, 36], #593421 = [89, 52, 33]) match target instead of double-multiplying into black
    const umber = evaluateNormalizedSkinToneSrgb(bakedTan, refHex, '#8d5524');
    expect(umber[0]).toBeCloseTo(141, 0);
    expect(umber[1]).toBeCloseTo(85, 0);
    expect(umber[2]).toBeCloseTo(36, 0);

    const espresso = evaluateNormalizedSkinToneSrgb(bakedTan, refHex, '#593421');
    expect(espresso[0]).toBeCloseTo(89, 0);
    expect(espresso[1]).toBeCloseTo(52, 0);
    expect(espresso[2]).toBeCloseTo(33, 0);

    // 4) Preserves baked shading contrast (highlight > midtone > shadow) across both fair and deep tones
    const highlight = evaluateNormalizedSkinToneSrgb([198, 140, 102], refHex, '#ffdecc');
    const shadow = evaluateNormalizedSkinToneSrgb([132, 86, 58], refHex, '#ffdecc');
    expect(highlight[1]).toBeGreaterThan(fair[1]);
    expect(fair[1]).toBeGreaterThan(shadow[1]);
  });

  it('protects non-skin shared-atlas regions (charcoal suit, white bikini/bodysuit, navy fabric, pink hair, sclera, dark lace)', () => {
    for (const target of ['#ffdecc', '#d49b72', '#593421']) {
      // Charcoal superhero brief
      const charcoal = evaluateNormalizedSkinToneSrgb([53, 53, 53], '#a97350', target);
      expect(charcoal[0]).toBeCloseTo(53, 1);
      expect(charcoal[1]).toBeCloseTo(53, 1);
      expect(charcoal[2]).toBeCloseTo(53, 1);

      // Stylized Women white bikini trim & navy bikini cup & pink hair
      const whiteTrim = evaluateNormalizedSkinToneSrgb([200, 184, 184], '#bf8d80', target);
      expect(whiteTrim[0]).toBeCloseTo(200, 1);
      expect(whiteTrim[1]).toBeCloseTo(184, 1);
      expect(whiteTrim[2]).toBeCloseTo(184, 1);

      const navyCup = evaluateNormalizedSkinToneSrgb([59, 56, 87], '#bf8d80', target);
      expect(navyCup[0]).toBeCloseTo(59, 1);
      expect(navyCup[1]).toBeCloseTo(56, 1);
      expect(navyCup[2]).toBeCloseTo(87, 1);

      const pinkHair = evaluateNormalizedSkinToneSrgb([208, 125, 150], '#bf8d80', target);
      expect(pinkHair[0]).toBeCloseTo(208, 1);
      expect(pinkHair[1]).toBeCloseTo(125, 1);
      expect(pinkHair[2]).toBeCloseTo(150, 1);

      // Eye sclera & Bailarina cool-white bodysuit + dark lace
      const sclera = evaluateNormalizedSkinToneSrgb([225, 225, 228], '#ac7051', target, true);
      expect(sclera[0]).toBeCloseTo(225, 1);
      expect(sclera[1]).toBeCloseTo(225, 1);
      expect(sclera[2]).toBeCloseTo(228, 1);

      const darkLace = evaluateNormalizedSkinToneSrgb([24, 15, 12], '#ac7051', target, true);
      expect(darkLace[0]).toBeCloseTo(24, 1);
      expect(darkLace[1]).toBeCloseTo(15, 1);
      expect(darkLace[2]).toBeCloseTo(12, 1);
    }
  });

  it('extracts accurate linear skin reference and dark-island flag from RGBA atlas data', () => {
    const px = new Uint8Array(16 * 4);
    // 10 warm tan skin pixels [170, 115, 80] + 6 dark lace pixels [18, 14, 12] (>12% dark)
    for (let i = 0; i < 16; i++) {
      const o = i * 4;
      if (i < 10) {
        px[o] = 170; px[o + 1] = 115; px[o + 2] = 80; px[o + 3] = 255;
      } else {
        px[o] = 18; px[o + 1] = 14; px[o + 2] = 12; px[o + 3] = 255;
      }
    }
    const analysis = analyzeSkinTextureRgba(px, 4, 4);
    expect(analysis).not.toBeNull();
    expect(analysis!.hasDarkNonSkinIslands).toBe(true);
    const expected = new T.Color('#aa7350');
    expect(analysis!.refLinear[0]).toBeCloseTo(expected.r, 2);
    expect(analysis!.refLinear[1]).toBeCloseTo(expected.g, 2);
    expect(analysis!.refLinear[2]).toBeCloseTo(expected.b, 2);
  });
});

describe('luminance-normalized dress/outfit recoloring and skin/dress independence', () => {
  it('guarantees MAE === 0 at #ffffff (Original) and accurately recolors both jet-black/dark and bright/pink garments while preserving fold contrast', () => {
    const samples: Array<{ name: string; rgb: [number, number, number]; refHex: string }> = [
      { name: 'Nightgown ivory', rgb: [217, 217, 217], refHex: '#d9d9d9' },
      { name: 'Massimo pink bra', rgb: [247, 122, 159], refHex: '#f77a9f' },
      { name: 'Babar dark pants', rgb: [34, 34, 34], refHex: '#222222' },
      { name: 'Bailarina black bodice', rgb: [18, 13, 11], refHex: '#120d0b' },
      { name: 'Superhero charcoal suit', rgb: [54, 54, 54], refHex: '#363636' },
    ];

    // 1) #ffffff ("Original") -> exact untouched pixel identity (MAE === 0)
    for (const s of samples) {
      const orig = evaluateNormalizedOutfitColorSrgb(s.rgb, s.refHex, '#ffffff');
      const mae =
        (Math.abs(orig[0] - s.rgb[0]) +
          Math.abs(orig[1] - s.rgb[1]) +
          Math.abs(orig[2] - s.rgb[2])) /
        3;
      expect(mae, s.name).toBeLessThan(1e-4);
    }

    // 2) Dark-to-light: Babar's dark pants ([34, 34, 34]) & Bailarina's black bodice ([18, 13, 11])
    // genuinely lift to Blush Rose (#f5d6e0 = [245, 214, 224]) instead of staying pitch-black!
    for (const dark of [samples[2]!, samples[3]!]) {
      const blush = evaluateNormalizedOutfitColorSrgb(dark.rgb, dark.refHex, '#f5d6e0');
      expect(blush[0], dark.name).toBeCloseTo(245, 0);
      expect(blush[1], dark.name).toBeCloseTo(214, 0);
      expect(blush[2], dark.name).toBeCloseTo(224, 0);
    }

    // Preserves highlight > midtone > shadow fabric fold shading on dark-to-light recoloring
    const darkHighlight = evaluateNormalizedOutfitColorSrgb([56, 56, 56], '#222222', '#f5d6e0');
    const darkMid = evaluateNormalizedOutfitColorSrgb([34, 34, 34], '#222222', '#f5d6e0');
    const darkShadow = evaluateNormalizedOutfitColorSrgb([14, 14, 14], '#222222', '#f5d6e0');
    expect(darkHighlight[0]).toBeGreaterThan(darkMid[0]);
    expect(darkMid[0]).toBeGreaterThan(darkShadow[0]);

    // 3) Light/pink-to-saturated: Nightgown ([217,217,217]) and Pink Bra ([247,122,159]) hit Cobalt (#1f4fd6 = [31,79,214]) and Crimson (#b8294b = [184,41,75]) cleanly without pink hue bleed!
    for (const light of [samples[0]!, samples[1]!]) {
      const cobalt = evaluateNormalizedOutfitColorSrgb(light.rgb, light.refHex, '#1f4fd6');
      expect(cobalt[0], light.name).toBeCloseTo(31, 0);
      expect(cobalt[1], light.name).toBeCloseTo(79, 0);
      expect(cobalt[2], light.name).toBeCloseTo(214, 0);

      const crimson = evaluateNormalizedOutfitColorSrgb(light.rgb, light.refHex, '#b8294b');
      expect(crimson[0], light.name).toBeCloseTo(184, 0);
      expect(crimson[1], light.name).toBeCloseTo(41, 0);
      expect(crimson[2], light.name).toBeCloseTo(75, 0);
    }

    // 4) Outfit RGBA analyzer skips transparent & black UV gutter padding
    const rgba = new Uint8Array(32 * 4);
    for (let i = 0; i < 32; i++) {
      const o = i * 4;
      if (i < 8) {
        // Black UV gutter
        rgba[o] = 0; rgba[o + 1] = 0; rgba[o + 2] = 0; rgba[o + 3] = 255;
      } else {
        // Blue shirt fabric [87, 103, 136]
        rgba[o] = 87; rgba[o + 1] = 103; rgba[o + 2] = 136; rgba[o + 3] = 255;
      }
    }
    const outfitLin = analyzeOutfitTextureRgba(rgba, 8, 4);
    expect(outfitLin).not.toBeNull();
    const expectedBlue = new T.Color('#576788');
    expect(outfitLin![0]).toBeCloseTo(expectedBlue.r, 2);
    expect(outfitLin![1]).toBeCloseTo(expectedBlue.g, 2);
    expect(outfitLin![2]).toBeCloseTo(expectedBlue.b, 2);
  });

  it('keeps skinColor and outfitColor 100% independent and simultaneously active on shared-atlas characters while chaining with NPR', () => {
    // Superhero Female: charcoal sports bra ([54, 54, 54] at yNorm=0.74) vs bare midriff skin ([170, 118, 82] at yNorm=0.64)
    const shBra: [number, number, number] = [54, 54, 54];
    const shSkin: [number, number, number] = [170, 118, 82];

    // Changing ONLY outfitColor recolors the bra to Crimson (#b8294b) and leaves bare skin 100% untouched!
    const braRecolored = evaluateSharedAtlasCharacterSrgb(
      shBra, '#aa7652', '#ffffff', '#363636', '#b8294b', [0.04, 0.74], 'superhero-female',
    );
    expect(braRecolored[0]).toBeCloseTo(184, 0);
    expect(braRecolored[1]).toBeCloseTo(41, 0);
    expect(braRecolored[2]).toBeCloseTo(75, 0);

    const skinUntouchedByDress = evaluateSharedAtlasCharacterSrgb(
      shSkin, '#aa7652', '#ffffff', '#363636', '#b8294b', [0.04, 0.64], 'superhero-female',
    );
    expect(skinUntouchedByDress[0]).toBeCloseTo(170, 1);
    expect(skinUntouchedByDress[1]).toBeCloseTo(118, 1);
    expect(skinUntouchedByDress[2]).toBeCloseTo(82, 1);

    // Changing BOTH skinColor (#ffdecc) and outfitColor (#1f4fd6) simultaneously applies each cleanly to its own region!
    const bothOnBra = evaluateSharedAtlasCharacterSrgb(
      shBra, '#aa7652', '#ffdecc', '#363636', '#1f4fd6', [0.04, 0.74], 'superhero-female',
    );
    expect(bothOnBra[0]).toBeCloseTo(31, 0);
    expect(bothOnBra[1]).toBeCloseTo(79, 0);
    expect(bothOnBra[2]).toBeCloseTo(214, 0);

    const bothOnSkin = evaluateSharedAtlasCharacterSrgb(
      shSkin, '#aa7652', '#ffdecc', '#363636', '#1f4fd6', [0.04, 0.64], 'superhero-female',
    );
    expect(bothOnSkin[0]).toBeCloseTo(255, 0);
    expect(bothOnSkin[1]).toBeCloseTo(222, 0);
    expect(bothOnSkin[2]).toBeCloseTo(204, 0);

    // Bailarina: dark eyes on head (yNorm=0.90) stay untouched when dress is Blush Rose, while lower fishnet stockings (yNorm=0.22) lighten cleanly!
    const headEyeDark: [number, number, number] = [14, 12, 11];
    const eyeCheck = evaluateSharedAtlasCharacterSrgb(
      headEyeDark, '#ac7051', '#ffdecc', '#120d0b', '#f5d6e0', [0.03, 0.90], 'bailarina', true,
    );
    expect(eyeCheck[0]).toBeCloseTo(14, 1);
    expect(eyeCheck[1]).toBeCloseTo(12, 1);
    expect(eyeCheck[2]).toBeCloseTo(11, 1);

    const lowerStocking: [number, number, number] = [18, 13, 11];
    const stockingCheck = evaluateSharedAtlasCharacterSrgb(
      lowerStocking, '#ac7051', '#ffffff', '#120d0b', '#f5d6e0', [0.08, 0.22], 'bailarina', true,
    );
    expect(stockingCheck[0]).toBeGreaterThan(200);
    expect(stockingCheck[1]).toBeGreaterThan(170);
    expect(stockingCheck[2]).toBeGreaterThan(180);

    // Stylized Women: gold bikini trim ([185, 145, 68] at yNorm=0.72) and outer hip bow strings ([62, 52, 48] at [0.16, 0.50]) respond to outfitColor!
    const goldTrim: [number, number, number] = [185, 145, 68];
    const goldSkinOnly = evaluateSharedAtlasCharacterSrgb(
      goldTrim, '#bf8d80', '#593421', '#5a5c78', '#ffffff', [0.05, 0.72], 'stylized-women',
    );
    expect(goldSkinOnly[0]).toBeCloseTo(185, 1);
    expect(goldSkinOnly[1]).toBeCloseTo(145, 1);
    expect(goldSkinOnly[2]).toBeCloseTo(68, 1);

    const hipBowTie: [number, number, number] = [62, 52, 48];
    const hipBowCrimson = evaluateSharedAtlasCharacterSrgb(
      hipBowTie, '#bf8d80', '#ffffff', '#5a5c78', '#b8294b', [0.16, 0.50], 'stylized-women',
    );
    expect(hipBowCrimson[0]).toBeGreaterThan(hipBowCrimson[2] * 1.8);
    expect(hipBowCrimson[0]).toBeGreaterThan(110);

    // Dedicated outfit shader chains cleanly with StudioShadingController (NPR)
    const gownMat = new T.MeshStandardMaterial({ name: 'Luna_night_gown', map: new T.Texture() });
    const binding = configureAuthoredOutfitMaterial(gownMat, '#b8294b');
    const npr = new StudioShadingController();
    npr.attachStudioShading(gownMat);
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: '',
      fragmentShader:
        '#include <common>\nvoid main() {\n#include <map_fragment>\n#include <lights_physical_fragment>\nvec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;\n}',
    };
    gownMat.onBeforeCompile(shader as unknown as T.WebGLProgramParametersWithUniforms, {} as T.WebGLRenderer);
    expect(shader.uniforms.uOutfitColor).toBe(binding.colorUniform);
    expect(shader.fragmentShader).toContain('pncEvaluateNormalizedOutfitColor');
    expect(shader.fragmentShader).toContain('vec3 pncBaseAlbedo = diffuseColor.rgb;');
  });
});

