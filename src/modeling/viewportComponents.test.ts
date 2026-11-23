import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { degrees } from '../model';
import {
  ROTATION_SNAP_DEG,
  ROTATION_SNAP_RAD,
  cleanSnappedEulerVec,
  quantizeSnappedAngleRad,
  resolveRotationSnapRad,
} from '../engine';
import { HELPER_LAYER } from '../npr';
import {
  C4DIconButton,
  C4DIcons,
  getBooleanIcon,
  getModifierIcon,
  getPrimitiveIcon,
} from '../components/c4dPalette';
import { TooltipButton } from '../components/studioTooltip';
import {
  computeAnchoredTooltipPosition,
  computeViewportCursorTooltipPosition,
  getCursorFootprintBox,
  getOsCursorArrowBox,
  makeRectBox,
  rectsOverlap,
} from '../components/tooltipPositioning';
import {
  PRIMITIVE_KINDS,
  SelectionGizmoProxyController,
  buildHalfEdgeOrAdjacency,
  computeFaceNormal,
  computeLoopCutPreviewPolyline,
  createDefaultPrimitiveSpec,
  createEditableComponentOverlay,
  createEmptySelection,
  createPrimitiveEditableMesh,
  marqueeSelectMeshComponents,
  pickMeshComponent,
} from './index';

function makeCameraAtZ(z = 5, width = 800, height = 600): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
  cam.position.set(0, 0, z);
  cam.lookAt(0, 0, 0);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  return cam;
}

function raycasterFromWorldTarget(
  camera: THREE.PerspectiveCamera,
  targetWorld: THREE.Vector3,
): THREE.Raycaster {
  const ndc = targetWorld.clone().project(camera);
  const rc = new THREE.Raycaster();
  rc.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
  return rc;
}

describe('EditableComponentOverlay & Loop Cut Live Preview', () => {
  it('builds HELPER_LAYER quad wireframe, point, edge, loop-cut, and polygon overlays cleanly', () => {
    const cube = createPrimitiveEditableMesh(createDefaultPrimitiveSpec('cube'));
    const overlay = createEditableComponentOverlay();

    // Every node in overlay group must sit exclusively on HELPER_LAYER
    overlay.group.traverse((obj) => {
      expect(obj.layers.isEnabled(HELPER_LAYER)).toBe(true);
    });

    // Point mode with 2 selected vertices and 1 hovered vertex
    overlay.update({
      mesh: cube,
      mode: 'point',
      selection: { mode: 'point', vertices: [0, 1], edges: [], faces: [] },
      hoveredIndex: 2,
    });

    // Quad wireframe on a 6-face cube has 12 undirected edges = 24 line vertices (never 36 triangulated!)
    const wire = overlay.group.children[0] as THREE.LineSegments;
    expect(wire.visible).toBe(true);
    expect(wire.geometry.getAttribute('position').count).toBe(24);

    // Edge mode with live Loop Cut preview (3 cuts)
    overlay.update({
      mesh: cube,
      mode: 'edge',
      selection: { mode: 'edge', vertices: [], edges: [0, 2], faces: [] },
      hoveredIndex: 3,
      loopCutPreview: { edgeIndex: 0, factor: 0.35, cuts: 3 },
    });

    // Polygon mode with 2 selected faces and 1 hovered face
    overlay.update({
      mesh: cube,
      mode: 'polygon',
      selection: { mode: 'polygon', vertices: [], edges: [], faces: [0, 1] },
      hoveredIndex: 2,
    });

    const worldMat = new THREE.Matrix4().makeTranslation(1, 2, 3);
    overlay.syncTransform(worldMat);
    expect(overlay.group.matrix.elements[12]).toBe(1);
    expect(overlay.group.matrix.elements[13]).toBe(2);
    expect(overlay.group.matrix.elements[14]).toBe(3);

    overlay.dispose();
    expect(overlay.group.children).toHaveLength(0);
  });

  it('computes closed and open Loop Cut preview polylines accurately', () => {
    const cube = createPrimitiveEditableMesh(createDefaultPrimitiveSpec('cube'));
    const singleLoop = computeLoopCutPreviewPolyline(cube, 0, 0.25, 1);
    expect(singleLoop).toHaveLength(1);
    expect(singleLoop[0].closed).toBe(true);
    // 4 ring edges + closing point = 5 points
    expect(singleLoop[0].points).toHaveLength(5);
    expect(singleLoop[0].points[0]).toEqual(singleLoop[0].points[4]);

    const multiLoop = computeLoopCutPreviewPolyline(cube, 0, 0.5, 3);
    expect(multiLoop).toHaveLength(3);
    for (const ring of multiLoop) {
      expect(ring.closed).toBe(true);
      expect(ring.points).toHaveLength(5);
    }

    // Open quad strip plane (3 quads along X, 1 along Z) -> open 4-edge ring polyline
    const strip = createPrimitiveEditableMesh({
      kind: 'plane',
      params: { width: 3, depth: 1, segX: 3, segZ: 1 },
    });
    const adj = buildHalfEdgeOrAdjacency(strip);
    // Pick an edge running along Z (`dx === 0`) so its ring runs across the 3 quads along X
    const zEdge = adj.edges.find(
      (e) => Math.abs(strip.vertices[e.a][0] - strip.vertices[e.b][0]) < 1e-5,
    )!;
    const openPreview = computeLoopCutPreviewPolyline(strip, zEdge.index, 0.5, 1);
    expect(openPreview).toHaveLength(1);
    expect(openPreview[0].closed).toBe(false);
    expect(openPreview[0].points).toHaveLength(4);
  });
});

