import * as THREE from 'three';
import { HELPER_LAYER, setLayerRecursive } from '../npr';
import type { ComponentSelection, EditableMeshData, GizmoFrame, ModelingMode, Vec3 } from './types';
import {
  buildHalfEdgeOrAdjacency,
  canonicalEdgeKey,
  computeFaceNormal,
  computeSelectionGizmoFrame,
  createQuadWireframeGeometry,
  selectEdgeRing,
  transformSelectedComponents,
} from './editableMesh';

/* ============================================================================
 * Types & Viewport Geometry Contracts
 * ============================================================================ */

export interface ViewportSizePx {
  width: number;
  height: number;
}

export interface ScreenRectPx {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface LoopCutPreviewSpec {
  edgeIndex: number;
  factor: number;
  cuts?: number;
}

export interface LoopCutPolyline {
  points: Vec3[];
  closed: boolean;
}

export interface OverlayThemeColors {
  wireframe?: number;
  pointUnselected?: number;
  pointSelected?: number;
  pointHovered?: number;
  edgeSelected?: number;
  edgeHovered?: number;
  faceSelected?: number;
  faceHovered?: number;
  loopCutPreview?: number;
}

const DEFAULT_OVERLAY_COLORS: Required<OverlayThemeColors> = {
  wireframe: 0x3a3f4b,
  pointUnselected: 0x2b303a,
  pointSelected: 0xff8a3d,
  pointHovered: 0xffd166,
  edgeSelected: 0xff8a3d,
  edgeHovered: 0xffd166,
  faceSelected: 0xff8a3d,
  faceHovered: 0xffd166,
  loopCutPreview: 0x38bdf8,
};

export interface PickComponentOptions {
  xRay?: boolean;
  pointSnapRadiusPx?: number;
  edgeSnapRadiusPx?: number;
}

export interface PickedMeshComponent {
  kind: 'vertex' | 'edge' | 'face';
  index: number;
  distance: number;
  worldPoint: Vec3;
}

/* ============================================================================
 * Internal Polygon Triangulation & Ray-Triangle Helpers
 * ============================================================================ */

interface MeshTriangleRecord {
  faceIndex: number;
  i0: number;
  i1: number;
  i2: number;
  p0: THREE.Vector3;
  p1: THREE.Vector3;
  p2: THREE.Vector3;
}

function triangulateFaceIndices(vertices: readonly Vec3[], faceVerts: readonly number[]): [number, number, number][] {
  const m = faceVerts.length;
  if (m < 3) return [];
  if (m === 3) return [[faceVerts[0], faceVerts[1], faceVerts[2]]];
  if (m === 4) {
    return [
      [faceVerts[0], faceVerts[1], faceVerts[2]],
      [faceVerts[0], faceVerts[2], faceVerts[3]],
    ];
  }

  // Project n-gon onto dominant plane and ear-clip
  const n = computeFaceNormal(vertices, faceVerts);
  const ax = Math.abs(n[0]);
  const ay = Math.abs(n[1]);
  const az = Math.abs(n[2]);
  const sign = (ax >= ay && ax >= az ? n[0] : ay >= az ? n[1] : n[2]) >= 0 ? 1 : -1;

  const pts2d = faceVerts.map((vi) => {
    const v = vertices[vi];
    if (ax >= ay && ax >= az) return [v[1], v[2] * sign] as const;
    if (ay >= az) return [v[2], v[0] * sign] as const;
    return [v[0], v[1] * sign] as const;
  });

  const rem = faceVerts.map((_, i) => i);
  const tris: [number, number, number][] = [];
  let guard = 0;

  const cross2 = (a: number, b: number, c: number) =>
    (pts2d[b][0] - pts2d[a][0]) * (pts2d[c][1] - pts2d[a][1]) -
    (pts2d[b][1] - pts2d[a][1]) * (pts2d[c][0] - pts2d[a][0]);

  const inTri2 = (p: number, a: number, b: number, c: number) => {
    const c1 = cross2(a, b, p);
    const c2 = cross2(b, c, p);
    const c3 = cross2(c, a, p);
    const neg = c1 < -1e-9 || c2 < -1e-9 || c3 < -1e-9;
    const pos = c1 > 1e-9 || c2 > 1e-9 || c3 > 1e-9;
    return !(neg && pos);
  };

  while (rem.length > 3 && guard < m * m + 8) {
    guard++;
    let clipped = false;
    for (let i = 0; i < rem.length; i++) {
      const prev = rem[(i - 1 + rem.length) % rem.length];
      const curr = rem[i];
      const next = rem[(i + 1) % rem.length];
      if (cross2(prev, curr, next) <= 1e-9) continue;
      let blocked = false;
      for (let j = 0; j < rem.length; j++) {
        const idx = rem[j];
        if (idx === prev || idx === curr || idx === next) continue;
        if (inTri2(idx, prev, curr, next)) {
          blocked = true;
          break;
        }
      }
      if (!blocked) {
        tris.push([faceVerts[prev], faceVerts[curr], faceVerts[next]]);
        rem.splice(i, 1);
        clipped = true;
        break;
      }
    }
    if (!clipped) {
      for (let i = 1; i < rem.length - 1; i++) {
        tris.push([faceVerts[rem[0]], faceVerts[rem[i]], faceVerts[rem[i + 1]]]);
      }
      return tris;
    }
  }

  if (rem.length === 3) {
    tris.push([faceVerts[rem[0]], faceVerts[rem[1]], faceVerts[rem[2]]]);
  }
  return tris;
}

function buildWorldTriangles(mesh: EditableMeshData, worldMatrix: THREE.Matrix4): {
  worldVerts: THREE.Vector3[];
  triangles: MeshTriangleRecord[];
} {
  const worldVerts = mesh.vertices.map((v) => new THREE.Vector3(v[0], v[1], v[2]).applyMatrix4(worldMatrix));
  const triangles: MeshTriangleRecord[] = [];
  for (let fi = 0; fi < mesh.faces.length; fi++) {
    const fv = mesh.faces[fi].verts;
    const tris = triangulateFaceIndices(mesh.vertices, fv);
    for (const [i0, i1, i2] of tris) {
      triangles.push({
        faceIndex: fi,
        i0,
        i1,
        i2,
        p0: worldVerts[i0],
        p1: worldVerts[i1],
        p2: worldVerts[i2],
      });
    }
  }
  return { worldVerts, triangles };
}

/**
 * Möller–Trumbore ray-triangle intersection (both sides tested so open sheets & flipped faces also occlude/pick cleanly).
 */
function intersectRayTriangle(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  p0: THREE.Vector3,
  p1: THREE.Vector3,
  p2: THREE.Vector3,
): number | null {
  const e1x = p1.x - p0.x;
  const e1y = p1.y - p0.y;
  const e1z = p1.z - p0.z;
  const e2x = p2.x - p0.x;
  const e2y = p2.y - p0.y;
  const e2z = p2.z - p0.z;

  const hx = dir.y * e2z - dir.z * e2y;
  const hy = dir.z * e2x - dir.x * e2z;
  const hz = dir.x * e2y - dir.y * e2x;

  const a = e1x * hx + e1y * hy + e1z * hz;
  if (Math.abs(a) < 1e-10) return null;

  const f = 1 / a;
  const sx = origin.x - p0.x;
  const sy = origin.y - p0.y;
  const sz = origin.z - p0.z;

  const u = f * (sx * hx + sy * hy + sz * hz);
  if (u < -1e-6 || u > 1 + 1e-6) return null;

  const qx = sy * e1z - sz * e1y;
  const qy = sz * e1x - sx * e1z;
  const qz = sx * e1y - sy * e1x;

  const v = f * (dir.x * qx + dir.y * qy + dir.z * qz);
  if (v < -1e-6 || u + v > 1 + 1e-6) return null;

  const t = f * (e2x * qx + e2y * qy + e2z * qz);
  return t > 1e-6 ? t : null;
}

function isWorldPointOccluded(
  cameraOrigin: THREE.Vector3,
  targetWorldPos: THREE.Vector3,
  triangles: readonly MeshTriangleRecord[],
  ignoredFaces: ReadonlySet<number>,
): boolean {
  const delta = new THREE.Vector3().subVectors(targetWorldPos, cameraOrigin);
  const dist = delta.length();
  if (dist < 1e-6) return false;
  const dir = delta.multiplyScalar(1 / dist);
  const maxOccluderT = dist - Math.max(1e-4, dist * 1e-4);

  for (let i = 0; i < triangles.length; i++) {
    const tri = triangles[i];
    if (ignoredFaces.has(tri.faceIndex)) continue;
    const t = intersectRayTriangle(cameraOrigin, dir, tri.p0, tri.p1, tri.p2);
    if (t !== null && t < maxOccluderT) {
      return true;
    }
  }
  return false;
}

function projectWorldToScreenPx(
  worldPos: THREE.Vector3,
  camera: THREE.Camera,
  viewport: ViewportSizePx,
): { x: number; y: number; ndcZ: number } | null {
  const v = worldPos.clone().project(camera);
  if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z)) return null;
  if (v.z < -1 || v.z > 1) return null;
  return {
    x: (v.x * 0.5 + 0.5) * viewport.width,
    y: (-v.y * 0.5 + 0.5) * viewport.height,
    ndcZ: v.z,
  };
}

