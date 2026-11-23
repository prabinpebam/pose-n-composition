import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  decodeUnpremultipliedPngDataTexture,
  registerMannequinRgbaTextures,
} from './external-rig';
import {
  registerMannequinArchetypeBundle,
  type MannequinArchetypeManifest,
} from './bodyProportions';
import { registerHairTemplate, type HairAssetId } from './hair';
import {
  registerMannequinHairBundle,
  type MannequinHairManifest,
  type MannequinHairTextureSet,
} from './mannequin-hair';
import type { Body } from './model';

interface FixtureGLTF {
  buffers: { uri: string }[];
  images?: unknown[];
  textures?: unknown[];
  materials?: unknown[];
  meshes: { primitives: { material?: number }[] }[];
}

class PolyfillProgressEvent extends Event {
  lengthComputable: boolean;
  loaded: number;
  total: number;
  constructor(type: string, init: ProgressEventInit = {}) {
    super(type);
    this.lengthComputable = init.lengthComputable ?? false;
    this.loaded = init.loaded ?? 0;
    this.total = init.total ?? 0;
  }
}

function stripEmbeddedImagesFromGlb(buf: Buffer): ArrayBuffer {
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as {
    images?: unknown[];
    textures?: unknown[];
    materials?: Array<{ pbrMetallicRoughness?: { baseColorTexture?: unknown } }>;
  };
  const binLen = buf.readUInt32LE(20 + jsonLen);
  const binStart = 20 + jsonLen + 8;
  const binChunk = buf.subarray(binStart, binStart + binLen);

  delete json.images;
  delete json.textures;
  if (json.materials) {
    for (const m of json.materials) {
      if (m.pbrMetallicRoughness) delete m.pbrMetallicRoughness.baseColorTexture;
    }
  }

  const jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const pad = (4 - (jsonBuf.length % 4)) % 4;
  const paddedJson = pad ? Buffer.concat([jsonBuf, Buffer.alloc(pad, 0x20)]) : jsonBuf;
  const totalLen = 12 + 8 + paddedJson.length + 8 + binChunk.length;
  const out = Buffer.alloc(totalLen);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(totalLen, 8);
  out.writeUInt32LE(paddedJson.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  paddedJson.copy(out, 20);
  const bOff = 20 + paddedJson.length;
  out.writeUInt32LE(binChunk.length, bOff);
  out.writeUInt32LE(0x004e4942, bOff + 4);
  binChunk.copy(out, bOff + 8);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

let cachedFixturesPromise: Promise<Map<Body, T.Group>> | null = null;

export function loadMannequinTestFixtures(options?: { includeHair?: boolean }): Promise<Map<Body, T.Group>> {
  (globalThis as { ProgressEvent?: unknown }).ProgressEvent ??= PolyfillProgressEvent;

  if (!cachedFixturesPromise) {
    cachedFixturesPromise = (async () => {
      const mannequinDir = resolve(process.cwd(), 'public', 'models', 'mannequin');
      const manifest = JSON.parse(
        readFileSync(resolve(mannequinDir, 'archetypes.json'), 'utf8'),
      ) as MannequinArchetypeManifest;
      const binNode = readFileSync(resolve(mannequinDir, 'archetypes.bin'));
      const binAb = binNode.buffer.slice(binNode.byteOffset, binNode.byteOffset + binNode.byteLength) as ArrayBuffer;
      registerMannequinArchetypeBundle(manifest, binAb);

      const templates = new Map<Body, T.Group>();
      const loader = new GLTFLoader();

      for (const body of ['male', 'female'] as const) {
        const cap = body === 'male' ? 'Male' : 'Female';
        const defaultPng = readFileSync(resolve(mannequinDir, `Mannequin_${cap}.png`));
        const chibiPng = readFileSync(resolve(mannequinDir, `Mannequin_${cap}_Chibi.png`));
        const [defaultTex, chibiTex] = await Promise.all([
          decodeUnpremultipliedPngDataTexture(
            new Uint8Array(defaultPng.buffer, defaultPng.byteOffset, defaultPng.byteLength),
          ),
          decodeUnpremultipliedPngDataTexture(
            new Uint8Array(chibiPng.buffer, chibiPng.byteOffset, chibiPng.byteLength),
          ),
        ]);
        registerMannequinRgbaTextures(body, defaultTex, chibiTex);

        const glbBuf = readFileSync(resolve(mannequinDir, `Mannequin_${cap}.glb`));
        const stripped = stripEmbeddedImagesFromGlb(glbBuf);
        const parsed = await loader.parseAsync(stripped, '');
        templates.set(body, parsed.scene);
      }

      const cc0HairDir = resolve(mannequinDir, 'hair');
      const cc0HairManifest = JSON.parse(
        readFileSync(resolve(cc0HairDir, 'mannequin-hair.json'), 'utf8'),
      ) as MannequinHairManifest;
      const cc0HairBuf = readFileSync(resolve(cc0HairDir, 'mannequin-hair.bin'));
      const cc0HairTextures: Record<string, MannequinHairTextureSet> = {};
      for (const asset of Object.values(cc0HairManifest.assets)) {
        const albedoPng = readFileSync(resolve(process.cwd(), 'public', asset.albedoPath));
        const normalPng = readFileSync(resolve(process.cwd(), 'public', asset.normalPath));
        const [map, normalMap] = await Promise.all([
          decodeUnpremultipliedPngDataTexture(
            new Uint8Array(albedoPng.buffer, albedoPng.byteOffset, albedoPng.byteLength),
          ),
          decodeUnpremultipliedPngDataTexture(
            new Uint8Array(normalPng.buffer, normalPng.byteOffset, normalPng.byteLength),
          ),
        ]);
        cc0HairTextures[asset.id] = { map, normalMap };
      }
      registerMannequinHairBundle(
        cc0HairManifest,
        cc0HairBuf.buffer.slice(cc0HairBuf.byteOffset, cc0HairBuf.byteOffset + cc0HairBuf.byteLength),
        cc0HairTextures,
      );

      const hairDir = resolve(process.cwd(), 'public', 'models', 'external', 'quaternius-universal-base');
      const hairIds: HairAssetId[] = ['SimpleParted', 'Long', 'Buns', 'Buzzed', 'BuzzedFemale', 'Beard'];
      for (const id of hairIds) {
        const source = JSON.parse(readFileSync(resolve(hairDir, `Hair_${id}.gltf`), 'utf8')) as FixtureGLTF;
        source.buffers.forEach(b => {
          b.uri = `data:application/octet-stream;base64,${readFileSync(resolve(hairDir, b.uri)).toString('base64')}`;
        });
        delete source.images;
        delete source.textures;
        delete source.materials;
        source.meshes.forEach(m => m.primitives.forEach(p => { delete p.material; }));
        const parsed = await loader.parseAsync(JSON.stringify(source), '');
        registerHairTemplate(id, parsed.scene);
      }

      return templates;
    })();
  }

  void options;
  return cachedFixturesPromise;
}
