import * as T from 'three';
import {
  claimViewportPointerInteraction,
  clearDomTextSelection,
  lockDocumentSelectionDuringDrag,
} from './inputRouting';
import { STAGE_LAYER } from './npr';
import type { Vec3 } from './model';

export type TumblePivotSource =
  | 'selection'
  | 'cursor-surface'
  | 'center-surface'
  | 'ground'
  | 'target';

export interface NavigationSelectionTarget {
  kind: 'joint' | 'object' | 'multi' | 'room-object' | 'light-target';
  pivot: T.Vector3;
  bounds?: T.Box3;
  radius?: number;
}

export interface NavigationFrameTarget {
  center: T.Vector3;
  radius: number;
}

export interface NavigationSceneContext {
  getRaycastRoots: () => T.Object3D[];
  getSelectionTarget: () => NavigationSelectionTarget | null;
  getFrameTarget?: () => NavigationFrameTarget | null;
}

export interface ViewportRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ViewportNavigationOptions {
  camera: T.PerspectiveCamera;
  domElement?: HTMLElement | null;
  context?: NavigationSceneContext;
  initialTarget?: Vec3;
  minDistance?: number;
  minTargetDistance?: number;
  maxDistance?: number;
  minPanDepth?: number;
  maxPanDepth?: number;
  rotateSpeed?: number;
  zoomSpeed?: number;
  groundY?: number;
  positionClamp?: number;
  targetClamp?: number;
  shouldIgnorePointerDown?: (event: PointerEvent) => boolean;
}

export interface ViewportNavigationEventMap {
  start: {};
  change: {};
  end: {};
}

interface TumbleGestureState {
  mode: 'tumble';
  startClientX: number;
  startClientY: number;
  moved: boolean;
  theta0: number;
  phi0: number;
  pivot: T.Vector3;
  pivotCam: T.Vector3;
  focusDepth: number;
  source: TumblePivotSource;
}

interface PanGestureState {
  mode: 'pan';
  startClientX: number;
  startClientY: number;
  deadzonePx: number;
  moved: boolean;
  cameraStart: T.Vector3;
  forward: T.Vector3;
  right: T.Vector3;
  up: T.Vector3;
  panDepth: number;
  projX: number;
  projY: number;
}

interface DollyDragGestureState {
  mode: 'dolly';
  startClientX: number;
  startClientY: number;
  lastClientY: number;
  moved: boolean;
  ndcX: number;
  ndcY: number;
}

type PointerGestureState = TumbleGestureState | PanGestureState | DollyDragGestureState;

interface FrameAnimationState {
  startPos: T.Vector3;
  startTarget: T.Vector3;
  goalPos: T.Vector3;
  goalTarget: T.Vector3;
  elapsedMs: number;
  durationMs: number;
}

const MIN_POLAR_ANGLE = 0.015;
const MAX_POLAR_ANGLE = Math.PI - 0.015;
const SELECTION_NDC_MARGIN = 0.98;
const STAGE_LAYERS = (() => {
  const layers = new T.Layers();
  layers.set(STAGE_LAYER);
  return layers;
})();

/**
 * Builds the exact right-handed turntable camera basis matching `THREE.Matrix4.lookAt`
 * with world up `(0, 1, 0)` for spherical backward-ray angles `(theta, phi)`.
 */
export function buildTurntableCameraBasis(
  theta: number,
  phi: number,
  outRight: T.Vector3,
  outUp: T.Vector3,
  outBackward: T.Vector3,
): void {
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const sinTheta = Math.sin(theta);
  const cosTheta = Math.cos(theta);

  outBackward.set(sinPhi * sinTheta, cosPhi, sinPhi * cosTheta);
  outRight.set(cosTheta, 0, -sinTheta);
  outUp.crossVectors(outBackward, outRight);
}

/**
 * Computes a stage-only world bounding box, excluding `HELPER_LAYER` gizmos,
 * joint overlay spheres, invisible objects, and cutaway room walls.
 */
export function computeStageWorldBounds(root: T.Object3D, target = new T.Box3()): T.Box3 {
  target.makeEmpty();
  root.updateMatrixWorld(true);

  const expandFromHierarchy = (node: T.Object3D): void => {
    if (!node.visible || node.userData?.ignorePick) return;
    if (node instanceof T.Mesh && node.layers.test(STAGE_LAYERS)) {
      if (node instanceof T.SkinnedMesh) {
        if (!node.boundingBox) node.computeBoundingBox();
        if (node.boundingBox && !node.boundingBox.isEmpty()) {
          const worldBox = node.boundingBox.clone().applyMatrix4(node.matrixWorld);
          target.union(worldBox);
        }
      } else {
        const geom = node.geometry;
        if (geom) {
          if (!geom.boundingBox) geom.computeBoundingBox();
          if (geom.boundingBox && !geom.boundingBox.isEmpty()) {
            const worldBox = geom.boundingBox.clone().applyMatrix4(node.matrixWorld);
            target.union(worldBox);
          }
        }
      }
    }
    for (const child of node.children) {
      expandFromHierarchy(child);
    }
  };

  expandFromHierarchy(root);
  return target;
}

/**
 * Computes a comfortable camera distance to frame a bounding sphere of `radius`
 * inside both the vertical and horizontal FOV of `camera`.
 */