function getCameraRayOrigin(camera: THREE.Camera, fallbackRayOrigin: THREE.Vector3): THREE.Vector3 {
  camera.updateMatrixWorld();
  const pos = new THREE.Vector3();
  pos.setFromMatrixPosition(camera.matrixWorld);
  if (pos.lengthSq() === 0 && fallbackRayOrigin.lengthSq() > 0) {
    return fallbackRayOrigin.clone();
  }
  return pos;
}

/* ============================================================================
 * Loop Cut Live Preview Polyline Builder (`computeLoopCutPreviewPolyline`)
 * ============================================================================ */

/**
 * Computes live 3D polylines in mesh-local space for Cinema 4D's Loop / Path Cut (`K`) tool
 * as the user hovers over any quad edge in Edge Mode!
 */
export function computeLoopCutPreviewPolyline(
  mesh: EditableMeshData,
  edgeIndex: number,
  factor = 0.5,
  cuts = 1,
): LoopCutPolyline[] {
  const adj = buildHalfEdgeOrAdjacency(mesh);
  if (edgeIndex < 0 || edgeIndex >= adj.edges.length) return [];

  const ringEdges = selectEdgeRing(mesh, edgeIndex);
  if (ringEdges.length === 0) return [];
  const ringSet = new Set<number>(ringEdges);

  // Order the ring edges by walking across shared quad faces starting from `edgeIndex`
  const orderedQuads: number[] = [];
  const quadEdges = new Map<number, [number, number]>();

  for (let fi = 0; fi < mesh.faces.length; fi++) {
    const fv = mesh.faces[fi].verts;
    if (fv.length !== 4) continue;
    const e0 = adj.edgeKeyToIndex.get(canonicalEdgeKey(fv[0], fv[1]))!;
    const e1 = adj.edgeKeyToIndex.get(canonicalEdgeKey(fv[1], fv[2]))!;
    const e2 = adj.edgeKeyToIndex.get(canonicalEdgeKey(fv[2], fv[3]))!;
    const e3 = adj.edgeKeyToIndex.get(canonicalEdgeKey(fv[3], fv[0]))!;
    if (ringSet.has(e0) && ringSet.has(e2)) {
      quadEdges.set(fi, [e0, e2]);
    } else if (ringSet.has(e1) && ringSet.has(e3)) {
      quadEdges.set(fi, [e1, e3]);
    }
  }

  if (quadEdges.size === 0) {
    // Fallback single edge midpoint marker segment if face isn't a quad
    const e = adj.edges[edgeIndex];
    const t = Math.min(0.99, Math.max(0.01, factor));
    const pa = mesh.vertices[e.a];
    const pb = mesh.vertices[e.b];
    const mid: Vec3 = [
      pa[0] + (pb[0] - pa[0]) * t,
      pa[1] + (pb[1] - pa[1]) * t,
      pa[2] + (pb[2] - pa[2]) * t,
    ];
    return [{ points: [mid], closed: false }];
  }

  // Traverse connected quad chain(s) along ring edges
  const visitedQuads = new Set<number>();
  const startFaces = adj.edges[edgeIndex].faces.filter((fi) => quadEdges.has(fi));
  let closed = false;

  if (startFaces.length > 0) {
    const firstQuad = startFaces[0];
    // Walk forward from `edgeIndex` across `firstQuad`
    const forwardEdges: number[] = [edgeIndex];
    let currEdge = edgeIndex;
    let currQuad: number | undefined = firstQuad;

    while (currQuad !== undefined && !visitedQuads.has(currQuad)) {
      visitedQuads.add(currQuad);
      orderedQuads.push(currQuad);
      const pair = quadEdges.get(currQuad)!;
      const nextEdge = pair[0] === currEdge ? pair[1] : pair[0];
      if (nextEdge === edgeIndex) {
        closed = true;
        break;
      }
      forwardEdges.push(nextEdge);
      currEdge = nextEdge;
      currQuad = adj.edges[currEdge].faces.find((fi) => quadEdges.has(fi) && !visitedQuads.has(fi));
    }

    // If open strip, also walk backward from `edgeIndex`
    if (!closed && startFaces.length > 1 && !visitedQuads.has(startFaces[1])) {
      let backEdge = edgeIndex;
      let backQuad: number | undefined = startFaces[1];
      const prependEdges: number[] = [];
      while (backQuad !== undefined && !visitedQuads.has(backQuad)) {
        visitedQuads.add(backQuad);
        const pair = quadEdges.get(backQuad)!;
        const prevEdge = pair[0] === backEdge ? pair[1] : pair[0];
        prependEdges.unshift(prevEdge);
        backEdge = prevEdge;
        backQuad = adj.edges[backEdge].faces.find((fi) => quadEdges.has(fi) && !visitedQuads.has(fi));
      }
      forwardEdges.unshift(...prependEdges);
    }

    // Assign consistent orientation `(u_k -> v_k)` across consecutive ring edges so `t` stays on the same side!
    const orientedEndpoints: [number, number][] = [];
    const eFirst = adj.edges[forwardEdges[0]];
    orientedEndpoints.push([eFirst.a, eFirst.b]);

    for (let i = 1; i < forwardEdges.length; i++) {
      const prevPair = orientedEndpoints[i - 1];
      const prevEdgeIdx = forwardEdges[i - 1];
      const nextEdgeIdx = forwardEdges[i];
      const eNext = adj.edges[nextEdgeIdx];
      // Find the quad shared by `prevEdgeIdx` and `nextEdgeIdx`
      const sharedQuad = adj.edges[prevEdgeIdx].faces.find(
        (fi) => quadEdges.has(fi) && adj.edges[nextEdgeIdx].faces.includes(fi),
      );
      if (sharedQuad !== undefined) {
        const fv = mesh.faces[sharedQuad].verts;
        // In quad `[v0, v1, v2, v3]`, if `prevPair` is `(v0, v1)`, opposite edge in same side order is `(v3, v2)`!
        const idxU = fv.indexOf(prevPair[0]);
        const idxV = fv.indexOf(prevPair[1]);
        if (idxU !== -1 && idxV !== -1) {
          // Determine the other two quad vertices: the one adjacent to `prevPair[0]` goes first!
          const adjToU = fv.find((vx) => vx !== prevPair[0] && vx !== prevPair[1] && adj.edgeKeyToIndex.has(canonicalEdgeKey(prevPair[0], vx)));
          const adjToV = fv.find((vx) => vx !== prevPair[0] && vx !== prevPair[1] && vx !== adjToU);
          if (adjToU !== undefined && adjToV !== undefined) {
            orientedEndpoints.push([adjToU, adjToV]);
            continue;
          }
        }
      }
      orientedEndpoints.push([eNext.a, eNext.b]);
    }

    // Anchor `factor` specifically to `edgeIndex`'s canonical `(a -> b)` orientation
    const refPos = forwardEdges.indexOf(edgeIndex);
    const refAligned =
      refPos === -1 ||
      (orientedEndpoints[refPos][0] === adj.edges[edgeIndex].a &&
        orientedEndpoints[refPos][1] === adj.edges[edgeIndex].b);

    const numCuts = Math.max(1, Math.min(32, Math.round(cuts)));
    const tList: number[] = [];
    if (numCuts === 1) {
      const clamped = Math.min(0.99, Math.max(0.01, factor));
      tList.push(refAligned ? clamped : 1 - clamped);
    } else {
      for (let c = 1; c <= numCuts; c++) {
        tList.push(c / (numCuts + 1));
      }
    }

    return tList.map((tVal) => {
      const points: Vec3[] = orientedEndpoints.map(([u, v]) => {
        const pu = mesh.vertices[u];
        const pv = mesh.vertices[v];
        return [
          pu[0] + (pv[0] - pu[0]) * tVal,
          pu[1] + (pv[1] - pu[1]) * tVal,
          pu[2] + (pv[2] - pu[2]) * tVal,
        ];
      });
      if (closed && points.length >= 2) {
        points.push([...points[0]]);
      }
      return { points, closed };
    });
  }

  return [];
}

