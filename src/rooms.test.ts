import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { cloneRoom, getRoomObjects, groupRoomMainObjects, loadRooms, makeRoom, prepareRoomTemplate, releaseUnusedRooms, updateRoomCutaway } from './rooms';
import { ROOMS, ROOM_IDS } from './roomCatalog';
import * as roomCatalog from './roomCatalog';
import { createItem, initialScene, validatePortable } from './model';

beforeAll(() => {
  if (!globalThis.ProgressEvent) vi.stubGlobal('ProgressEvent', Event);
});

it('lights unassigned glTF surfaces without changing authored metallic materials', async () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const gltf = await new GLTFLoader().parseAsync(JSON.stringify({
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0, 1] }],
    nodes: [{ mesh: 0 }, { mesh: 1 }],
    meshes: [
      { primitives: [{ attributes: { POSITION: 0 } }] },
      { primitives: [{ attributes: { POSITION: 0 }, material: 0 }] },
    ],
    materials: [{ pbrMetallicRoughness: { metallicFactor: 1, roughnessFactor: 1 } }],
    buffers: [{ byteLength: positions.byteLength, uri: `data:application/octet-stream;base64,${Buffer.from(positions.buffer).toString('base64')}` }],
    bufferViews: [{ buffer: 0, byteLength: positions.byteLength }],
    accessors: [{ bufferView: 0, componentType: 5126, type: 'VEC3', count: 3, min: [0, 0, 0], max: [1, 1, 0] }],
  }), '');
  const metals: number[] = [];
  prepareRoomTemplate(gltf).traverse(node => {
    if (node instanceof T.Mesh && node.material instanceof T.MeshStandardMaterial) metals.push(node.material.metalness);
  });
  expect(metals).toEqual([0, 1]);
});

it('cuts away only near-side walls/ceilings, follows room rotation and restores the shell', () => {
  const source = new T.Group();
  const part = (role: string, z: number) => {
    const mesh = new T.Mesh(new T.BoxGeometry(2, 2, .1), new T.MeshStandardMaterial());
    mesh.position.set(0, 1, z); mesh.userData.pncRoomPart = role;
    source.add(mesh); return mesh;
  };
  part('wall', 2); part('wall', -2); part('ceiling', 0); part('furniture', 1);
  const root = cloneRoom(source), a = root.children[0].children;
  updateRoomCutaway(root, new T.Vector3(0, 1, 5), new T.Vector3(0, 1, 0), true);
  expect(a.map(p => p.visible)).toEqual([false, true, false, true]);
  root.rotation.y = Math.PI;
  updateRoomCutaway(root, new T.Vector3(0, 1, 5), new T.Vector3(0, 1, 0), true);
  expect(a.map(p => p.visible)).toEqual([true, false, false, true]);
  updateRoomCutaway(root, new T.Vector3(0, 1, 5), new T.Vector3(0, 1, 0), false);
  expect(a.every(p => p.visible)).toBe(true);
  expect(source.children.every(p => p.visible)).toBe(true);
});

it('preserves independent room materials/geometry and transparent glass without tinting furniture', () => {
  const source = new T.Group();
  const window = new T.Mesh(new T.BoxGeometry(), new T.MeshStandardMaterial());
  source.userData.pncRoomPart = 'glass'; source.add(window);
  const a = cloneRoom(source), b = cloneRoom(source);
  const glass = a.children[0].children[0] as T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>;
  const sibling = b.children[0].children[0] as T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>;
  expect(glass.geometry).not.toBe(sibling.geometry);
  expect(glass.material).not.toBe(sibling.material);
  expect(glass.material.transparent).toBe(true);
  expect(glass.material.opacity).toBeLessThanOrEqual(.22);
  expect(glass.material.depthWrite).toBe(false);
  expect(glass.userData.fixedColor).toBe(true);
  expect(window.material.transparent).toBe(false);
});

