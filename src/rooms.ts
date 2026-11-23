import * as T from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { ROOMS, isRoomId, type RoomId } from './roomCatalog';
import { ensureGeometryBvh, installBvhRaycastAcceleration } from './performance/bvhRaycaster';

const templates = new Map<RoomId, T.Object3D>();
const pending = new Map<RoomId, Promise<void>>();
const gpuReleased = new Set<RoomId>();
interface Shell { mesh: T.Mesh; bounds: T.Box3; visible: boolean; ceiling: boolean }
const shells = new WeakMap<T.Group, Shell[]>();

export type RoomObjectCategory = 'architecture' | 'furniture' | 'decor' | 'lighting';

export interface RoomObjectInfo {
  id: string;
  name: string;
  category: RoomObjectCategory;
  group: T.Group;
  basePosition: [number, number, number];
}

const roomObjectsMap = new WeakMap<T.Group, RoomObjectInfo[]>();

export function getRoomObjects(root: T.Group): RoomObjectInfo[] {
  return roomObjectsMap.get(root) ?? [];
}

export function prepareRoomTemplate(gltf: GLTF): T.Object3D {
  installBvhRaycastAcceleration();
  gltf.scene.traverse(node => {
    if (!(node instanceof T.Mesh)) return;
    node.geometry.userData.__sharedRoomTemplateGeometry = true;
    ensureGeometryBvh(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      if (material instanceof T.MeshStandardMaterial && gltf.parser.associations.get(material)?.materials === undefined) {
        material.metalness = 0;
      }
    }
  });
  return gltf.scene;
}