/* ============================================================================
 * Three.js Point / Edge / Polygon Viewport Overlay (`EditableComponentOverlay`)
 * ============================================================================ */

export interface EditableOverlayUpdateParams {
  mesh: EditableMeshData;
  mode: ModelingMode;
  selection: ComponentSelection;
  hoveredIndex?: number | null;
  xRay?: boolean;
  showWireframeInObjectMode?: boolean;
  loopCutPreview?: LoopCutPreviewSpec | null;
  colors?: OverlayThemeColors;
}

function buildSelectedEdgesGeometry(mesh: EditableMeshData, edgeIndices: readonly number[]): THREE.BufferGeometry {
  const adj = buildHalfEdgeOrAdjacency(mesh);
  const positions: number[] = [];
  for (const ei of edgeIndices) {
    if (ei < 0 || ei >= adj.edges.length) continue;
    const e = adj.edges[ei];
    const pa = mesh.vertices[e.a];
    const pb = mesh.vertices[e.b];
    positions.push(pa[0], pa[1], pa[2], pb[0], pb[1], pb[2]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geo;
}

function buildVerticesPointsGeometry(mesh: EditableMeshData, vertexIndices: readonly number[]): THREE.BufferGeometry {
  const positions: number[] = [];
  for (const vi of vertexIndices) {
    if (vi < 0 || vi >= mesh.vertices.length) continue;
    const p = mesh.vertices[vi];
    positions.push(p[0], p[1], p[2]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geo;
}

function buildFacesHighlightGeometry(mesh: EditableMeshData, faceIndices: readonly number[]): {
  surfaceGeo: THREE.BufferGeometry;
  outlineGeo: THREE.BufferGeometry;
} {
  const triPositions: number[] = [];
  const outlinePositions: number[] = [];

  for (const fi of faceIndices) {
    if (fi < 0 || fi >= mesh.faces.length) continue;
    const fv = mesh.faces[fi].verts;
    const tris = triangulateFaceIndices(mesh.vertices, fv);
    for (const [i0, i1, i2] of tris) {
      const p0 = mesh.vertices[i0];
      const p1 = mesh.vertices[i1];
      const p2 = mesh.vertices[i2];
      triPositions.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2]);
    }
    for (let k = 0; k < fv.length; k++) {
      const pa = mesh.vertices[fv[k]];
      const pb = mesh.vertices[fv[(k + 1) % fv.length]];
      outlinePositions.push(pa[0], pa[1], pa[2], pb[0], pb[1], pb[2]);
    }
  }

  const surfaceGeo = new THREE.BufferGeometry();
  surfaceGeo.setAttribute('position', new THREE.Float32BufferAttribute(triPositions, 3));
  if (triPositions.length > 0) surfaceGeo.computeVertexNormals();

  const outlineGeo = new THREE.BufferGeometry();
  outlineGeo.setAttribute('position', new THREE.Float32BufferAttribute(outlinePositions, 3));

  return { surfaceGeo, outlineGeo };
}

function buildPolylinesGeometry(polylines: readonly LoopCutPolyline[]): THREE.BufferGeometry {
  const positions: number[] = [];
  for (const line of polylines) {
    for (let i = 0; i < line.points.length - 1; i++) {
      const a = line.points[i];
      const b = line.points[i + 1];
      positions.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geo;
}

/**
 * Lightweight, disposable Three.js overlay group (`HELPER_LAYER`) rendering Cinema 4D's
 * quad wireframe cage, Point handles, Edge highlights + Loop Cut preview ring, and Polygon face tints.
 */
export class EditableComponentOverlay {
  readonly group: THREE.Group;

  private wireframeLines: THREE.LineSegments;
  private unselectedPoints: THREE.Points;
  private selectedPoints: THREE.Points;
  private hoveredPoints: THREE.Points;
  private selectedEdgeLines: THREE.LineSegments;
  private hoveredEdgeLines: THREE.LineSegments;
  private loopCutLines: THREE.LineSegments;
  private selectedFaceMesh: THREE.Mesh;
  private selectedFaceOutline: THREE.LineSegments;
  private hoveredFaceMesh: THREE.Mesh;

  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'C4DEditableComponentOverlay';
    this.group.matrixAutoUpdate = false;

    this.wireframeLines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: DEFAULT_OVERLAY_COLORS.wireframe,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }),
    );
    this.wireframeLines.renderOrder = 21;

    this.unselectedPoints = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({
        color: DEFAULT_OVERLAY_COLORS.pointUnselected,
        size: 5.5,
        sizeAttenuation: false,
        depthWrite: false,
      }),
    );
    this.unselectedPoints.renderOrder = 24;

    this.selectedPoints = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({
        color: DEFAULT_OVERLAY_COLORS.pointSelected,
        size: 8.5,
        sizeAttenuation: false,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.selectedPoints.renderOrder = 26;

    this.hoveredPoints = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({
        color: DEFAULT_OVERLAY_COLORS.pointHovered,
        size: 10,
        sizeAttenuation: false,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.hoveredPoints.renderOrder = 27;

    this.selectedEdgeLines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: DEFAULT_OVERLAY_COLORS.edgeSelected,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.selectedEdgeLines.renderOrder = 25;

    this.hoveredEdgeLines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: DEFAULT_OVERLAY_COLORS.edgeHovered,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.hoveredEdgeLines.renderOrder = 26;

    this.loopCutLines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: DEFAULT_OVERLAY_COLORS.loopCutPreview,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.loopCutLines.renderOrder = 27;

    this.selectedFaceMesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: DEFAULT_OVERLAY_COLORS.faceSelected,
        transparent: true,
        opacity: 0.34,
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    this.selectedFaceMesh.renderOrder = 22;

    this.selectedFaceOutline = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: DEFAULT_OVERLAY_COLORS.faceSelected,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.selectedFaceOutline.renderOrder = 24;

    this.hoveredFaceMesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: DEFAULT_OVERLAY_COLORS.faceHovered,
        transparent: true,
        opacity: 0.24,
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      }),
    );
    this.hoveredFaceMesh.renderOrder = 23;

    this.group.add(
      this.wireframeLines,
      this.selectedFaceMesh,
      this.hoveredFaceMesh,
      this.selectedFaceOutline,
      this.unselectedPoints,
      this.selectedEdgeLines,
      this.hoveredEdgeLines,
      this.loopCutLines,
      this.selectedPoints,
      this.hoveredPoints,
    );

    setLayerRecursive(this.group, HELPER_LAYER);
  }

  syncTransform(worldMatrix: THREE.Matrix4): void {
    this.group.matrix.copy(worldMatrix);
    this.group.matrixWorldNeedsUpdate = true;
  }

  private replaceGeometry(target: { geometry: THREE.BufferGeometry }, nextGeo: THREE.BufferGeometry): void {
    target.geometry.dispose();
    target.geometry = nextGeo;
  }

  update(params: EditableOverlayUpdateParams): void {
    const {
      mesh,
      mode,
      selection,
      hoveredIndex = null,
      xRay = false,
      showWireframeInObjectMode = false,
      loopCutPreview = null,
      colors,
    } = params;

    const palette = { ...DEFAULT_OVERLAY_COLORS, ...colors };
    const isComponentMode = mode === 'point' || mode === 'edge' || mode === 'polygon';

    // Apply palette colors & xRay depth state
    const wireMat = this.wireframeLines.material as THREE.LineBasicMaterial;
    wireMat.color.setHex(palette.wireframe);
    wireMat.depthTest = !xRay;

    (this.unselectedPoints.material as THREE.PointsMaterial).color.setHex(palette.pointUnselected);
    (this.unselectedPoints.material as THREE.PointsMaterial).depthTest = !xRay;
    (this.selectedPoints.material as THREE.PointsMaterial).color.setHex(palette.pointSelected);
    (this.hoveredPoints.material as THREE.PointsMaterial).color.setHex(palette.pointHovered);

    (this.selectedEdgeLines.material as THREE.LineBasicMaterial).color.setHex(palette.edgeSelected);
    (this.hoveredEdgeLines.material as THREE.LineBasicMaterial).color.setHex(palette.edgeHovered);
    (this.loopCutLines.material as THREE.LineBasicMaterial).color.setHex(palette.loopCutPreview);

    (this.selectedFaceMesh.material as THREE.MeshBasicMaterial).color.setHex(palette.faceSelected);
    (this.selectedFaceMesh.material as THREE.MeshBasicMaterial).depthTest = !xRay;
    (this.selectedFaceOutline.material as THREE.LineBasicMaterial).color.setHex(palette.faceSelected);
    (this.hoveredFaceMesh.material as THREE.MeshBasicMaterial).color.setHex(palette.faceHovered);
    (this.hoveredFaceMesh.material as THREE.MeshBasicMaterial).depthTest = !xRay;

    // 1. Quad wireframe cage (true polygon edges, never triangulated diagonals!)
    const showWireframe = isComponentMode || showWireframeInObjectMode;
    this.wireframeLines.visible = showWireframe;
    if (showWireframe) {
      this.replaceGeometry(this.wireframeLines, createQuadWireframeGeometry(mesh));
    }

    // 2. Point mode handles
    this.unselectedPoints.visible = mode === 'point';
    this.selectedPoints.visible = mode === 'point' && selection.vertices.length > 0;
    this.hoveredPoints.visible = mode === 'point' && hoveredIndex !== null && hoveredIndex >= 0;

    if (mode === 'point') {
      const selSet = new Set(selection.vertices);
      const unsel: number[] = [];
      for (let vi = 0; vi < mesh.vertices.length; vi++) {
        if (!selSet.has(vi) && vi !== hoveredIndex) unsel.push(vi);
      }
      this.replaceGeometry(this.unselectedPoints, buildVerticesPointsGeometry(mesh, unsel));
      this.replaceGeometry(this.selectedPoints, buildVerticesPointsGeometry(mesh, selection.vertices));
      this.replaceGeometry(
        this.hoveredPoints,
        buildVerticesPointsGeometry(mesh, hoveredIndex !== null && hoveredIndex >= 0 ? [hoveredIndex] : []),
      );
    }

    // 3. Edge mode highlights + Loop Cut preview
    this.selectedEdgeLines.visible = mode === 'edge' && selection.edges.length > 0;
    this.hoveredEdgeLines.visible = mode === 'edge' && hoveredIndex !== null && hoveredIndex >= 0;
    this.loopCutLines.visible = mode === 'edge' && loopCutPreview !== null;

    if (mode === 'edge') {
      this.replaceGeometry(this.selectedEdgeLines, buildSelectedEdgesGeometry(mesh, selection.edges));
      this.replaceGeometry(
        this.hoveredEdgeLines,
        buildSelectedEdgesGeometry(mesh, hoveredIndex !== null && hoveredIndex >= 0 ? [hoveredIndex] : []),
      );
      if (loopCutPreview) {
        const polylines = computeLoopCutPreviewPolyline(
          mesh,
          loopCutPreview.edgeIndex,
          loopCutPreview.factor,
          loopCutPreview.cuts ?? 1,
        );
        this.replaceGeometry(this.loopCutLines, buildPolylinesGeometry(polylines));
      }
    }

    // 4. Polygon mode face overlays
    this.selectedFaceMesh.visible = mode === 'polygon' && selection.faces.length > 0;
    this.selectedFaceOutline.visible = mode === 'polygon' && selection.faces.length > 0;
    this.hoveredFaceMesh.visible = mode === 'polygon' && hoveredIndex !== null && hoveredIndex >= 0;

    if (mode === 'polygon') {
      const selHighlight = buildFacesHighlightGeometry(mesh, selection.faces);
      this.replaceGeometry(this.selectedFaceMesh, selHighlight.surfaceGeo);
      this.replaceGeometry(this.selectedFaceOutline, selHighlight.outlineGeo);

      const hovHighlight = buildFacesHighlightGeometry(
        mesh,
        hoveredIndex !== null && hoveredIndex >= 0 && !selection.faces.includes(hoveredIndex)
          ? [hoveredIndex]
          : [],
      );
      hovHighlight.outlineGeo.dispose();
      this.replaceGeometry(this.hoveredFaceMesh, hovHighlight.surfaceGeo);
    }

    setLayerRecursive(this.group, HELPER_LAYER);
  }

  dispose(): void {
    const disposables: (THREE.Mesh | THREE.LineSegments | THREE.Points)[] = [
      this.wireframeLines,
      this.unselectedPoints,
      this.selectedPoints,
      this.hoveredPoints,
      this.selectedEdgeLines,
      this.hoveredEdgeLines,
      this.loopCutLines,
      this.selectedFaceMesh,
      this.selectedFaceOutline,
      this.hoveredFaceMesh,
    ];
    for (const obj of disposables) {
      obj.geometry.dispose();
      if (Array.isArray(obj.material)) {
        obj.material.forEach((m) => m.dispose());
      } else {
        obj.material.dispose();
      }
    }
    this.group.clear();
  }
}