export function computeFrameDistance(
  camera: T.PerspectiveCamera,
  radius: number,
  minDistance = 0.45,
  maxDistance = 90,
  paddingFactor = 1.24,
): number {
  const safeRadius = Math.max(0.22, radius);
  const vHalfFov = T.MathUtils.degToRad(Math.max(5, Math.min(150, camera.fov)) * 0.5);
  const safeAspect = Number.isFinite(camera.aspect) && camera.aspect > 0.1 ? camera.aspect : 1;
  const hHalfFov = Math.atan(Math.tan(vHalfFov) * safeAspect);
  const limitingHalfFov = Math.max(0.05, Math.min(vHalfFov, hHalfFov));
  const rawDistance = (safeRadius * paddingFactor) / Math.sin(limitingHalfFov);
  return T.MathUtils.clamp(rawDistance, minDistance, maxDistance);
}

export function clientToNdc(
  clientX: number,
  clientY: number,
  rect: ViewportRectLike,
  out = new T.Vector2(),
): T.Vector2 {
  const w = Math.max(1, rect.width);
  const h = Math.max(1, rect.height);
  return out.set(
    ((clientX - rect.left) / w) * 2 - 1,
    -((clientY - rect.top) / h) * 2 + 1,
  );
}

export class ViewportNavigationController extends T.EventDispatcher<ViewportNavigationEventMap> {
  readonly camera: T.PerspectiveCamera;
  readonly target = new T.Vector3(0, 0.95, 0);
  enabled = true;
  minDistance: number;
  minTargetDistance: number;
  maxDistance: number;
  minPanDepth: number;
  maxPanDepth: number;
  rotateSpeed: number;
  zoomSpeed: number;
  groundY: number;
  positionClamp: number | null;
  targetClamp: number | null;

  private domElement: HTMLElement | null;
  private context?: NavigationSceneContext;
  private shouldIgnorePointerDown?: (event: PointerEvent) => boolean;

  private readonly raycaster = new T.Raycaster();
  private readonly groundPlane: T.Plane;
  private activePointers = new Map<number, { x: number; y: number; pointerType: string }>();
  private gesturePointerId: number | null = null;
  private gesture: PointerGestureState | null = null;
  private touchPinchPrev: { midX: number; midY: number; span: number; panDepth: number } | null = null;
  private frameAnim: FrameAnimationState | null = null;
  private lastUpdateNow: number | null = null;
  private releaseDocDragLock: (() => void) | null = null;

  constructor(options: ViewportNavigationOptions) {
    super();
    this.camera = options.camera;
    this.domElement = options.domElement ?? null;
    this.context = options.context;
    this.minDistance = options.minDistance ?? 0.08;
    this.minTargetDistance = options.minTargetDistance ?? 0.2;
    this.maxDistance = options.maxDistance ?? 120;
    this.minPanDepth = options.minPanDepth ?? 0.12;
    this.maxPanDepth = options.maxPanDepth ?? 60;
    this.rotateSpeed = options.rotateSpeed ?? 1.0;
    this.zoomSpeed = options.zoomSpeed ?? 1.0;
    this.groundY = options.groundY ?? 0;
    this.positionClamp = options.positionClamp ?? null;
    this.targetClamp = options.targetClamp ?? null;
    this.shouldIgnorePointerDown = options.shouldIgnorePointerDown;
    this.groundPlane = new T.Plane(new T.Vector3(0, 1, 0), -this.groundY);
    this.raycaster.layers.set(STAGE_LAYER);

    if (options.initialTarget) {
      this.target.fromArray(options.initialTarget);
    }
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld(true);

    if (this.domElement) {
      this.connect(this.domElement);
    }
  }

  setContext(context: NavigationSceneContext): void {
    this.context = context;
  }

  private connect(element: HTMLElement): void {
    this.domElement = element;
    element.style.touchAction = 'none';
    if (typeof element.getAttribute === 'function' && element.getAttribute('tabindex') === null) {
      element.tabIndex = -1;
    }
    element.draggable = false;
    element.addEventListener('contextmenu', this.onContextMenu);
    element.addEventListener('mousedown', this.onMouseDown);
    element.addEventListener('dragstart', this.onNativeDragOrSelect);
    element.addEventListener('selectstart', this.onNativeDragOrSelect);
    element.addEventListener('pointerdown', this.onPointerDown);
    element.addEventListener('pointermove', this.onPointerMove);
    element.addEventListener('pointerup', this.onPointerUp);
    element.addEventListener('pointercancel', this.onPointerCancel);
    element.addEventListener('wheel', this.onWheel, { passive: false });
  }

  disconnect(): void {
    if (!this.domElement) return;
    const el = this.domElement;
    el.removeEventListener('contextmenu', this.onContextMenu);
    el.removeEventListener('mousedown', this.onMouseDown);
    el.removeEventListener('dragstart', this.onNativeDragOrSelect);
    el.removeEventListener('selectstart', this.onNativeDragOrSelect);
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointercancel', this.onPointerCancel);
    el.removeEventListener('wheel', this.onWheel);
    this.cancelActiveGesture(false);
    this.domElement = null;
  }

  dispose(): void {
    this.cancelAnimation();
    this.disconnect();
  }

  get isDragging(): boolean {
    return this.gesture !== null || this.touchPinchPrev !== null;
  }

  get isAnimating(): boolean {
    return this.frameAnim !== null;
  }