describe('Depth-Occluded Component Picking & Marquee Box Selection', () => {
  it('picks visible front faces, vertices, and edges while rejecting back-occluded elements unless xRay is enabled', () => {
    const viewport = { width: 800, height: 600 };
    const camera = makeCameraAtZ(5, viewport.width, viewport.height);
    const cube = createPrimitiveEditableMesh(createDefaultPrimitiveSpec('cube'));
    const identity = new THREE.Matrix4();

    // 1. Polygon mode at screen center -> hits front +Z face
    const centerRay = new THREE.Raycaster();
    centerRay.setFromCamera(new THREE.Vector2(0, 0), camera);
    const faceHit = pickMeshComponent(centerRay, camera, viewport, identity, cube, 'polygon');
    expect(faceHit).not.toBeNull();
    expect(faceHit!.kind).toBe('face');
    const hitNormal = computeFaceNormal(cube.vertices, cube.faces[faceHit!.index].verts);
    expect(hitNormal[2]).toBeGreaterThan(0.9);

    // 2. Point mode: rotate cube slightly (+0.18 Y, -0.14 X) so the back-top-right vertex `(+0.5, +0.5, -0.5)`
    // tucks inward (`x' ~ +0.40, y' ~ +0.42`) strictly behind the front +Z face, well away from front corners!
    const tiltedWorld = new THREE.Matrix4().makeRotationY(0.18).multiply(new THREE.Matrix4().makeRotationX(-0.14));
    const backVertIdx = cube.vertices.findIndex(
      (v) => v[0] > 0 && v[1] > 0 && v[2] < 0,
    );
    const backWorldPos = new THREE.Vector3(...cube.vertices[backVertIdx]).applyMatrix4(tiltedWorld);
    const backRay = raycasterFromWorldTarget(camera, backWorldPos);

    // Without X-Ray, the front face occludes `backVertIdx` -> null!
    const occludedPick = pickMeshComponent(backRay, camera, viewport, tiltedWorld, cube, 'point', {
      xRay: false,
      pointSnapRadiusPx: 10,
    });
    expect(occludedPick).toBeNull();

    // With X-Ray enabled, the exact same ray picks `backVertIdx`!
    const xRayPick = pickMeshComponent(backRay, camera, viewport, tiltedWorld, cube, 'point', {
      xRay: true,
      pointSnapRadiusPx: 10,
    });
    expect(xRayPick).not.toBeNull();
    expect(xRayPick!.kind).toBe('vertex');
    expect(xRayPick!.index).toBe(backVertIdx);

    // Front vertex is picked cleanly even with `xRay: false`
    const frontVertIdx = cube.vertices.findIndex(
      (v) => v[0] > 0 && v[1] > 0 && v[2] > 0,
    );
    const frontWorldPos = new THREE.Vector3(...cube.vertices[frontVertIdx]).applyMatrix4(tiltedWorld);
    const frontRay = raycasterFromWorldTarget(camera, frontWorldPos);
    const frontPick = pickMeshComponent(frontRay, camera, viewport, tiltedWorld, cube, 'point', {
      xRay: false,
    });
    expect(frontPick).not.toBeNull();
    expect(frontPick!.index).toBe(frontVertIdx);

    // 3. Edge mode: front +Z top edge is picked with `xRay: false`; back -Z edge is occluded unless `xRay: true`
    const adj = buildHalfEdgeOrAdjacency(cube);
    const frontTopEdge = adj.edges.find(
      (e) => cube.vertices[e.a][2] > 0 && cube.vertices[e.b][2] > 0 && cube.vertices[e.a][1] > 0 && cube.vertices[e.b][1] > 0,
    )!;
    const frontEdgeMid = new THREE.Vector3(
      (cube.vertices[frontTopEdge.a][0] + cube.vertices[frontTopEdge.b][0]) * 0.5,
      (cube.vertices[frontTopEdge.a][1] + cube.vertices[frontTopEdge.b][1]) * 0.5,
      (cube.vertices[frontTopEdge.a][2] + cube.vertices[frontTopEdge.b][2]) * 0.5,
    ).applyMatrix4(tiltedWorld);
    const frontEdgePick = pickMeshComponent(
      raycasterFromWorldTarget(camera, frontEdgeMid),
      camera,
      viewport,
      tiltedWorld,
      cube,
      'edge',
      { xRay: false },
    );
    expect(frontEdgePick).not.toBeNull();
    expect(frontEdgePick!.index).toBe(frontTopEdge.index);

    const backTopEdge = adj.edges.find(
      (e) => cube.vertices[e.a][2] < 0 && cube.vertices[e.b][2] < 0 && cube.vertices[e.a][1] > 0 && cube.vertices[e.b][1] > 0,
    )!;
    const backEdgeMid = new THREE.Vector3(
      (cube.vertices[backTopEdge.a][0] + cube.vertices[backTopEdge.b][0]) * 0.5,
      (cube.vertices[backTopEdge.a][1] + cube.vertices[backTopEdge.b][1]) * 0.5,
      (cube.vertices[backTopEdge.a][2] + cube.vertices[backTopEdge.b][2]) * 0.5,
    ).applyMatrix4(tiltedWorld);
    expect(
      pickMeshComponent(
        raycasterFromWorldTarget(camera, backEdgeMid),
        camera,
        viewport,
        tiltedWorld,
        cube,
        'edge',
        { xRay: false, edgeSnapRadiusPx: 8 },
      ),
    ).toBeNull();
    expect(
      pickMeshComponent(
        raycasterFromWorldTarget(camera, backEdgeMid),
        camera,
        viewport,
        tiltedWorld,
        cube,
        'edge',
        { xRay: true, edgeSnapRadiusPx: 8 },
      )?.index,
    ).toBe(backTopEdge.index);
  });

  it('marquee-selects only visible front components when xRay=false and all components when xRay=true', () => {
    const viewport = { width: 800, height: 600 };
    const camera = makeCameraAtZ(5, viewport.width, viewport.height);
    const cube = createPrimitiveEditableMesh(createDefaultPrimitiveSpec('cube'));
    const fullScreen = { x0: 0, y0: 0, x1: 800, y1: 600 };
    const identity = new THREE.Matrix4();

    // Points: 4 visible front vertices vs all 8 in X-Ray
    expect(marqueeSelectMeshComponents(fullScreen, camera, viewport, identity, cube, 'point', false)).toHaveLength(4);
    expect(marqueeSelectMeshComponents(fullScreen, camera, viewport, identity, cube, 'point', true)).toHaveLength(8);

    // Edges: 4 visible front edges vs all 12 in X-Ray
    expect(marqueeSelectMeshComponents(fullScreen, camera, viewport, identity, cube, 'edge', false)).toHaveLength(4);
    expect(marqueeSelectMeshComponents(fullScreen, camera, viewport, identity, cube, 'edge', true)).toHaveLength(12);

    // Faces: 1 visible +Z face vs all 6 in X-Ray
    expect(marqueeSelectMeshComponents(fullScreen, camera, viewport, identity, cube, 'polygon', false)).toHaveLength(1);
    expect(marqueeSelectMeshComponents(fullScreen, camera, viewport, identity, cube, 'polygon', true)).toHaveLength(6);
  });
});