export function createEditableComponentOverlay(): EditableComponentOverlay {
  return new EditableComponentOverlay();
}

/* ============================================================================
 * Depth-Aware Component Picking (`pickMeshComponent`) & Marquee Selection
 * ============================================================================ */

function distPointToSegment2D(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { distPx: number; t: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-8) {
    return { distPx: Math.hypot(px - ax, py - ay), t: 0 };
  }
  const t = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const cx = ax + dx * t;
  const cy = ay + dy * t;
  return { distPx: Math.hypot(px - cx, py - cy), t };
}

/**
 * Picks the closest visible Vertex (`point`), Quad/Polygon Edge (`edge`), or Quad/N-gon Face (`polygon`)
 * under `raycaster`, automatically rejecting back-side occluded vertices/edges unless `options.xRay` is true!
 */
export function pickMeshComponent(
  raycaster: THREE.Raycaster,
  camera: THREE.Camera,
  viewportSizePx: ViewportSizePx,
  worldMatrix: THREE.Matrix4,
  mesh: EditableMeshData,
  mode: ModelingMode,
  options?: PickComponentOptions,
): PickedMeshComponent | null {
  if (mode === 'object' || mesh.vertices.length === 0) return null;

  camera.updateMatrixWorld();
  const xRay = options?.xRay ?? false;
  const pointSnapPx = options?.pointSnapRadiusPx ?? 12;
  const edgeSnapPx = options?.edgeSnapRadiusPx ?? 10;

  const { worldVerts, triangles } = buildWorldTriangles(mesh, worldMatrix);
  const rayOrigin = raycaster.ray.origin;
  const rayDir = raycaster.ray.direction;

  // 1. Polygon / Face mode: exact Möller–Trumbore raycast returning closest hit face
  if (mode === 'polygon') {
    let bestT = Infinity;
    let bestFace = -1;
    for (let i = 0; i < triangles.length; i++) {
      const tri = triangles[i];
      const t = intersectRayTriangle(rayOrigin, rayDir, tri.p0, tri.p1, tri.p2);
      if (t !== null && t < bestT) {
        bestT = t;
        bestFace = tri.faceIndex;
      }
    }
    if (bestFace === -1) return null;
    const hitPt = rayOrigin.clone().addScaledVector(rayDir, bestT);
    return {
      kind: 'face',
      index: bestFace,
      distance: bestT,
      worldPoint: [hitPt.x, hitPt.y, hitPt.z],
    };
  }

  // Compute cursor screen pixel from a point 1 unit along `raycaster.ray`
  const sampleAlongRay = rayOrigin.clone().add(rayDir);
  const cursorScreen = projectWorldToScreenPx(sampleAlongRay, camera, viewportSizePx);
  if (!cursorScreen) return null;

  const cameraOrigin = getCameraRayOrigin(camera, rayOrigin);
  const adj = buildHalfEdgeOrAdjacency(mesh);

  // 2. Point / Vertex mode
  if (mode === 'point') {
    let bestVi = -1;
    let bestScreenDist = pointSnapPx;
    let bestCamDist = Infinity;

    for (let vi = 0; vi < worldVerts.length; vi++) {
      const wPos = worldVerts[vi];
      const scr = projectWorldToScreenPx(wPos, camera, viewportSizePx);
      if (!scr) continue;
      const dPx = Math.hypot(scr.x - cursorScreen.x, scr.y - cursorScreen.y);
      if (dPx > pointSnapPx) continue;

      if (!xRay) {
        const incidentFaces = new Set(adj.vertexFaces[vi] ?? []);
        if (isWorldPointOccluded(cameraOrigin, wPos, triangles, incidentFaces)) {
          continue;
        }
      }

      const camDist = cameraOrigin.distanceTo(wPos);
      // Prefer significantly closer pixel hit, or closer to camera on ties
      if (
        bestVi === -1 ||
        dPx < bestScreenDist - 1.5 ||
        (Math.abs(dPx - bestScreenDist) <= 1.5 && camDist < bestCamDist)
      ) {
        bestVi = vi;
        bestScreenDist = dPx;
        bestCamDist = camDist;
      }
    }

    if (bestVi === -1) return null;
    const wp = worldVerts[bestVi];
    return {
      kind: 'vertex',
      index: bestVi,
      distance: bestCamDist,
      worldPoint: [wp.x, wp.y, wp.z],
    };
  }

  // 3. Edge mode
  if (mode === 'edge') {
    let bestEi = -1;
    let bestScreenDist = edgeSnapPx;
    let bestCamDist = Infinity;
    let bestWorldPoint: Vec3 = [0, 0, 0];

    for (let ei = 0; ei < adj.edges.length; ei++) {
      const e = adj.edges[ei];
      const wa = worldVerts[e.a];
      const wb = worldVerts[e.b];
      const sa = projectWorldToScreenPx(wa, camera, viewportSizePx);
      const sb = projectWorldToScreenPx(wb, camera, viewportSizePx);
      if (!sa || !sb) continue;

      const { distPx, t } = distPointToSegment2D(
        cursorScreen.x,
        cursorScreen.y,
        sa.x,
        sa.y,
        sb.x,
        sb.y,
      );
      if (distPx > edgeSnapPx) continue;

      const worldOnEdge = new THREE.Vector3().lerpVectors(wa, wb, t);

      if (!xRay) {
        const ignoredFaces = new Set<number>(e.faces);
        if (t < 0.15) {
          for (const fi of adj.vertexFaces[e.a] ?? []) ignoredFaces.add(fi);
        } else if (t > 0.85) {
          for (const fi of adj.vertexFaces[e.b] ?? []) ignoredFaces.add(fi);
        }
        if (isWorldPointOccluded(cameraOrigin, worldOnEdge, triangles, ignoredFaces)) {
          continue;
        }
      }

      const camDist = cameraOrigin.distanceTo(worldOnEdge);
      if (
        bestEi === -1 ||
        distPx < bestScreenDist - 1.5 ||
        (Math.abs(distPx - bestScreenDist) <= 1.5 && camDist < bestCamDist)
      ) {
        bestEi = ei;
        bestScreenDist = distPx;
        bestCamDist = camDist;
        bestWorldPoint = [worldOnEdge.x, worldOnEdge.y, worldOnEdge.z];
      }
    }

    if (bestEi === -1) return null;
    return {
      kind: 'edge',
      index: bestEi,
      distance: bestCamDist,
      worldPoint: bestWorldPoint,
    };
  }

  return null;
}

