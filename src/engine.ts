import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { makeFigure, setFigurePose, type Figure } from './rig';
import { makeProp } from './props';
import { clone, isBody, JOINTS, validatePortable, type Item, type Joint, type SceneState, type Vec3 } from './model';

interface Entry { kind: Item['kind']; root: T.Group; figure?: Figure; light?: T.SpotLight; target?: T.Object3D; markers?: T.Mesh[] }
export interface EngineOptions {
  change: (state: SceneState) => void; select: (id: string | null, joint: Joint | null) => void; error: (error: unknown) => void;
}
export class Studio {
  readonly renderer: T.WebGLRenderer;
  readonly scene = new T.Scene();
  readonly editorCamera = new T.PerspectiveCamera(42, 1, 0.02, 500);
  readonly camera = new T.PerspectiveCamera();
  readonly orbit: OrbitControls;
  readonly transform: TransformControls;
  readonly entries = new Map<string, Entry>();
  private readonly grid: T.GridHelper;
  private readonly resizeObserver: ResizeObserver;
  private composer: EffectComposer | null = null;
  private bokeh: BokehPass | null = null;
  private state: SceneState | null = null;
  private selected: string | null = null;
  private joint: Joint | null = null;
  private cameraView = false;
  private jointsVisible = true;
  private helpers = true;
  private pointerStart = new T.Vector2();
  private recentlyDragged = false;
  private alive = true;
  private width = 1;
  private height = 1;
  private mode: 'translate' | 'rotate' | 'scale' = 'translate';
  private host: HTMLDivElement;
  private options: EngineOptions;
  constructor(host: HTMLDivElement, options: EngineOptions) {
    this.host = host; this.options = options;
    this.renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.domElement.setAttribute('aria-label', 'Interactive 3D posing viewport');
    this.host.appendChild(this.renderer.domElement);
    this.editorCamera.position.set(3.2, 2.4, 5.2);
    this.orbit = new OrbitControls(this.editorCamera, this.renderer.domElement);
    this.orbit.target.set(0, 0.95, 0); this.orbit.enableDamping = true; this.orbit.minDistance = 0.3; this.orbit.maxDistance = 80;
    this.transform = new TransformControls(this.editorCamera, this.renderer.domElement);
    this.transform.setSize(0.85);
    this.scene.add(this.transform.getHelper());
    this.transform.addEventListener('dragging-changed', e => {
      this.orbit.enabled = !e.value && !this.cameraView;
      if (e.value) this.recentlyDragged = true;
    });
    this.transform.addEventListener('mouseUp', () => {
      this.commitTransforms();
      setTimeout(() => { this.recentlyDragged = false; }, 0);
    });
    this.scene.add(new T.HemisphereLight('#d8e5ff', '#615448', 1.6));
    const fill = new T.DirectionalLight('#ffffff', 1.1); fill.position.set(-4, 4, -2); this.scene.add(fill);
    const floor = new T.Mesh(new T.PlaneGeometry(200, 200), new T.MeshStandardMaterial({ color: '#55514a', roughness: 0.96 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.005; floor.receiveShadow = true; this.scene.add(floor);
    this.grid = new T.GridHelper(20, 40, '#7b7771', '#62605b'); this.grid.position.y = -0.003; this.scene.add(this.grid);
    this.renderer.domElement.addEventListener('pointerdown', this.pointerDown);
    this.renderer.domElement.addEventListener('pointerup', this.pointerUp);
    this.renderer.domElement.addEventListener('webglcontextlost', this.contextLost);
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(host);
    this.renderer.setAnimationLoop(() => {
      if (!this.alive) return;
      this.orbit.update();
      try { this.render(); } catch (e) { this.renderer.setAnimationLoop(null); options.error(e); }
    });
  }
  private contextLost = (event: Event) => { event.preventDefault(); this.options.error(new Error('WebGL context lost. Save a JSON backup if possible, then reload this tab.')); };
  private pointerDown = (event: PointerEvent) => { this.pointerStart.set(event.clientX, event.clientY); };
  private pointerUp = (event: PointerEvent) => {
    if (this.cameraView || this.recentlyDragged || this.transform.dragging || this.transform.axis || this.pointerStart.distanceTo(new T.Vector2(event.clientX, event.clientY)) > 4) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const pointer = new T.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    const ray = new T.Raycaster(); ray.setFromCamera(pointer, this.editorCamera);
    const targets = [...this.entries.values()].flatMap(e => [e.root]);
    const hit = ray.intersectObjects(targets, true).find(h => h.object.visible && !h.object.userData.ignorePick);
    if (!hit) { this.options.select(null, null); return; }
    let node: T.Object3D | null = hit.object;
    const joint: Joint | null = hit.object.userData.joint ?? null;
    while (node && !node.userData.itemId) node = node.parent;
    if (node) this.options.select(node.userData.itemId, joint);
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
          const figure = makeFigure(item.kind, item.color);
          const markers = JOINTS.map(j => {
            const m = new T.Mesh(new T.SphereGeometry(0.022, 10, 8), new T.MeshBasicMaterial({ color: '#ffd07d', depthTest: false, transparent: true, opacity: 0.9 }));
            m.renderOrder = 20; m.userData.joint = j; figure.bones[j].add(m); return m;
          });
          entry = { kind: item.kind, root: figure.root, figure, markers };
        } else if (item.kind === 'light') {
          const root = new T.Group();
          const bulb = new T.Mesh(new T.SphereGeometry(0.07, 16, 12), new T.MeshBasicMaterial({ color: item.color }));
          root.add(bulb);
          const light = new T.SpotLight(item.color, item.intensity, 70, Math.PI / 3, 0.65, 1.3);
          light.castShadow = true; light.shadow.mapSize.set(1024, 1024); light.shadow.bias = -0.0003;
          root.add(light);
          const target = new T.Object3D(); this.scene.add(target); light.target = target;
          entry = { kind: item.kind, root, light, target };
        } else entry = { kind: item.kind, root: makeProp(item.kind, item.color) };
        entry.root.userData.itemId = item.id; this.entries.set(item.id, entry); this.scene.add(entry.root);
      }
      entry.root.position.fromArray(item.position); entry.root.rotation.set(...item.rotation); entry.root.scale.fromArray(item.scale);
      if (entry.figure && item.pose) { setFigurePose(entry.figure, item.pose); (entry.figure.skin.material as T.MeshStandardMaterial).color.set(item.color); }
      else if (!entry.light) entry.root.traverse(node => {
        if (node instanceof T.Mesh && node.material instanceof T.MeshStandardMaterial && !node.userData.fixedColor) node.material.color.set(item.color);
      });
      if (entry.light) {
        entry.light.color.set(item.color); entry.light.intensity = item.intensity ?? 30; entry.target!.position.fromArray(item.target ?? [0, 1, 0]);
        const bulb = entry.root.children[0] as T.Mesh<T.SphereGeometry, T.MeshBasicMaterial>; bulb.material.color.set(item.color);
      }
    }
    this.scene.background = new T.Color(state.background);
    const c = state.camera; this.camera.position.fromArray(c.position); this.camera.lookAt(new T.Vector3(...c.target));
    this.camera.near = c.near; this.camera.far = c.far; this.camera.filmGauge = 36; this.camera.zoom = 1;
    this.camera.aspect = aspect(c.aspect); this.camera.setFocalLength(c.focalLength); this.camera.updateProjectionMatrix();
    if (this.bokeh) {
      this.bokeh.materialBokeh.uniforms.focus.value = c.focus; this.bokeh.materialBokeh.uniforms.aperture.value = c.aperture; this.bokeh.materialBokeh.uniforms.maxblur.value = c.maxBlur;
    }
    this.select(this.selected, this.joint);
    this.resize();
  }
  select(id: string | null, joint: Joint | null): void {
    this.selected = id; this.joint = joint;
    for (const [key, e] of this.entries) e.markers?.forEach(m => {
      m.visible = key === id && this.jointsVisible && !this.cameraView;
      (m.material as T.MeshBasicMaterial).color.set(m.userData.joint === joint ? '#ff826b' : '#ffd07d');
    });
    this.transform.detach();
    const e = id ? this.entries.get(id) : null;
    if (e && !this.cameraView) {
      this.transform.setMode(joint ? 'rotate' : this.mode);
      this.transform.setSpace(joint ? 'local' : 'world');
      this.transform.attach(joint && e.figure ? e.figure.bones[joint] : e.root);
    }
  }
  setMode(mode: 'translate' | 'rotate' | 'scale'): void { this.mode = mode; this.select(this.selected, this.joint); }
  setView(cameraView: boolean): void {
    this.cameraView = cameraView; this.orbit.enabled = !cameraView; this.select(this.selected, this.joint); this.resize();
  }
  setHelpers(joints: boolean, helpers: boolean): void { this.jointsVisible = joints; this.helpers = helpers; this.select(this.selected, this.joint); }
  focusSelected(): void {
    const e = this.selected ? this.entries.get(this.selected) : null;
    const center = e ? new T.Box3().setFromObject(e.root).getCenter(new T.Vector3()) : new T.Vector3(0, 1, 0);
    const delta = this.editorCamera.position.clone().sub(this.orbit.target).normalize().multiplyScalar(3.6);
    this.orbit.target.copy(center); this.editorCamera.position.copy(center).add(delta);
  }
  useEditorCamera(): Pick<SceneState['camera'], 'position' | 'target'> {
    return { position: this.editorCamera.position.toArray() as Vec3, target: this.orbit.target.toArray() as Vec3 };
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
    const next = clone(this.state), entry = this.entries.get(this.selected), item = next.items.find(i => i.id === this.selected);
    if (!entry || !item) return;
    if (this.joint && entry.figure && item.pose) item.pose[this.joint] = entry.figure.bones[this.joint].rotation.toArray().slice(0, 3) as Vec3;
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
    this.grid.visible = this.helpers && !this.cameraView;
    this.entries.forEach(e => { if (e.light) (e.root.children[0] as T.Mesh).visible = !this.cameraView; });
    if (this.cameraView && this.state.camera.dof) {
      if (!this.composer) {
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));
        this.bokeh = new BokehPass(this.scene, this.camera, { focus: this.state.camera.focus, aperture: this.state.camera.aperture, maxblur: this.state.camera.maxBlur });
        this.composer.addPass(this.bokeh); this.composer.addPass(new OutputPass()); this.composer.setSize(this.width, this.height);
      }
      this.composer.render();
    } else this.renderer.render(this.scene, this.cameraView ? this.camera : this.editorCamera);
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
      this.setView(wasView); this.render();
    }
  }
  dispose(): void {
    this.alive = false; this.renderer.setAnimationLoop(null); this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener('pointerdown', this.pointerDown);
    this.renderer.domElement.removeEventListener('pointerup', this.pointerUp);
    this.renderer.domElement.removeEventListener('webglcontextlost', this.contextLost);
    this.transform.dispose(); this.orbit.dispose(); this.composer?.dispose(); this.bokeh?.dispose();
    disposeObject(this.scene); this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
export function aspect(value: SceneState['camera']['aspect']): number { const [x, y] = value.split(':').map(Number); return x / y; }
function disposeObject(root: T.Object3D): void {
  const geometries = new Set<T.BufferGeometry>(), materials = new Set<T.Material>();
  root.traverse(n => {
    if (n instanceof T.Mesh || n instanceof T.LineSegments) {
      geometries.add(n.geometry);
      (Array.isArray(n.material) ? n.material : [n.material]).forEach((m: T.Material) => materials.add(m));
    }
    if (n instanceof T.SpotLight) n.dispose();
  });
  geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
}