describe('SelectionGizmoProxyController & C4DPalette Token Discipline', () => {
  it('transforms selected components accurately through rotated & scaled parent world matrices with zero drift', () => {
    const cube = createPrimitiveEditableMesh(createDefaultPrimitiveSpec('cube'));
    const plusZFace = cube.faces.findIndex((f) => computeFaceNormal(cube.vertices, f.verts)[2] > 0.9);
    const sel = { ...createEmptySelection('polygon'), faces: [plusZFace] };

    // Mesh sits at `(3, 1, -2)`, rotated +90° around Y (so local +Z points along world +X!), scaled by `2`!
    const meshWorld = new THREE.Matrix4().compose(
      new THREE.Vector3(3, 1, -2),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2),
      new THREE.Vector3(2, 2, 2),
    );

    const controller = new SelectionGizmoProxyController();
    const placement = controller.syncToSelection(cube, sel, meshWorld, 'local');
    expect(placement.hasSelection).toBe(true);
    // Local +Z face center `(0, 0, 0.5)` -> scaled `(0, 0, 1)` -> rotated +90° Y `(1, 0, 0)` -> translated `(4, 1, -2)`!
    expect(placement.position.x).toBeCloseTo(4, 5);
    expect(placement.position.y).toBeCloseTo(1, 5);
    expect(placement.position.z).toBeCloseTo(-2, 5);

    controller.beginDrag(cube, sel);
    expect(controller.isDragging).toBe(true);

    // Drag proxy +2 units in World X -> equals +1 unit in local +Z (because scale is 2 and local +Z == world +X)!
    controller.proxyObject.position.x += 2;
    const dragged = controller.computeDraggedMesh(meshWorld)!;
    expect(dragged).not.toBeNull();

    for (const vi of cube.faces[plusZFace].verts) {
      expect(dragged.vertices[vi][0]).toBeCloseTo(cube.vertices[vi][0], 5);
      expect(dragged.vertices[vi][1]).toBeCloseTo(cube.vertices[vi][1], 5);
      expect(dragged.vertices[vi][2]).toBeCloseTo(cube.vertices[vi][2] + 1, 5);
    }

    controller.endDrag();
    expect(controller.isDragging).toBe(false);
  });

  it('verifies C4DIcons coverage and strict Clawpilot var(--cp-*) styling rules in c4dPalette.tsx', () => {
    expect(Object.keys(C4DIcons).length).toBeGreaterThanOrEqual(45);
    for (const kind of PRIMITIVE_KINDS) {
      expect(getPrimitiveIcon(kind)).toBeTruthy();
    }
    expect(getPrimitiveIcon('cube', true)).toBeTruthy();
    expect(getBooleanIcon('union')).toBeTruthy();
    expect(getBooleanIcon('subtract')).toBeTruthy();
    expect(getBooleanIcon('intersect')).toBeTruthy();
    for (const mod of ['bevel', 'subdivision', 'mirror', 'solidify', 'bend', 'twist', 'taper', 'array'] as const) {
      expect(getModifierIcon(mod)).toBeTruthy();
    }

    const paletteSrc = readFileSync(
      resolve(__dirname, '../components/c4dPalette.tsx'),
      'utf8',
    );
    // Zero hardcoded hex colors or rgb()/rgba() literals in c4dPalette.tsx!
    expect(paletteSrc).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(paletteSrc).not.toMatch(/\brgba?\s*\(/i);
    // Zero 1-sided accent borders!
    expect(paletteSrc).not.toMatch(/\bborderLeft\b|\bborderRight\b|\bborder-left\b|\bborder-right\b/);
  });

  it('guarantees zero overlap with OS cursor arrow across Top Bar, Left Strip, Right Dock, Bottom Caddy, and 3D Viewport', () => {
    const vw = 1280;
    const vh = 800;

    const assertCursorSafeAndClamped = (
      left: number,
      top: number,
      tipWidth: number,
      tipHeight: number,
      pointerX: number,
      pointerY: number,
    ) => {
      const tipBox = makeRectBox(left, top, tipWidth, tipHeight);
      const osArrow = getOsCursorArrowBox(pointerX, pointerY);
      const paddedFootprint = getCursorFootprintBox(pointerX, pointerY);

      expect(rectsOverlap(tipBox, osArrow)).toBe(false);
      expect(rectsOverlap(tipBox, paddedFootprint)).toBe(false);
      expect(tipBox.left).toBeGreaterThanOrEqual(8);
      expect(tipBox.top).toBeGreaterThanOrEqual(8);
      expect(tipBox.right).toBeLessThanOrEqual(vw - 8);
      expect(tipBox.bottom).toBeLessThanOrEqual(vh - 8);
    };

    // 1. Top Command Bar buttons (left edge, middle, far-right Help button; pointer from top to bottom pixel)
    for (const anchorX of [12, 240, 680, 1242]) {
      const anchorRect = makeRectBox(anchorX, 5, 30, 30);
      for (const py of [7, 20, 35]) {
        const px = anchorX + 18;
        const tipWidth = 216;
        const tipHeight = 44;
        const pos = computeAnchoredTooltipPosition({
          anchorRect,
          tipWidth,
          tipHeight,
          placement: 'auto',
          pointer: { x: px, y: py },
          viewportWidth: vw,
          viewportHeight: vh,
        });
        expect(pos.resolvedPlacement).toBe('bottom');
        assertCursorSafeAndClamped(pos.left, pos.top, tipWidth, tipHeight, px, py);
      }
    }

    // 2. Left Vertical Mode & Modeling Tool Strip (top, middle, bottom; pointer even on right-most pixel)
    for (const anchorY of [46, 360, 762]) {
      const anchorRect = makeRectBox(7, anchorY, 30, 30);
      for (const px of [12, 24, 37]) {
        const py = anchorY + 16;
        const tipWidth = 192;
        const tipHeight = 32;
        const pos = computeAnchoredTooltipPosition({
          anchorRect,
          tipWidth,
          tipHeight,
          placement: 'right',
          pointer: { x: px, y: py },
          viewportWidth: vw,
          viewportHeight: vh,
        });
        expect(pos.resolvedPlacement).toBe('right');
        // Also clears the entire 44px left vertical dock so sibling buttons are never covered
        expect(pos.left).toBeGreaterThan(44);
        assertCursorSafeAndClamped(pos.left, pos.top, tipWidth, tipHeight, px, py);
      }
    }

    // 3. Right Dock (Object Manager & Attribute Manager compact action buttons + scrolled near top edge)
    for (const [anchorX, anchorY] of [
      [1240, 88],
      [1192, 240],
      [1040, 560],
      [1240, 14], // scrolled near very top -> safely flips below cursor tail
    ] as const) {
      const anchorRect = makeRectBox(anchorX, anchorY, 22, 22);
      const px = anchorX + 11;
      const py = anchorY + 14;
      const tipWidth = 176;
      const tipHeight = 36;
      const pos = computeAnchoredTooltipPosition({
        anchorRect,
        tipWidth,
        tipHeight,
        placement: 'top',
        pointer: { x: px, y: py },
        viewportWidth: vw,
        viewportHeight: vh,
      });
      assertCursorSafeAndClamped(pos.left, pos.top, tipWidth, tipHeight, px, py);
    }

    // 4. Bottom Operator Caddy scrub labels (`placement: 'top'`)
    {
      const anchorRect = makeRectBox(64, 684, 72, 18);
      const px = 98;
      const py = 693;
      const tipWidth = 198;
      const tipHeight = 40;
      const pos = computeAnchoredTooltipPosition({
        anchorRect,
        tipWidth,
        tipHeight,
        placement: 'top',
        pointer: { x: px, y: py },
        viewportWidth: vw,
        viewportHeight: vh,
      });
      expect(pos.resolvedPlacement).toBe('top');
      assertCursorSafeAndClamped(pos.left, pos.top, tipWidth, tipHeight, px, py);
    }

    // 5. 3D Viewport cursor-tracked hover tooltips (joint markers, light handles, mesh components)
    for (const [px, py] of [
      [620, 380], // center viewport -> cleanly above cursor hotspot
      [620, 26], // near top viewport edge -> flips cleanly below 36px cursor tail
      [52, 420], // near left dock edge -> clamped inside >= 8
      [940, 774], // near bottom-right viewport edge -> above cursor hotspot
    ] as const) {
      const tipWidth = 196;
      const tipHeight = 42;
      const pos = computeViewportCursorTooltipPosition({
        pointerX: px,
        pointerY: py,
        tipWidth,
        tipHeight,
        viewportWidth: vw,
        viewportHeight: vh,
      });
      assertCursorSafeAndClamped(pos.left, pos.top, tipWidth, tipHeight, px, py);
    }
  });

  it('enforces zero duplicate native title attributes, right-placed left-dock buttons, and Clawpilot token hygiene', () => {
    const iconBtnMarkup = renderToStaticMarkup(
      createElement(C4DIconButton, {
        icon: C4DIcons.moveTool,
        label: 'Move Tool',
        shortcut: 'W',
      }),
    );
    expect(iconBtnMarkup).toContain('aria-label="Move Tool (W)"');
    expect(iconBtnMarkup).not.toContain('title=');

    const tooltipBtnMarkup = renderToStaticMarkup(
      createElement(
        TooltipButton,
        {
          tooltip: 'Hide Figure',
          'aria-label': 'Hide Figure',
        },
        'Eye',
      ),
    );
    expect(tooltipBtnMarkup).toContain('aria-label="Hide Figure"');
    expect(tooltipBtnMarkup).not.toContain('title=');

    const studioTooltipSrc = readFileSync(
      resolve(__dirname, '../components/studioTooltip.tsx'),
      'utf8',
    );
    expect(studioTooltipSrc).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(studioTooltipSrc).not.toMatch(/\brgba?\s*\(/i);
    expect(studioTooltipSrc).not.toMatch(/\bborderLeft\b|\bborderRight\b|\bborder-left\b|\bborder-right\b/);

    for (const relPath of [
      '../components/c4dPalette.tsx',
      '../components/ui.tsx',
      '../components/c4dAttributePanels.tsx',
      '../engine.ts',
    ]) {
      const src = readFileSync(resolve(__dirname, relPath), 'utf8');
      expect(src).not.toMatch(/\btitle\s*=/);
      expect(src).not.toMatch(/domElement\.title/);
    }

    const appSrc = readFileSync(resolve(__dirname, '../App.tsx'), 'utf8');
    const leftDockMatch = appSrc.match(/<aside className="c4d-left-dock"[\s\S]*?<\/aside>/);
    expect(leftDockMatch).toBeTruthy();
    const leftDockButtons = leftDockMatch![0].match(/<C4DIconButton[\s\S]*?\/>/g) ?? [];
    expect(leftDockButtons.length).toBe(26);
    for (const btnBlock of leftDockButtons) {
      expect(btnBlock).toContain('tooltipPlacement="right"');
    }

    const cssSrc = readFileSync(resolve(__dirname, '../styles.css'), 'utf8');
    const tooltipRuleMatch = cssSrc.match(/\.studio-tooltip\s*\{[\s\S]*?\}/);
    expect(tooltipRuleMatch).toBeTruthy();
    expect(tooltipRuleMatch![0]).toContain('pointer-events: none');
  });
});

describe('Shift 15-Degree Rotation Snapping', () => {
  it('resolves 15° (π / 12 rad) when Shift is held and null when released', () => {
    expect(ROTATION_SNAP_DEG).toBe(15);
    expect(ROTATION_SNAP_RAD).toBeCloseTo(Math.PI / 12, 12);
    expect(resolveRotationSnapRad(true)).toBe(ROTATION_SNAP_RAD);
    expect(resolveRotationSnapRad(false)).toBeNull();
  });

  it('quantizes quaternion-derived snapped Euler angles cleanly onto exact 15° multiples without -0 or float noise', () => {
    // Around X or Z axis, XYZ Euler expresses [-180°, 180°] directly on the single axis;
    // around Y axis, XYZ Euler expresses (-90°, 90°) directly and ±180° as [180°, 0°, 180°].
    for (const targetDeg of [0, 15, 30, 45, 60, 75, -15, -45, -75, -90, 90, 180]) {
      const qX = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 0, 0),
        THREE.MathUtils.degToRad(targetDeg),
      );
      const eulerX = new THREE.Euler().setFromQuaternion(qX, 'XYZ');
      const cleanedX = cleanSnappedEulerVec([eulerX.x, eulerX.y, eulerX.z], true);
      expect(Object.is(cleanedX[1], -0)).toBe(false);
      expect(Object.is(cleanedX[2], -0)).toBe(false);
      expect(degrees(cleanedX[0])).toBe(targetDeg);
      expect(degrees(cleanedX[1])).toBe(0);
      expect(degrees(cleanedX[2])).toBe(0);
    }

    for (const targetDeg of [0, 15, 30, 45, 60, 75, -15, -45, -75]) {
      const qY = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        THREE.MathUtils.degToRad(targetDeg),
      );
      const eulerY = new THREE.Euler().setFromQuaternion(qY, 'XYZ');
      const cleanedY = cleanSnappedEulerVec([eulerY.x, eulerY.y, eulerY.z], true);
      expect(degrees(cleanedY[0])).toBe(0);
      expect(degrees(cleanedY[1])).toBe(targetDeg);
      expect(degrees(cleanedY[2])).toBe(0);
    }

    // Preserves non-multiple starting angles + 15° delta (e.g. 7° + 15° = 22°) without rounding to 15° or 30°
    const offsetRad = THREE.MathUtils.degToRad(22);
    expect(quantizeSnappedAngleRad(offsetRad)).toBe(offsetRad);

    // Leaves un-snapped drags completely untouched
    const raw: [number, number, number] = [0.26179939, -0, 0.12345];
    expect(cleanSnappedEulerVec(raw, false)).toBe(raw);
  });

  it('guards active TransformControls gizmo axes on Shift+pointerDown/pointerUp and resets snap on blur/visibilitychange', () => {
    const engineSrc = readFileSync(resolve(__dirname, '../engine.ts'), 'utf8');
    expect(engineSrc).toContain('if (this.transform.axis !== null) return;');
    expect(engineSrc).toContain(
      'if (this.recentlyDragged || this.transform.dragging || this.transform.axis !== null ||',
    );
    expect(engineSrc).not.toContain('(!event.shiftKey && this.transform.axis)');
    expect(engineSrc).toContain("window.addEventListener('blur', this.handleWindowBlurSnap)");
    expect(engineSrc).toContain(
      "document.addEventListener('visibilitychange', this.handleVisibilityChangeSnap)",
    );

    const appSrc = readFileSync(resolve(__dirname, '../App.tsx'), 'utf8');
    expect(appSrc).toContain('hold Shift to snap 15°');
    expect(appSrc).toContain('Snap rotation to 15° increments');
  });
});