it('cuts away a wall extending in front of the target even when its center is behind it', () => {
  const source = new T.Group();
  for (const z of [-2, -6]) {
    const wall = new T.Mesh(new T.BoxGeometry(1, 2, 8), new T.MeshStandardMaterial());
    wall.position.z = z; wall.userData.pncRoomPart = 'wall'; source.add(wall);
  }
  const room = cloneRoom(source);
  updateRoomCutaway(room, new T.Vector3(0, 1, 5), new T.Vector3(0, 1, 0), true);
  expect(room.children[0].children.map(wall => wall.visible)).toEqual([false, true]);
});

it('keeps side walls, back walls, floor, and interior objects visible across all orbit angles and inside-room views', () => {
  const source = new T.Group();
  const makeWall = (x: number, z: number, w: number, d: number) => {
    const mesh = new T.Mesh(new T.BoxGeometry(w, 3, d), new T.MeshStandardMaterial());
    mesh.position.set(x, 1.5, z); mesh.userData.pncRoomPart = 'wall';
    source.add(mesh); return mesh;
  };
  const north = makeWall(0, -4, 6, .1);
  const south = makeWall(0, 4, 6, .1);
  const east = makeWall(3, 0, .1, 8);
  const west = makeWall(-3, 0, .1, 8);
  const ceiling = new T.Mesh(new T.BoxGeometry(6, .1, 8), new T.MeshStandardMaterial());
  ceiling.position.set(0, 3, 0); ceiling.userData.pncRoomPart = 'ceiling'; source.add(ceiling);
  const floor = new T.Mesh(new T.PlaneGeometry(6, 8), new T.MeshStandardMaterial());
  floor.rotation.x = -Math.PI / 2; source.add(floor);
  const sofa = new T.Mesh(new T.BoxGeometry(2, .8, 1), new T.MeshStandardMaterial());
  sofa.position.set(0, .4, -1); source.add(sofa);
  void north; void south; void east; void west;

  const root = cloneRoom(source);
  const [nMesh, sMesh, eMesh, wMesh, cMesh, flMesh, sfMesh] = root.children[0].children;
  const target = new T.Vector3(0, 1, 0);

  // Looking from South: only South wall and ceiling hide; North, East, West, floor, sofa stay visible
  updateRoomCutaway(root, new T.Vector3(0, 2, 9), target, true);
  expect([nMesh.visible, sMesh.visible, eMesh.visible, wMesh.visible, cMesh.visible, flMesh.visible, sfMesh.visible])
    .toEqual([true, false, true, true, false, true, true]);

  // Looking from East: only East wall and ceiling hide
  updateRoomCutaway(root, new T.Vector3(9, 2, 0), target, true);
  expect([nMesh.visible, sMesh.visible, eMesh.visible, wMesh.visible, cMesh.visible, flMesh.visible, sfMesh.visible])
    .toEqual([true, true, false, true, false, true, true]);

  // Looking from South-Southeast diagonal: South & East hide; North & West stay visible
  updateRoomCutaway(root, new T.Vector3(6, 2, 9), target, true);
  expect([nMesh.visible, sMesh.visible, eMesh.visible, wMesh.visible, cMesh.visible, flMesh.visible, sfMesh.visible])
    .toEqual([true, false, false, true, false, true, true]);

  // Inside the room: no walls hide
  updateRoomCutaway(root, new T.Vector3(0, 1.6, 2), target, true);
  expect([nMesh.visible, sMesh.visible, eMesh.visible, wMesh.visible, cMesh.visible, flMesh.visible, sfMesh.visible])
    .toEqual([true, true, true, true, false, true, true]);

  // Cutaway disabled: everything is visible again
  updateRoomCutaway(root, new T.Vector3(8, 2, 9), target, false);
  expect(root.children[0].children.every(m => m.visible)).toBe(true);
});

