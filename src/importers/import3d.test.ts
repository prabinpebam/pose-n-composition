import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  deserializeImportedAsset,
  detect3DFormat,
  extractEditableMeshFromObject3D,
  import3dFiles,
  importSingle3dFile,
  portableJsonToSerializedAsset,
  serializedAssetToPortableJson,
  serializeImportedAsset,
  SUPPORTED_3D_EXTENSIONS,
} from './import3d';
import { bevelEdges, buildHalfEdgeOrAdjacency, evaluateBoolean } from '../modeling';

const SAMPLE_OBJ = `
mtllib cube.mtl
o TestCube
v -0.5 0.0  0.5
v  0.5 0.0  0.5
v  0.5 1.0  0.5
v -0.5 1.0  0.5
v -0.5 0.0 -0.5
v  0.5 0.0 -0.5
v  0.5 1.0 -0.5
v -0.5 1.0 -0.5
usemtl TerracottaMat
f 1 2 3 4
f 6 5 8 7
f 2 6 7 3
f 5 1 4 8
f 4 3 7 8
f 5 6 2 1
`.trim();

const SAMPLE_MTL = `
newmtl TerracottaMat
Kd 0.82 0.36 0.24
Ks 0.15 0.15 0.15
d 1.0
`.trim();

const SAMPLE_ASCII_STL = `
solid MillimeterTetra
  facet normal 0 0 -1
    outer loop
      vertex 0 0 100
      vertex 0 1000 100
      vertex 1000 0 100
    endloop
  endfacet
  facet normal 0 -1 0
    outer loop
      vertex 0 0 100
      vertex 1000 0 100
      vertex 0 0 1100
    endloop
  endfacet
  facet normal -1 0 0
    outer loop
      vertex 0 0 100
      vertex 0 0 1100
      vertex 0 1000 100
    endloop
  endfacet
  facet normal 0.577 0.577 0.577
    outer loop
      vertex 1000 0 100
      vertex 0 1000 100
      vertex 0 0 1100
    endloop
  endfacet
endsolid MillimeterTetra
`.trim();

const SAMPLE_VERTEX_COLOR_PLY = `
ply
format ascii 1.0
element vertex 4
property float x
property float y
property float z
property uchar red
property uchar green
property uchar blue
element face 4
property list uchar int vertex_indices
end_header
0 0 0 255 40 40
1 0 0 40 255 40
0.5 0 0.866 40 40 255
0.5 0.816 0.288 255 220 60
3 0 2 1
3 0 1 3
3 1 2 3
3 2 0 3
`.trim();

function createBinaryStlTriangle(): ArrayBuffer {
  // 80-byte header + uint32 count (1) + 50 bytes per triangle = 134 bytes
  const buf = new ArrayBuffer(134);
  const view = new DataView(buf);
  view.setUint32(80, 1, true);
  // normal (0, 1, 0)
  view.setFloat32(84, 0, true);
  view.setFloat32(88, 1, true);
  view.setFloat32(92, 0, true);
  // v0 (-1, 2, 0), v1 (1, 2, 0), v2 (0, 2, -1)
  const coords = [-1, 2, 0, 1, 2, 0, 0, 2, -1];
  coords.forEach((val, idx) => view.setFloat32(96 + idx * 4, val, true));
  return buf;
}