  cancelAnimation(): void {
    this.frameAnim = null;
    this.lastUpdateNow = null;
  }

  finishAnimation(): void {
    if (!this.frameAnim) return;
    const anim = this.frameAnim;
    this.frameAnim = null;
    this.lastUpdateNow = null;
    this.applyCameraAndTarget(anim.goalPos, anim.goalTarget);
    this.dispatchEvent({ type: 'change' });
    this.dispatchEvent({ type: 'end' });
  }

  /**
   * Synchronizes camera orientation with `camera.position` and `this.target` and advances
   * any active `frameFocus` transition.
   */
  update(explicitDtSeconds?: number): boolean {
    if (this.frameAnim) {
      let dtMs: number;
      if (explicitDtSeconds !== undefined) {
        dtMs = Math.max(0, explicitDtSeconds * 1000);
      } else {
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        dtMs = this.lastUpdateNow === null ? 16.67 : Math.min(100, Math.max(0, now - this.lastUpdateNow));
        this.lastUpdateNow = now;
      }

      this.frameAnim.elapsedMs += dtMs;
      const rawT = this.frameAnim.durationMs <= 0
        ? 1
        : Math.min(1, this.frameAnim.elapsedMs / this.frameAnim.durationMs);
      const eased = 1 - Math.pow(1 - rawT, 3);

      const pos = new T.Vector3().lerpVectors(this.frameAnim.startPos, this.frameAnim.goalPos, eased);
      const tgt = new T.Vector3().lerpVectors(this.frameAnim.startTarget, this.frameAnim.goalTarget, eased);
      this.applyCameraAndTarget(pos, tgt);
      this.dispatchEvent({ type: 'change' });

      if (rawT >= 1) {
        this.frameAnim = null;
        this.lastUpdateNow = null;
        this.dispatchEvent({ type: 'end' });
      }
      return true;
    }

    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld(true);
    return false;
  }

  private getForwardDirection(out = new T.Vector3()): T.Vector3 {
    out.copy(this.target).sub(this.camera.position);
    if (out.lengthSq() > 1e-10) {
      return out.normalize();
    }
    return this.camera.getWorldDirection(out);
  }

  private extractSphericalAngles(): { theta: number; phi: number } {
    const backward = this.getForwardDirection(new T.Vector3()).negate();
    const phi = T.MathUtils.clamp(Math.acos(T.MathUtils.clamp(backward.y, -1, 1)), MIN_POLAR_ANGLE, MAX_POLAR_ANGLE);
    let theta: number;
    if (Math.hypot(backward.x, backward.z) > 1e-6) {
      theta = Math.atan2(backward.x, backward.z);
    } else {
      const m = this.camera.matrixWorld.elements;
      theta = Math.atan2(-m[2]!, m[0]!);
    }
    return { theta, phi };
  }

  private applyCameraAndTarget(nextPosition: T.Vector3, nextTarget: T.Vector3): void {
    const forward = nextTarget.clone().sub(nextPosition);
    const dist = forward.length();
    const validForward = dist > 1e-7
      ? forward.divideScalar(dist)
      : this.getForwardDirection(new T.Vector3());
    const focusDist = T.MathUtils.clamp(dist > 1e-7 ? dist : this.minTargetDistance, this.minTargetDistance, this.maxDistance);

    const pos = nextPosition.clone();
    if (this.positionClamp !== null) {
      const c = this.positionClamp;
      pos.set(
        T.MathUtils.clamp(pos.x, -c, c),
        T.MathUtils.clamp(pos.y, -c, c),
        T.MathUtils.clamp(pos.z, -c, c),
      );
    }

    let cappedFocusDist = focusDist;
    if (this.targetClamp !== null) {
      const c = this.targetClamp;
      for (const axis of ['x', 'y', 'z'] as const) {
        const dirVal = validForward[axis];
        const posVal = pos[axis];
        if (Math.abs(dirVal) > 1e-6 && Math.abs(posVal) < c - this.minTargetDistance) {
          const limit = dirVal > 0 ? (c - posVal) / dirVal : (-c - posVal) / dirVal;
          if (limit > this.minTargetDistance) {
            cappedFocusDist = Math.min(cappedFocusDist, limit);
          }
        }
      }
    }

    const tgt = pos.clone().addScaledVector(validForward, cappedFocusDist);
    if (this.targetClamp !== null) {
      const c = this.targetClamp;
      tgt.set(
        T.MathUtils.clamp(tgt.x, -c, c),
        T.MathUtils.clamp(tgt.y, -c, c),
        T.MathUtils.clamp(tgt.z, -c, c),
      );
    }

    this.camera.position.copy(pos);
    this.target.copy(tgt);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld(true);
  }