/**
 * Marquee rectangle selection for Vertices, Edges, or Faces in screen pixel coordinates.
 * Respects Cinema 4D's "Only Select Visible Elements" (`!xRay`) occlusion rule!
 */
export function marqueeSelectMeshComponents(
  rectPx: ScreenRectPx,
  camera: THREE.Camera,
  viewportSizePx: ViewportSizePx,
  worldMatrix: THREE.Matrix4,
  mesh: EditableMeshData,
  mode: ModelingMode,
  xRay = false,
): number[] {
  if (mode === 'object' || mesh.vertices.length === 0) return [];

  camera.updateMatrixWorld();
  const minX = Math.min(rectPx.x0, rectPx.x1);
  const maxX = Math.max(rectPx.x0, rectPx.x1);
  const minY = Math.min(rectPx.y0, rectPx.y1);
  const maxY = Math.max(rectPx.y0, rectPx.y1);

  const inRect = (pt: { x: number; y: number } | null): boolean =>
    pt !== null && pt.x >= minX && pt.x <= maxX && pt.y >= minY && pt.y <= maxY;

  const { worldVerts, triangles } = buildWorldTriangles(mesh, worldMatrix);
  const cameraOrigin = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  const adj = buildHalfEdgeOrAdjacency(mesh);

  if (mode === 'point') {
    const hits: number[] = [];
    for (let vi = 0; vi < worldVerts.length; vi++) {
      const wPos = worldVerts[vi];
      if (!inRect(projectWorldToScreenPx(wPos, camera, viewportSizePx))) continue;
      if (!xRay) {
        const incidentFaces = new Set(adj.vertexFaces[vi] ?? []);
        if (isWorldPointOccluded(cameraOrigin, wPos, triangles, incidentFaces)) continue;
      }
      hits.push(vi);
    }
    return hits;
  }

  if (mode === 'edge') {
    const hits: number[] = [];
    for (let ei = 0; ei < adj.edges.length; ei++) {
      const e = adj.edges[ei];
      const wa = worldVerts[e.a];
      const wb = worldVerts[e.b];
      const mid = new THREE.Vector3().addVectors(wa, wb).multiplyScalar(0.5);
      // Match edge if its midpoint OR both endpoints lie inside the marquee rectangle
      const midIn = inRect(projectWorldToScreenPx(mid, camera, viewportSizePx));
      const endsIn =
        inRect(projectWorldToScreenPx(wa, camera, viewportSizePx)) &&
        inRect(projectWorldToScreenPx(wb, camera, viewportSizePx));
      if (!midIn && !endsIn) continue;

      if (!xRay) {
        const ignoredFaces = new Set<number>(e.faces);
        if (isWorldPointOccluded(cameraOrigin, mid, triangles, ignoredFaces)) continue;
      }
      hits.push(ei);
    }
    return hits;
  }

  if (mode === 'polygon') {
    const hits: number[] = [];
    for (let fi = 0; fi < mesh.faces.length; fi++) {
      const fv = mesh.faces[fi].verts;
      if (fv.length < 3) continue;
      const centroid = new THREE.Vector3();
      for (const vi of fv) centroid.add(worldVerts[vi]);
      centroid.multiplyScalar(1 / fv.length);

      if (!inRect(projectWorldToScreenPx(centroid, camera, viewportSizePx))) continue;
      if (!xRay) {
        const ignored = new Set<number>([fi]);
        if (isWorldPointOccluded(cameraOrigin, centroid, triangles, ignored)) continue;
      }
      hits.push(fi);
    }
    return hits;
  }

  return [];
}

