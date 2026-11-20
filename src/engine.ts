import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { computeAnchoredPositionY, getJointRotation, measureFigureMinWorldY, setFigurePose, type Figure } from './rig';
import { makeExternalFigure, setFigureColors, setFigureHairStyle } from './external-rig';
import { DEFAULT_BODY_TYPE, type BodyTypeId } from './bodyProportions';
import { clampPoseToAnatomicalLimits } from './skinDeformer';
import { makeProp } from './props';
import { pickJointMarker, sizeJointMarker } from './joint-markers';
import { HELPER_LAYER, STAGE_LAYER, NprInkPass, StudioShadingController, needsInk, paperColor, setLayerRecursive } from './npr';
import { clone, DEFAULT_HAIR_COLOR, DEFAULT_RENDER_STYLE, defaultOutfitColor, isBody, JOINTS, selectionCentroid, transformItems, validatePortable, type Body, type Item, type Joint, type Pose, type SceneState, type Vec3 } from './model';

interface Entry { kind: Item['kind']; root: T.Group; figure?: Figure; light?: T.SpotLight; target?: T.Object3D; markers?: T.Mesh<T.SphereGeometry, T.MeshBasicMaterial>[] }
export interface EngineOptions {
  change: (state: SceneState) => void;
  liveChange?: (state: SceneState) => void;
  orbitChange?: (orbit: { position: Vec3; target: Vec3 }, settled: boolean) => void;
  cameraChange?: (cameraPose: { position: Vec3; target: Vec3 }, settled: boolean) => void;
  select: (id: string | null, joint: Joint | null, additive?: boolean) => void;
  selectMany?: (ids: string[]) => void;
  error: (error: unknown) => void;
}
export class Studio {
  readonly renderer: T.WebGLRenderer;
  readonly scene = new T.Scene();
  readonly editorCamera = new T.PerspectiveCamera(42, 1, 0.02, 500);
  readonly camera = new T.PerspectiveCamera();
  readonly orbit: OrbitControls;
  readonly cameraOrbit: OrbitControls;
  readonly transform: TransformControls;
  readonly entries = new Map<string, Entry>();
  private readonly grid: T.GridHelper;
  private readonly fill: T.DirectionalLight;
  private readonly resizeObserver: ResizeObserver;
  private composer: EffectComposer | null = null;
  private bokeh: BokehPass | null = null;
  private renderPass: RenderPass | null = null;
  private inkPass: NprInkPass | null = null;
  private shading = new StudioShadingController();
  private helperDepth = new T.MeshDepthMaterial({ colorWrite: false });
  private selectedIds: string[] = [];
  readonly groupPivot = new T.Object3D();
  private groupBase: { items: Item[]; inverse: T.Matrix4 } | null = null;
  private marquee: { pointer: number; x: number; y: number; additive: boolean; element: HTMLDivElement } | null = null;
  private state: SceneState | null = null;
  private selected: string | null = null;
  private joint: Joint | null = null;
  private cameraView = false;
  private jointsVisible = true;
  private helpers = true;
  private pointerStart = new T.Vector2();
  private recentlyDragged = false;
  private nodePointer: number | null = null;
  private hoveredMarker: T.Mesh<T.SphereGeometry, T.MeshBasicMaterial> | null = null;
  private transformChanged = false;
  private suppressOrbitEmit = false;
  private lastOrbit: [number, number, number, number, number, number] = [3.2, 2.4, 5.2, 0, 0.95, 0];
  private suppressCameraEmit = false;
  private cameraPointerDown = false;
  private cameraGestureDirty = false;
  private cameraWheelTimer: ReturnType<typeof setTimeout> | null = null;
  private lastCameraPose: [number, number, number, number, number, number] = [0, 1.35, 3.8, 0, 1.05, 0];
  private alive = true;
  private width = 1;
  private height = 1;
  private mode: 'translate' | 'rotate' | 'scale' = 'translate';
  private host: HTMLDivElement;
  private options: EngineOptions;
  constructor(host: HTMLDivElement, options: EngineOptions) {
    this.host = host; this.options = options;
    this.renderer = new T.WebGLRenderer({ antialias: true, alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.domElement.setAttribute('aria-label', 'Interactive 3D posing viewport');
    this.host.appendChild(this.renderer.domElement);
    this.editorCamera.position.set(3.2, 2.4, 5.2);
    this.editorCamera.layers.enable(HELPER_LAYER);
    this.orbit = new OrbitControls(this.editorCamera, this.renderer.domElement);
    this.orbit.target.set(0, 0.95, 0); this.orbit.enableDamping = true; this.orbit.minDistance = 0.3; this.orbit.maxDistance = 80;
    this.orbit.update();
    this.recordOrbit();
    this.orbit.addEventListener('change', this.handleOrbitChange);
    this.orbit.addEventListener('end', this.handleOrbitEnd);
    this.camera.position.set(0, 1.35, 3.8);
    this.cameraOrbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.cameraOrbit.target.set(0, 1.05, 0);
    this.cameraOrbit.enableDamping = false;
    this.cameraOrbit.minDistance = 0.25;
    this.cameraOrbit.maxDistance = 65;
    this.cameraOrbit.enabled = false;
    this.cameraOrbit.update();
    this.recordCameraPose();
    this.cameraOrbit.addEventListener('change', this.handleCameraOrbitChange);
    this.cameraOrbit.addEventListener('end', this.handleCameraOrbitEnd);
    this.transform = new TransformControls(this.editorCamera, this.renderer.domElement);
    this.transform.setSize(0.85);
    this.scene.add(this.groupPivot);
    setLayerRecursive(this.transform.getHelper(), HELPER_LAYER);
    this.transform.getRaycaster().layers.enable(HELPER_LAYER);
    this.scene.add(this.transform.getHelper());
    this.transform.addEventListener('mouseDown', () => {
      if (this.selectedIds.length < 2 || !this.state) return;
      this.groupPivot.updateMatrix();
      this.groupBase = { items: clone(this.state.items), inverse: this.groupPivot.matrix.clone().invert() };
    });
    this.transform.addEventListener('dragging-changed', e => {
      this.orbit.enabled = !e.value && !this.cameraView;
      this.cameraOrbit.enabled = !e.value && this.cameraView;
      if (e.value) { this.recentlyDragged = true; this.transformChanged = false; }
    });
    this.transform.addEventListener('objectChange', () => {
      if (this.groupBase) {
        this.groupPivot.updateMatrix();
        const delta = this.groupPivot.matrix.clone().multiply(this.groupBase.inverse);
        for (const item of transformItems(this.groupBase.items, this.selectedIds, delta)) {
          if (!this.selectedIds.includes(item.id)) continue;
          const entry = this.entries.get(item.id);
          if (!entry) continue;
          entry.root.position.fromArray(item.position); entry.root.rotation.set(...item.rotation); entry.root.scale.fromArray(item.scale);
          if (entry.target && item.target) entry.target.position.fromArray(item.target);
        }
      }
      if (this.joint && this.selected) {
        const entry = this.entries.get(this.selected), item = this.state?.items.find(i => i.id === this.selected);
        if (entry?.figure && item?.pose) {
          const pose = clone(item.pose);
          pose[this.joint] = getJointRotation(entry.figure, this.joint);
          setFigurePose(entry.figure, pose);
        }
      }
      this.transformChanged = true;
      const live = this.readLiveState();
      if (live) this.options.liveChange?.(live);
    });
    this.transform.addEventListener('mouseUp', () => {
      if (this.transformChanged) {
        this.commitTransforms();
        this.transformChanged = false;
      }
      this.groupBase = null;
      setTimeout(() => { this.recentlyDragged = false; }, 0);
    });
    this.scene.add(new T.HemisphereLight('#d8e5ff', '#615448', 1.6));
    this.fill = new T.DirectionalLight('#ffffff', 1.1); this.fill.position.set(-4, 4, -2); this.scene.add(this.fill);
    const floor = new T.Mesh(new T.PlaneGeometry(200, 200), new T.MeshStandardMaterial({ color: '#55514a', roughness: 0.96 }));
    floor.userData.nprFloor = true;
    this.shading.attachStudioShading(floor.material);
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.005; floor.receiveShadow = true; this.scene.add(floor);
    this.grid = new T.GridHelper(20, 40, '#7b7771', '#62605b'); this.grid.position.y = -0.003; this.scene.add(this.grid);
    setLayerRecursive(this.grid, HELPER_LAYER);
    this.renderer.domElement.addEventListener('pointerdown', this.pointerDown, true);
    this.renderer.domElement.addEventListener('touchstart', this.cameraTouchStart, { capture: true, passive: true });
    this.renderer.domElement.addEventListener('pointerup', this.nodePointerUp, true);
    this.renderer.domElement.addEventListener('pointermove', this.pointerMove, true);
    this.renderer.domElement.addEventListener('pointerleave', this.pointerLeave);
    this.renderer.domElement.addEventListener('pointercancel', this.pointerCancel);
    this.renderer.domElement.addEventListener('pointerup', this.pointerUp);
    this.renderer.domElement.addEventListener('webglcontextlost', this.contextLost);
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(host);
    this.renderer.setAnimationLoop(() => {
      if (!this.alive) return;
      if (this.cameraView) this.cameraOrbit.update();
      else this.orbit.update();
      try { this.render(); } catch (e) { this.renderer.setAnimationLoop(null); options.error(e); }
    });
  }
  private contextLost = (event: Event) => { event.preventDefault(); this.options.error(new Error('WebGL context lost. Save a JSON backup if possible, then reload this tab.')); };
  private markerAt(event: PointerEvent) {
    const entry = this.selected ? this.entries.get(this.selected) : null;
    return this.cameraView ? null : pickJointMarker(entry?.markers ?? [], this.editorCamera, this.renderer.domElement.getBoundingClientRect(), event.clientX, event.clientY);
  }
  private cameraTouchStart = () => {
    if (this.cameraView && !this.transform.dragging) this.cameraPointerDown = true;
  };
  private pointerDown = (event: PointerEvent) => {
    this.pointerStart.set(event.clientX, event.clientY);
    if (event.button === 0 && (event.ctrlKey || event.metaKey) && !this.transform.dragging) {
      event.stopImmediatePropagation();
      const element = document.createElement('div'); element.className = 'selection-marquee';
      this.host.appendChild(element);
      this.marquee = { pointer: event.pointerId, x: event.clientX, y: event.clientY, additive: event.shiftKey, element };
      this.orbit.enabled = false; this.cameraOrbit.enabled = false;
      this.renderer.domElement.setPointerCapture(event.pointerId);
      return;
    }
    if (this.cameraView && !this.transform.dragging) {
      this.cameraPointerDown = true;
      return;
    }
    if (event.button !== 0 || this.transform.dragging) return;
    const marker = event.shiftKey || this.selectedIds.length > 1 ? null : this.markerAt(event);
    if (!marker) return;
    // Visible overlay nodes own the click, even where skin or a gizmo lies in front.
    event.stopImmediatePropagation();
    this.nodePointer = event.pointerId;
    this.renderer.domElement.setPointerCapture(event.pointerId);
    this.select(this.selected, marker.userData.joint);
    this.options.select(this.selected, marker.userData.joint);
  };
  private nodePointerUp = (event: PointerEvent) => {
    if (this.marquee?.pointer === event.pointerId) {
      event.stopImmediatePropagation();
      this.finishMarquee(event);
      return;
    }
    if (event.pointerId !== this.nodePointer) return;
    event.stopImmediatePropagation();
    this.nodePointer = null;
    this.renderer.domElement.releasePointerCapture(event.pointerId);
  };
  private pointerMove = (event: PointerEvent) => {
    if (this.marquee) {
      const rect = this.host.getBoundingClientRect(), m = this.marquee;
      Object.assign(m.element.style, {
        left: `${Math.min(m.x, event.clientX) - rect.left}px`, top: `${Math.min(m.y, event.clientY) - rect.top}px`,
        width: `${Math.abs(m.x - event.clientX)}px`, height: `${Math.abs(m.y - event.clientY)}px`,
      });
      return;
    }
    if (this.transform.dragging || this.nodePointer !== null) return;
    this.hoveredMarker = this.markerAt(event);
    this.updateMarkerColors();
    this.renderer.domElement.style.cursor = this.hoveredMarker ? 'pointer' : '';
    this.renderer.domElement.title = this.hoveredMarker ? `${this.hoveredMarker.userData.joint.replace(/([A-Z])/g, ' $1')} - click to rotate` : '';
  };
  private pointerLeave = () => {
    this.hoveredMarker = null; this.updateMarkerColors();
    this.renderer.domElement.style.cursor = ''; this.renderer.domElement.title = '';
  };
  private pointerCancel = () => {
    this.cancelMarquee();
    this.nodePointer = null;
    this.flushCameraGesture();
    if (this.transform.dragging) this.transform.pointerUp(null);
    if (this.transformChanged) {
      this.commitTransforms();
      this.transformChanged = false;
    }
    this.pointerLeave();
  };
  private cancelMarquee(): void {
    if (!this.marquee) return;
    const { pointer, element } = this.marquee;
    element.remove(); this.marquee = null;
    if (this.renderer.domElement.hasPointerCapture(pointer)) this.renderer.domElement.releasePointerCapture(pointer);
    this.orbit.enabled = !this.cameraView; this.cameraOrbit.enabled = this.cameraView;
  }
  private finishMarquee(event: PointerEvent): void {
    const m = this.marquee;
    if (!m) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const left = Math.min(m.x, event.clientX), right = Math.max(m.x, event.clientX);
    const top = Math.min(m.y, event.clientY), bottom = Math.max(m.y, event.clientY);
    const camera = this.cameraView ? this.camera : this.editorCamera;
    camera.updateMatrixWorld(true);
    const ids = m.additive ? [...this.selectedIds] : [];
    for (const [id, entry] of this.entries) {
      entry.root.updateMatrixWorld(true);
      const box = new T.Box3().setFromObject(entry.root);
      const points: T.Vector3[] = [entry.root.getWorldPosition(new T.Vector3())];
      if (!box.isEmpty()) for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) points.push(new T.Vector3(x, y, z));
      entry.markers?.forEach(marker => points.push(marker.getWorldPosition(new T.Vector3())));
      const projected = points.map(p => p.project(camera)).filter(p => p.z >= -1 && p.z <= 1);
      if (!projected.length) continue;
      const xs = projected.map(p => rect.left + (p.x + 1) * rect.width / 2);
      const ys = projected.map(p => rect.top + (1 - p.y) * rect.height / 2);
      if (Math.max(...xs) >= left && Math.min(...xs) <= right && Math.max(...ys) >= top && Math.min(...ys) <= bottom && !ids.includes(id)) ids.push(id);
    }
    this.cancelMarquee();
    this.options.selectMany?.(ids);
  }
  private recordOrbit(): void {
    const p = this.editorCamera.position, t = this.orbit.target;
    this.lastOrbit = [p.x, p.y, p.z, t.x, t.y, t.z];
  }
  private emitOrbit(settled: boolean): void {
    if (this.suppressOrbitEmit) return;
    const p = this.editorCamera.position, t = this.orbit.target;
    const next: [number, number, number, number, number, number] = [p.x, p.y, p.z, t.x, t.y, t.z];
    const moved = next.some((v, idx) => Math.abs(v - this.lastOrbit[idx]!) > 1e-4);
    if (!moved && !settled) return;
    this.lastOrbit = next;
    this.options.orbitChange?.(this.getOrbitView(), settled);
  }
  private handleOrbitChange = () => {
    this.emitOrbit(false);
  };
  private handleOrbitEnd = () => {
    this.emitOrbit(true);
  };
  private clampCameraOrbit(): void {
    this.cameraOrbit.target.set(
      T.MathUtils.clamp(this.cameraOrbit.target.x, -85, 85),
      T.MathUtils.clamp(this.cameraOrbit.target.y, -85, 85),
      T.MathUtils.clamp(this.cameraOrbit.target.z, -85, 85),
    );
    this.camera.position.set(
      T.MathUtils.clamp(this.camera.position.x, -99, 99),
      T.MathUtils.clamp(this.camera.position.y, -99, 99),
      T.MathUtils.clamp(this.camera.position.z, -99, 99),
    );
    this.camera.lookAt(this.cameraOrbit.target);
  }
  private recordCameraPose(): void {
    const p = this.camera.position, t = this.cameraOrbit.target;
    this.lastCameraPose = [p.x, p.y, p.z, t.x, t.y, t.z];
  }
  getCameraOrbitView(): { position: Vec3; target: Vec3 } {
    const round4 = (n: number) => Number(n.toFixed(4));
    const p = this.camera.position, t = this.cameraOrbit.target;
    return {
      position: [round4(p.x), round4(p.y), round4(p.z)],
      target: [round4(t.x), round4(t.y), round4(t.z)],
    };
  }
  flushCameraGesture(): void {
    if (this.cameraWheelTimer !== null) {
      clearTimeout(this.cameraWheelTimer);
      this.cameraWheelTimer = null;
    }
    this.cameraPointerDown = false;
    if (!this.cameraGestureDirty) return;
    this.cameraGestureDirty = false;
    const pose = this.getCameraOrbitView();
    if (this.state) {
      this.state.camera.position = clone(pose.position);
      this.state.camera.target = clone(pose.target);
    }
    this.options.cameraChange?.(pose, true);
  }
  cancelCameraGesture(): void {
    if (this.cameraWheelTimer !== null) {
      clearTimeout(this.cameraWheelTimer);
      this.cameraWheelTimer = null;
    }
    this.cameraPointerDown = false;
    this.cameraGestureDirty = false;
  }
  private handleCameraOrbitChange = () => {
    if (this.suppressCameraEmit || !this.cameraView) return;
    this.clampCameraOrbit();
    const p = this.camera.position, t = this.cameraOrbit.target;
    const next: [number, number, number, number, number, number] = [p.x, p.y, p.z, t.x, t.y, t.z];
    const moved = next.some((v, idx) => Math.abs(v - this.lastCameraPose[idx]!) > 1e-4);
    if (!moved) return;
    this.lastCameraPose = next;
    this.cameraGestureDirty = true;
    const pose = this.getCameraOrbitView();
    if (this.state) {
      this.state.camera.position = clone(pose.position);
      this.state.camera.target = clone(pose.target);
    }
    this.options.cameraChange?.(pose, false);
    if (!this.cameraPointerDown) {
      if (this.cameraWheelTimer !== null) clearTimeout(this.cameraWheelTimer);
      this.cameraWheelTimer = setTimeout(() => {
        this.cameraWheelTimer = null;
        this.flushCameraGesture();
      }, 160);
    }
  };
  private handleCameraOrbitEnd = () => {
    if (this.suppressCameraEmit || !this.cameraView) return;
    if (this.cameraPointerDown) {
      this.cameraPointerDown = false;
      this.flushCameraGesture();
    }
  };
  private updateMarkerColors(): void {
    for (const entry of this.entries.values()) entry.markers?.forEach(m => {
      m.material.color.set(m.userData.joint === this.joint ? '#ff826b' : m === this.hoveredMarker ? '#ffffff' : '#ffd07d');
    });
  }
  private pointerUp = (event: PointerEvent) => {
    if (this.recentlyDragged || this.transform.dragging || (!event.shiftKey && this.transform.axis) || this.pointerStart.distanceTo(new T.Vector2(event.clientX, event.clientY)) > 4) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const pointer = new T.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    const ray = new T.Raycaster(); ray.layers.enable(HELPER_LAYER); ray.setFromCamera(pointer, this.cameraView ? this.camera : this.editorCamera);
    const targets = [...this.entries.values()].flatMap(e => [e.root]);
    const hit = ray.intersectObjects(targets, true).find(h => h.object.visible && !h.object.userData.ignorePick && !h.object.userData.joint);
    if (!hit) { if (!event.shiftKey) this.options.select(null, null); return; }
    let node: T.Object3D | null = hit.object;
    const joint: Joint | null = hit.object.userData.joint ?? null;
    while (node && !node.userData.itemId) node = node.parent;
    if (node) this.options.select(node.userData.itemId, joint, event.shiftKey);
  };
  sync(state: SceneState): void {
    this.state = clone(state);
    for (const [id, entry] of this.entries) if (!state.items.some(i => i.id === id && i.kind === entry.kind)) {
      this.transform.detach(); this.scene.remove(entry.root);
      if (entry.target) this.scene.remove(entry.target);
      disposeObject(entry.root); this.entries.delete(id);
    }
    for (const item of state.items) {
      let entry = this.entries.get(item.id);
      if (!entry) {
        if (isBody(item.kind)) {
          const figure = makeExternalFigure(item.kind, item.color, item.outfitColor ?? defaultOutfitColor(item.kind));
          const markers = JOINTS.map(j => {
            const m = new T.Mesh(new T.SphereGeometry(0.022, 16, 12), new T.MeshBasicMaterial({ color: '#ffd07d', depthTest: false, depthWrite: false }));
            m.renderOrder = 20; m.userData.joint = j; m.layers.set(HELPER_LAYER); figure.bones[j].add(m); return m;
          });
          entry = { kind: item.kind, root: figure.root, figure, markers };
        } else if (item.kind === 'light') {
          const root = new T.Group();
          const bulb = new T.Mesh(new T.SphereGeometry(0.07, 16, 12), new T.MeshBasicMaterial({ color: item.color }));
          root.add(bulb);
          bulb.layers.set(HELPER_LAYER);
          const light = new T.SpotLight(item.color, item.intensity, 70, Math.PI / 3, 0.65, 1.3);
          light.castShadow = true; light.shadow.mapSize.set(1024, 1024); light.shadow.bias = -0.0003;
          root.add(light);
          const target = new T.Object3D(); this.scene.add(target); light.target = target;
          entry = { kind: item.kind, root, light, target };
        } else entry = { kind: item.kind, root: makeProp(item.kind, item.color) };
        entry.root.userData.itemId = item.id; this.entries.set(item.id, entry); this.scene.add(entry.root);
      }
      entry.root.position.fromArray(item.position); entry.root.rotation.set(...item.rotation); entry.root.scale.fromArray(item.scale);
      if (entry.figure && item.pose && isBody(item.kind)) {
        entry.figure.deformation = { bodyType: item.bodyType ?? DEFAULT_BODY_TYPE, limitMode: item.anatomicalLimits === false ? 'free' : 'anatomical' };
        setFigurePose(entry.figure, item.pose);
        setFigureHairStyle(entry.figure, item.kind, item.hairStyle, item.hairColor ?? DEFAULT_HAIR_COLOR);
        setFigureColors(
          entry.figure,
          item.color,
          item.outfitColor ?? defaultOutfitColor(item.kind),
          item.hairColor ?? DEFAULT_HAIR_COLOR,
        );
      }
      else if (!entry.light) entry.root.traverse(node => {
        if (node instanceof T.Mesh && node.material instanceof T.MeshStandardMaterial && !node.userData.fixedColor) node.material.color.set(item.color);
      });
      if (entry.light) {
        entry.light.color.set(item.color); entry.light.intensity = item.intensity ?? 30; entry.target!.position.fromArray(item.target ?? [0, 1, 0]);
        const bulb = entry.root.children[0] as T.Mesh<T.SphereGeometry, T.MeshBasicMaterial>; bulb.material.color.set(item.color);
      }
      entry.root.traverse(node => {
        if (!(node instanceof T.Mesh)) return;
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
          if (material instanceof T.MeshStandardMaterial) this.shading.attachStudioShading(material);
        }
      });
    }
    this.scene.background = new T.Color(state.background);
    const c = state.camera;
    const cameraMoved =
      Math.abs(this.camera.position.x - c.position[0]) > 2e-4 ||
      Math.abs(this.camera.position.y - c.position[1]) > 2e-4 ||
      Math.abs(this.camera.position.z - c.position[2]) > 2e-4 ||
      Math.abs(this.cameraOrbit.target.x - c.target[0]) > 2e-4 ||
      Math.abs(this.cameraOrbit.target.y - c.target[1]) > 2e-4 ||
      Math.abs(this.cameraOrbit.target.z - c.target[2]) > 2e-4;
    if (cameraMoved) {
      this.suppressCameraEmit = true;
      try {
        this.cameraOrbit.target.fromArray(c.target);
        this.camera.position.fromArray(c.position);
        this.cameraOrbit.update();
        this.recordCameraPose();
      } finally {
        this.suppressCameraEmit = false;
      }
    } else {
      this.camera.lookAt(this.cameraOrbit.target);
    }
    this.camera.near = c.near; this.camera.far = c.far; this.camera.filmGauge = 36; this.camera.zoom = 1;
    this.camera.aspect = aspect(c.aspect); this.camera.setFocalLength(c.focalLength); this.camera.updateProjectionMatrix();
    if (this.bokeh) {
      this.bokeh.materialBokeh.uniforms.focus.value = c.focus; this.bokeh.materialBokeh.uniforms.aperture.value = c.aperture; this.bokeh.materialBokeh.uniforms.maxblur.value = c.maxBlur;
    }
    this.select(this.selected, this.joint);
    this.resize();
  }
  select(id: string | null, joint: Joint | null, ids?: string[]): void {
    this.selectedIds = (ids ?? (id === this.selected ? this.selectedIds : id ? [id] : [])).filter(key => this.entries.has(key));
    if (id && !this.selectedIds.includes(id)) this.selectedIds.push(id);
    if (this.selectedIds.length > 1) joint = null;
    this.selected = id; this.joint = joint;
    for (const [key, e] of this.entries) e.markers?.forEach(m => {
      m.visible = key === id && this.selectedIds.length < 2 && this.jointsVisible && !this.cameraView;
    });
    this.updateMarkerColors();
    this.transform.detach();
    this.transform.axis = null;
    const e = id ? this.entries.get(id) : null;
    if (this.selectedIds.length >= 2 && !this.cameraView && this.state) {
      this.groupPivot.position.fromArray(selectionCentroid(this.state.items.filter(i => this.selectedIds.includes(i.id))));
      this.groupPivot.rotation.set(0, 0, 0); this.groupPivot.scale.set(1, 1, 1);
      this.transform.setMode(this.mode === 'scale' ? 'translate' : this.mode);
      this.transform.setSpace('world'); this.transform.attach(this.groupPivot);
      return;
    }
    if (e && !this.cameraView) {
      this.transform.setMode(joint ? 'rotate' : this.mode);
      this.transform.setSpace(joint ? 'local' : 'world');
      this.transform.attach(joint && e.figure ? e.figure.bones[joint] : e.root);
    }
  }
  setMode(mode: 'translate' | 'rotate' | 'scale'): void { this.mode = mode; this.select(this.selected, this.joint); }
  setView(cameraView: boolean): void {
    if (this.cameraView && !cameraView) this.flushCameraGesture();
    this.cameraView = cameraView;
    this.orbit.enabled = !cameraView && !this.transform.dragging;
    this.cameraOrbit.enabled = cameraView && !this.transform.dragging;
    this.select(this.selected, this.joint);
    this.resize();
  }
  setHelpers(joints: boolean, helpers: boolean): void { this.jointsVisible = joints; this.helpers = helpers; this.select(this.selected, this.joint); }
  setOrbitView(position: Vec3, target: Vec3): void {
    this.suppressOrbitEmit = true;
    try {
      this.orbit.target.fromArray(target);
      this.editorCamera.position.fromArray(position);
      this.orbit.update();
      this.recordOrbit();
    } finally {
      this.suppressOrbitEmit = false;
    }
  }
  getOrbitView(): { position: Vec3; target: Vec3 } {
    return { position: this.editorCamera.position.toArray() as Vec3, target: this.orbit.target.toArray() as Vec3 };
  }
  focusSelected(): void {
    const e = this.selected ? this.entries.get(this.selected) : null;
    const center = e ? new T.Box3().setFromObject(e.root).getCenter(new T.Vector3()) : new T.Vector3(0, 1, 0);
    if (this.cameraView) {
      this.flushCameraGesture();
      this.suppressCameraEmit = true;
      try {
        const dir = this.camera.position.clone().sub(this.cameraOrbit.target);
        const delta = (dir.lengthSq() > 1e-6 ? dir.normalize() : new T.Vector3(0, 0.08, 1).normalize()).multiplyScalar(3.6);
        this.cameraOrbit.target.copy(center);
        this.camera.position.copy(center).add(delta);
        this.cameraOrbit.update();
        this.clampCameraOrbit();
        this.recordCameraPose();
      } finally {
        this.suppressCameraEmit = false;
      }
      const pose = this.getCameraOrbitView();
      if (this.state) {
        this.state.camera.position = clone(pose.position);
        this.state.camera.target = clone(pose.target);
      }
      this.options.cameraChange?.(pose, true);
      return;
    }
    const delta = this.editorCamera.position.clone().sub(this.orbit.target).normalize().multiplyScalar(3.6);
    this.orbit.target.copy(center); this.editorCamera.position.copy(center).add(delta);
    this.orbit.update();
    this.emitOrbit(true);
  }
  readLiveState(): SceneState | null {
    if (!this.state) return null;
    if (!this.selected || !this.transformChanged) return clone(this.state);
    const next = clone(this.state);
    if (this.selectedIds.length > 1) {
      for (const item of next.items) {
        if (!this.selectedIds.includes(item.id)) continue;
        const entry = this.entries.get(item.id);
        if (!entry) continue;
        item.position = entry.root.position.toArray() as Vec3;
        item.rotation = entry.root.rotation.toArray().slice(0, 3) as Vec3;
        item.scale = entry.root.scale.toArray() as Vec3;
        if (entry.target) item.target = entry.target.position.toArray() as Vec3;
      }
      return next;
    }
    const entry = this.entries.get(this.selected);
    const item = next.items.find(i => i.id === this.selected);
    if (!entry || !item) return clone(this.state);
    if (this.joint && entry.figure && item.pose) {
      item.pose[this.joint] = getJointRotation(entry.figure, this.joint);
    } else {
      item.position = entry.root.position.toArray() as Vec3;
      item.rotation = entry.root.rotation.toArray().slice(0, 3) as Vec3;
      item.scale = entry.root.scale.toArray() as Vec3;
    }
    try {
      const validated = validatePortable(next);
      return validated.type === 'scene' ? validated : clone(this.state);
    } catch {
      return clone(this.state);
    }
  }
  useEditorCamera(): Pick<SceneState['camera'], 'position' | 'target'> {
    return { position: this.editorCamera.position.toArray() as Vec3, target: this.orbit.target.toArray() as Vec3 };
  }
  getFigure(id: string): Figure | null {
    return this.entries.get(id)?.figure ?? null;
  }
  groundPoseY(id: string, candidatePose?: Pose, settings?: Pick<Item, 'bodyType' | 'anatomicalLimits'>): number | null {
    const entry = this.entries.get(id);
    const stateItem = this.state?.items.find(i => i.id === id);
    if (!entry?.figure || !stateItem?.pose) return null;
    const prevY = entry.root.position.y, previous = entry.figure.deformation;
    try {
      if (settings) entry.figure.deformation = { bodyType: settings.bodyType ?? DEFAULT_BODY_TYPE, limitMode: settings.anatomicalLimits === false ? 'free' : 'anatomical' };
      entry.root.position.y = 0;
      setFigurePose(entry.figure, candidatePose ?? stateItem.pose);
      const skin = entry.figure.skin, pos = skin.geometry.getAttribute('position'), vertex = new T.Vector3();
      let minY = Infinity;
      for (let i = 0; i < pos.count; i++) {
        const y = skin.getVertexPosition(i, vertex).applyMatrix4(skin.matrixWorld).y;
        if (y < minY) minY = y;
      }
      if (!Number.isFinite(minY)) throw new Error('Cannot ground the figure: deformed bounds are invalid.');
      return Number((-minY).toFixed(4));
    } finally {
      entry.root.position.y = prevY;
      entry.figure.deformation = previous;
      setFigurePose(entry.figure, stateItem.pose);
    }
  }
  anchoredFigureY(
    id: string,
    next: { kind?: Body; bodyType?: BodyTypeId; anatomicalLimits?: boolean; pose?: Pose },
  ): number | null {
    return computeStudioAnchoredFigureY(this, id, next);
  }
  previewFigurePose(id: string, pose: Pose, rootY?: number): void {
    const entry = this.entries.get(id);
    if (!entry?.figure) return;
    if (rootY !== undefined) entry.root.position.y = rootY;
    setFigurePose(entry.figure, pose);
    entry.root.updateMatrixWorld(true);
    entry.figure.skin.skeleton.update();
    if (this.selected === id && !this.cameraView) {
      this.transform.attach(this.joint ? entry.figure.bones[this.joint] : entry.root);
    }
  }
  selectedFocusDistance(): number | null {
    const e = this.selected ? this.entries.get(this.selected) : null;
    if (!e) return null;
    this.camera.updateMatrixWorld(true);
    const point = new T.Box3().setFromObject(e.root).getCenter(new T.Vector3()).applyMatrix4(this.camera.matrixWorldInverse);
    return T.MathUtils.clamp(-point.z, 0.1, 100);
  }
  private commitTransforms(): void {
    if (!this.state || !this.selected) return;
    const next = this.readLiveState()!, entry = this.entries.get(this.selected), item = next.items.find(i => i.id === this.selected);
    if (!entry || !item) return;
    if (this.selectedIds.length > 1) {
      try { validatePortable(next); this.options.change(next); }
      catch (error) { this.options.error(error); this.sync(this.state); }
      return;
    }
    if (this.joint && entry.figure && item.pose) item.pose[this.joint] = getJointRotation(entry.figure, this.joint);
    else {
      item.position = entry.root.position.toArray() as Vec3; item.rotation = entry.root.rotation.toArray().slice(0, 3) as Vec3; item.scale = entry.root.scale.toArray() as Vec3;
    }
    try { validatePortable(next); this.options.change(next); }
    catch (error) { this.options.error(error); this.sync(this.state); }
  }
  private resize(): void {
    if (!this.state) return;
    const width = Math.max(1, this.host.clientWidth), height = Math.max(1, this.host.clientHeight);
    const ratio = aspect(this.state.camera.aspect);
    this.width = Math.floor(this.cameraView ? Math.min(width, height * ratio) : width);
    this.height = Math.floor(this.cameraView ? this.width / ratio : height);
    this.renderer.setSize(this.width, this.height);
    this.editorCamera.aspect = this.width / this.height; this.editorCamera.updateProjectionMatrix();
    this.composer?.setSize(this.width, this.height);
  }
  private render(): void {
    if (!this.state) return;
    if (!this.cameraView) this.entries.forEach(e => e.markers?.forEach(m => {
      if (m.visible) sizeJointMarker(m, this.editorCamera, this.height);
    }));
    this.grid.visible = this.helpers && !this.cameraView;
    this.entries.forEach(e => { if (e.light) (e.root.children[0] as T.Mesh).visible = !this.cameraView; });
    const style = this.state.renderStyle ?? { ...DEFAULT_RENDER_STYLE };
    this.shading.update(style, this.state.background);
    // Keep the fill below the cel terminator so unshadowed fill lighting cannot
    // erase the spotlight's cast-shadow shapes.
    this.fill.intensity = style.mode === 'illustration' ? 0.35 : 1.1;
    this.renderer.toneMapping = style.mode === 'realistic' || style.mode === 'clay' ? T.ACESFilmicToneMapping : T.NoToneMapping;
    this.entries.forEach(e => { if (e.light) e.light.shadow.radius = style.mode === 'illustration' ? 1 : 2.2; });
    const activeCamera = this.cameraView ? this.camera : this.editorCamera;
    const layerMask = activeCamera.layers.mask;
    activeCamera.layers.set(STAGE_LAYER);
    const background = this.scene.background;
    if (style.mode === 'outline') this.scene.background = new T.Color(paperColor(style, this.state.background));
    const composed = needsInk(style) || (this.cameraView && this.state.camera.dof);
    if (composed) {
      if (!this.composer) {
        this.composer = new EffectComposer(this.renderer);
        this.renderPass = new RenderPass(this.scene, activeCamera);
        this.composer.addPass(this.renderPass);
        this.inkPass = new NprInkPass(this.scene, activeCamera);
        this.composer.addPass(this.inkPass);
        this.bokeh = new BokehPass(this.scene, this.camera, { focus: this.state.camera.focus, aperture: this.state.camera.aperture, maxblur: this.state.camera.maxBlur });
        // Preserve the sampled ink alpha; stock BokehPass forces opaque output.
        this.bokeh.materialBokeh.fragmentShader = this.bokeh.materialBokeh.fragmentShader.replace('gl_FragColor.a = 1.0;', '');
        this.composer.addPass(this.bokeh); this.composer.addPass(new OutputPass()); this.composer.setSize(this.width, this.height);
      }
      this.renderPass!.camera = activeCamera;
      this.inkPass!.camera = activeCamera;
      this.inkPass!.enabled = needsInk(style); this.inkPass!.update(style, this.state.background);
      this.bokeh!.enabled = this.cameraView && this.state.camera.dof;
      this.composer.render();
    } else this.renderer.render(this.scene, activeCamera);
    this.scene.background = null;
    if (!this.cameraView) {
      this.renderer.autoClear = false;
      if (composed) {
        // Full-screen passes don't carry stage depth to the canvas. Restore it
        // before helpers so the grid stays behind figures, never inside the ink.
        this.renderer.clearDepth();
        this.scene.overrideMaterial = this.helperDepth;
        this.renderer.render(this.scene, activeCamera);
        this.scene.overrideMaterial = null;
      }
      activeCamera.layers.set(HELPER_LAYER);
      this.renderer.render(this.scene, activeCamera);
      this.renderer.autoClear = true;
    }
    this.scene.background = background;
    activeCamera.layers.mask = layerMask;
  }
  async exportPng(): Promise<Blob> {
    const wasView = this.cameraView;
    const pixelRatio = this.renderer.getPixelRatio();
    this.setView(true);
    this.renderer.setPixelRatio(1); this.composer?.setPixelRatio(1);
    this.width = 1600; this.height = Math.round(1600 / this.camera.aspect);
    this.renderer.setSize(this.width, this.height); this.composer?.setSize(this.width, this.height);
    try {
      this.render();
      const blob = await new Promise<Blob>((resolve, reject) => this.renderer.domElement.toBlob(b => b ? resolve(b) : reject(new Error('PNG encoding failed.')), 'image/png'));
      return blob;
    } finally {
      this.renderer.setPixelRatio(pixelRatio); this.composer?.setPixelRatio(pixelRatio);
      this.setView(wasView);
      this.render();
    }
  }
  dispose(): void {
    this.cancelMarquee();
    this.flushCameraGesture();
    this.alive = false; this.renderer.setAnimationLoop(null); this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener('pointerdown', this.pointerDown, true);
    this.renderer.domElement.removeEventListener('touchstart', this.cameraTouchStart, true);
    this.renderer.domElement.removeEventListener('pointerup', this.nodePointerUp, true);
    this.renderer.domElement.removeEventListener('pointermove', this.pointerMove, true);
    this.renderer.domElement.removeEventListener('pointerleave', this.pointerLeave);
    this.renderer.domElement.removeEventListener('pointercancel', this.pointerCancel);
    this.renderer.domElement.removeEventListener('pointerup', this.pointerUp);
    this.renderer.domElement.removeEventListener('webglcontextlost', this.contextLost);
    this.orbit.removeEventListener('change', this.handleOrbitChange);
    this.orbit.removeEventListener('end', this.handleOrbitEnd);
    this.cameraOrbit.removeEventListener('change', this.handleCameraOrbitChange);
    this.cameraOrbit.removeEventListener('end', this.handleCameraOrbitEnd);
    this.transform.dispose(); this.orbit.dispose(); this.cameraOrbit.dispose(); this.composer?.dispose(); this.bokeh?.dispose(); this.inkPass?.dispose(); this.helperDepth.dispose();
    disposeObject(this.scene, true); this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
export function computeStudioAnchoredFigureY(
  studio: Studio | null | undefined,
  id: string,
  next: { kind?: Body; bodyType?: BodyTypeId; anatomicalLimits?: boolean; pose?: Pose },
): number | null {
  if (!studio) return null;
  const internals = studio as unknown as {
    entries?: Map<string, Entry>;
    state?: SceneState | null;
  };
  const entry = internals.entries?.get(id);
  const stateItem = internals.state?.items.find(i => i.id === id);
  if (!entry?.figure || !stateItem || !isBody(stateItem.kind) || !stateItem.pose) return null;
  const prevPos = entry.root.position.clone();
  const prevRot = entry.root.rotation.clone();
  const prevScale = entry.root.scale.clone();
  const prevDeformation = entry.figure.deformation ? { ...entry.figure.deformation } : undefined;
  let tempFigure: Figure | null = null;
  try {
    entry.root.position.fromArray(stateItem.position);
    entry.root.rotation.fromArray(stateItem.rotation);
    entry.root.scale.fromArray(stateItem.scale);
    entry.figure.deformation = {
      bodyType: stateItem.bodyType ?? DEFAULT_BODY_TYPE,
      limitMode: stateItem.anatomicalLimits === false ? 'free' : 'anatomical',
    };
    setFigurePose(entry.figure, stateItem.pose);
    const beforeMinY = measureFigureMinWorldY(entry.figure);

    const nextKind = next.kind ?? stateItem.kind;
    const nextBodyType = next.bodyType ?? stateItem.bodyType ?? DEFAULT_BODY_TYPE;
    const nextLimitMode = (next.anatomicalLimits ?? stateItem.anatomicalLimits) === false ? 'free' : 'anatomical';
    const nextPose = clampPoseToAnatomicalLimits(next.pose ?? stateItem.pose, nextLimitMode);

    let afterMinY: number;
    if (nextKind === entry.kind) {
      entry.figure.deformation = { bodyType: nextBodyType, limitMode: nextLimitMode };
      setFigurePose(entry.figure, nextPose);
      afterMinY = measureFigureMinWorldY(entry.figure);
    } else {
      tempFigure = makeExternalFigure(
        nextKind,
        stateItem.color,
        stateItem.outfitColor ?? defaultOutfitColor(stateItem.kind),
      );
      tempFigure.root.position.fromArray(stateItem.position);
      tempFigure.root.rotation.fromArray(stateItem.rotation);
      tempFigure.root.scale.fromArray(stateItem.scale);
      tempFigure.deformation = { bodyType: nextBodyType, limitMode: nextLimitMode };
      setFigurePose(tempFigure, nextPose);
      afterMinY = measureFigureMinWorldY(tempFigure);
    }
    return computeAnchoredPositionY(stateItem.position[1], beforeMinY, afterMinY);
  } finally {
    if (tempFigure) disposeObject(tempFigure.root);
    entry.root.position.copy(prevPos);
    entry.root.rotation.copy(prevRot);
    entry.root.scale.copy(prevScale);
    entry.figure.deformation = prevDeformation;
    setFigurePose(entry.figure, stateItem.pose);
  }
}

export function syncStudioScene(studio: Studio | null | undefined, state: SceneState): void {
  if (!studio) return;
  const internals = studio as unknown as {
    entries?: Map<string, Entry>;
    scene?: T.Scene;
    transform?: TransformControls;
  };
  if (internals.entries && internals.scene) {
    for (const [id, entry] of internals.entries) {
      if (!state.items.some(i => i.id === id && i.kind === entry.kind)) {
        internals.transform?.detach();
        internals.scene.remove(entry.root);
        if (entry.target) internals.scene.remove(entry.target);
        disposeObject(entry.root);
        internals.entries.delete(id);
      }
    }
  }
  studio.sync(state);
}

export function aspect(value: SceneState['camera']['aspect']): number { const [x, y] = value.split(':').map(Number); return x / y; }
function disposeObject(root: T.Object3D, releaseTextures = false): void {
  const geometries = new Set<T.BufferGeometry>(), materials = new Set<T.Material>(), skeletons = new Set<T.Skeleton>();
  root.traverse(n => {
    if (n instanceof T.Mesh || n instanceof T.LineSegments) {
      geometries.add(n.geometry);
      (Array.isArray(n.material) ? n.material : [n.material]).forEach((m: T.Material) => materials.add(m));
    }
    if (n instanceof T.SpotLight) n.dispose();
    if (n instanceof T.SkinnedMesh) skeletons.add(n.skeleton);
  });
  if (releaseTextures) {
    const textures = new Set<T.Texture>();
    materials.forEach(m => Object.values(m).forEach(value => { if (value instanceof T.Texture) textures.add(value); }));
    textures.forEach(texture => texture.dispose());
  }
  geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); skeletons.forEach(s => s.dispose());
}
