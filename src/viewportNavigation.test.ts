import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { HELPER_LAYER, STAGE_LAYER, setLayerRecursive } from './npr';
import {
  buildTurntableCameraBasis,
  computeStageWorldBounds,
  ViewportNavigationController,
  type NavigationFrameTarget,
  type NavigationSelectionTarget,
} from './viewportNavigation';

const VIEWPORT = { width: 1200, height: 800 };

function makeCamera(
  position: [number, number, number],
  lookAtTarget: [number, number, number],
  fov = 42,
): T.PerspectiveCamera {
  const camera = new T.PerspectiveCamera(fov, VIEWPORT.width / VIEWPORT.height, 0.02, 500);
  camera.position.set(...position);
  camera.up.set(0, 1, 0);
  camera.lookAt(...lookAtTarget);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

function projectToNdc(point: T.Vector3, camera: T.PerspectiveCamera): T.Vector3 {
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return point.clone().project(camera);
}

describe('ViewportNavigationController', () => {
  describe('zero-jump off-origin tumble (orbit)', () => {
    it('causes zero camera position or quaternion jump (< 1e-6) on pointerdown for both on-axis and off-axis pivots', () => {
      // Camera far from world origin looking slightly left/down of an off-origin subject at (8, 1.5, -6)
      const camera = makeCamera([11.4, 2.7, -1.8], [7.3, 1.15, -5.6]);
      const subjectMesh = new T.Mesh(new T.BoxGeometry(0.6, 1.7, 0.4), new T.MeshBasicMaterial());
      subjectMesh.position.set(8, 1.5, -6);
      subjectMesh.updateMatrixWorld(true);

      let activeSelection: NavigationSelectionTarget | null = {
        kind: 'object',
        pivot: new T.Vector3(8, 1.5, -6),
        bounds: computeStageWorldBounds(subjectMesh),
        radius: 0.95,
      };

      const nav = new ViewportNavigationController({
        camera,
        domElement: null,
        initialTarget: [0, 0.95, 0], // deliberately stale origin target before synchronization
        context: {
          getRaycastRoots: () => [subjectMesh],
          getSelectionTarget: () => activeSelection,
        },
      });
      // Aim camera at [7.3, 1.15, -5.6] so (8, 1.5, -6) is distinctly off-axis in screen space
      nav.target.set(7.3, 1.15, -5.6);
      nav.update();

      const initialPos = camera.position.clone();
      const initialQuat = camera.quaternion.clone();
      const initialTarget = nav.target.clone();
      const pivotBefore = projectToNdc(new T.Vector3(8, 1.5, -6), camera);
      expect(Math.abs(pivotBefore.x)).toBeGreaterThan(0.05);
      expect(Math.abs(pivotBefore.y)).toBeGreaterThan(0.05);

      // 1. Off-axis selection pivot beginTumbleNdc: ZERO jump
      const startedOffAxis = nav.beginTumbleNdc(0.1, -0.1, 660, 440);
      expect(startedOffAxis.source).toBe('selection');
      expect(camera.position.distanceTo(initialPos)).toBeLessThan(1e-9);
      expect(camera.quaternion.angleTo(initialQuat)).toBeLessThan(1e-9);
      expect(nav.target.distanceTo(initialTarget)).toBeLessThan(1e-9);
      // 0-pixel move must also produce zero jump
      nav.updateTumbleFromStartDelta(0, 0, VIEWPORT.height);
      expect(camera.position.distanceTo(initialPos)).toBeLessThan(1e-9);
      expect(camera.quaternion.angleTo(initialQuat)).toBeLessThan(1e-9);
      nav.endGesture();

      // 2. On-axis pivot beginTumbleNdc: ZERO jump
      activeSelection = {
        kind: 'joint',
        pivot: new T.Vector3(7.3, 1.15, -5.6),
        radius: 0.28,
      };
      const startedOnAxis = nav.beginTumbleNdc(0, 0, 600, 400);
      expect(startedOnAxis.source).toBe('selection');
      expect(camera.position.distanceTo(initialPos)).toBeLessThan(1e-9);
      expect(camera.quaternion.angleTo(initialQuat)).toBeLessThan(1e-9);
      nav.endGesture();
    });

    it('keeps an off-origin pivot at (8, 1.5, -6) stationary in screen NDC during yaw + pitch tumble instead of swinging around (0, 0, 0)', () => {
      const pivot = new T.Vector3(8, 1.5, -6);
      const camera = makeCamera([11.2, 2.5, -1.9], [7.5, 1.25, -5.7]);
      const characterGroup = new T.Group();
      const torso = new T.Mesh(new T.CapsuleGeometry(0.25, 1.1, 4, 8), new T.MeshBasicMaterial());
      torso.position.copy(pivot);
      characterGroup.add(torso);
      characterGroup.updateMatrixWorld(true);

      const nav = new ViewportNavigationController({
        camera,
        domElement: null,
        initialTarget: [7.5, 1.25, -5.7],
        context: {
          getRaycastRoots: () => [characterGroup],
          getSelectionTarget: () => ({
            kind: 'object',
            pivot: pivot.clone(),
            bounds: computeStageWorldBounds(characterGroup),
            radius: 0.85,
          }),
        },
      });
      nav.update();

      const ndcInitial = projectToNdc(pivot, camera);
      const initialDistToPivot = camera.position.distanceTo(pivot);

      nav.beginTumbleNdc(ndcInitial.x, ndcInitial.y, 640, 380);
      // Sweep 90+ degrees of yaw and significant pitch across multiple drag steps
      for (const [dx, dy] of [
        [45, -20],
        [140, 35],
        [290, -55],
        [-180, 42],
      ] as const) {
        nav.updateTumbleFromStartDelta(dx, dy, VIEWPORT.height);
        const ndcAfter = projectToNdc(pivot, camera);
        expect(Math.abs(ndcAfter.x - ndcInitial.x)).toBeLessThan(1e-6);
        expect(Math.abs(ndcAfter.y - ndcInitial.y)).toBeLessThan(1e-6);
        expect(camera.position.distanceTo(pivot)).toBeCloseTo(initialDistToPivot, 6);

        // Verify controls.target stays synchronized along the camera's optical axis at focus depth
        const forward = new T.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
        const toTarget = nav.target.clone().sub(camera.position);
        expect(toTarget.clone().normalize().distanceTo(forward)).toBeLessThan(1e-6);
        expect(toTarget.length()).toBeGreaterThan(2.0);
      }
      nav.endGesture();
    });

    it('uses Auto-Depth surface raycast when unselected or when selection is off-screen, ignoring cutaway walls and helper gizmos', () => {
      const couchCenter = new T.Vector3(8, 0.8, -6);
      const couch = new T.Mesh(new T.BoxGeometry(2.2, 1.0, 0.9), new T.MeshBasicMaterial());
      couch.position.copy(couchCenter);
      setLayerRecursive(couch, STAGE_LAYER);

      // Cutaway wall between camera and couch (hidden by updateRoomCutaway -> visible = false)
      const cutawayWall = new T.Mesh(new T.BoxGeometry(6, 3, 0.2), new T.MeshBasicMaterial());
      cutawayWall.position.set(8, 1.5, -3.2);
      cutawayWall.visible = false;
      setLayerRecursive(cutawayWall, STAGE_LAYER);

      // Helper-layer gizmo line directly in front of camera (must be ignored by stage raycast)
      const helperMesh = new T.Mesh(new T.BoxGeometry(2, 2, 0.1), new T.MeshBasicMaterial());
      helperMesh.position.set(8, 1.2, -2.2);
      setLayerRecursive(helperMesh, HELPER_LAYER);

      const roomRoot = new T.Group();
      roomRoot.add(couch, cutawayWall, helperMesh);
      roomRoot.updateMatrixWorld(true);

      // Off-screen selected character way behind/left at (-14, 1, 12)
      const offscreenSelection: NavigationSelectionTarget = {
        kind: 'object',
        pivot: new T.Vector3(-14, 1, 12),
        radius: 0.9,
      };

      const camera = makeCamera([8, 1.8, -1.2], [8, 0.9, -6]);
      camera.layers.enable(HELPER_LAYER);

      const nav = new ViewportNavigationController({
        camera,
        domElement: null,
        initialTarget: [0, 1, 0],
        context: {
          getRaycastRoots: () => [roomRoot],
          getSelectionTarget: () => offscreenSelection,
        },
      });
      // Aim camera at the couch even if target started near (8, 0.9, -6)
      nav.target.set(8, 0.9, -6);
      nav.update();

      const cursorNdc = new T.Vector2(0.12, -0.04);
      const { pivot, source } = nav.beginTumbleNdc(cursorNdc.x, cursorNdc.y, 672, 416);
      expect(source).toBe('cursor-surface');
      // Must hit the front face of the couch at z = -5.55, NOT the hidden wall (-3.1) or helper (-2.15) or offscreen (-14,1,12)
      expect(pivot.z).toBeCloseTo(-5.55, 2);
      expect(pivot.x).toBeGreaterThan(7.0);
      expect(pivot.x).toBeLessThan(9.0);

      const hitNdcBefore = projectToNdc(pivot, camera);
      nav.updateTumbleFromStartDelta(160, -35, VIEWPORT.height);
      const hitNdcAfter = projectToNdc(pivot, camera);
      expect(Math.abs(hitNdcAfter.x - hitNdcBefore.x)).toBeLessThan(1e-6);
      expect(Math.abs(hitNdcAfter.y - hitNdcBefore.y)).toBeLessThan(1e-6);
      nav.endGesture();
    });

    it('matches Three.js lookAt orthonormal basis across quadrants', () => {
      const right = new T.Vector3();
      const up = new T.Vector3();
      const back = new T.Vector3();
      for (const [theta, phi] of [
        [0, 1.1],
        [1.35, 0.65],
        [-2.4, 2.1],
        [Math.PI, 1.4],
      ] as const) {
        buildTurntableCameraBasis(theta, phi, right, up, back);
        const cam = new T.PerspectiveCamera(42, 1.5, 0.02, 500);
        cam.position.copy(back).multiplyScalar(4);
        cam.up.set(0, 1, 0);
        cam.lookAt(0, 0, 0);
        cam.updateMatrixWorld(true);
        const m = cam.matrixWorld.elements;
        expect(right.distanceTo(new T.Vector3(m[0]!, m[1]!, m[2]!))).toBeLessThan(1e-12);
        expect(up.distanceTo(new T.Vector3(m[4]!, m[5]!, m[6]!))).toBeLessThan(1e-12);
        expect(back.distanceTo(new T.Vector3(m[8]!, m[9]!, m[10]!))).toBeLessThan(1e-12);
      }
    });
  });

  describe('1:1 depth-locked panning', () => {
    it.each([
      { label: 'near detail (0.5 m)', depth: 0.5 },
      { label: 'far across room (10 m)', depth: 10.0 },
    ])('moves an off-origin world point at cursor depth ($label) by exact pixel delta in screen NDC', ({ depth }) => {
      // Off-origin angled camera around (8, 1.5, -6)
      const camera = makeCamera([9.5, 2.3, -3.0], [7.2, 1.4, -7.5]);
      const forward = new T.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
      const m = camera.matrixWorld.elements;
      const camRight = new T.Vector3(m[0]!, m[1]!, m[2]!).normalize();
      const camUp = new T.Vector3(m[4]!, m[5]!, m[6]!).normalize();

      // Place a surface plane perpendicular to view at exact forward distance `depth`
      const surfaceCenter = camera.position.clone().addScaledVector(forward, depth);
      const surface = new T.Mesh(new T.PlaneGeometry(30, 30), new T.MeshBasicMaterial({ side: T.DoubleSide }));
      surface.position.copy(surfaceCenter);
      surface.quaternion.copy(camera.quaternion);
      surface.updateMatrixWorld(true);

      // Pick an off-center point on that surface at depth `depth`
      const worldFeaturePoint = surfaceCenter
        .clone()
        .addScaledVector(camRight, depth * 0.14)
        .addScaledVector(camUp, -depth * 0.09);
      const startNdc = projectToNdc(worldFeaturePoint, camera);

      const nav = new ViewportNavigationController({
        camera,
        domElement: null,
        initialTarget: [0, 1, 0], // stale origin target must NOT corrupt pan speed!
        context: {
          getRaycastRoots: () => [surface],
          getSelectionTarget: () => null,
        },
      });
      // Keep exact initial orientation while leaving target at stale distance (0.8m) to prove depth comes from raycast
      nav.target.copy(camera.position).addScaledVector(forward, 0.8);
      nav.update();

      const camPosBefore = camera.position.clone();
      const sampledDepth = nav.beginPanNdc(startNdc.x, startNdc.y, 500, 420);
      expect(sampledDepth).toBeCloseTo(depth, 4);
      // Zero jump on pan start
      expect(camera.position.distanceTo(camPosBefore)).toBeLessThan(1e-9);

      const deltaPixelsX = 150;
      const deltaPixelsY = -96;
      nav.updatePanFromStartDelta(deltaPixelsX, deltaPixelsY, VIEWPORT.width, VIEWPORT.height);

      const endNdc = projectToNdc(worldFeaturePoint, camera);
      const expectedDeltaNdcX = (2 * deltaPixelsX) / VIEWPORT.width;
      const expectedDeltaNdcY = -(2 * deltaPixelsY) / VIEWPORT.height;

      expect(endNdc.x - startNdc.x).toBeCloseTo(expectedDeltaNdcX, 6);
      expect(endNdc.y - startNdc.y).toBeCloseTo(expectedDeltaNdcY, 6);
      nav.endGesture();
    });
  });

  describe('cursor-aware dolly & no invisible target wall', () => {
    it('dollies cleanly past a stale mid-air target (camera z=2, stale target z=1.8, wall/couch z=-5) all the way to the far surface', () => {
      const camera = makeCamera([0, 1.4, 2.0], [0, 1.4, 1.8]);
      const farCouch = new T.Mesh(new T.BoxGeometry(3, 2, 0.4), new T.MeshBasicMaterial());
      // Front face of couch/wall is at z = -4.8, center at z = -5.0
      farCouch.position.set(0, 1.4, -5.0);
      farCouch.updateMatrixWorld(true);

      const nav = new ViewportNavigationController({
        camera,
        domElement: null,
        initialTarget: [0, 1.4, 1.8],
        minDistance: 0.08,
        context: {
          getRaycastRoots: () => [farCouch],
          getSelectionTarget: () => null,
        },
      });
      nav.update();
      expect(nav.target.z).toBeCloseTo(1.8, 5);

      // Repeated wheel zoom-in steps must push straight past z = 1.8 toward z = -4.8
      for (let i = 0; i < 35; i++) {
        nav.dollyAtNdc(0, 0, -120);
      }

      // Camera sailed far past the old z = 1.8 wall and approached z = -4.8!
      expect(camera.position.z).toBeLessThan(-4.4);
      // Never penetrates closer than minDistance (0.08m) to the front face at z = -4.8
      expect(camera.position.z).toBeGreaterThanOrEqual(-4.8 + 0.08 - 1e-5);
      // Target stayed in front of the camera so lookAt never flips 180 degrees
      expect(nav.target.z).toBeLessThan(camera.position.z);
    });

    it('zooms toward the 3D point under an off-center cursor keeping that point fixed in NDC', () => {
      const camera = makeCamera([6, 2.0, 2.0], [6, 1.5, -5.0]);
      const wall = new T.Mesh(new T.BoxGeometry(12, 6, 0.2), new T.MeshBasicMaterial());
      wall.position.set(6, 2.0, -5.0);
      wall.updateMatrixWorld(true);

      const nav = new ViewportNavigationController({
        camera,
        domElement: null,
        initialTarget: [6, 1.5, -5.0],
        context: {
          getRaycastRoots: () => [wall],
          getSelectionTarget: () => null,
        },
      });
      nav.update();

      const cursorNdc = new T.Vector2(0.42, 0.28);
      const ray = new T.Raycaster();
      ray.setFromCamera(cursorNdc, camera);
      const hitPoint = ray.intersectObject(wall, true)[0]!.point.clone();

      const beforeNdc = projectToNdc(hitPoint, camera);
      expect(beforeNdc.x).toBeCloseTo(cursorNdc.x, 5);
      expect(beforeNdc.y).toBeCloseTo(cursorNdc.y, 5);

      nav.dollyAtNdc(cursorNdc.x, cursorNdc.y, -240);
      const afterNdc = projectToNdc(hitPoint, camera);
      expect(afterNdc.x).toBeCloseTo(cursorNdc.x, 5);
      expect(afterNdc.y).toBeCloseTo(cursorNdc.y, 5);
    });
  });

  describe('Frame Selection (F)', () => {
    it('frames a selected FK joint, a character, and an off-origin room furniture object at appropriate working distances', () => {
      const camera = makeCamera([3.2, 2.4, 5.2], [0, 0.95, 0]);
      const initialViewDir = camera.position.clone().sub(new T.Vector3(0, 0.95, 0)).normalize();

      let currentFrameTarget: NavigationFrameTarget = {
        center: new T.Vector3(0, 1, 0),
        radius: 0.9,
      };

      const nav = new ViewportNavigationController({
        camera,
        domElement: null,
        initialTarget: [0, 0.95, 0],
        context: {
          getRaycastRoots: () => [],
          getSelectionTarget: () => null,
          getFrameTarget: () => currentFrameTarget,
        },
      });
      nav.update();

      // 1. Frame a distal FK joint (e.g. leftWrist at [5.2, 1.38, -4.1], radius 0.28)
      const jointPos = new T.Vector3(5.2, 1.38, -4.1);
      currentFrameTarget = { center: jointPos.clone(), radius: 0.28 };
      const jointResult = nav.frameSelection({ immediate: true });
      expect(nav.target.distanceTo(jointPos)).toBeLessThan(1e-6);
      const jointNdc = projectToNdc(jointPos, camera);
      expect(Math.abs(jointNdc.x)).toBeLessThan(1e-6);
      expect(Math.abs(jointNdc.y)).toBeLessThan(1e-6);
      expect(jointResult.distance).toBeGreaterThan(0.7);
      expect(jointResult.distance).toBeLessThan(1.6);
      // Viewing angle preserved
      expect(camera.position.clone().sub(nav.target).normalize().distanceTo(initialViewDir)).toBeLessThan(1e-6);

      // 2. Frame a full posed character at [-6.5, 0.9, -7.2] (radius ~0.95m)
      const charCenter = new T.Vector3(-6.5, 0.9, -7.2);
      currentFrameTarget = { center: charCenter.clone(), radius: 0.95 };
      const charResult = nav.frameSelection({ immediate: true });
      expect(nav.target.distanceTo(charCenter)).toBeLessThan(1e-6);
      expect(charResult.distance).toBeGreaterThan(jointResult.distance * 2);
      expect(charResult.distance).toBeLessThan(4.5);

      // 3. Smoothly animate framing an off-origin room furniture object (couch at [8.4, 0.55, -6.3], radius 1.45m)
      const couchCenter = new T.Vector3(8.4, 0.55, -6.3);
      currentFrameTarget = { center: couchCenter.clone(), radius: 1.45 };
      const couchGoal = nav.frameSelection({ durationMs: 180 });
      expect(nav.isAnimating).toBe(true);

      nav.update(0.06);
      expect(nav.isAnimating).toBe(true);
      expect(nav.target.distanceTo(charCenter)).toBeGreaterThan(0.5);

      nav.update(0.06);
      nav.update(0.06);
      expect(nav.isAnimating).toBe(false);
      expect(nav.target.distanceTo(couchCenter)).toBeLessThan(1e-6);
      expect(camera.position.distanceTo(couchGoal.position)).toBeLessThan(1e-6);
      const couchNdc = projectToNdc(couchCenter, camera);
      expect(Math.abs(couchNdc.x)).toBeLessThan(1e-6);
      expect(Math.abs(couchNdc.y)).toBeLessThan(1e-6);
    });

    it('binds Frame Selection (F) and tumble pivot to Light Source vs Light Target even behind foreground geometry', () => {
      const camera = makeCamera([3.2, 2.4, 5.2], [0, 0.95, 0]);
      const lightSourcePos = new T.Vector3(2.4, 3.2, 2.1);
      const lightTargetPos = new T.Vector3(-1.2, 0.9, -2.5);

      // Foreground prop standing between camera and the light target
      const foregroundProp = new T.Mesh(new T.BoxGeometry(1.5, 2.0, 0.4), new T.MeshBasicMaterial());
      foregroundProp.position.set(-0.4, 1.0, 2.5);
      foregroundProp.updateMatrixWorld(true);

      let activePart: 'source' | 'target' = 'source';

      const nav = new ViewportNavigationController({
        camera,
        domElement: null,
        initialTarget: [0, 0.95, 0],
        context: {
          getRaycastRoots: () => [foregroundProp],
          getSelectionTarget: () =>
            activePart === 'target'
              ? { kind: 'light-target', pivot: lightTargetPos.clone(), radius: 0.45 }
              : { kind: 'object', pivot: lightSourcePos.clone(), radius: 0.65 },
          getFrameTarget: () =>
            activePart === 'target'
              ? { center: lightTargetPos.clone(), radius: 0.45 }
              : { center: lightSourcePos.clone(), radius: 0.65 },
        },
      });
      nav.update();

      // 1. Light Source selected -> F frames light source and tumble pivots around light source
      nav.frameSelection({ immediate: true });
      expect(nav.target.distanceTo(lightSourcePos)).toBeLessThan(1e-6);
      const sourceTumble = nav.beginTumbleNdc(0, 0, 600, 400);
      expect(sourceTumble.pivot.distanceTo(lightSourcePos)).toBeLessThan(1e-6);
      nav.endGesture();

      // 2. Light Target selected -> F frames light target and tumble pivots around light target (never hijacked by foreground prop)
      activePart = 'target';
      nav.frameSelection({ immediate: true });
      expect(nav.target.distanceTo(lightTargetPos)).toBeLessThan(1e-6);
      const targetNdc = projectToNdc(lightTargetPos, camera);
      expect(Math.abs(targetNdc.x)).toBeLessThan(1e-6);
      expect(Math.abs(targetNdc.y)).toBeLessThan(1e-6);

      const targetTumble = nav.beginTumbleNdc(0, 0, 600, 400);
      expect(targetTumble.pivot.distanceTo(lightTargetPos)).toBeLessThan(1e-6);
      nav.updateTumbleFromStartDelta(140, -50, VIEWPORT.height);
      const targetNdcAfter = projectToNdc(lightTargetPos, camera);
      expect(Math.abs(targetNdcAfter.x - targetNdc.x)).toBeLessThan(1e-6);
      expect(Math.abs(targetNdcAfter.y - targetNdc.y)).toBeLessThan(1e-6);
      nav.endGesture();
    });
  });

  describe('DOM selection recovery on pointerdown (no tumble/pan lockup)', () => {
    it('clears active DOM text selection on viewport pointerdown, prevents default drag initiation, and tumbles + pans cleanly', () => {
      const camera = makeCamera([0, 1.5, 4.0], [0, 1.0, 0]);
      const subject = new T.Mesh(new T.BoxGeometry(0.8, 1.6, 0.5), new T.MeshBasicMaterial());
      subject.position.set(0, 1.0, 0);
      subject.updateMatrixWorld(true);

      let selectionText = 'Pose & Composition selected UI text';
      let blurredControl = false;
      let canvasFocused = false;
      const listeners = new Map<string, Set<(event: unknown) => void>>();
      const docListeners = new Map<string, Set<(event: unknown) => void>>();

      const fakeDoc = {
        activeElement: {
          tagName: 'BUTTON',
          blur: () => {
            blurredControl = true;
          },
        },
        body: { tagName: 'BODY' },
        defaultView: {
          getSelection: () => ({
            get rangeCount() {
              return selectionText.length > 0 ? 1 : 0;
            },
            removeAllRanges: () => {
              selectionText = '';
            },
          }),
        },
        addEventListener(type: string, fn: (event: unknown) => void) {
          if (!docListeners.has(type)) docListeners.set(type, new Set());
          docListeners.get(type)!.add(fn);
        },
        removeEventListener(type: string, fn: (event: unknown) => void) {
          docListeners.get(type)?.delete(fn);
        },
      };

      const fakeCanvas = {
        tagName: 'CANVAS',
        style: { touchAction: '' },
        tabIndex: 0,
        draggable: true,
        ownerDocument: fakeDoc,
        getAttribute: () => null,
        focus: () => {
          canvasFocused = true;
        },
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 800 }),
        addEventListener(type: string, fn: (event: unknown) => void) {
          if (!listeners.has(type)) listeners.set(type, new Set());
          listeners.get(type)!.add(fn);
        },
        removeEventListener(type: string, fn: (event: unknown) => void) {
          listeners.get(type)?.delete(fn);
        },
        setPointerCapture: () => {},
        hasPointerCapture: () => false,
        releasePointerCapture: () => {},
      } as unknown as HTMLElement;

      const emit = (type: string, payload: Record<string, unknown>) => {
        let prevented = false;
        const event = {
          ...payload,
          preventDefault: () => {
            prevented = true;
          },
        };
        for (const fn of listeners.get(type) ?? []) fn(event);
        return prevented;
      };

      const nav = new ViewportNavigationController({
        camera,
        domElement: fakeCanvas,
        initialTarget: [0, 1.0, 0],
        context: {
          getRaycastRoots: () => [subject],
          getSelectionTarget: () => null,
        },
      });

      const startPos = camera.position.clone();

      // 1. Left-drag tumble while DOM text selection is active
      expect(selectionText).not.toBe('');
      const downPrevented = emit('pointerdown', {
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        clientX: 600,
        clientY: 400,
      });
      expect(downPrevented).toBe(true);
      expect(selectionText).toBe('');
      expect(blurredControl).toBe(true);
      expect(canvasFocused).toBe(true);
      expect(fakeCanvas.draggable).toBe(false);

      // Document-level selectstart/dragstart are blocked while dragging
      expect(docListeners.get('selectstart')?.size).toBe(1);
      expect(docListeners.get('dragstart')?.size).toBe(1);

      emit('pointermove', { pointerId: 1, pointerType: 'mouse', clientX: 740, clientY: 360 });
      emit('pointerup', { pointerId: 1, pointerType: 'mouse', clientX: 740, clientY: 360 });
      expect(camera.position.distanceTo(startPos)).toBeGreaterThan(0.4);
      expect(docListeners.get('selectstart')?.size ?? 0).toBe(0);

      // 2. Re-select text and perform right-drag pan — still works with zero lockup
      selectionText = 'Selected again';
      const afterTumblePos = camera.position.clone();
      const panDownPrevented = emit('pointerdown', {
        pointerId: 2,
        pointerType: 'mouse',
        button: 2,
        clientX: 600,
        clientY: 400,
      });
      expect(panDownPrevented).toBe(true);
      expect(selectionText).toBe('');
      emit('pointermove', { pointerId: 2, pointerType: 'mouse', clientX: 480, clientY: 450 });
      emit('pointerup', { pointerId: 2, pointerType: 'mouse', clientX: 480, clientY: 450 });
      expect(camera.position.distanceTo(afterTumblePos)).toBeGreaterThan(0.2);

      nav.dispose();
    });
  });
});