describe('Multi-Format 3D Scene Importer (import3d)', () => {
  it('recognizes all 7 required 3D format families (.glb/.gltf, .obj, .fbx, .stl, .ply, .dae, .3ds)', () => {
    for (const ext of SUPPORTED_3D_EXTENSIONS) {
      expect(detect3DFormat(`asset${ext}`)).not.toBeNull();
    }
    expect(detect3DFormat('notes.txt')).toBeNull();
  });

  it('imports .obj with companion .mtl, computes missing normals, grounds minY=0, and converts to quad EditableMesh', async () => {
    const asset = await import3dFiles([
      { name: 'cube.mtl', data: SAMPLE_MTL },
      { name: 'pedestal_cube.obj', data: SAMPLE_OBJ },
    ]);

    expect(asset.name).toBe('pedestal_cube');
    expect(asset.format).toBe('obj');
    expect(asset.meshCount).toBe(1);
    expect(asset.faceCount).toBe(12);

    const worldBox = new THREE.Box3().setFromObject(asset.root);
    expect(worldBox.min.y).toBeCloseTo(0, 5);
    expect((worldBox.min.x + worldBox.max.x) * 0.5).toBeCloseTo(0, 5);
    expect((worldBox.min.z + worldBox.max.z) * 0.5).toBeCloseTo(0, 5);

    // Extract EditableMesh (Make Editable) -> merges 12 coplanar OBJ tris back into 6 quads!
    const editable = extractEditableMeshFromObject3D(asset.root);
    expect(editable.vertices).toHaveLength(8);
    expect(editable.faces).toHaveLength(6);

    // Can bevel & CSG boolean the imported mesh!
    const adj = buildHalfEdgeOrAdjacency(editable);
    const beveled = bevelEdges(editable, adj.edges.map((e) => e.index), { width: 0.08, segments: 2 });
    expect(beveled.mesh.faces.length).toBeGreaterThan(20);

    const cutter = new THREE.SphereGeometry(0.4, 12, 10);
    const csg = evaluateBoolean(
      editable,
      null,
      cutter,
      { position: [0, 0.5, 0.5], rotation: [0, 0, 0], scale: [1, 1, 1] },
      'subtract',
    );
    expect(csg.getAttribute('position').count).toBeGreaterThan(12);
    cutter.dispose();
    csg.dispose();
  });

  it('imports ASCII & binary .stl and auto-normalizes millimeter CAD dimensions to stage meters', async () => {
    const asciiAsset = await importSingle3dFile({
      name: 'cad_part_mm.stl',
      data: SAMPLE_ASCII_STL,
    });

    expect(asciiAsset.format).toBe('stl');
    // Original span is 1000 mm -> auto-scaled by 0.001 to 1.0 m!
    expect(asciiAsset.appliedScale).toBeCloseTo(0.001, 6);
    expect(asciiAsset.boundsSize[0]).toBeCloseTo(1.0, 4);
    expect(asciiAsset.boundsSize[1]).toBeCloseTo(1.0, 4);
    expect(asciiAsset.boundsSize[2]).toBeCloseTo(1.0, 4);

    const box = new THREE.Box3().setFromObject(asciiAsset.root);
    expect(box.min.y).toBeCloseTo(0, 5);

    const binAsset = await importSingle3dFile({
      name: 'plate_bin.stl',
      data: createBinaryStlTriangle(),
    });
    expect(binAsset.faceCount).toBe(1);
    const binBox = new THREE.Box3().setFromObject(binAsset.root);
    expect(binBox.min.y).toBeCloseTo(0, 5);
  });

  it('imports .ply with vertex colors enabled and survives .glb binary & Base64 IndexedDB round-trip serialization', async () => {
    const plyAsset = await importSingle3dFile({
      name: 'colored_gem.ply',
      data: SAMPLE_VERTEX_COLOR_PLY,
    });

    expect(plyAsset.format).toBe('ply');
    expect(plyAsset.faceCount).toBe(4);

    let foundColoredMesh = false;
    plyAsset.root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        expect(obj.geometry.getAttribute('color')).toBeDefined();
        expect(obj.geometry.getAttribute('normal')).toBeDefined();
        const mat = obj.material as THREE.MeshStandardMaterial;
        expect(mat.vertexColors).toBe(true);
        foundColoredMesh = true;
      }
    });
    expect(foundColoredMesh).toBe(true);

    // Serialize to binary GLB ArrayBuffer -> Portable JSON Base64 -> Deserialize back to Object3D!
    const serialized = await serializeImportedAsset(plyAsset);
    expect(serialized.glb.byteLength).toBeGreaterThan(100);
    // Verify GLB magic header "glTF" (0x46546C67)
    expect(new DataView(serialized.glb).getUint32(0, true)).toBe(0x46546c67);

    const portable = serializedAssetToPortableJson(serialized);
    expect(portable.glbBase64.length).toBeGreaterThan(64);
    const unpacked = portableJsonToSerializedAsset(portable);

    const restored = await deserializeImportedAsset(unpacked);
    expect(restored.name).toBe('colored_gem');
    expect(restored.format).toBe('ply');
    expect(restored.faceCount).toBe(4);

    // Also test direct `.glb` import through `importSingle3dFile`!
    const reimportedGlb = await importSingle3dFile({
      name: 'roundtrip.glb',
      data: serialized.glb,
    });
    expect(reimportedGlb.format).toBe('glb');
    expect(reimportedGlb.faceCount).toBe(4);
  });
});
