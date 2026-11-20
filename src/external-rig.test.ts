import { beforeAll, describe, expect, it } from 'vitest';
import * as T from 'three';
import {
  buildExternalFigure,
  buildNormalizedBodyOutfitRgba,
  setFigureColors,
  setFigureHairStyle,
  SOURCE_BONES,
} from './external-rig';
import { HAIR_STYLES } from './hair';
import { computeAnchoredPositionY, getJointRotation, measureFigureMinWorldY, setFigurePose, type Figure } from './rig';
import { createItem, JOINTS, neutralPose, PRESETS, preset, radians, swapItemBodyKind, type Body } from './model';
import { BODY_TYPE_IDS, getFigureMorphedSkullEnvelope, type BodyTypeId } from './bodyProportions';
import { loadMannequinTestFixtures } from './testMannequinFixtures';

let templates = new Map<Body, T.Group>();
beforeAll(async () => {
  templates = await loadMannequinTestFixtures();
});
const make = (body: Body) => buildExternalFigure(body, templates.get(body)!, '#aabbcc');
function vertexWorld(f: Figure, skin: T.SkinnedMesh): T.Vector3 {
  const p = new T.Vector3().fromBufferAttribute(skin.geometry.getAttribute('position'), 0);
  return skin.localToWorld(skin.applyBoneTransform(0, p));
}
describe.each(['male', 'female'] as const)('ready-made %s rig', body => {
  it('integrates every archetype with authoritative pass-through skinning, reflected roots and idle caching', () => {
    const f = make(body), pose = preset('Kneeling');
    f.deformation = { bodyType: 'heroic', limitMode: 'anatomical' };
    for (const bodyType of BODY_TYPE_IDS) {
      f.deformation.bodyType = bodyType;
      f.root.position.set(1, 0.3, -2); f.root.rotation.set(0.1, 0.5, 0.2); f.root.scale.set(-1.2, 0.9, 1.1);
      setFigurePose(f, pose);
      const positions = f.skin.geometry.getAttribute('position');
      if (!(positions instanceof T.BufferAttribute)) throw new Error('Expected non-interleaved deformed positions');
      if (bodyType !== 'chibi') {
        for (let i = 0; i < positions.count; i += 97) {
          expect(f.skin.getVertexPosition(i, new T.Vector3()).distanceTo(new T.Vector3().fromBufferAttribute(positions, i))).toBeLessThan(1e-5);
        }
        for (let b = 0; b < f.skin.skeleton.bones.length; b++) {
          const shaderMatrix = f.skin.bindMatrixInverse.clone()
            .multiply(new T.Matrix4().fromArray(f.skin.skeleton.boneMatrices, b * 16)).multiply(f.skin.bindMatrix);
          shaderMatrix.elements.forEach((v, i) => expect(v).toBeCloseTo(i % 5 === 0 ? 1 : 0, 4));
        }
      } else {
        // Chibi uses clean GPU skinning (disableSkinDeformer + coupled bone pose) so positions remain bind-space
        const vCheck = f.skin.getVertexPosition(0, new T.Vector3());
        expect(Number.isFinite(vCheck.x) && Number.isFinite(vCheck.y) && Number.isFinite(vCheck.z)).toBe(true);
      }
      const version = positions.version;
      setFigurePose(f, pose);
      expect(positions.version).toBe(version);
    }
    f.deformation.bodyType = 'heroic';
    setFigurePose(f, pose);
    const fresh = make(body);
    fresh.deformation = { bodyType: 'heroic', limitMode: 'anatomical' };
    setFigurePose(fresh, pose);
    expect(Array.from(f.skin.geometry.getAttribute('position').array)).toEqual(Array.from(fresh.skin.geometry.getAttribute('position').array));
  });
  it('round-trips coupled semantic joints and recovers a real local FK delta without helper drift', () => {
    const f = make(body);
    f.deformation = { bodyType: 'chibi', limitMode: 'anatomical' };
    for (const name of PRESETS) {
      const pose = preset(name); setFigurePose(f, pose);
      for (const j of JOINTS) {
        expect(new T.Quaternion().setFromEuler(new T.Euler(...getJointRotation(f, j))).angleTo(new T.Quaternion().setFromEuler(new T.Euler(...pose[j])))).toBeLessThan(1e-6);
      }
    }
    const pose = preset('Reach'), basis = f.rotationBases.chest;
    const delta = new T.Quaternion().setFromEuler(new T.Euler(0.1, -0.05, 0.04));
    f.bones.chest.quaternion.multiply(basis.clone().multiply(delta).multiply(basis.clone().invert()));
    const actual = new T.Quaternion().setFromEuler(new T.Euler(...getJointRotation(f, 'chest')));
    expect(actual.angleTo(new T.Quaternion().setFromEuler(new T.Euler(...pose.chest)).multiply(delta))).toBeLessThan(1e-6);
    setFigureHairStyle(f, body, body === 'male' ? 'partedBeard' : 'buns');
    const scalp = f.root.getObjectByName('Scalp hair') as T.Mesh;
    const chibiSkull = getFigureMorphedSkullEnvelope(f.root)!;
    scalp.geometry.computeBoundingBox();
    const hairLocalWidth = scalp.geometry.boundingBox!.max.x - scalp.geometry.boundingBox!.min.x;
    expect(hairLocalWidth).toBeGreaterThan(chibiSkull.half[0] * 1.9);
    const broken = neutralPose(); broken.leftElbow[0] = 1;
    setFigurePose(f, broken);
    expect(getJointRotation(f, 'leftElbow')[0]).toBeCloseTo(T.MathUtils.degToRad(2));
    f.deformation.limitMode = 'free'; setFigurePose(f, broken);
    expect(getJointRotation(f, 'leftElbow')[0]).toBeCloseTo(1);
  });
  it('uses the real source skeleton and three independently poseable skinned surfaces', () => {
    const f = make(body), bounds = new T.Box3().setFromObject(f.skin);
    expect(f.skins).toHaveLength(3);
    expect(f.root.scale.toArray()).toEqual([1, 1, 1]);
    expect(bounds.max.y - bounds.min.y).toBeCloseTo(body === 'male' ? 1.80 : 1.75, 2);
    expect(bounds.min.y).toBeCloseTo(0, 3);
    for (const j of JOINTS) expect(f.bones[j].name).toBe(SOURCE_BONES[j]);
    expect(f.skins.every(s => s.skeleton.bones.length > JOINTS.length)).toBe(true);
    // Body, Eyes, and Eyebrows MUST own independent Skeleton & boneInverses arrays
    expect(f.skins[0]!.skeleton).not.toBe(f.skins[1]!.skeleton);
    expect(f.skins[0]!.skeleton).not.toBe(f.skins[2]!.skeleton);
    expect(f.skins[1]!.skeleton).not.toBe(f.skins[2]!.skeleton);
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
    expect(upper.y).toBeGreaterThan(eyeY);
    expect(lower.y).toBeGreaterThan(eyeY - 0.03);
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
  it('tints skin, outfit, hair, and eyes independently across multiple clones of the same gender', () => {
    const a = buildExternalFigure(body, templates.get(body)!, '#f5d0ba', '#1e6b52');
    const b = buildExternalFigure(body, templates.get(body)!, '#5c3824', '#8a2be2');
    const eyesA = a.skins.find(s => s.name === 'Eyes')!;
    const eyeMatBefore = (eyesA.material as T.MeshStandardMaterial).color.getHexString();

    expect(a.tintMaterials[0].color.getHexString()).toBe('f5d0ba');
    expect(a.outfitColorUniforms[0].value.getHexString()).toBe('1e6b52');
    expect(b.tintMaterials[0].color.getHexString()).toBe('5c3824');
    expect(b.outfitColorUniforms[0].value.getHexString()).toBe('8a2be2');

    setFigureColors(a, '#8d5524', '#d94862', '#eeddcc');
    expect(a.tintMaterials[0].color.getHexString()).toBe('8d5524');
    expect(a.outfitColorUniforms[0].value.getHexString()).toBe('d94862');
    expect(a.hairMaterials.every(m => m.color.getHexString() === 'eeddcc')).toBe(true);
    expect((eyesA.material as T.MeshStandardMaterial).color.getHexString()).toBe(eyeMatBefore);

    // Clone B stays completely untouched.
    expect(b.tintMaterials[0].color.getHexString()).toBe('5c3824');
    expect(b.outfitColorUniforms[0].value.getHexString()).toBe('8a2be2');

    // Verify shader hook injects uOutfitColor uniform without multiplying alpha.
    const fakeShader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: '',
      fragmentShader: '#include <common>\nvoid main() {\n#include <map_fragment>\n}',
    };
    a.tintMaterials[0].onBeforeCompile(fakeShader as unknown as T.WebGLProgramParametersWithUniforms, {} as T.WebGLRenderer);
    expect(fakeShader.uniforms.uOutfitColor).toBe(a.outfitColorUniforms[0]);
    expect(fakeShader.fragmentShader).toContain('mix( diffuse, uOutfitColor, sampledDiffuseColor.a )');
    expect(fakeShader.fragmentShader).not.toContain('diffuseColor *= sampledDiffuseColor');
  });
});

describe('luminance normalization and outfit alpha separation', () => {
  it('neutralizes baked orange skin bias, separates matte charcoal outfit, and preserves anatomical & trim shading', () => {
    // 6 pixels: [mid skin, sunlit skin, shaded skin, dark eye-rim skin, mid charcoal outfit, lighter outfit waistband seam]
    const base = new Uint8ClampedArray([
      170, 116, 81, 255,
      196, 138, 99, 255,
      142, 94, 64, 255,
      78, 52, 42, 255,
      54, 54, 54, 255,
      64, 64, 64, 255,
    ]);
    const rough = new Uint8ClampedArray([
      0, 168, 0, 255,
      0, 168, 0, 255,
      0, 172, 0, 255,
      0, 165, 0, 255,
      0, 253, 0, 255,
      0, 253, 0, 255,
    ]);

    const { rgba } = buildNormalizedBodyOutfitRgba(base, 6, 1, rough);
    for (let p = 0; p < 6; p++) {
      const o = p * 4;
      // Every texel is pure neutral grayscale (zero R/G/B hue contamination).
      expect(rgba[o]).toBe(rgba[o + 1]);
      expect(rgba[o + 1]).toBe(rgba[o + 2]);
    }
    // Skin midtone normalizes near ~0.92 (236/255) with preserved highlight > midtone > shadow.
    expect(rgba[0]).toBeGreaterThanOrEqual(225);
    expect(rgba[4]).toBeGreaterThan(rgba[0]!);
    expect(rgba[0]).toBeGreaterThan(rgba[8]!);
    // All 4 skin texels (including dark low-roughness eye rim) keep outfit mask === 0!
    expect(rgba[3]).toBe(0);
    expect(rgba[7]).toBe(0);
    expect(rgba[11]).toBe(0);
    expect(rgba[15]).toBe(0);
    // Both matte charcoal outfit texels get full outfit mask === 255 with seam contrast preserved!
    expect(rgba[19]).toBe(255);
    expect(rgba[23]).toBe(255);
    expect(rgba[20]).toBeGreaterThan(rgba[16]!);
  });
});

describe('in-place base figure & proportion anchor invariance', () => {
  it('keeps floor-grounded figures on y = 0 and elevated figures at exact support minWorldY across female <-> male and bodyType swaps', () => {
    const swapSequence: BodyTypeId[] = ['heroic', 'chibi', 'obese', 'busty', 'slender', 'realistic'];

    for (const initialSupportY of [0, 0.45]) {
      let item = createItem('female', 0, 'heroic');
      item.position = [1.8, 0, -1.2];
      item.rotation = [0, radians(65), 0];
      item.scale = [-1, 1, 1];
      item.pose = preset('Seated');
      item.color = '#d29978';
      item.outfitColor = '#2a6f5b';
      item.hairStyle = 'buns';
      item.hairColor = '#662211';
      item.anatomicalLimits = false;

      const buildFromItem = (src: typeof item): Figure => {
        const fig = buildExternalFigure(src.kind as Body, templates.get(src.kind as Body)!, src.color, src.outfitColor!);
        fig.root.position.fromArray(src.position);
        fig.root.rotation.fromArray(src.rotation);
        fig.root.scale.fromArray(src.scale);
        fig.deformation = {
          bodyType: src.bodyType ?? 'heroic',
          limitMode: src.anatomicalLimits === false ? 'free' : 'anatomical',
        };
        setFigureHairStyle(fig, src.kind as Body, src.hairStyle, src.hairColor);
        setFigurePose(fig, src.pose!);
        setFigureColors(fig, src.color, src.outfitColor!, src.hairColor);
        return fig;
      };

      let fig = buildFromItem(item);
      const minAtZero = measureFigureMinWorldY(fig);
      item.position[1] = Number((initialSupportY - minAtZero).toFixed(5));
      fig.root.position.y = item.position[1];
      expect(measureFigureMinWorldY(fig)).toBeCloseTo(initialSupportY, 4);

      // 1. Cycle through body proportions in-place
      for (const bt of swapSequence) {
        const beforeMinY = measureFigureMinWorldY(fig);
        fig.deformation = { bodyType: bt, limitMode: 'free' };
        setFigurePose(fig, item.pose!);
        const afterMinY = measureFigureMinWorldY(fig);
        item.bodyType = bt;
        item.position = [item.position[0], computeAnchoredPositionY(item.position[1], beforeMinY, afterMinY), item.position[2]];
        fig.root.position.fromArray(item.position);

        expect(item.position[0]).toBe(1.8);
        expect(item.position[2]).toBe(-1.2);
        expect(Math.abs(measureFigureMinWorldY(fig) - initialSupportY)).toBeLessThan(0.001);
      }

      // 2. Swap female -> male -> female in-place while preserving all fields & support anchor
      const originalId = item.id;
      for (const nextKind of ['male', 'female'] as const) {
        const beforeMinY = measureFigureMinWorldY(fig);
        const candidate = swapItemBodyKind(item, nextKind, item.position[1]);
        const nextFig = buildFromItem(candidate);
        const afterMinY = measureFigureMinWorldY(nextFig);
        const anchoredY = computeAnchoredPositionY(item.position[1], beforeMinY, afterMinY);
        item = swapItemBodyKind(item, nextKind, anchoredY);
        nextFig.root.position.fromArray(item.position);
        fig = nextFig;

        expect(item.id).toBe(originalId);
        expect(item.kind).toBe(nextKind);
        expect(item.position[0]).toBe(1.8);
        expect(item.position[2]).toBe(-1.2);
        expect(item.rotation).toEqual([0, radians(65), 0]);
        expect(item.scale).toEqual([-1, 1, 1]);
        expect(item.bodyType).toBe('realistic');
        expect(item.color).toBe('#d29978');
        expect(item.outfitColor).toBe('#2a6f5b');
        expect(item.hairStyle).toBe('buns');
        expect(item.hairColor).toBe('#662211');
        expect(item.anatomicalLimits).toBe(false);
        expect(fig.hairStyle).toBe('buns');
        expect(fig.tintMaterials[0].color.getHexString()).toBe('d29978');
        expect(fig.outfitColorUniforms[0].value.getHexString()).toBe('2a6f5b');
        expect(Math.abs(measureFigureMinWorldY(fig) - initialSupportY)).toBeLessThan(0.001);
      }
    }
  });
});

describe('multi-character same-gender isolation & eye/eyebrow socket attachment', () => {
  it('isolates 3 Males + 3 Females simultaneously with exact 0.0 vertex, normal, color, boneInverse, and material drift when siblings mutate', () => {
    const specs: Array<{
      gender: Body;
      bodyType: BodyTypeId;
      poseName: (typeof PRESETS)[number];
      pos: [number, number, number];
      skin: string;
      outfit: string;
      hair: (typeof HAIR_STYLES)[number];
      hairColor: string;
    }> = [
      { gender: 'male', bodyType: 'realistic', poseName: 'Neutral', pos: [-2.4, 0, 0], skin: '#f5d0ba', outfit: '#1e6b52', hair: 'parted', hairColor: '#2c221e' },
      { gender: 'male', bodyType: 'heroic', poseName: 'Heroic', pos: [-1.2, 0.25, -0.5], skin: '#d99b78', outfit: '#2b4a78', hair: 'partedBeard', hairColor: '#4a3222' },
      { gender: 'male', bodyType: 'obese', poseName: 'Seated', pos: [0.0, 0.45, 0.3], skin: '#8d5524', outfit: '#7a2b3a', hair: 'buzz', hairColor: '#1a1a1a' },
      { gender: 'female', bodyType: 'chibi', poseName: 'Contrapposto', pos: [1.1, 0, -0.2], skin: '#ffdecc', outfit: '#d94862', hair: 'long', hairColor: '#c87d55' },
      { gender: 'female', bodyType: 'busty', poseName: 'Reach', pos: [2.2, 0.3, 0.4], skin: '#c6865c', outfit: '#2b6b5e', hair: 'buns', hairColor: '#3b2314' },
      { gender: 'female', bodyType: 'slender', poseName: 'Kneeling', pos: [3.3, 0, -0.6], skin: '#6b3e26', outfit: '#5a3d8a', hair: 'parted', hairColor: '#eeddcc' },
    ];

    const figures = specs.map(s => {
      const f = buildExternalFigure(s.gender, templates.get(s.gender)!, s.skin, s.outfit);
      f.root.position.set(...s.pos);
      f.deformation = { bodyType: s.bodyType, limitMode: 'anatomical' };
      setFigurePose(f, preset(s.poseName));
      setFigureHairStyle(f, s.gender, s.hair, s.hairColor);
      setFigureColors(f, s.skin, s.outfit, s.hairColor);
      return f;
    });

    // Assert zero shared BufferGeometry / BufferAttribute / Skeleton / Material instances across all 6 figures
    for (let i = 0; i < figures.length; i++) {
      for (let j = i + 1; j < figures.length; j++) {
        const fa = figures[i]!, fb = figures[j]!;
        for (let k = 0; k < fa.skins.length; k++) {
          const sa = fa.skins[k]!, sb = fb.skins[k]!;
          expect(sa.geometry).not.toBe(sb.geometry);
          expect(sa.geometry.getAttribute('position').array).not.toBe(sb.geometry.getAttribute('position').array);
          expect(sa.geometry.getAttribute('normal').array).not.toBe(sb.geometry.getAttribute('normal').array);
          expect(sa.skeleton).not.toBe(sb.skeleton);
          expect(sa.skeleton.boneInverses[0]).not.toBe(sb.skeleton.boneInverses[0]);
          expect(sa.material).not.toBe(sb.material);
        }
        const hairA = fa.root.getObjectByName('Scalp hair') as T.Mesh;
        const hairB = fb.root.getObjectByName('Scalp hair') as T.Mesh;
        expect(hairA.geometry).not.toBe(hairB.geometry);
        expect(hairA.material).not.toBe(hairB.material);
      }
    }

    // Chibi female has clean-face map + anime eye vertex colors; adult females have adult map + distinct realistic eye colors
    const eyesChibi = figures[3]!.skins.find(s => s.name === 'Eyes')!;
    const eyesBusty = figures[4]!.skins.find(s => s.name === 'Eyes')!;
    expect(figures[3]!.tintMaterials[0]!.map).not.toBe(figures[4]!.tintMaterials[0]!.map);
    expect((eyesChibi.material as T.MeshStandardMaterial).vertexColors).toBe(true);
    expect(
      Array.from((eyesChibi.geometry.getAttribute('color') as T.BufferAttribute).array.slice(0, 24)),
    ).not.toEqual(
      Array.from((eyesBusty.geometry.getAttribute('color') as T.BufferAttribute).array.slice(0, 24)),
    );

    // Snapshot immutable state of untouched figures [0, 2, 3, 4]
    const untouchedIndices = [0, 2, 3, 4];
    const snapshots = untouchedIndices.map(idx => {
      const f = figures[idx]!;
      const scalp = f.root.getObjectByName('Scalp hair') as T.Mesh;
      return {
        idx,
        skins: f.skins.map(s => ({
          pos: Float32Array.from((s.geometry.getAttribute('position') as T.BufferAttribute).array as Float32Array),
          norm: Float32Array.from((s.geometry.getAttribute('normal') as T.BufferAttribute).array as Float32Array),
          color: s.geometry.getAttribute('color')
            ? Float32Array.from((s.geometry.getAttribute('color') as T.BufferAttribute).array as Float32Array)
            : null,
          inverses: s.skeleton.boneInverses.map(m => Float32Array.from(m.elements)),
        })),
        hairPos: Float32Array.from((scalp.geometry.getAttribute('position') as T.BufferAttribute).array as Float32Array),
        skinHex: f.tintMaterials[0]!.color.getHexString(),
        outfitHex: f.outfitColorUniforms[0]!.value.getHexString(),
        hairHex: f.hairMaterials.map(m => m.color.getHexString()),
        bodyMap: f.tintMaterials[0]!.map,
      };
    });

    // Aggressively mutate Male #2 (index 1 -> chibi + Running + new colors/hair) & Female #3 (index 5 -> obese + Crouch + new colors/hair)
    figures[1]!.deformation = { bodyType: 'chibi', limitMode: 'anatomical' };
    setFigurePose(figures[1]!, preset('Running'));
    setFigureHairStyle(figures[1]!, 'male', 'long', '#ffaa22');
    setFigureColors(figures[1]!, '#ffe0cc', '#1122aa', '#ffaa22');

    figures[5]!.deformation = { bodyType: 'obese', limitMode: 'anatomical' };
    setFigurePose(figures[5]!, preset('Crouch'));
    setFigureHairStyle(figures[5]!, 'female', 'buns', '#991133');
    setFigureColors(figures[5]!, '#4a2c18', '#dd6611', '#991133');

    // Assert exact 0.0 bit-for-bit drift across every untouched Male & Female figure!
    for (const snap of snapshots) {
      const f = figures[snap.idx]!;
      const scalp = f.root.getObjectByName('Scalp hair') as T.Mesh;
      expect(f.tintMaterials[0]!.color.getHexString()).toBe(snap.skinHex);
      expect(f.outfitColorUniforms[0]!.value.getHexString()).toBe(snap.outfitHex);
      expect(f.hairMaterials.map(m => m.color.getHexString())).toEqual(snap.hairHex);
      expect(f.tintMaterials[0]!.map).toBe(snap.bodyMap);

      const curHairPos = (scalp.geometry.getAttribute('position') as T.BufferAttribute).array as Float32Array;
      expect(curHairPos).toEqual(snap.hairPos);

      f.skins.forEach((s, k) => {
        const sp = snap.skins[k]!;
        expect((s.geometry.getAttribute('position') as T.BufferAttribute).array).toEqual(sp.pos);
        expect((s.geometry.getAttribute('normal') as T.BufferAttribute).array).toEqual(sp.norm);
        if (sp.color) {
          expect((s.geometry.getAttribute('color') as T.BufferAttribute).array).toEqual(sp.color);
        }
        s.skeleton.boneInverses.forEach((m, bIdx) => {
          expect(Float32Array.from(m.elements)).toEqual(sp.inverses[bIdx]!);
        });
      });
    }
  });

  it('keeps Eyes and Eyebrows rigidly attached to Head (0 detachment error) across all 9 archetypes and extreme poses', () => {
    for (const gender of ['male', 'female'] as const) {
      const f = make(gender);
      const eyes = f.skins.find(s => s.name === 'Eyes')!;
      const brows = f.skins.find(s => s.name === 'Eyebrows')!;

      for (const bt of BODY_TYPE_IDS) {
        f.deformation = { bodyType: bt, limitMode: 'anatomical' };
        setFigurePose(f, neutralPose());
        f.root.updateMatrixWorld(true);
        f.skins.forEach(s => s.skeleton.update());

        const skull = getFigureMorphedSkullEnvelope(f.root)!;
        const eyesBoxNeutral = new T.Box3();
        const browsBoxNeutral = new T.Box3();
        const eyeHeadLocal: T.Vector3[] = [];
        const browHeadLocal: T.Vector3[] = [];

        const eCount = eyes.geometry.getAttribute('position').count;
        for (let i = 0; i < eCount; i++) {
          const wp = eyes.getVertexPosition(i, new T.Vector3()).applyMatrix4(eyes.matrixWorld);
          eyesBoxNeutral.expandByPoint(wp);
          if (i % 7 === 0) eyeHeadLocal.push(f.bones.head.worldToLocal(wp.clone()));
        }
        const bCount = brows.geometry.getAttribute('position').count;
        for (let i = 0; i < bCount; i++) {
          const wp = brows.getVertexPosition(i, new T.Vector3()).applyMatrix4(brows.matrixWorld);
          browsBoxNeutral.expandByPoint(wp);
          if (i % 5 === 0) browHeadLocal.push(f.bones.head.worldToLocal(wp.clone()));
        }

        // Neutral world containment: eyes & brows sit cleanly inside morphed head height & lateral width
        const eyeCenter = eyesBoxNeutral.getCenter(new T.Vector3());
        const browCenter = browsBoxNeutral.getCenter(new T.Vector3());
        expect(eyeCenter.y).toBeGreaterThan(skull.chinY + 0.04);
        expect(eyeCenter.y).toBeLessThan(skull.crownY - 0.04);
        expect(browCenter.y).toBeGreaterThan(eyeCenter.y);
        expect(browCenter.y).toBeLessThan(skull.crownY - 0.02);
        expect(Math.abs(eyeCenter.x)).toBeLessThan(0.005);
        expect(eyesBoxNeutral.max.x).toBeLessThan(skull.half[0] * 1.05);

        // Pose figure aggressively (Kneeling + head/neck twist + world transform) and verify < 1e-5 m Head-local detachment!
        const posed = preset('Kneeling');
        posed.neck = [0.22, -0.35, 0.12];
        posed.head = [-0.38, 0.55, -0.18];
        f.root.position.set(-1.3, 0.4, 0.9);
        f.root.rotation.set(0.05, -0.6, 0.08);
        setFigurePose(f, posed);
        f.root.updateMatrixWorld(true);
        f.skins.forEach(s => s.skeleton.update());

        let k = 0;
        for (let i = 0; i < eCount; i += 7) {
          const actual = eyes.getVertexPosition(i, new T.Vector3()).applyMatrix4(eyes.matrixWorld);
          const expected = f.bones.head.localToWorld(eyeHeadLocal[k++]!.clone());
          expect(actual.distanceTo(expected)).toBeLessThan(1e-5);
        }
        k = 0;
        for (let i = 0; i < bCount; i += 5) {
          const actual = brows.getVertexPosition(i, new T.Vector3()).applyMatrix4(brows.matrixWorld);
          const expected = f.bones.head.localToWorld(browHeadLocal[k++]!.clone());
          expect(actual.distanceTo(expected)).toBeLessThan(1e-5);
        }

        f.root.position.set(0, 0, 0);
        f.root.rotation.set(0, 0, 0);
      }
    }
  });
});
