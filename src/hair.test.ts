import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  buildHairGeometryAndMaterial,
  defaultHairStyle,
  HAIR_STYLES,
  hasHairTemplates,
  registerHairTemplate,
  type HairAssetId,
} from './hair';

interface FixtureGLTF {
  buffers: { uri: string }[];
  images?: unknown[];
  textures?: unknown[];
  materials?: unknown[];
  meshes: { primitives: { material?: number }[] }[];
}

beforeAll(async () => {
  vi.stubGlobal('ProgressEvent', class extends Event {
    lengthComputable: boolean;
    loaded: number;
    total: number;
    constructor(type: string, init: ProgressEventInit = {}) {
      super(type);
      this.lengthComputable = init.lengthComputable ?? false;
      this.loaded = init.loaded ?? 0;
      this.total = init.total ?? 0;
    }
  });
  const directory = resolve('public', 'models', 'external', 'quaternius-universal-base');
  const ids: HairAssetId[] = ['SimpleParted', 'Long', 'Buns', 'Buzzed', 'BuzzedFemale', 'Beard'];
  for (const id of ids) {
    const source = JSON.parse(readFileSync(resolve(directory, `Hair_${id}.gltf`), 'utf8')) as FixtureGLTF;
    source.buffers.forEach(b => {
      b.uri = `data:application/octet-stream;base64,${readFileSync(resolve(directory, b.uri)).toString('base64')}`;
    });
    delete source.images;
    delete source.textures;
    delete source.materials;
    source.meshes.forEach(m => m.primitives.forEach(p => { delete p.material; }));
    const parsed = await new GLTFLoader().parseAsync(JSON.stringify(source), '');
    registerHairTemplate(id, parsed.scene);
  }
});

afterAll(() => vi.unstubAllGlobals());

describe('sculpted CC0 hairstyle templates and cross-body skull adapter', () => {
  it('registers all six sculpted hair templates and assigns distinct body defaults', () => {
    expect(hasHairTemplates()).toBe(true);
    expect(defaultHairStyle('male')).toBe('parted');
    expect(defaultHairStyle('female')).toBe('long');
  });

  it('builds distinct sculpted geometries per style, tints hairColor, and supports bald mode', () => {
    const identity = new T.Matrix4();
    const parted = buildHairGeometryAndMaterial('male', 'parted', identity, '#5a3825')!;
    const partedBeard = buildHairGeometryAndMaterial('male', 'partedBeard', identity, '#5a3825')!;
    const long = buildHairGeometryAndMaterial('female', 'long', identity, '#c89b54')!;
    const none = buildHairGeometryAndMaterial('male', 'none', identity, '#222222')!;

    expect(parted.visible).toBe(true);
    expect(partedBeard.visible).toBe(true);
    expect(long.visible).toBe(true);
    expect(none.visible).toBe(false);

    const partedVerts = parted.geometry.getAttribute('position').count;
    const beardVerts = partedBeard.geometry.getAttribute('position').count;
    const longVerts = long.geometry.getAttribute('position').count;
    expect(partedVerts).toBeGreaterThan(200);
    expect(beardVerts).toBeGreaterThan(partedVerts);
    expect(longVerts).not.toBe(partedVerts);
    expect(`#${long.material.color.getHexString()}`).toBe('#c89b54');
  });

  it('adapts cross-body hairstyles to each skull crown height cleanly across all styles', () => {
    const identity = new T.Matrix4();
    for (const style of HAIR_STYLES) {
      if (style === 'none') continue;
      const maleFit = buildHairGeometryAndMaterial('male', style, identity, '#3b2720')!;
      const femaleFit = buildHairGeometryAndMaterial('female', style, identity, '#3b2720')!;
      maleFit.geometry.computeBoundingBox();
      femaleFit.geometry.computeBoundingBox();
      // Male skull crown (~1.81 m) sits higher than female skull crown (~1.77 m) in native space
      expect(maleFit.geometry.boundingBox!.max.y).toBeGreaterThan(femaleFit.geometry.boundingBox!.max.y + 0.02);
    }
  });
});
