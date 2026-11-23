import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  bevelEdges,
  bevelFaces,
  booleanResultToEditableMesh,
  bridgeEdges,
  bridgeFaces,
  bufferGeometryToEditableMesh,
  buildHalfEdgeOrAdjacency,
  chamferVertices,
  closePolygonHoles,
  collapseEdges,
  computeFaceNormal,
  computeSelectionGizmoFrame,
  connectVertices,
  convertSelection,
  createDefaultPrimitiveSpec,
  createModifierSpec,
  createPrimitiveEditableMesh,
  createPrimitiveGeometry,
  createQuadWireframeGeometry,
  deleteFaces,
  dissolveEdges,
  dissolveFaces,
  disposeEvaluatedResult,
  editableMeshToBufferGeometry,
  evaluateBoolean,
  evaluateBooleanChain,
  evaluateModelingNode,
  extrudeFaces,
  flipFaceNormals,
  growSelection,
  insetFaces,
  loopCut,
  makeNodeEditable,
  PLATONIC_TYPES,
  PRIMITIVE_KINDS,
  recalculateNormalsOutside,
  selectConnectedComponent,
  selectEdgeLoop,
  selectEdgeRing,
  shrinkSelection,
  slideEdges,
  splitDisconnectFaces,
  subdivideFaces,
  transformSelectedComponents,
  weldVertices,
  type EditableMeshData,
  type PrimitiveKind,
  type PrimitiveSpec,
} from './index';