export async function loadRooms(ids: readonly RoomId[]): Promise<void> {
  await Promise.all([...new Set(ids)].map(async id => {
    if (!isRoomId(id)) throw new Error(`Unavailable preset room: ${id}`);
    if (templates.has(id)) return;
    let request = pending.get(id);
    if (!request) {
      request = new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}${ROOMS[id].path}`)
        .then(gltf => { templates.set(id, prepareRoomTemplate(gltf)); })
        .catch(error => { throw new Error(`Could not load ${ROOMS[id].label}: ${error instanceof Error ? error.message : String(error)}`); })
        .finally(() => { pending.delete(id); });
      pending.set(id, request);
    }
    await request;
  }));
}

export function cloneRoom(template: T.Object3D): T.Group {
  installBvhRaycastAcceleration();
  const root = new T.Group();
  root.add(template.clone(true));
  root.updateMatrixWorld(true);
  const parts: Shell[] = [];
  root.traverse(node => {
    node.userData.pncRoomPart ??= node.parent?.userData.pncRoomPart;
    if (!(node instanceof T.Mesh)) return;
    if (!node.geometry.userData?.__sharedRoomTemplateGeometry) {
      node.geometry = node.geometry.clone();
    }
    ensureGeometryBvh(node.geometry);
    const prepare = (original: T.Material) => {
      const material = original instanceof T.MeshBasicMaterial
        ? new T.MeshStandardMaterial({ color: original.color, map: original.map, alphaMap: original.alphaMap,
          transparent: original.transparent, opacity: original.opacity, alphaTest: original.alphaTest, side: original.side })
        : original.clone();
      if (node.userData.pncRoomPart === 'glass') {
        material.transparent = true;
        material.opacity = Math.min(material.opacity, .22);
        material.depthWrite = false;
      }
      return material;
    };
    node.material = Array.isArray(node.material) ? node.material.map(prepare) : prepare(node.material);
    node.castShadow = node.userData.pncRoomPart !== 'glass';
    node.receiveShadow = true;
    node.userData.fixedColor = true;
    const role = node.userData.pncRoomPart;
    if (role === 'wall' || role === 'ceiling') {
      const bounds = new T.Box3().setFromObject(node).applyMatrix4(root.matrixWorld.clone().invert());
      parts.push({ mesh: node, bounds, visible: node.visible, ceiling: role === 'ceiling' });
    }
  });
  shells.set(root, parts);
  return root;
}

const GENERIC_MESH_NAME = /^(cube|plane|cylinder|sphere|cone|torus|circle|box|mesh|object|node|sm|poly|shape|group|untitled|default|bezi|curve|line|aa)([._\-\s]*\d+)*$/i;

function extractSemanticBase(raw: string): string | null {
  const cleaned = raw
    .replace(/([._\-]\d+)+$/g, '')
    .replace(/(_P\d+|_S-Remesh.*|_mesh|_geo|_low|_high)$/gi, '')
    .trim();
  if (!cleaned || cleaned.length < 2 || GENERIC_MESH_NAME.test(cleaned)) return null;
  return cleaned;
}

function inferRoomObjectLabel(
  meshes: T.Mesh[],
  bounds: T.Box3,
  isRug: boolean,
): { name: string; category: RoomObjectCategory } {
  if (isRug) return { name: 'Rug', category: 'decor' };
  const combined = meshes
    .flatMap(m => [
      m.name,
      ...(Array.isArray(m.material) ? m.material : [m.material]).map(mat => mat?.name ?? ''),
    ])
    .join(' ')
    .replace(/[_-]+/g, ' ')
    .toLowerCase();

  const rules: Array<[RegExp, string, RoomObjectCategory]> = [
    [/\b(sofa|couch|sectional|settee|loveseat)\b/, 'Sofa', 'furniture'],
    [/\b(bed|mattress|bedunit|lit)\b/, 'Bed', 'furniture'],
    [/\b(desk|bureau)\b/, 'Desk', 'furniture'],
    [/\b(dining.*table|coffee.*table|side.*table|table|mesa)\b/, 'Table', 'furniture'],
    [/\b(armchair|chair|stool|bench|seat|pouf|ottoman)\b/, 'Chair', 'furniture'],
    [/\b(bookshelf|bookcase|kitaplik|shelf|cabinet|wardrobe|dresser|vanity|nightstand|bedside|cupboard|credenza|sideboard|tv.?stand)\b/, 'Cabinet / Shelf', 'furniture'],
    [/\b(lamp|chandelier|sconce|pendant|lantern|light)\b/, 'Lamp', 'lighting'],
    [/\b(curtain|drape|blind)\b/, 'Curtains', 'decor'],
    [/\b(rug|carpet|mat)\b/, 'Rug', 'decor'],
    [/\b(plant|tree|flower|pot|vase|planter)\b/, 'Plant', 'decor'],
    [/\b(tv|television|monitor|screen|laptop|macbook|computer)\b/, 'Electronics', 'decor'],
    [/\b(painting|frame|picture|poster|mirror|clock)\b/, 'Wall Decor', 'decor'],
    [/\b(pillow|cushion|blanket|throw)\b/, 'Cushion', 'decor'],
    [/\b(book|books|magazine)\b/, 'Books', 'decor'],
  ];

  for (const [re, label, category] of rules) {
    if (re.test(combined)) return { name: label, category };
  }

  for (const m of meshes) {
    const base = extractSemanticBase(m.name);
    if (base) {
      const pretty = base.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      return { name: pretty.slice(0, 32), category: 'furniture' };
    }
  }

  const size = bounds.getSize(new T.Vector3());
  const area = size.x * size.z;
  if (bounds.min.y > 1.8 && size.y < 0.9 && area < 2.0) return { name: 'Light Fixture', category: 'lighting' };
  if (size.y >= 1.1 && area >= 0.25) return { name: 'Cabinet / Unit', category: 'furniture' };
  if (area >= 0.45 && size.y >= 0.25) return { name: 'Furniture', category: 'furniture' };
  return { name: 'Decor', category: 'decor' };
}

export function groupRoomMainObjects(root: T.Group): RoomObjectInfo[] {
  root.updateMatrixWorld(true);
  const rootInv = root.matrixWorld.clone().invert();
  const allMeshes: T.Mesh[] = [];
  root.traverse(node => {
    if (node instanceof T.Mesh) allMeshes.push(node);
  });
  if (!allMeshes.length) {
    roomObjectsMap.set(root, []);
    return [];
  }

  const meshBoxes = new Map<T.Mesh, T.Box3>();
  for (const m of allMeshes) {
    meshBoxes.set(m, new T.Box3().setFromObject(m).applyMatrix4(rootInv));
  }

  const shellMeshes: T.Mesh[] = [];
  const rugMeshes: T.Mesh[] = [];
  const furnitureMeshes: T.Mesh[] = [];
  const sizeVec = new T.Vector3();

  for (const m of allMeshes) {
    const part = m.userData.pncRoomPart;
    const box = meshBoxes.get(m)!;
    box.getSize(sizeVec);
    const areaXZ = sizeVec.x * sizeVec.z;
    const isFloorSlab =
      box.min.y <= 0.08 &&
      box.max.y <= 0.25 &&
      sizeVec.y <= 0.35 &&
      (areaXZ >= 8.0 || (areaXZ >= 3.5 && /floor|zemin|ground|plane|sala|quartos|corredor/i.test(m.name)));
    if (part === 'wall' || part === 'ceiling' || part === 'glass' || isFloorSlab) {
      shellMeshes.push(m);
    } else if (box.min.y <= 0.06 && box.max.y <= 0.12 && sizeVec.y <= 0.12 && areaXZ >= 0.8) {
      rugMeshes.push(m);
    } else {
      furnitureMeshes.push(m);
    }
  }

  // Cluster furniture meshes by 3D bounding-box proximity (4 cm) or shared semantic name within 1.8 m.
  const n = furnitureMeshes.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const unite = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  const expandedBoxes = furnitureMeshes.map(m => meshBoxes.get(m)!.clone().expandByScalar(0.04));
  const centers = furnitureMeshes.map(m => meshBoxes.get(m)!.getCenter(new T.Vector3()));
  const semanticBases = furnitureMeshes.map(m => extractSemanticBase(m.name)?.toLowerCase() ?? null);

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (expandedBoxes[i].intersectsBox(expandedBoxes[j])) {
        unite(i, j);
      } else if (
        semanticBases[i] &&
        semanticBases[i] === semanticBases[j] &&
        centers[i].distanceTo(centers[j]) < 1.8
      ) {
        unite(i, j);
      }
    }
  }

  const clusters = new Map<number, T.Mesh[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const list = clusters.get(r) ?? [];
    list.push(furnitureMeshes[i]);
    clusters.set(r, list);
  }

  const infos: RoomObjectInfo[] = [];
  const usedIds = new Set<string>();
  const nameCounts = new Map<string, number>();

  const attachGroup = (idBase: string, label: string, category: RoomObjectCategory, meshes: T.Mesh[], basePosition: [number, number, number]) => {
    const count = (nameCounts.get(label) ?? 0) + 1;
    nameCounts.set(label, count);
    const displayName = category === 'architecture' || count === 1 ? label : `${label} ${count}`;
    let id = idBase;
    let suffix = 2;
    while (usedIds.has(id)) id = `${idBase}-${suffix++}`;
    usedIds.add(id);

    const group = new T.Group();
    group.name = displayName;
    group.position.set(basePosition[0], basePosition[1], basePosition[2]);
    group.userData.roomObjectId = id;
    group.userData.basePosition = basePosition;
    root.add(group);
    group.updateMatrixWorld(true);
    const groupInv = group.matrixWorld.clone().invert();
    const pos = new T.Vector3();
    const quat = new T.Quaternion();
    const scl = new T.Vector3();

    for (const m of meshes) {
      const localMat = groupInv.clone().multiply(m.matrixWorld);
      localMat.decompose(pos, quat, scl);
      group.add(m);
      m.position.copy(pos);
      m.quaternion.copy(quat);
      m.scale.copy(scl);
      m.userData.roomObjectId = id;
    }

    infos.push({ id, name: displayName, category, group, basePosition });
  };

  if (shellMeshes.length) {
    attachGroup('arch:shell', 'Walls & Floor', 'architecture', shellMeshes, [0, 0, 0]);
  }

  // Sort clusters deterministically by min-X, min-Z so IDs & names are stable across reloads.
  const clusterEntries: Array<{ meshes: T.Mesh[]; box: T.Box3; isRug: boolean }> = [
    ...[...clusters.values()].map(meshes => {
      const box = new T.Box3();
      for (const m of meshes) box.union(meshBoxes.get(m)!);
      return { meshes, box, isRug: false };
    }),
    ...rugMeshes.map(m => ({ meshes: [m], box: meshBoxes.get(m)!.clone(), isRug: true })),
  ];
  clusterEntries.sort((a, b) => (a.box.min.x - b.box.min.x) || (a.box.min.z - b.box.min.z));

  clusterEntries.forEach((entry, idx) => {
    const { name, category } = inferRoomObjectLabel(entry.meshes, entry.box, entry.isRug);
    const center = entry.box.getCenter(new T.Vector3());
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'object';
    attachGroup(`obj:${slug}:${idx}`, name, category, entry.meshes, [center.x, entry.box.min.y, center.z]);
  });

  roomObjectsMap.set(root, infos);
  return infos;
}

export function makeRoom(id: RoomId): T.Group {
  const template = templates.get(id);
  if (!template) throw new Error(`Preset room ${id} has not been loaded`);
  gpuReleased.delete(id);
  const root = cloneRoom(template);
  groupRoomMainObjects(root);
  return root;
}

export function releaseUnusedRooms(ids: readonly RoomId[]): void {
  const active = new Set(ids);
  for (const [id, template] of templates) {
    if (active.has(id) || gpuReleased.has(id)) continue;
    const textures = new Set<T.Texture>();
    template.traverse(node => {
      if (!(node instanceof T.Mesh)) return;
      node.geometry.dispose();
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        for (const value of Object.values(material)) if (value instanceof T.Texture) textures.add(value);
        material.dispose();
      }
    });
    for (const texture of textures) {
      texture.dispose();
    }
    // Keep CPU assets for synchronous Undo/Redo; textures upload again when restored.
    gpuReleased.add(id);
  }
}

const cutawayRaycaster = new T.Raycaster() as T.Raycaster & { firstHitOnly?: boolean };
cutawayRaycaster.firstHitOnly = true;
const cutawayDir = new T.Vector3();
const cutawayNormDir = new T.Vector3();
const cutawayRight = new T.Vector3();
const cutawayProbe = new T.Vector3();
const cutawayUp = new T.Vector3(0, 1, 0);
const cutawayProbes = [
  new T.Vector3(),
  new T.Vector3(),
  new T.Vector3(),
  new T.Vector3(),
  new T.Vector3(),
] as const;
const cutawayHits: T.Intersection[] = [];

interface CutawayMemo {
  enabled: boolean;
  camPos: T.Vector3;
  targetPos: T.Vector3;
  viewDir: T.Vector3;
  rootPos: T.Vector3;
  rootQuat: T.Quaternion;
  rootScale: T.Vector3;
  revision: number;
}
const cutawayMemos = new WeakMap<T.Group, CutawayMemo>();

/** Marks a room's cutaway sightline cache dirty (e.g. after editing sub-object transforms). */
export function invalidateRoomCutaway(root: T.Group): void {
  root.userData.__cutawayRevision = ((root.userData.__cutawayRevision as number | undefined) ?? 0) + 1;
}

const CUTAWAY_POS_THRESHOLD_SQ = 0.02 * 0.02; // 2 cm
const CUTAWAY_VIEW_COS_DELTA = 1 - Math.cos((0.5 * Math.PI) / 180); // 0.5°
const CUTAWAY_QUAT_DOT_DELTA = 1 - Math.cos((0.25 * Math.PI) / 180); // 0.5° rotation

function intersectWallDoubleSided(mesh: T.Mesh): boolean {
  cutawayHits.length = 0;
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const savedSides = materials.map(m => m.side);
  for (const m of materials) m.side = T.DoubleSide;
  try {
    cutawayRaycaster.intersectObject(mesh, false, cutawayHits);
  } finally {
    materials.forEach((m, i) => { m.side = savedSides[i]; });
  }
  return cutawayHits.length > 0;
}

export function updateRoomCutaway(root: T.Group, camera: T.Vector3, target: T.Vector3, enabled: boolean): boolean {
  const parts = shells.get(root);
  if (!parts?.length) return false;

  root.updateMatrixWorld(true);
  cutawayDir.copy(target).sub(camera);
  const centerDist = cutawayDir.length();
  if (centerDist > 1e-6) {
    cutawayNormDir.copy(cutawayDir).divideScalar(centerDist);
  } else {
    cutawayNormDir.set(0, 0, -1);
  }

  const revision = (root.userData.__cutawayRevision as number | undefined) ?? 0;
  const memo = cutawayMemos.get(root);
  if (
    memo &&
    memo.enabled === enabled &&
    memo.revision === revision &&
    camera.distanceToSquared(memo.camPos) <= CUTAWAY_POS_THRESHOLD_SQ &&
    target.distanceToSquared(memo.targetPos) <= CUTAWAY_POS_THRESHOLD_SQ &&
    1 - cutawayNormDir.dot(memo.viewDir) <= CUTAWAY_VIEW_COS_DELTA &&
    root.position.distanceToSquared(memo.rootPos) <= 1e-6 &&
    1 - Math.abs(root.quaternion.dot(memo.rootQuat)) <= CUTAWAY_QUAT_DOT_DELTA &&
    root.scale.distanceToSquared(memo.rootScale) <= 1e-6
  ) {
    return false;
  }

  if (memo) {
    memo.enabled = enabled;
    memo.revision = revision;
    memo.camPos.copy(camera);
    memo.targetPos.copy(target);
    memo.viewDir.copy(cutawayNormDir);
    memo.rootPos.copy(root.position);
    memo.rootQuat.copy(root.quaternion);
    memo.rootScale.copy(root.scale);
  } else {
    cutawayMemos.set(root, {
      enabled,
      revision,
      camPos: camera.clone(),
      targetPos: target.clone(),
      viewDir: cutawayNormDir.clone(),
      rootPos: root.position.clone(),
      rootQuat: root.quaternion.clone(),
      rootScale: root.scale.clone(),
    });
  }

  let visibilityChanged = false;
  if (!enabled) {
    for (const part of parts) {
      if (part.mesh.visible !== part.visible) {
        part.mesh.visible = part.visible;
        visibilityChanged = true;
      }
    }
    return visibilityChanged;
  }

  if (centerDist < 0.05) {
    for (const part of parts) {
      const nextVis = part.visible && !part.ceiling;
      if (part.mesh.visible !== nextVis) {
        part.mesh.visible = nextVis;
        visibilityChanged = true;
      }
    }
    return visibilityChanged;
  }

  cutawayRight.crossVectors(cutawayDir, cutawayUp);
  if (cutawayRight.lengthSq() < 1e-6) cutawayRight.set(1, 0, 0);
  else cutawayRight.normalize();

  cutawayProbes[0].copy(target);
  cutawayProbes[1].copy(target).addScaledVector(cutawayRight, 0.45);
  cutawayProbes[2].copy(target).addScaledVector(cutawayRight, -0.45);
  cutawayProbes[3].copy(target).addScaledVector(cutawayUp, 0.45);
  cutawayProbes[4].copy(target).addScaledVector(cutawayUp, -0.35);

  for (const part of parts) {
    if (!part.visible || part.ceiling) {
      if (part.mesh.visible) {
        part.mesh.visible = false;
        visibilityChanged = true;
      }
      continue;
    }
    let blocked = false;
    for (let i = 0; i < cutawayProbes.length; i++) {
      cutawayProbe.copy(cutawayProbes[i]).sub(camera);
      const dist = cutawayProbe.length();
      if (dist <= 0.05) continue;
      cutawayProbe.divideScalar(dist);
      cutawayRaycaster.set(camera, cutawayProbe);
      cutawayRaycaster.near = 0;
      cutawayRaycaster.far = dist - 0.05;
      if (intersectWallDoubleSided(part.mesh)) {
        blocked = true;
        break;
      }
    }
    const nextVis = !blocked;
    if (part.mesh.visible !== nextVis) {
      part.mesh.visible = nextVis;
      visibilityChanged = true;
    }
  }
  return visibilityChanged;
}
