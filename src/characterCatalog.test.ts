import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it, vi } from 'vitest';
import { CHARACTERS, MODEL_IDS } from './characterCatalog';
import { buildExternalFigure, setFigureColors } from './external-rig';
import { JOINTS, initialScene, neutralPose, validatePortable } from './model';
import { getJointRotation, setFigurePose } from './rig';

describe.each(MODEL_IDS.filter(id => CHARACTERS[id].source))('%s source rig', id => {
  it('moves weighted vertices for every semantic joint without changing its sibling', async () => {
    const character = CHARACTERS[id];
    const path = resolve('public', character.path);
    const gltf = JSON.parse(readFileSync(path, 'utf8'));
    for (const image of gltf.images) expect(readFileSync(resolve(dirname(path), image.uri)).length).toBeGreaterThan(0);
    // Node has no image decoder. Keep original geometry, skin and material names;
    // the browser check exercises the actual textured materials.
    delete gltf.images; delete gltf.textures;
    gltf.materials = gltf.materials.map(({name}: {name: string}) => ({name}));
    for (const b of gltf.buffers) b.uri = `data:application/octet-stream;base64,${readFileSync(resolve(dirname(path), b.uri)).toString('base64')}`;
    if (!globalThis.ProgressEvent) vi.stubGlobal('ProgressEvent', Event);
    const template = (await new GLTFLoader().parseAsync(JSON.stringify(gltf), '')).scene;
    const make = () => buildExternalFigure(character.body, template, '#bda487', '#554433', id);
    const a = make(), b = make();
    a.deformation = { bodyType: 'chibi', limitMode: 'free' }; // A dormant mannequin setting must not morph the source.
    const sample = (mesh: T.SkinnedMesh) => {
      const points: T.Vector3[] = [];
      for (let i = 0; i < mesh.geometry.attributes.position.count; i += 13) points.push(mesh.getVertexPosition(i, new T.Vector3()));
      return points;
    };
    const baseline = sample(b.skin);
    expect(a.skin.geometry).not.toBe(b.skin.geometry);
    expect(a.skin.skeleton).not.toBe(b.skin.skeleton);
    for (const joint of JOINTS) {
      const pose = neutralPose(); pose[joint] = [.32, -.21, .09];
      setFigurePose(a, pose);
      expect(getJointRotation(a, joint)[0]).toBeCloseTo(.32, 5);
      expect(sample(a.skin).some((p, i) => p.distanceTo(baseline[i]) > .001), joint).toBe(true);
    }
    expect(sample(b.skin)).toEqual(baseline);
    setFigureColors(a, '#aabbcc', '#221144');
    expect(a.tintMaterials[0].color.getHexString()).toBe('aabbcc');
    expect(a.outfitColorUniforms[0].value.getHexString()).toBe('221144');
    expect(b.outfitColorUniforms[0].value.getHexString()).toBe('554433');
    expect(a.root.getObjectByName('Scalp hair')?.parent).toBe(a.bones.head);
  });
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