function assertFiniteGeometryAndNormals(mesh: EditableMeshData): void {
  expect(mesh.vertices.length).toBeGreaterThan(2);
  expect(mesh.faces.length).toBeGreaterThan(0);

  for (const v of mesh.vertices) {
    expect(Number.isFinite(v[0])).toBe(true);
    expect(Number.isFinite(v[1])).toBe(true);
    expect(Number.isFinite(v[2])).toBe(true);
  }

  const geo = editableMeshToBufferGeometry(mesh);
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  const uv = geo.getAttribute('uv');
  expect(pos.count).toBeGreaterThanOrEqual(3);
  expect(nrm.count).toBe(pos.count);
  expect(uv.count).toBe(pos.count);

  for (let i = 0; i < nrm.count; i++) {
    const len = Math.hypot(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
    expect(len).toBeGreaterThan(0.98);
    expect(len).toBeLessThan(1.02);
  }

  const wire = createQuadWireframeGeometry(mesh);
  const adj = buildHalfEdgeOrAdjacency(mesh);
  expect(wire.getAttribute('position').count).toBe(adj.edges.length * 2);

  geo.dispose();
  wire.dispose();
}

function assertWatertightManifold(mesh: EditableMeshData): void {
  assertFiniteGeometryAndNormals(mesh);
  const adj = buildHalfEdgeOrAdjacency(mesh);
  expect(adj.edges.length).toBeGreaterThan(0);
  const openOrNonManifold = adj.edges.filter((e) => e.isBoundary || e.faces.length !== 2);
  expect(openOrNonManifold).toHaveLength(0);
}

describe('Parametric Primitives (Quad Topology + Chamfer & Smooth Fillet)', () => {
  it('generates valid finite geometry and quad wireframes for all 11 default primitives', () => {
    const closedKinds = new Set<PrimitiveKind>([
      'cube',
      'sphere',
      'cylinder',
      'cone',
      'pyramid',
      'torus',
      'capsule',
      'tube',
      'platonic',
    ]);

    for (const kind of PRIMITIVE_KINDS) {
      const spec = createDefaultPrimitiveSpec(kind) as PrimitiveSpec;
      const mesh = createPrimitiveEditableMesh(spec);
      assertFiniteGeometryAndNormals(mesh);
      if (closedKinds.has(kind)) {
        assertWatertightManifold(mesh);
      }

      const directGeo = createPrimitiveGeometry(spec);
      expect(directGeo.getAttribute('position').count).toBeGreaterThan(0);
      directGeo.dispose();
    }
  });

  it('produces true quad wireframe on default Cube (12 quad edges, 6 quad faces, 8 vertices)', () => {
    const cube = createPrimitiveEditableMesh(createDefaultPrimitiveSpec('cube'));
    expect(cube.vertices).toHaveLength(8);
    expect(cube.faces).toHaveLength(6);
    expect(cube.faces.every((f) => f.verts.length === 4)).toBe(true);

    const wire = createQuadWireframeGeometry(cube);
    // 12 edges * 2 endpoints = 24 vertices (NOT 36 from 18 triangulated edges!)
    expect(wire.getAttribute('position').count).toBe(24);
    wire.dispose();
  });

  it('supports crisp Chamfer (filletSubdivisions=1) and Smooth Fillet (filletSubdivisions=3) on Cube, Cylinder, Cone, Pyramid, Tube, and Platonic solids', () => {
    const filletSpecs: PrimitiveSpec[] = [
      // Cube chamfer & smooth all-quad fillet
      {
        kind: 'cube',
        params: { width: 1.2, height: 1, depth: 0.8, segX: 2, segY: 2, segZ: 1, fillet: true, filletRadius: 0.1, filletSubdivisions: 1 },
      },
      {
        kind: 'cube',
        params: { width: 1.2, height: 1, depth: 0.8, segX: 2, segY: 2, segZ: 1, fillet: true, filletRadius: 0.12, filletSubdivisions: 3 },
      },
      // Cylinder chamfer & smooth fillet
      {
        kind: 'cylinder',
        params: { radiusTop: 0.45, radiusBottom: 0.5, height: 1.2, radialSegments: 16, heightSegments: 2, fillet: true, filletRadius: 0.08, filletSubdivisions: 1 },
      },
      {
        kind: 'cylinder',
        params: { radiusTop: 0.45, radiusBottom: 0.5, height: 1.2, radialSegments: 16, heightSegments: 2, fillet: true, filletRadius: 0.08, filletSubdivisions: 3 },
      },
      // Cone (pointed & frustum) chamfer & smooth fillet
      {
        kind: 'cone',
        params: { radiusBottom: 0.5, radiusTop: 0, height: 1.1, radialSegments: 16, heightSegments: 2, fillet: true, filletRadius: 0.06, filletSubdivisions: 1 },
      },
      {
        kind: 'cone',
        params: { radiusBottom: 0.5, radiusTop: 0.15, height: 1.1, radialSegments: 16, heightSegments: 2, fillet: true, filletRadius: 0.06, filletSubdivisions: 3 },
      },
      // Pyramid chamfer & smooth fillet
      {
        kind: 'pyramid',
        params: { width: 1, height: 1.1, depth: 1, segments: 1, fillet: true, filletRadius: 0.08, filletSubdivisions: 1 },
      },
      {
        kind: 'pyramid',
        params: { width: 1, height: 1.1, depth: 1, segments: 2, fillet: true, filletRadius: 0.07, filletSubdivisions: 3 },
      },
      // Hollow Tube (pure quads!) chamfer & smooth fillet
      {
        kind: 'tube',
        params: { innerRadius: 0.28, outerRadius: 0.5, height: 1, radialSegments: 16, heightSegments: 2, fillet: true, filletRadius: 0.04, filletSubdivisions: 1 },
      },
      {
        kind: 'tube',
        params: { innerRadius: 0.28, outerRadius: 0.5, height: 1, radialSegments: 16, heightSegments: 2, fillet: true, filletRadius: 0.04, filletSubdivisions: 3 },
      },
    ];

    for (const polyhedron of PLATONIC_TYPES) {
      filletSpecs.push({
        kind: 'platonic',
        params: { polyhedron, radius: 0.6, subdivisions: 0, fillet: true, filletRadius: 0.05, filletSubdivisions: 1 },
      });
      filletSpecs.push({
        kind: 'platonic',
        params: { polyhedron, radius: 0.6, subdivisions: 0, fillet: true, filletRadius: 0.05, filletSubdivisions: 3 },
      });
    }

    for (const spec of filletSpecs) {
      const mesh = createPrimitiveEditableMesh(spec);
      assertWatertightManifold(mesh);
      if (spec.kind === 'cube' && spec.params.filletSubdivisions >= 2) {
        // Smooth analytic fillet box is 100% pure quads!
        expect(mesh.faces.every((f) => f.verts.length === 4)).toBe(true);
      }
      if (spec.kind === 'tube') {
        expect(mesh.faces.every((f) => f.verts.length === 4)).toBe(true);
      }
    }
  });

  it('closes sliced Sphere, Hemisphere, partial Torus, and annular Disc cleanly', () => {
    const slicedSphere = createPrimitiveEditableMesh({
      kind: 'sphere',
      params: { radius: 0.5, widthSegments: 16, heightSegments: 12, hemisphere: true, sliceDeg: 225 },
    });
    assertWatertightManifold(slicedSphere);

    const partialTorus = createPrimitiveEditableMesh({
      kind: 'torus',
      params: { radius: 0.5, tube: 0.15, radialSegments: 12, tubularSegments: 18, arcDeg: 270 },
    });
    assertWatertightManifold(partialTorus);

    const ringDisc = createPrimitiveEditableMesh({
      kind: 'disc',
      params: { innerRadius: 0.25, outerRadius: 0.6, radialSegments: 16, ringSegments: 3 },
    });
    assertFiniteGeometryAndNormals(ringDisc);
    expect(ringDisc.faces.every((f) => f.verts.length === 4)).toBe(true);
  });
});

describe('EditableMesh Conversion, Selection, and Surface/Edge/Point Operations', () => {
  it('converts triangulated THREE.BoxGeometry into 6 clean quads via bufferGeometryToEditableMesh', () => {
    const boxGeo = new THREE.BoxGeometry(2, 1, 3);
    const editable = bufferGeometryToEditableMesh(boxGeo);
    boxGeo.dispose();

    expect(editable.vertices).toHaveLength(8);
    expect(editable.faces).toHaveLength(6);
    expect(editable.faces.every((f) => f.verts.length === 4)).toBe(true);
    assertWatertightManifold(editable);
  });

  it('selects quad edge loops, parallel quad rings, connected components, and grows/shrinks/converts selections', () => {
    const torus = createPrimitiveEditableMesh({
      kind: 'torus',
      params: { radius: 0.5, tube: 0.15, radialSegments: 8, tubularSegments: 12, arcDeg: 360 },
    });
    const loop = selectEdgeLoop(torus, 0);
    const ring = selectEdgeRing(torus, 0);
    // On an 8x12 quad torus, every loop has length 8 or 12, and its perpendicular ring has length 12 or 8!
    expect([8, 12]).toContain(loop.length);
    expect([8, 12]).toContain(ring.length);

    const comp = selectConnectedComponent(torus, 'polygon', 0);
    expect(comp.faces).toHaveLength(8 * 12);

    const grown = growSelection(torus, { mode: 'polygon', vertices: [], edges: [], faces: [0] });
    expect(grown.faces.length).toBe(9);
    const shrunk = shrinkSelection(torus, grown);
    expect(shrunk.faces).toEqual([0]);

    const boundaryEdges = convertSelection(torus, grown, 'edge', { boundaryOnly: true });
    expect(boundaryEdges.edges.length).toBe(12);
  });

  it('computes local/world gizmo frames and transforms selected components', () => {
    const cube = createPrimitiveEditableMesh(createDefaultPrimitiveSpec('cube'));
    const topFaceIdx = cube.faces.findIndex((f) => computeFaceNormal(cube.vertices, f.verts)[1] > 0.9);
    expect(topFaceIdx).toBeGreaterThanOrEqual(0);

    const sel = { mode: 'polygon' as const, vertices: [], edges: [], faces: [topFaceIdx] };
    const frame = computeSelectionGizmoFrame(cube, sel, 'local');
    expect(frame.origin[1]).toBeCloseTo(0.5, 5);
    expect(frame.normal[1]).toBeCloseTo(1, 5);

    const moved = transformSelectedComponents(
      cube,
      sel,
      new THREE.Matrix4().makeTranslation(0, 0.5, 0),
    );
    const movedFrame = computeSelectionGizmoFrame(moved.mesh, moved.selection, 'world');
    expect(movedFrame.origin[1]).toBeCloseTo(1.0, 5);
  });

  it('extrudes faces (group & individual), insets faces, and bevels faces cleanly', () => {
    const segCube = createPrimitiveEditableMesh({
      ...createDefaultPrimitiveSpec('cube'),
      params: { ...createDefaultPrimitiveSpec('cube').params, segX: 2, segZ: 2 },
    });
    const topFaces = segCube.faces
      .map((f, i) => ({ f, i }))
      .filter(({ f }) => computeFaceNormal(segCube.vertices, f.verts)[1] > 0.9)
      .map(({ i }) => i);
    expect(topFaces).toHaveLength(4);

    // Group extrude keeps the 4 top quads joined as one island
    const groupExt = extrudeFaces(segCube, topFaces, { offset: 0.35, groupNormals: true });
    assertWatertightManifold(groupExt.mesh);
    expect(groupExt.selection.faces).toHaveLength(4);

    // Individual extrude creates 4 separate towers (each with 4 walls)
    const indivExt = extrudeFaces(segCube, topFaces, { offset: 0.25, groupNormals: false });
    assertWatertightManifold(indivExt.mesh);
    expect(indivExt.mesh.faces.length).toBeGreaterThan(groupExt.mesh.faces.length);

    // Group & individual inset (Extrude Inner)
    const insetRes = insetFaces(segCube, topFaces, { inset: 0.1, depth: -0.05, individual: false });
    assertWatertightManifold(insetRes.mesh);

    const indivInset = insetFaces(segCube, topFaces, { inset: 0.08, individual: true });
    assertWatertightManifold(indivInset.mesh);

    const bevFaceRes = bevelFaces(segCube, topFaces, { inset: 0.08, offset: 0.12, segments: 2 });
    assertWatertightManifold(bevFaceRes.mesh);
  });

  it('bevels edges into crisp Chamfers (segments=1) and Smooth Fillets (segments=3), including partial edge subsets', () => {
    const cube = createPrimitiveEditableMesh(createDefaultPrimitiveSpec('cube'));
    const adj = buildHalfEdgeOrAdjacency(cube);
    const allEdges = adj.edges.map((e) => e.index);

    // Full 12-edge chamfer: 6 original quads + 12 edge quads + 8 corner triangles = 26 faces
    const chamfer = bevelEdges(cube, allEdges, { width: 0.12, segments: 1 });
    expect(chamfer.mesh.faces).toHaveLength(26);
    assertWatertightManifold(chamfer.mesh);

    // Full 12-edge smooth fillet (segments = 3)
    const fillet = bevelEdges(cube, allEdges, { width: 0.15, segments: 3, profile: 0.5 });
    expect(fillet.mesh.faces.length).toBeGreaterThan(60);
    assertWatertightManifold(fillet.mesh);

    // Partial single-edge bevel (unbeveled shared edges must stay crack-free & watertight!)
    const singleEdgeBevel = bevelEdges(cube, [0], { width: 0.15, segments: 3 });
    assertWatertightManifold(singleEdgeBevel.mesh);
  });

  it('performs loopCut, slideEdges, dissolveEdges, collapseEdges, bridgeFaces, and bridgeEdges', () => {
    const cube = createPrimitiveEditableMesh(createDefaultPrimitiveSpec('cube'));

    // Loop cut around cube adds 4 quad faces (6 -> 10 faces) and selects the 4 new loop edges
    const cut1 = loopCut(cube, 0, { factor: 0.4, cuts: 1 });
    expect(cut1.mesh.faces).toHaveLength(10);
    expect(cut1.selection.edges).toHaveLength(4);
    assertWatertightManifold(cut1.mesh);

    // Slide the newly cut edge loop
    const slid = slideEdges(cut1.mesh, cut1.selection.edges, 0.3);
    assertWatertightManifold(slid.mesh);

    // Dissolve the loop edges back to 6 faces!
    const dissolved = dissolveEdges(slid.mesh, cut1.selection.edges);
    expect(dissolved.mesh.faces).toHaveLength(6);
    assertWatertightManifold(dissolved.mesh);

    // Bridge two opposing faces of a segmented cube to punch a watertight quad tunnel through it!
    const segCube = createPrimitiveEditableMesh({
      kind: 'cube',
      params: { ...createDefaultPrimitiveSpec('cube').params, segX: 3, segY: 3, segZ: 1 },
    });
    // Find center front (+Z) and center back (-Z) faces
    const frontCenter = segCube.faces.findIndex((f) => {
      const n = computeFaceNormal(segCube.vertices, f.verts);
      const cx = f.verts.reduce((s, v) => s + segCube.vertices[v][0], 0) / 4;
      const cy = f.verts.reduce((s, v) => s + segCube.vertices[v][1], 0) / 4;
      return n[2] > 0.9 && Math.abs(cx) < 0.05 && Math.abs(cy) < 0.05;
    });
    const backCenter = segCube.faces.findIndex((f) => {
      const n = computeFaceNormal(segCube.vertices, f.verts);
      const cx = f.verts.reduce((s, v) => s + segCube.vertices[v][0], 0) / 4;
      const cy = f.verts.reduce((s, v) => s + segCube.vertices[v][1], 0) / 4;
      return n[2] < -0.9 && Math.abs(cx) < 0.05 && Math.abs(cy) < 0.05;
    });
    const bridged = bridgeFaces(segCube, [frontCenter, backCenter]);
    expect(bridged.selection.faces).toHaveLength(4);
    assertWatertightManifold(bridged.mesh);

    // Bridge two open boundary edge chains on two separated planes
    const planeA = createPrimitiveEditableMesh({ kind: 'plane', params: { width: 1, depth: 1, segX: 2, segZ: 1 } });
    const planeB = transformSelectedComponents(
      createPrimitiveEditableMesh({ kind: 'plane', params: { width: 1, depth: 1, segX: 2, segZ: 1 } }),
      { mode: 'point', vertices: [0, 1, 2, 3, 4, 5], edges: [], faces: [] },
      new THREE.Matrix4().makeTranslation(0, 0, 2),
    ).mesh;
    const combined: EditableMeshData = {
      vertices: [...planeA.vertices, ...planeB.vertices],
      faces: [
        ...planeA.faces,
        ...planeB.faces.map((f) => ({ verts: f.verts.map((v) => v + planeA.vertices.length) })),
      ],
    };
    const combAdj = buildHalfEdgeOrAdjacency(combined);
    const chainA = combAdj.edges
      .filter((e) => e.isBoundary && Math.abs(combined.vertices[e.a][2] - 0.5) < 1e-4 && Math.abs(combined.vertices[e.b][2] - 0.5) < 1e-4)
      .map((e) => e.index);
    const chainB = combAdj.edges
      .filter((e) => e.isBoundary && Math.abs(combined.vertices[e.a][2] - 1.5) < 1e-4 && Math.abs(combined.vertices[e.b][2] - 1.5) < 1e-4)
      .map((e) => e.index);
    const edgeBridged = bridgeEdges(combined, chainA, chainB);
    expect(edgeBridged.selection.faces).toHaveLength(2);
    expect(edgeBridged.mesh.faces).toHaveLength(6);

    // Collapse an edge cleanly
    const collapsed = collapseEdges(cube, [0]);
    expect(collapsed.mesh.vertices).toHaveLength(7);
    assertWatertightManifold(collapsed.mesh);
  });

  it('handles deleteFaces, closePolygonHoles, dissolveFaces, flipFaceNormals, recalculateNormalsOutside, splitDisconnectFaces, and vertex ops', () => {
    const cube = createPrimitiveEditableMesh(createDefaultPrimitiveSpec('cube'));

    // Delete 1 face -> open box with 5 faces; closePolygonHoles restores 6th face & watertightness!
    const opened = deleteFaces(cube, [0]);
    expect(opened.mesh.faces).toHaveLength(5);
    expect(buildHalfEdgeOrAdjacency(opened.mesh).edges.some((e) => e.isBoundary)).toBe(true);

    const closed = closePolygonHoles(opened.mesh);
    expect(closed.mesh.faces).toHaveLength(6);
    assertWatertightManifold(closed.mesh);

    // Flip 1 face normal -> recalculateNormalsOutside restores positive outward manifold
    const flippedOne = flipFaceNormals(cube, [2]);
    const recalced = recalculateNormalsOutside(flippedOne.mesh);
    assertWatertightManifold(recalced.mesh);
    // Every face normal should point away from origin on centered cube
    for (const f of recalced.mesh.faces) {
      const n = computeFaceNormal(recalced.mesh.vertices, f.verts);
      const c = f.verts.reduce((acc, v) => [acc[0] + recalced.mesh.vertices[v][0] / 4, acc[1] + recalced.mesh.vertices[v][1] / 4, acc[2] + recalced.mesh.vertices[v][2] / 4], [0, 0, 0]);
      expect(n[0] * c[0] + n[1] * c[1] + n[2] * c[2]).toBeGreaterThan(0.1);
    }

    // Dissolve two adjacent plane quads into one 6-vert polygon
    const twoQuadPlane = createPrimitiveEditableMesh({
      kind: 'plane',
      params: { width: 2, depth: 1, segX: 2, segZ: 1 },
    });
    const dissolvedFace = dissolveFaces(twoQuadPlane, [0, 1]);
    expect(dissolvedFace.mesh.faces).toHaveLength(1);

    // Split disconnect face creates unshared vertices
    const disconnected = splitDisconnectFaces(cube, [0]);
    expect(disconnected.mesh.vertices).toHaveLength(12);

    // Chamfer all 8 cube vertices -> 6 octagons + 8 corner triangles = 14 watertight faces!
    const vertChamfer = chamferVertices(cube, [0, 1, 2, 3, 4, 5, 6, 7], { width: 0.2 });
    expect(vertChamfer.mesh.faces).toHaveLength(14);
    assertWatertightManifold(vertChamfer.mesh);

    // Connect two opposite vertices of face 0 -> splits 1 quad into 2 triangles (6 -> 7 faces)
    const vDiag = [cube.faces[0].verts[0], cube.faces[0].verts[2]];
    const connected = connectVertices(cube, vDiag);
    expect(connected.mesh.faces).toHaveLength(7);
    expect(connected.selection.edges).toHaveLength(1);

    // Weld vertices to center
    const welded = weldVertices(cube, [cube.faces[0].verts[0], cube.faces[0].verts[1]], { mode: 'center' });
    expect(welded.mesh.vertices).toHaveLength(7);
    assertWatertightManifold(welded.mesh);
  });
});

describe('Non-Destructive C4D Modifier Stack & CSG Boolean Evaluator', () => {
  it('evaluates all 8 C4D modifiers non-destructively', () => {
    const cube = createPrimitiveEditableMesh(createDefaultPrimitiveSpec('cube'));
    const plane = createPrimitiveEditableMesh({
      kind: 'plane',
      params: { width: 1.5, depth: 1.5, segX: 3, segZ: 3 },
    });

    // 1. Bevel modifier
    const beveledRes = evaluateModelingNode({
      nodeType: 'editable',
      mesh: cube,
      modifiers: [createModifierSpec('bevel', 'm-bev', { width: 0.1, segments: 2, angleThresholdDeg: 30 })],
    });
    assertWatertightManifold(beveledRes.editableMesh);
    disposeEvaluatedResult(beveledRes);

    // 2. Catmull-Clark Subdivision modifier (levels = 2 -> 6 * 4 * 4 = 96 pure quads!)
    const subdivRes = evaluateModelingNode({
      nodeType: 'editable',
      mesh: cube,
      modifiers: [createModifierSpec('subdivision', 'm-sub', { levels: 2, smooth: true })],
    });
    expect(subdivRes.editableMesh.faces).toHaveLength(96);
    expect(subdivRes.editableMesh.faces.every((f) => f.verts.length === 4)).toBe(true);
    assertWatertightManifold(subdivRes.editableMesh);
    disposeEvaluatedResult(subdivRes);

    // 3. Mirror (Symmetry) with bisect = true on an X-shifted cube -> bisects & welds into 1 watertight manifold!
    const shiftedCube = transformSelectedComponents(
      cube,
      { mode: 'point', vertices: cube.vertices.map((_, i) => i), edges: [], faces: [] },
      new THREE.Matrix4().makeTranslation(0.25, 0, 0),
    ).mesh;
    const mirrorRes = evaluateModelingNode({
      nodeType: 'editable',
      mesh: shiftedCube,
      modifiers: [createModifierSpec('mirror', 'm-mir', { axis: 'x', offset: 0, bisect: true, mergeThreshold: 0.002 })],
    });
    assertWatertightManifold(mirrorRes.editableMesh);
    disposeEvaluatedResult(mirrorRes);

    // 4. Solidify turns open Plane into a closed watertight slab!
    const solidifyRes = evaluateModelingNode({
      nodeType: 'editable',
      mesh: plane,
      modifiers: [createModifierSpec('solidify', 'm-sol', { thickness: 0.12, evenThickness: true })],
    });
    assertWatertightManifold(solidifyRes.editableMesh);
    disposeEvaluatedResult(solidifyRes);

    // 5, 6, 7. Bend + Twist + Taper stack on segmented pillar
    const tallBox = createPrimitiveEditableMesh({
      kind: 'cube',
      params: { ...createDefaultPrimitiveSpec('cube').params, height: 3, segY: 12 },
    });
    const deformedRes = evaluateModelingNode({
      nodeType: 'editable',
      mesh: tallBox,
      modifiers: [
        createModifierSpec('taper', 'm-tap', { strength: 0.4, axis: 'y', curvature: 0.2 }),
        createModifierSpec('twist', 'm-twi', { angleDeg: 90, axis: 'y' }),
        createModifierSpec('bend', 'm-bnd', { angleDeg: 60, axis: 'y', directionDeg: 30 }),
      ],
    });
    assertWatertightManifold(deformedRes.editableMesh);
    disposeEvaluatedResult(deformedRes);

    // 8. Linear & Radial Array Cloner
    const linearArr = evaluateModelingNode({
      nodeType: 'editable',
      mesh: cube,
      modifiers: [createModifierSpec('array', 'm-arr-l', { mode: 'linear', count: 4, offset: [1.5, 0, 0], radius: 0, stepRotationDeg: [0, 15, 0] })],
    });
    expect(linearArr.editableMesh.faces).toHaveLength(6 * 4);
    disposeEvaluatedResult(linearArr);

    const radialArr = evaluateModelingNode({
      nodeType: 'editable',
      mesh: cube,
      modifiers: [createModifierSpec('array', 'm-arr-r', { mode: 'radial', count: 6, offset: [0, 0.2, 0], radius: 2.0, stepRotationDeg: [0, 0, 0] })],
    });
    expect(radialArr.editableMesh.faces).toHaveLength(6 * 6);
    disposeEvaluatedResult(radialArr);
  });

  it('evaluates CSG Union, Subtract, Intersect, Multi-Operand Chains, and Make Editable conversion', () => {
    const cube = createPrimitiveEditableMesh(createDefaultPrimitiveSpec('cube'));
    const cyl = createPrimitiveEditableMesh({
      kind: 'cylinder',
      params: { ...createDefaultPrimitiveSpec('cylinder').params, radiusTop: 0.28, radiusBottom: 0.28, height: 2.0, radialSegments: 20 },
    });

    for (const op of ['union', 'subtract', 'intersect'] as const) {
      const resultGeo = evaluateBoolean(
        cube,
        null,
        cyl,
        { position: [0.1, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        op,
      );
      expect(resultGeo.getAttribute('position').count).toBeGreaterThan(12);
      const editable = booleanResultToEditableMesh(resultGeo);
      assertFiniteGeometryAndNormals(editable);
      resultGeo.dispose();
    }

    // Multi-operand Boolean generator node + Make Editable (C)
    const booleNode = {
      nodeType: 'boolean' as const,
      operation: 'subtract' as const,
      operands: [
        {
          nodeType: 'primitive' as const,
          primitive: createDefaultPrimitiveSpec('cube'),
        },
        {
          nodeType: 'primitive' as const,
          primitive: {
            kind: 'sphere' as const,
            params: { radius: 0.45, widthSegments: 16, heightSegments: 12, hemisphere: false, sliceDeg: 360 },
          },
          transform: { position: [0.35, 0.35, 0.35] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] },
        },
      ],
      modifiers: [createModifierSpec('mirror', 'm-sym', { axis: 'x', offset: -0.6, bisect: false, mergeThreshold: 0.001 })],
    };

    const evaluated = evaluateModelingNode(booleNode);
    expect(evaluated.editableMesh.faces.length).toBeGreaterThan(20);
    disposeEvaluatedResult(evaluated);

    const baked = makeNodeEditable(booleNode, { bakeModifiers: true });
    expect(baked.remainingModifiers).toHaveLength(0);
    expect(baked.mesh.faces.length).toBe(evaluated.editableMesh.faces.length);

    // Direct chain check
    const chainGeo = evaluateBooleanChain(
      [
        { mesh: cube },
        { mesh: cyl, transform: new THREE.Matrix4().makeRotationX(Math.PI / 2), operation: 'subtract' },
      ],
      'subtract',
    );
    expect(chainGeo.getAttribute('position').count).toBeGreaterThan(20);
    chainGeo.dispose();
  });
});