/* ============================================================================
 * Selection Gizmo Proxy Helper (`TransformControls` <-> `EditableMeshData`)
 * ============================================================================ */

export interface WorldSelectionGizmoPlacement {
  hasSelection: boolean;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  localFrame: GizmoFrame;
}

function hasAnySelectedComponent(selection: ComponentSelection): boolean {
  if (selection.mode === 'point') return selection.vertices.length > 0;
  if (selection.mode === 'edge') return selection.edges.length > 0;
  if (selection.mode === 'polygon') return selection.faces.length > 0;
  return false;
}

/**
 * Computes world-space `position` and `quaternion` (`'world'` axis-aligned or `'local'` averaged normal frame)
 * for attaching Three.js `TransformControls` to the active Point / Edge / Polygon selection!
 */
export function computeWorldSelectionGizmoPlacement(
  mesh: EditableMeshData,
  selection: ComponentSelection,
  worldMatrix: THREE.Matrix4,
  coordSpace: 'world' | 'local' = 'local',
): WorldSelectionGizmoPlacement {
  const localFrame = computeSelectionGizmoFrame(mesh, selection);
  const hasSelection = hasAnySelectedComponent(selection);

  const position = new THREE.Vector3(
    localFrame.origin[0],
    localFrame.origin[1],
    localFrame.origin[2],
  ).applyMatrix4(worldMatrix);

  const quaternion = new THREE.Quaternion();
  if (coordSpace === 'local' && hasSelection) {
    const normalMat = new THREE.Matrix3().getNormalMatrix(worldMatrix);
    const xAxis = new THREE.Vector3(...localFrame.tangent).applyMatrix3(normalMat).normalize();
    const zAxis = new THREE.Vector3(...localFrame.normal).applyMatrix3(normalMat).normalize();
    // Keep right-handed orthonormal basis: X = tangent, Y = bitangent, Z = normal (or Y = normal!)
    // In Three.js / Cinema 4D modeling gizmos, Y-axis (green) or Z-axis (blue) along normal:
    // Using Z = normal, X = tangent, Y = Z x X gives standard local surface frame!
    let yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis);
    if (yAxis.lengthSq() < 1e-8) {
      xAxis.set(1, 0, 0);
      if (Math.abs(zAxis.dot(xAxis)) > 0.9) xAxis.set(0, 1, 0);
      yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis);
    }
    yAxis.normalize();
    xAxis.crossVectors(yAxis, zAxis).normalize();

    const rotBasis = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
    quaternion.setFromRotationMatrix(rotBasis);
  }

  return {
    hasSelection,
    position,
    quaternion,
    localFrame,
  };
}