  private raycastStageAtNdc(ndcX: number, ndcY: number): T.Intersection | null {
    const roots = this.context?.getRaycastRoots() ?? [];
    if (!roots.length) return null;
    for (const r of roots) r.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true);
    this.camera.updateProjectionMatrix();
    this.raycaster.layers.set(STAGE_LAYER);
    this.raycaster.near = Math.max(0.02, this.camera.near);
    this.raycaster.far = Math.min(this.maxDistance * 1.5, this.camera.far);
    this.raycaster.setFromCamera(new T.Vector2(ndcX, ndcY), this.camera);
    const hits = this.raycaster.intersectObjects(roots, true);
    for (const hit of hits) {
      if (!hit.object.visible || hit.object.userData?.ignorePick) continue;
      if (hit.distance >= this.raycaster.near) return hit;
    }
    return null;
  }

  private intersectGroundAtNdc(ndcX: number, ndcY: number, maxGroundDistance = 80): { point: T.Vector3; distance: number } | null {
    this.camera.updateMatrixWorld(true);
    this.camera.updateProjectionMatrix();
    this.groundPlane.constant = -this.groundY;
    this.raycaster.setFromCamera(new T.Vector2(ndcX, ndcY), this.camera);
    const denom = this.groundPlane.normal.dot(this.raycaster.ray.direction);
    if (Math.abs(denom) < 1e-4) return null;
    const t = -(this.raycaster.ray.origin.dot(this.groundPlane.normal) + this.groundPlane.constant) / denom;
    if (t < 0.06 || t > maxGroundDistance) return null;
    const point = this.raycaster.ray.origin.clone().addScaledVector(this.raycaster.ray.direction, t);
    return { point, distance: t };
  }

  /**
   * Resolves the intelligent 3D world pivot for an orbit gesture:
   * 1. Active selection pivot (joint / character / prop / light / room-furniture / multi-centroid)
   *    when it is in front of the camera and inside the viewport frustum.
   * 2. Visible 3D stage surface directly under the cursor (character, prop, furniture, non-cutaway room wall/floor).
   * 3. Visible 3D stage surface at viewport center `(0, 0)`.
   * 4. Ground plane `y = groundY` intersection at viewport center (or under cursor).
   * 5. Current camera `target`.
   */
  resolveTumblePivot(ndcX = 0, ndcY = 0): { pivot: T.Vector3; source: TumblePivotSource } {
    this.camera.updateMatrixWorld(true);
    this.camera.updateProjectionMatrix();

    const cursorHit = this.raycastStageAtNdc(ndcX, ndcY);

    const selection = this.context?.getSelectionTarget() ?? null;
    if (selection) {
      const pCam = selection.pivot.clone().applyMatrix4(this.camera.matrixWorldInverse);
      const forwardDepth = -pCam.z;
      if (forwardDepth > Math.max(this.camera.near + 0.02, 0.06) && forwardDepth <= this.maxDistance) {
        const ndc = selection.pivot.clone().project(this.camera);
        if (Math.abs(ndc.x) <= SELECTION_NDC_MARGIN && Math.abs(ndc.y) <= SELECTION_NDC_MARGIN) {
          const occludedByMuchCloserForeground =
            selection.kind !== 'joint' &&
            selection.kind !== 'light-target' &&
            cursorHit !== null &&
            cursorHit.distance < forwardDepth * 0.45;
          if (!occludedByMuchCloserForeground) {
            return { pivot: selection.pivot.clone(), source: 'selection' };
          }
        }
      }
    }

    if (cursorHit) {
      return { pivot: cursorHit.point.clone(), source: 'cursor-surface' };
    }

    if (Math.abs(ndcX) > 1e-4 || Math.abs(ndcY) > 1e-4) {
      const centerHit = this.raycastStageAtNdc(0, 0);
      if (centerHit) {
        return { pivot: centerHit.point.clone(), source: 'center-surface' };
      }
    }

    const centerGround = this.intersectGroundAtNdc(0, 0, 75);
    if (centerGround) {
      return { pivot: centerGround.point, source: 'ground' };
    }

    const cursorGround = this.intersectGroundAtNdc(ndcX, ndcY, 75);
    if (cursorGround) {
      return { pivot: cursorGround.point, source: 'ground' };
    }

    return { pivot: this.target.clone(), source: 'target' };
  }

  /**
   * Samples the forward camera depth under `(ndcX, ndcY)` so panning tracks the grabbed surface 1:1.
   */
  resolvePanDepth(ndcX = 0, ndcY = 0): number {
    this.camera.updateMatrixWorld(true);
    this.camera.updateProjectionMatrix();
    const forward = this.getForwardDirection();

    const cursorHit = this.raycastStageAtNdc(ndcX, ndcY);
    if (cursorHit) {
      const depth = cursorHit.point.clone().sub(this.camera.position).dot(forward);
      if (depth > 0.02) {
        return T.MathUtils.clamp(depth, this.minPanDepth, this.maxPanDepth);
      }
    }

    const cursorGround = this.intersectGroundAtNdc(ndcX, ndcY, 80);
    if (cursorGround) {
      const depth = cursorGround.point.clone().sub(this.camera.position).dot(forward);
      if (depth > 0.02 && depth <= 35) {
        return T.MathUtils.clamp(depth, this.minPanDepth, this.maxPanDepth);
      }
      const centerHit = this.raycastStageAtNdc(0, 0);
      if (centerHit) {
        const centerDepth = centerHit.point.clone().sub(this.camera.position).dot(forward);
        if (centerDepth > 0.02) {
          return T.MathUtils.clamp(centerDepth, this.minPanDepth, this.maxPanDepth);
        }
      }
      if (depth > 0.02) {
        return T.MathUtils.clamp(depth, this.minPanDepth, this.maxPanDepth);
      }
    }

    const centerHit = this.raycastStageAtNdc(0, 0);
    if (centerHit) {
      const depth = centerHit.point.clone().sub(this.camera.position).dot(forward);
      if (depth > 0.02) {
        return T.MathUtils.clamp(depth, this.minPanDepth, this.maxPanDepth);
      }
    }

    const centerGround = this.intersectGroundAtNdc(0, 0, 80);
    if (centerGround) {
      const depth = centerGround.point.clone().sub(this.camera.position).dot(forward);
      if (depth > 0.02) {
        return T.MathUtils.clamp(depth, this.minPanDepth, this.maxPanDepth);
      }
    }

    return T.MathUtils.clamp(this.camera.position.distanceTo(this.target), this.minPanDepth, this.maxPanDepth);
  }

  /**
   * Starts a zero-jump tumble gesture at NDC `(ndcX, ndcY)`.
   * Guaranteed not to mutate `camera.position`, `camera.quaternion`, or `target` on start.
   */
  beginTumbleNdc(
    ndcX: number,
    ndcY: number,
    startClientX = 0,
    startClientY = 0,
  ): { pivot: T.Vector3; source: TumblePivotSource } {
    this.cancelAnimation();
    this.camera.up.set(0, 1, 0);
    this.camera.updateMatrixWorld(true);
    this.camera.updateProjectionMatrix();

    const { theta: theta0, phi: phi0 } = this.extractSphericalAngles();
    const right0 = new T.Vector3();
    const up0 = new T.Vector3();
    const back0 = new T.Vector3();
    buildTurntableCameraBasis(theta0, phi0, right0, up0, back0);

    const { pivot, source } = this.resolveTumblePivot(ndcX, ndcY);
    const worldOffset = pivot.clone().sub(this.camera.position);
    const pivotCam = new T.Vector3(
      worldOffset.dot(right0),
      worldOffset.dot(up0),
      worldOffset.dot(back0),
    );
    const rawForwardDepth = -pivotCam.z;
    const focusDepth = T.MathUtils.clamp(
      rawForwardDepth > this.minTargetDistance ? rawForwardDepth : this.camera.position.distanceTo(this.target),
      this.minTargetDistance,
      this.maxDistance,
    );

    this.gesture = {
      mode: 'tumble',
      startClientX,
      startClientY,
      moved: false,
      theta0,
      phi0,
      pivot,
      pivotCam,
      focusDepth,
      source,
    };

    return { pivot: pivot.clone(), source };
  }

  /**
   * Updates the active tumble gesture from cumulative pixel deltas `(totalDx, totalDy)` since `beginTumble`.
   * Preserves `pivot`'s camera-space vector `pivotCam`, keeping `pivot` locked on screen with zero jump.
   */
  updateTumbleFromStartDelta(totalDx: number, totalDy: number, viewportHeight: number): void {
    if (!this.gesture || this.gesture.mode !== 'tumble') return;
    if (!this.gesture.moved) {
      if (totalDx === 0 && totalDy === 0) return;
      this.gesture.moved = true;
      this.dispatchEvent({ type: 'start' });
    }

    const g = this.gesture;
    const anglePerPixel = ((2 * Math.PI) / Math.max(1, viewportHeight)) * this.rotateSpeed;
    const theta = g.theta0 - totalDx * anglePerPixel;
    const phi = T.MathUtils.clamp(g.phi0 - totalDy * anglePerPixel, MIN_POLAR_ANGLE, MAX_POLAR_ANGLE);

    const right = new T.Vector3();
    const up = new T.Vector3();
    const backward = new T.Vector3();
    buildTurntableCameraBasis(theta, phi, right, up, backward);

    const worldOffset = new T.Vector3()
      .addScaledVector(right, g.pivotCam.x)
      .addScaledVector(up, g.pivotCam.y)
      .addScaledVector(backward, g.pivotCam.z);

    const nextPos = g.pivot.clone().sub(worldOffset);
    const nextTarget = nextPos.clone().addScaledVector(backward, -g.focusDepth);
    this.applyCameraAndTarget(nextPos, nextTarget);
    this.dispatchEvent({ type: 'change' });
  }

  /**
   * Starts a 1:1 depth-locked pan gesture at NDC `(ndcX, ndcY)`.
   * Guaranteed not to mutate `camera.position`, `camera.quaternion`, or `target` on start.
   */
  beginPanNdc(ndcX: number, ndcY: number, startClientX = 0, startClientY = 0, deadzonePx = 0): number {
    this.cancelAnimation();
    this.camera.up.set(0, 1, 0);
    this.camera.updateMatrixWorld(true);
    this.camera.updateProjectionMatrix();

    const panDepth = this.resolvePanDepth(ndcX, ndcY);
    const m = this.camera.matrixWorld.elements;
    const right = new T.Vector3(m[0]!, m[1]!, m[2]!).normalize();
    const up = new T.Vector3(m[4]!, m[5]!, m[6]!).normalize();
    const forward = this.getForwardDirection(new T.Vector3());

    this.gesture = {
      mode: 'pan',
      startClientX,
      startClientY,
      deadzonePx,
      moved: false,
      cameraStart: this.camera.position.clone(),
      forward,
      right,
      up,
      panDepth,
      projX: this.camera.projectionMatrix.elements[0]!,
      projY: this.camera.projectionMatrix.elements[5]!,
    };

    return panDepth;
  }

  /**
   * Updates the active pan gesture from cumulative pixel deltas `(totalDx, totalDy)` since `beginPan`.
   * Translates the camera in screen plane so a world point at `panDepth` moves by exact `(totalDx, totalDy)` pixels.
   */
  updatePanFromStartDelta(
    totalDx: number,
    totalDy: number,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    if (!this.gesture || this.gesture.mode !== 'pan') return;
    if (!this.gesture.moved) {
      if (totalDx === 0 && totalDy === 0) return;
      this.gesture.moved = true;
      this.dispatchEvent({ type: 'start' });
    }

    const g = this.gesture;
    const dNdcX = (2 * totalDx) / Math.max(1, viewportWidth);
    const dNdcY = -(2 * totalDy) / Math.max(1, viewportHeight);
    const shiftRight = -(g.panDepth / g.projX) * dNdcX;
    const shiftUp = -(g.panDepth / g.projY) * dNdcY;

    const nextPos = g.cameraStart
      .clone()
      .addScaledVector(g.right, shiftRight)
      .addScaledVector(g.up, shiftUp);
    const nextTarget = nextPos.clone().addScaledVector(g.forward, g.panDepth);
    this.applyCameraAndTarget(nextPos, nextTarget);
    this.dispatchEvent({ type: 'change' });
  }

  endGesture(): void {
    const wasMoved = this.gesture?.moved ?? false;
    this.gesture = null;
    this.gesturePointerId = null;
    if (wasMoved) {
      this.dispatchEvent({ type: 'end' });
    }
  }

  /**
   * Cursor-aware dolly / wheel zoom with automatic `target` advancement so zooming
   * never stalls on a stale mid-air `controls.target` inside rooms or off-origin areas.
   */
  dollyAtNdc(ndcX: number, ndcY: number, wheelDeltaY: number, deltaMode = 0, emitStartEnd = true): void {
    const pixels = deltaMode === 1 ? wheelDeltaY * 32 : deltaMode === 2 ? wheelDeltaY * 320 : wheelDeltaY;
    if (!Number.isFinite(pixels) || Math.abs(pixels) < 1e-6) return;

    this.cancelAnimation();
    this.camera.up.set(0, 1, 0);
    this.camera.updateMatrixWorld(true);
    this.camera.updateProjectionMatrix();

    const ticks = T.MathUtils.clamp(pixels / 120, -4, 4);
    const zoomIn = ticks < 0;
    const scale = Math.pow(0.86, Math.abs(ticks) * this.zoomSpeed);
    const alpha = zoomIn ? 1 - scale : -(1 / scale - 1);

    const forward = this.getForwardDirection(new T.Vector3());
    this.raycaster.setFromCamera(new T.Vector2(ndcX, ndcY), this.camera);
    const cursorRayDir = this.raycaster.ray.direction.clone().normalize();
    const cosToForward = Math.max(0.25, cursorRayDir.dot(forward));

    let rayDist: number;
    let hasSolidSurface = false;

    const cursorHit = this.raycastStageAtNdc(ndcX, ndcY);
    if (cursorHit) {
      rayDist = cursorHit.distance;
      hasSolidSurface = true;
    } else {
      const centerHit = this.raycastStageAtNdc(0, 0);
      if (centerHit) {
        const centerForwardDepth = Math.max(0.1, centerHit.point.clone().sub(this.camera.position).dot(forward));
        rayDist = centerForwardDepth / cosToForward;
        hasSolidSurface = true;
      } else {
        const groundHit = this.intersectGroundAtNdc(ndcX, ndcY, 85) ?? this.intersectGroundAtNdc(0, 0, 85);
        if (groundHit) {
          rayDist = groundHit.distance;
          hasSolidSurface = false;
        } else {
          const fallbackForward = Math.max(1.2, this.camera.position.distanceTo(this.target));
          rayDist = fallbackForward / cosToForward;
          hasSolidSurface = false;
        }
      }
    }

    let travel: number;
    if (zoomIn) {
      if (hasSolidSurface) {
        if (rayDist <= this.minDistance) return;
        travel = Math.min(alpha * rayDist, rayDist - this.minDistance);
      } else {
        const effectiveDist = Math.max(rayDist, 1.0);
        travel = alpha * effectiveDist;
      }
    } else {
      const effectiveDist = T.MathUtils.clamp(Math.max(rayDist, 0.35), 0.35, this.maxDistance);
      travel = alpha * effectiveDist;
      if (effectiveDist - travel > this.maxDistance) {
        travel = Math.min(0, effectiveDist - this.maxDistance);
      }
      if (Math.abs(travel) < 1e-7) return;
    }

    const refPoint = this.camera.position.clone().addScaledVector(cursorRayDir, Math.max(rayDist, this.minTargetDistance));
    const nextPos = this.camera.position.clone().addScaledVector(cursorRayDir, travel);
    const remainingForward = refPoint.sub(nextPos).dot(forward);
    const currentTargetDist = this.camera.position.distanceTo(this.target);
    const nextFocusDepth = T.MathUtils.clamp(
      remainingForward > this.minTargetDistance
        ? remainingForward
        : Math.max(this.minTargetDistance, currentTargetDist),
      this.minTargetDistance,
      this.maxDistance,
    );
    const nextTarget = nextPos.clone().addScaledVector(forward, nextFocusDepth);

    if (emitStartEnd) this.dispatchEvent({ type: 'start' });
    this.applyCameraAndTarget(nextPos, nextTarget);
    this.dispatchEvent({ type: 'change' });
    if (emitStartEnd) this.dispatchEvent({ type: 'end' });
  }

  /**
   * Frames the active selection (or fallback scene subjects) at a FOV-fitted working distance.
   */
  frameTarget(
    frame: NavigationFrameTarget,
    options?: { immediate?: boolean; durationMs?: number },
  ): { position: T.Vector3; target: T.Vector3; distance: number } {
    this.cancelActiveGesture(false);
    this.cancelAnimation();
    this.camera.up.set(0, 1, 0);
    this.camera.updateMatrixWorld(true);
    this.camera.updateProjectionMatrix();

    const viewOffsetDir = this.camera.position.clone().sub(this.target);
    if (viewOffsetDir.lengthSq() < 1e-8) {
      viewOffsetDir.set(0, 0.2, 1);
    }
    viewOffsetDir.normalize();

    const fitDistance = computeFrameDistance(
      this.camera,
      frame.radius,
      Math.max(0.45, this.minTargetDistance),
      this.maxDistance * 0.85,
    );

    const goalTarget = frame.center.clone();
    if (this.targetClamp !== null) {
      const c = this.targetClamp;
      goalTarget.set(
        T.MathUtils.clamp(goalTarget.x, -c, c),
        T.MathUtils.clamp(goalTarget.y, -c, c),
        T.MathUtils.clamp(goalTarget.z, -c, c),
      );
    }
    const goalPos = goalTarget.clone().addScaledVector(viewOffsetDir, fitDistance);
    if (this.positionClamp !== null) {
      const c = this.positionClamp;
      goalPos.set(
        T.MathUtils.clamp(goalPos.x, -c, c),
        T.MathUtils.clamp(goalPos.y, -c, c),
        T.MathUtils.clamp(goalPos.z, -c, c),
      );
    }

    const durationMs = options?.immediate ? 0 : (options?.durationMs ?? 180);
    if (durationMs <= 0) {
      this.dispatchEvent({ type: 'start' });
      this.applyCameraAndTarget(goalPos, goalTarget);
      this.dispatchEvent({ type: 'change' });
      this.dispatchEvent({ type: 'end' });
      return { position: this.camera.position.clone(), target: this.target.clone(), distance: fitDistance };
    }

    this.frameAnim = {
      startPos: this.camera.position.clone(),
      startTarget: this.target.clone(),
      goalPos,
      goalTarget,
      elapsedMs: 0,
      durationMs,
    };
    this.lastUpdateNow = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.dispatchEvent({ type: 'start' });
    return { position: goalPos.clone(), target: goalTarget.clone(), distance: fitDistance };
  }

  frameSelection(options?: { immediate?: boolean; durationMs?: number }): { position: T.Vector3; target: T.Vector3; distance: number } {
    const target = this.context?.getFrameTarget?.() ?? {
      center: new T.Vector3(0, 1, 0),
      radius: 1.0,
    };
    return this.frameTarget(target, options);
  }

  private onContextMenu = (event: Event): void => {
    if (!this.enabled) return;
    event.preventDefault();
  };

  private onMouseDown = (event: MouseEvent): void => {
    if (!this.enabled || !this.domElement) return;
    clearDomTextSelection(this.domElement.ownerDocument);
    event.preventDefault();
  };

  private onNativeDragOrSelect = (event: Event): void => {
    event.preventDefault();
  };

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.enabled || !this.domElement) return;
    claimViewportPointerInteraction(this.domElement, event);
    if (this.shouldIgnorePointerDown?.(event)) return;

    const rect = this.domElement.getBoundingClientRect();
    if (!this.releaseDocDragLock) {
      this.releaseDocDragLock = lockDocumentSelectionDuringDrag(this.domElement.ownerDocument);
    }
    this.activePointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      pointerType: event.pointerType,
    });
    try {
      this.domElement.setPointerCapture(event.pointerId);
    } catch {
      // Ignore synthetic events without active browser pointer state.
    }

    if (event.pointerType === 'touch' && this.activePointers.size === 2) {
      if (this.gesture) this.endGesture();
      const pts = [...this.activePointers.values()];
      const midX = (pts[0]!.x + pts[1]!.x) * 0.5;
      const midY = (pts[0]!.y + pts[1]!.y) * 0.5;
      const span = Math.hypot(pts[1]!.x - pts[0]!.x, pts[1]!.y - pts[0]!.y);
      const ndc = clientToNdc(midX, midY, rect);
      this.touchPinchPrev = {
        midX,
        midY,
        span: Math.max(1, span),
        panDepth: this.resolvePanDepth(ndc.x, ndc.y),
      };
      this.dispatchEvent({ type: 'start' });
      return;
    }

    if (this.activePointers.size > 1) return;

    const ndc = clientToNdc(event.clientX, event.clientY, rect);
    if (event.button === 2 || event.button === 1) {
      this.gesturePointerId = event.pointerId;
      if (event.altKey && event.button === 2) {
        this.cancelAnimation();
        this.gesture = {
          mode: 'dolly',
          startClientX: event.clientX,
          startClientY: event.clientY,
          lastClientY: event.clientY,
          moved: false,
          ndcX: ndc.x,
          ndcY: ndc.y,
        };
      } else {
        this.beginPanNdc(ndc.x, ndc.y, event.clientX, event.clientY);
      }
      return;
    }

    if (event.button === 0 && !event.ctrlKey && !event.metaKey) {
      this.gesturePointerId = event.pointerId;
      if (event.shiftKey) {
        this.beginPanNdc(ndc.x, ndc.y, event.clientX, event.clientY, 4);
      } else {
        this.beginTumbleNdc(ndc.x, ndc.y, event.clientX, event.clientY);
      }
    }
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.domElement) return;
    if (!this.enabled) {
      if (this.gesture || this.touchPinchPrev) this.cancelActiveGesture(true);
      return;
    }

    const tracked = this.activePointers.get(event.pointerId);
    if (!tracked) return;
    tracked.x = event.clientX;
    tracked.y = event.clientY;

    const rect = this.domElement.getBoundingClientRect();

    if (this.touchPinchPrev && this.activePointers.size === 2) {
      const pts = [...this.activePointers.values()];
      const midX = (pts[0]!.x + pts[1]!.x) * 0.5;
      const midY = (pts[0]!.y + pts[1]!.y) * 0.5;
      const span = Math.max(1, Math.hypot(pts[1]!.x - pts[0]!.x, pts[1]!.y - pts[0]!.y));

      const dx = midX - this.touchPinchPrev.midX;
      const dy = midY - this.touchPinchPrev.midY;
      if (Math.abs(dx) > 0 || Math.abs(dy) > 0) {
        const ndc = clientToNdc(this.touchPinchPrev.midX, this.touchPinchPrev.midY, rect);
        this.beginPanNdc(ndc.x, ndc.y, this.touchPinchPrev.midX, this.touchPinchPrev.midY);
        if (this.gesture?.mode === 'pan') {
          this.gesture.panDepth = this.touchPinchPrev.panDepth;
          this.gesture.moved = true;
        }
        this.updatePanFromStartDelta(dx, dy, rect.width, rect.height);
        this.gesture = null;
      }

      const ratio = span / this.touchPinchPrev.span;
      if (Math.abs(ratio - 1) > 1e-3) {
        const ndc = clientToNdc(midX, midY, rect);
        const syntheticWheel = -Math.log(ratio) * 520;
        this.dollyAtNdc(ndc.x, ndc.y, syntheticWheel, 0, false);
      }

      this.touchPinchPrev.midX = midX;
      this.touchPinchPrev.midY = midY;
      this.touchPinchPrev.span = span;
      return;
    }

    if (event.pointerId !== this.gesturePointerId || !this.gesture) return;

    const totalDx = event.clientX - this.gesture.startClientX;
    const totalDy = event.clientY - this.gesture.startClientY;

    if (this.gesture.mode === 'tumble') {
      this.updateTumbleFromStartDelta(totalDx, totalDy, rect.height);
    } else if (this.gesture.mode === 'pan') {
      if (!this.gesture.moved && this.gesture.deadzonePx > 0 && Math.hypot(totalDx, totalDy) <= this.gesture.deadzonePx) {
        return;
      }
      this.updatePanFromStartDelta(totalDx, totalDy, rect.width, rect.height);
    } else if (this.gesture.mode === 'dolly') {
      const stepDy = event.clientY - this.gesture.lastClientY;
      if (stepDy === 0) return;
      if (!this.gesture.moved) {
        this.gesture.moved = true;
        this.dispatchEvent({ type: 'start' });
      }
      this.gesture.lastClientY = event.clientY;
      this.dollyAtNdc(this.gesture.ndcX, this.gesture.ndcY, stepDy * 2.2, 0, false);
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    this.releasePointer(event.pointerId);
  };

  private onPointerCancel = (event: PointerEvent): void => {
    this.releasePointer(event.pointerId);
  };

  private releasePointer(pointerId: number): void {
    if (this.domElement) {
      try {
        if (this.domElement.hasPointerCapture(pointerId)) {
          this.domElement.releasePointerCapture(pointerId);
        }
      } catch {
        // Ignore synthetic release errors.
      }
    }
    this.activePointers.delete(pointerId);
    if (this.touchPinchPrev && this.activePointers.size < 2) {
      this.touchPinchPrev = null;
      this.dispatchEvent({ type: 'end' });
    }
    if (pointerId === this.gesturePointerId) {
      this.endGesture();
    }
    if (this.activePointers.size === 0 && this.releaseDocDragLock) {
      this.releaseDocDragLock();
      this.releaseDocDragLock = null;
    }
  }

  private cancelActiveGesture(emitEnd: boolean): void {
    if (this.domElement) {
      for (const id of this.activePointers.keys()) {
        try {
          if (this.domElement.hasPointerCapture(id)) {
            this.domElement.releasePointerCapture(id);
          }
        } catch {
          // Ignore synthetic release errors.
        }
      }
    }
    const wasActive = Boolean((this.gesture && this.gesture.moved) || this.touchPinchPrev);
    this.activePointers.clear();
    this.gesture = null;
    this.gesturePointerId = null;
    this.touchPinchPrev = null;
    if (this.releaseDocDragLock) {
      this.releaseDocDragLock();
      this.releaseDocDragLock = null;
    }
    if (emitEnd && wasActive) {
      this.dispatchEvent({ type: 'end' });
    }
  }

  private onWheel = (event: WheelEvent): void => {
    if (!this.enabled || !this.domElement) return;
    event.preventDefault();
    const rect = this.domElement.getBoundingClientRect();
    const ndc = clientToNdc(event.clientX, event.clientY, rect);
    this.dollyAtNdc(ndc.x, ndc.y, event.deltaY, event.deltaMode, true);
  };
}