it.skipIf(ROOM_IDS.length === 0)('releases inactive GPU textures without losing assets needed by Undo/Redo', async () => {
  const gltf = await new GLTFLoader().parseAsync(JSON.stringify({
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [] }], nodes: [],
  }), '');
  const texture = new T.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  gltf.scene.add(new T.Mesh(new T.BoxGeometry(), new T.MeshStandardMaterial({ map: texture })));
  const dispose = vi.spyOn(texture, 'dispose');
  const load = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockResolvedValueOnce(gltf);
  try {
    await loadRooms([ROOM_IDS[0]]);
    makeRoom(ROOM_IDS[0]);
    releaseUnusedRooms([]);
    expect(dispose).toHaveBeenCalledOnce();
    expect(() => makeRoom(ROOM_IDS[0])).not.toThrow();
    expect(texture.image.data).toEqual(new Uint8Array([255, 255, 255, 255]));
  } finally {
    load.mockRestore();
    dispose.mockRestore();
  }
});

it('groups room meshes into main logical objects with bottom-center pivots and roundtrips overrides/locks', () => {
  const source = new T.Group();
  const wall = new T.Mesh(new T.BoxGeometry(6, 3, 0.1), new T.MeshStandardMaterial());
  wall.position.set(0, 1.5, -3);
  wall.userData.pncRoomPart = 'wall';
  const floor = new T.Mesh(new T.BoxGeometry(6, 0.05, 6), new T.MeshStandardMaterial());
  floor.name = 'Floor';
  floor.position.set(0, -0.025, 0);
  const rug = new T.Mesh(new T.BoxGeometry(3, 0.02, 2), new T.MeshStandardMaterial());
  rug.name = 'Rug';
  rug.position.set(0, 0.01, 0);
  const sofaBase = new T.Mesh(new T.BoxGeometry(2, 0.4, 0.9), new T.MeshStandardMaterial());
  sofaBase.name = 'Sofa_Base';
  sofaBase.position.set(-1, 0.2, 0);
  const sofaCushion = new T.Mesh(new T.BoxGeometry(0.8, 0.3, 0.4), new T.MeshStandardMaterial());
  sofaCushion.name = 'Cube.001';
  sofaCushion.position.set(-1, 0.55, -0.1);
  const table = new T.Mesh(new T.BoxGeometry(1, 0.5, 0.6), new T.MeshStandardMaterial());
  table.name = 'Coffee_Table';
  table.position.set(1.5, 0.25, 0.5);
  source.add(wall, floor, rug, sofaBase, sofaCushion, table);

  const root = cloneRoom(source);
  const objects = groupRoomMainObjects(root);
  expect(getRoomObjects(root)).toBe(objects);
  expect(objects.map(o => o.category)).toContain('architecture');
  expect(objects.some(o => o.name === 'Sofa')).toBe(true);
  expect(objects.some(o => o.name === 'Table')).toBe(true);
  expect(objects.some(o => o.name === 'Rug')).toBe(true);
  const sofaObj = objects.find(o => o.name === 'Sofa')!;
  expect(sofaObj.basePosition[1]).toBeCloseTo(0, 4);
  expect(sofaObj.group.children).toHaveLength(2);

  const scene = initialScene();
  scene.items[0].locked = true;
  scene.items[0].visible = false;
  const roomItem = {
    ...createItem('room'),
    roomId: 'test-room',
    locked: true,
    roomObjects: {
      [sofaObj.id]: { position: [0.5, 0, -0.2] as [number, number, number], rotation: [0, 0.5, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number], visible: false, locked: true, deleted: false },
    },
  };
  scene.items.push(roomItem);
  const knownRoom = vi.spyOn(roomCatalog, 'isRoomId').mockImplementation(value => value === 'test-room');
  try {
    const restored = validatePortable(JSON.parse(JSON.stringify(scene)));
    if (restored.type !== 'scene') throw new Error('Expected scene');
    expect(restored.items[0].locked).toBe(true);
    expect(restored.items[0].visible).toBe(false);
    expect(restored.items.at(-1)?.roomObjects?.[sofaObj.id]?.locked).toBe(true);
    expect(() => validatePortable({ ...scene, items: [{ ...roomItem, locked: 'yes' }] })).toThrow('Invalid file');
    expect(() => validatePortable({ ...scene, items: [{ ...roomItem, roomObjects: { [sofaObj.id]: { scale: [0, 1, 1] } } }] })).toThrow('Invalid file');
  } finally {
    knownRoom.mockRestore();
  }
});