/**
 * Converts a `TransformControls` proxy object's world-matrix delta (`startProxyWorldMatrix -> currentProxyWorldMatrix`)
 * into an exact, drift-free mesh-local `Matrix4` transform on the selected components of `baseMesh`!
 */
export function applyProxyDeltaToEditableMesh(
  baseMesh: EditableMeshData,
  selection: ComponentSelection,
  meshWorldMatrix: THREE.Matrix4,
  startProxyWorldMatrix: THREE.Matrix4,
  currentProxyWorldMatrix: THREE.Matrix4,
): EditableMeshData {
  const startInv = startProxyWorldMatrix.clone().invert();
  const deltaWorld = new THREE.Matrix4().multiplyMatrices(currentProxyWorldMatrix, startInv);

  const meshWorldInv = meshWorldMatrix.clone().invert();
  const deltaLocal = new THREE.Matrix4()
    .multiplyMatrices(meshWorldInv, deltaWorld)
    .multiply(meshWorldMatrix);

  return transformSelectedComponents(baseMesh, selection, deltaLocal).mesh;
}

/**
 * Stateful helper owning a `HELPER_LAYER` proxy `THREE.Object3D` that `TransformControls` attaches to
 * during Point / Edge / Polygon Move, Rotate, and Scale dragging.
 */
export class SelectionGizmoProxyController {
  readonly proxyObject: THREE.Object3D;

  private dragStartMesh: EditableMeshData | null = null;
  private dragSelection: ComponentSelection | null = null;
  private dragStartProxyWorld = new THREE.Matrix4();

  constructor() {
    this.proxyObject = new THREE.Object3D();
    this.proxyObject.name = 'C4DComponentGizmoProxy';
    this.proxyObject.layers.set(HELPER_LAYER);
  }

  get isDragging(): boolean {
    return this.dragStartMesh !== null;
  }

  syncToSelection(
    mesh: EditableMeshData,
    selection: ComponentSelection,
    meshWorldMatrix: THREE.Matrix4,
    coordSpace: 'world' | 'local' = 'local',
  ): WorldSelectionGizmoPlacement {
    const placement = computeWorldSelectionGizmoPlacement(mesh, selection, meshWorldMatrix, coordSpace);
    this.proxyObject.position.copy(placement.position);
    this.proxyObject.quaternion.copy(placement.quaternion);
    this.proxyObject.scale.set(1, 1, 1);
    this.proxyObject.updateMatrixWorld(true);
    return placement;
  }

  beginDrag(baseMesh: EditableMeshData, selection: ComponentSelection): void {
    this.proxyObject.updateMatrixWorld(true);
    this.dragStartMesh = {
      vertices: baseMesh.vertices.map((v) => [v[0], v[1], v[2]]),
      faces: baseMesh.faces.map((f) => ({
        verts: [...f.verts],
        ...(f.materialIndex !== undefined ? { materialIndex: f.materialIndex } : {}),
        ...(f.uvs ? { uvs: f.uvs.map((uv) => [uv[0], uv[1]] as [number, number]) } : {}),
      })),
    };
    this.dragSelection = {
      mode: selection.mode,
      vertices: [...selection.vertices],
      edges: [...selection.edges],
      faces: [...selection.faces],
    };
    this.dragStartProxyWorld.copy(this.proxyObject.matrixWorld);
  }

  computeDraggedMesh(meshWorldMatrix: THREE.Matrix4): EditableMeshData | null {
    if (!this.dragStartMesh || !this.dragSelection) return null;
    this.proxyObject.updateMatrixWorld(true);
    return applyProxyDeltaToEditableMesh(
      this.dragStartMesh,
      this.dragSelection,
      meshWorldMatrix,
      this.dragStartProxyWorld,
      this.proxyObject.matrixWorld,
    );
  }

  endDrag(): void {
    this.dragStartMesh = null;
    this.dragSelection = null;
  }
}