describe.each(ROOM_IDS)('%s preset room', id => {
  it('roundtrips scene transforms/visibility and rejects invalid room fields', () => {
    const scene = initialScene();
    const item = { ...createItem('room'), roomId: id, visible: false, cutaway: false };
    item.position = [1, 0, -2]; item.rotation = [0, .4, 0];
    scene.items.push(item);
    const restored = validatePortable(JSON.parse(JSON.stringify(scene)));
    if (restored.type !== 'scene') throw new Error('Expected scene');
    expect(restored.items.at(-1)).toEqual(item);
    for (const patch of [{ roomId: 'unavailable' }, { visible: 'false' }, { cutaway: null }, { kind: 'chair' }]) {
      expect(() => validatePortable({ ...scene, items: [{ ...item, ...patch }] })).toThrow('Invalid file');
    }
  });

  it('places an unobstructed human-sized volume over the walking floor top, not the slab underside', async () => {
    const bytes = readFileSync(resolve('.', ROOMS[id].path));
    const length = bytes.readUInt32LE(12);
    const gltf = JSON.parse(bytes.subarray(20, 20 + length).toString('utf8'));
    for (const image of gltf.images ?? []) {
      expect(image.uri, 'room textures must be embedded').toBeUndefined();
      expect(gltf.bufferViews[image.bufferView].byteLength).toBeGreaterThan(0);
    }
    delete gltf.images; delete gltf.textures;
    gltf.materials = gltf.materials.map(({ name, doubleSided }: { name: string; doubleSided?: boolean }) => ({ name, doubleSided }));
    gltf.buffers[0].uri = `data:application/octet-stream;base64,${bytes.subarray(28 + length).toString('base64')}`;
    const room = (await new GLTFLoader().parseAsync(JSON.stringify(gltf), '')).scene;
    room.updateMatrixWorld(true);
    for (const [x, z] of [[0, 0], [.4, 0], [-.4, 0], [0, .4], [0, -.4]]) {
      const ray = new T.Raycaster(new T.Vector3(x, 1.85, z), new T.Vector3(0, -1, 0), 0, 1.86);
      const hit = ray.intersectObject(room, true)[0];
      expect(hit, `walking-floor column ${x}, ${z}`).toBeDefined();
      const rugRing = id === 'local-modern-bedroom' && (x !== 0 || z !== 0) && hit.object.name === 'Rug';
      // Preserve the authored rug folds; only its grounded origin is planar zero.
      expect(Math.abs(hit.point.y), `floor top/standing volume ${x}, ${z} on ${hit.object.name}`).toBeLessThanOrEqual(rugRing ? .010 : 5e-6);
      if (x === 0 && z === 0 && hit.face) {
        const worldNormal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
        expect(worldNormal.y, `walking floor normal at (0,0) on ${hit.object.name}`).toBeGreaterThan(0.9);
      }
    }
    room.traverse(node => {
      if (node instanceof T.Mesh) {
        expect(node.matrixWorld.determinant(), `positive determinant on ${node.name}`).toBeGreaterThan(0);
      }
    });
    const clone = cloneRoom(room);
    const walls: T.Mesh[] = [];
    const nonShells: T.Mesh[] = [];
    clone.traverse(node => {
      if (!(node instanceof T.Mesh)) return;
      if (node.userData.pncRoomPart === 'wall') walls.push(node);
      else if (node.userData.pncRoomPart !== 'ceiling') nonShells.push(node);
    });
    for (const [cx, cz] of [[0, 14], [14, 0], [0, -14], [-14, 0]]) {
      updateRoomCutaway(clone, new T.Vector3(cx, 2, cz), new T.Vector3(0, 1, 0), true);
      expect(nonShells.every(m => m.visible), `non-shell meshes visible from (${cx}, ${cz})`).toBe(true);
      if (walls.length > 0) {
        expect(walls.some(w => w.visible), `at least one wall remains visible from (${cx}, ${cz})`).toBe(true);
      }
    }
    expect(ROOMS[id].metrics.clearance).toBeGreaterThanOrEqual(.4);
  });
});
