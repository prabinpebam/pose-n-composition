import * as T from 'three';
import { getGarmentNodes, getGarmentOffset, prepareCloth, syncWardrobe } from './mannequin-wardrobe';
import { clothPoseKey, isGarmentEquipped, setFitOffset, type Garment, type SettledDrape } from './model';
import { GarmentHandles, type FitSelection } from './garmentHandles';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { computeAnchoredPositionY, getJointRotation, measureFigureMinWorldY, setFigurePose, type Figure } from './rig';
import {
  captureFkDragAnchor,
  computeAnchoredFkDragEuler,
  makeExternalFigure,
  setFigureColors,
  setFigureDressMap,
  setFigureHairStyle,
  type FkDragAnchor,
} from './external-rig';
import { defaultModelId, type ModelId } from './characterCatalog';
import { DEFAULT_BODY_TYPE, type BodyTypeId } from './bodyProportions';
import { clampPoseToAnatomicalLimits } from './skinDeformer';
import { makeProp } from './props';
import {
  getRoomObjects,
  invalidateRoomCutaway,
  makeRoom,
  releaseUnusedRooms,
  updateRoomCutaway,
  type RoomObjectInfo,
} from './rooms';
import type { RoomId } from './roomCatalog';
import { pickJointMarker, sizeJointMarker } from './joint-markers';
import { capturePin, solvePoseEdit, type PoseEdit } from './poseIK';
import { HELPER_LAYER, STAGE_LAYER, NprInkPass, StudioShadingController, needsInk, paperColor, setLayerRecursive } from './npr';
import {
  applyLightShadowQuality,
  computeSceneCasterBounds,
  fitDirectionalShadowFrustum,
  fitSpotShadowFrustum,
  installPcssSoftShadows,
  isPcssSoftShadowsInstalled,
  SHADOW_QUALITY_PRESETS,
  ShadowCacheController,
  type DirectionalShadowFitResult,
  type SpotShadowFitResult,
} from './rendering/shadowSystem';
import {
  RealtimeGiController,
  shouldApplyStudioAo,
  StudioPostGiPipeline,
  type RealtimeGiDiagnostics,
} from './rendering/globalIllumination';
import {
  disposeGeometryBvh,
  ensureGeometryBvh,
  ensureObjectTreeBvh,
  installBvhRaycastAcceleration,
  withFirstHitRaycaster,
} from './performance/bvhRaycaster';
import { FrameGovernor, type FrameGovernorContext } from './performance/frameGovernor';
import { PerfMonitor, type PerfMetricsSnapshot } from './performance/perfMetrics';
import {
  claimViewportPointerInteraction,
  lockDocumentSelectionDuringDrag,
} from './inputRouting';
import {
  clone,
  createDefaultPrimitiveSpec,
  defaultCharacterHairColor,
  defaultCharacterOutfitColor,
  DEFAULT_AO_ENABLED,
  DEFAULT_GI_ENABLED,
  DEFAULT_GI_INTENSITY,
  DEFAULT_MANNEQUIN_DRESS_ID,
  DEFAULT_RENDER_QUALITY,
  DEFAULT_RENDER_STYLE,
  DEFAULT_SHADOW_SOFTNESS,
  findItemOrOperand,
  isBody,
  isMannequinCharacter,
  isModelingKind,
  isTargetedLight,
  JOINTS,
  LIGHT_DEFAULTS,
  parseTargetObjectRef,
  PROP_KINDS,
  radians,
  resolveLightPartForItem,
  selectionCentroid,
  syncLinkedLightTargets,
  transformItems,
  updateItemOrOperand,
  validatePortable,
  type Body,
  type EditableMeshData,
  type Item,
  type Joint,
  type LightPart,
  type LightType,
  type Pose,
  type PropKind,
  type RenderQualityMode,
  type RenderStyleState,
  type SceneState,
  type Vec3,
} from './model';
import { getRuntimeImportedAsset } from './storage';
import { extractEditableMeshFromObject3D } from './importers/import3d';
import {
  buildHalfEdgeOrAdjacency,
  cloneEditableMesh,
  createQuadWireframeGeometry,
  evaluateModelingNode,
  selectEdgeLoop,
  type ComponentSelection,
  type ModelingMode,
  type ModelingNodeSpec,
} from './modeling';
import {
  EditableComponentOverlay,
  marqueeSelectMeshComponents,
  pickMeshComponent,
  SelectionGizmoProxyController,
} from './modeling/viewportComponents';
import {
  computeStageWorldBounds,
  ViewportNavigationController,
  type NavigationFrameTarget,
  type NavigationSceneContext,
  type NavigationSelectionTarget,
} from './viewportNavigation';

const DISTAL_JOINTS: ReadonlySet<Joint> = new Set<Joint>([
  'head',
  'neck',
  'leftWrist',
  'rightWrist',
  'leftAnkle',
  'rightAnkle',
]);

type StudioLight = T.SpotLight | T.DirectionalLight | T.PointLight;
interface Entry {
  kind: Item['kind'];
  root: T.Group;
  roomId?: RoomId;
  figure?: Figure;
  light?: StudioLight;
  lightType?: LightType;
  sourceHandle?: T.Mesh<T.SphereGeometry, T.MeshBasicMaterial>;
  sourceRing?: T.LineSegments<T.BufferGeometry, T.LineBasicMaterial>;
  lightGizmo?: T.LineSegments<T.BufferGeometry, T.LineBasicMaterial>;
  aimLine?: T.Line<T.BufferGeometry, T.LineBasicMaterial>;
  target?: T.Object3D;
  targetHandle?: T.Mesh<T.SphereGeometry, T.MeshBasicMaterial>;
  targetRing?: T.LineSegments<T.BufferGeometry, T.LineBasicMaterial>;
  markers?: T.Mesh<T.SphereGeometry, T.MeshBasicMaterial>[];
  modelingSig?: string;
  evaluatedMesh?: EditableMeshData;
  primaryMesh?: T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>;
  populatedMeshCount?: number;
}
export interface EngineHoverTip {
  readonly title: string;
  readonly description?: string;
  readonly shortcut?: string;
  readonly clientX: number;
  readonly clientY: number;
}

export interface EngineOptions {
  change: (state: SceneState) => void;
  currentDocument?: () => SceneState;
  liveChange?: (state: SceneState) => void;
  orbitChange?: (orbit: { position: Vec3; target: Vec3 }, settled: boolean) => void;
  cameraChange?: (cameraPose: { position: Vec3; target: Vec3 }, settled: boolean) => void;
  select: (id: string | null, joint: Joint | null, additive?: boolean, lightPart?: LightPart) => void;
  selectMany?: (ids: string[]) => void;
  selectRoomObject?: (roomId: string, objectId: string | null) => void;
  componentSelect?: (selection: ComponentSelection) => void;
  meshEdit?: (itemId: string, mesh: EditableMeshData, selection: ComponentSelection, settled: boolean) => void;
  loopCutClick?: (itemId: string, edgeIndex: number, factor: number) => void;
  hoverTip?: (tip: EngineHoverTip | null) => void;
  fitSelect?: (selection: FitSelection | null) => void;
  error: (error: unknown) => void;
}

const importedEditableMeshCache = new Map<string, EditableMeshData>();
const propEditableMeshCache = new Map<PropKind, EditableMeshData>();
const halfEdgeAdjacencyCache = new WeakMap<EditableMeshData, ReturnType<typeof buildHalfEdgeOrAdjacency>>();
const editableMeshStamps = new WeakMap<EditableMeshData, number>();
let nextEditableMeshStamp = 1;

export function getCachedHalfEdgeMesh(mesh: EditableMeshData): ReturnType<typeof buildHalfEdgeOrAdjacency> {
  const cached = halfEdgeAdjacencyCache.get(mesh);
  if (cached) return cached;
  const built = buildHalfEdgeOrAdjacency(mesh);
  halfEdgeAdjacencyCache.set(mesh, built);
  return built;
}

function getEditableMeshStamp(mesh: EditableMeshData | undefined): number {
  if (!mesh) return 0;
  let stamp = editableMeshStamps.get(mesh);
  if (stamp === undefined) {
    stamp = nextEditableMeshStamp++;
    editableMeshStamps.set(mesh, stamp);
  }
  return stamp;
}

function getCachedPropEditableMesh(kind: PropKind): EditableMeshData {
  const cached = propEditableMeshCache.get(kind);
  if (cached) return cached;
  const tempProp = makeProp(kind, '#ffffff');
  const extracted = extractEditableMeshFromObject3D(tempProp);
  disposeObject(tempProp);
  propEditableMeshCache.set(kind, extracted);
  return extracted;
}

function getImportedBaseEditableMesh(assetId: string): EditableMeshData | null {
  const cached = importedEditableMeshCache.get(assetId);
  if (cached) return cached;
  const asset = getRuntimeImportedAsset(assetId);
  if (!asset) return null;
  const extracted = extractEditableMeshFromObject3D(asset.root);
  importedEditableMeshCache.set(assetId, extracted);
  return extracted;
}

function itemToModelingNode(item: Item, includeTransform = false): ModelingNodeSpec {
  const base = {
    id: item.id,
    name: item.name,
    modifiers: item.modifiers,
    phongAngleDeg: item.phongAngleDeg ?? 40,
    ...(includeTransform
      ? {
          transform: {
            position: item.position,
            rotation: item.rotation,
            scale: item.scale,
          },
        }
      : {}),
  };

  if (item.kind === 'primitive') {
    return {
      ...base,
      nodeType: 'primitive',
      primitive: item.primitive ?? createDefaultPrimitiveSpec('cube'),
    };
  }
  if (item.kind === 'mesh') {
    return {
      ...base,
      nodeType: 'editable',
      mesh: item.editableMesh ?? { vertices: [], faces: [] },
    };
  }
  if (item.kind === 'boole') {
    const visibleOperands = (item.operands ?? []).filter(op => op.visible !== false);
    return {
      ...base,
      nodeType: 'boolean',
      operation: item.booleanEnabled === false ? 'union' : (item.booleanOp ?? 'subtract'),
      operands: visibleOperands.map(op => itemToModelingNode(op, true)),
    };
  }
  if (item.kind === 'imported') {
    const extracted = item.assetId ? getImportedBaseEditableMesh(item.assetId) : null;
    if (extracted && extracted.vertices.length > 0) {
      return {
        ...base,
        nodeType: 'editable',
        mesh: extracted,
      };
    }
    return {
      ...base,
      nodeType: 'primitive',
      primitive: createDefaultPrimitiveSpec('cube'),
    };
  }
  if ((PROP_KINDS as readonly string[]).includes(item.kind) && item.kind !== 'room') {
    const extracted = getCachedPropEditableMesh(item.kind as PropKind);
    return {
      ...base,
      nodeType: 'editable',
      mesh: extracted,
    };
  }
  return {
    ...base,
    nodeType: 'primitive',
    primitive: createDefaultPrimitiveSpec('cube'),
  };
}

function serializeModifiersCompact(modifiers: Item['modifiers']): string {
  if (!modifiers || modifiers.length === 0) return '';
  let out = '';
  for (let i = 0; i < modifiers.length; i++) {
    const m = modifiers[i]!;
    out += `${m.id}:${m.type}:${m.enabled ? 1 : 0}:${JSON.stringify(m)};`;
  }
  return out;
}

function computeModelingSignature(item: Item): string {
  const phong = item.phongAngleDeg ?? 40;
  const mods = serializeModifiersCompact(item.modifiers);
  if (item.kind === 'imported') {
    const hydrated = Boolean(item.assetId && getRuntimeImportedAsset(item.assetId));
    return `imp|${item.assetId ?? ''}|${hydrated ? 1 : 0}|${item.color}|${item.roughness ?? ''}|${item.metalness ?? ''}|${phong}|${mods}`;
  }
  if (item.kind === 'boole') {
    const ops = item.operands ?? [];
    let opsSig = '';
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i]!;
      opsSig += `[${op.id}:${op.visible !== false ? 1 : 0}:${op.position.join(',')}:${op.rotation.join(',')}:${op.scale.join(',')}:${computeModelingSignature(op)}]`;
    }
    return `boole|${item.booleanOp ?? 'subtract'}|${item.booleanEnabled !== false ? 1 : 0}|${phong}|${mods}|${opsSig}`;
  }
  if (item.kind === 'mesh') {
    const stamp = getEditableMeshStamp(item.editableMesh);
    const vLen = item.editableMesh?.vertices.length ?? 0;
    const fLen = item.editableMesh?.faces.length ?? 0;
    return `mesh|${stamp}|${vLen}|${fLen}|${phong}|${mods}`;
  }
  const p = item.primitive;
  const pSig = p ? JSON.stringify(p) : '';
  return `${item.kind}|${pSig}|${phong}|${mods}`;
}
export const STUDIO_HEMI_INTENSITY = 1.6;
export const STUDIO_FILL_INTENSITY = 1.1;
export const STUDIO_ILLUSTRATION_FILL_INTENSITY = 0.35;

export const ROTATION_SNAP_DEG = 15;
export const ROTATION_SNAP_RAD = T.MathUtils.degToRad(ROTATION_SNAP_DEG);
const SNAP_EPSILON_DEG = 1e-4;

export function resolveRotationSnapRad(shiftHeld: boolean): number | null {
  return shiftHeld ? ROTATION_SNAP_RAD : null;
}

export function quantizeSnappedAngleRad(
  angleRad: number,
  snapDeg = ROTATION_SNAP_DEG,
): number {
  if (!Number.isFinite(angleRad) || snapDeg <= 0) return angleRad;
  const deg = T.MathUtils.radToDeg(angleRad);
  const nearestStep = Math.round(deg / snapDeg) * snapDeg;
  if (Math.abs(deg - nearestStep) <= SNAP_EPSILON_DEG) {
    const normalizedStep = Object.is(nearestStep, -0) ? 0 : nearestStep;
    return T.MathUtils.degToRad(normalizedStep);
  }
  return angleRad;
}

export function cleanSnappedEulerVec(
  eulerRad: Vec3,
  snapped: boolean,
  snapDeg = ROTATION_SNAP_DEG,
): Vec3 {
  if (!snapped) return eulerRad;
  return [
    quantizeSnappedAngleRad(eulerRad[0], snapDeg),
    quantizeSnappedAngleRad(eulerRad[1], snapDeg),
    quantizeSnappedAngleRad(eulerRad[2], snapDeg),
  ];
}

export function applyStudioEnvironmentLighting(
  targets: {
    hemi: Pick<T.HemisphereLight, 'intensity' | 'visible'>;
    fill: Pick<T.DirectionalLight, 'intensity' | 'visible'>;
    scene: Pick<T.Scene, 'environment'> & { environmentIntensity?: number };
  },
  sceneLightsOnly: boolean,
  mode: RenderStyleState['mode'],
): void {
  if (sceneLightsOnly) {
    targets.hemi.intensity = 0;
    targets.hemi.visible = false;
    targets.fill.intensity = 0;
    targets.fill.visible = false;
    targets.scene.environment = null;
    if ('environmentIntensity' in targets.scene) {
      targets.scene.environmentIntensity = 0;
    }
  } else {
    targets.hemi.visible = true;
    targets.hemi.intensity = STUDIO_HEMI_INTENSITY;
    targets.fill.visible = true;
    // Keep the fill below the cel terminator so unshadowed fill lighting cannot
    // erase the spotlight's cast-shadow shapes.
    targets.fill.intensity =
      mode === 'illustration' ? STUDIO_ILLUSTRATION_FILL_INTENSITY : STUDIO_FILL_INTENSITY;
  }
}

export class Studio {
  readonly renderer: T.WebGLRenderer;
  readonly scene = new T.Scene();
  readonly editorCamera = new T.PerspectiveCamera(42, 1, 0.02, 500);
  readonly camera = new T.PerspectiveCamera();
  readonly orbit: ViewportNavigationController;
  readonly cameraOrbit: ViewportNavigationController;
  readonly transform: TransformControls;
  readonly entries = new Map<string, Entry>();
  private readonly grid: T.GridHelper;
  private readonly floor: T.Mesh;
  private readonly hemi: T.HemisphereLight;
  private readonly fill: T.DirectionalLight;
  private readonly resizeObserver: ResizeObserver;
  private composer: EffectComposer | null = null;
  private giPostPass: StudioPostGiPipeline | null = null;
  private bokeh: BokehPass | null = null;
  private renderPass: RenderPass | null = null;
  private inkPass: NprInkPass | null = null;
  private shading = new StudioShadingController();
  private readonly shadowCache = new ShadowCacheController();
  private readonly gi = new RealtimeGiController({ quality: DEFAULT_RENDER_QUALITY });
  private readonly perfMonitor = new PerfMonitor(120);
  private readonly governor: FrameGovernor;
  private perfListener: ((snapshot: PerfMetricsSnapshot) => void) | null = null;
  private lastPerfEmitMs = 0;
  private liveShadowRevision = 0;
  private liveGiRevision = 0;
  private lastGiStateSig = '';
  private lastFrameShadowUpdates = 0;
  private lastDirectionalShadowFits: DirectionalShadowFitResult[] = [];
  private lastSpotShadowFits: SpotShadowFitResult[] = [];
  private lastPcssQuality: RenderQualityMode = DEFAULT_RENDER_QUALITY;
  private depthCopyMaterial: T.RawShaderMaterial | null = null;
  private depthCopyQuad: FullScreenQuad | null = null;
  private helperDepth = new T.MeshDepthMaterial({ colorWrite: false });
  private selectedIds: string[] = [];
  readonly garmentHandles = new GarmentHandles();
  private fitSelection: FitSelection | null = null;
  private fitPreview?: NonNullable<Item['wardrobe']>;
  private fitDragDocument?: SceneState;
  private posePreviewId: string | null = null;
  private fitPlane?: {plane:T.Plane; grab:T.Vector3};
  readonly groupPivot = new T.Object3D();
  private jointTarget = new T.Object3D();
  private positionPosing = false;
  private solvedDrag: ReturnType<typeof solvePoseEdit> | null = null;
  private groupBase: { items: Item[]; inverse: T.Matrix4 } | null = null;
  private fkDragAnchor: { itemId: string; anchor: FkDragAnchor; latestEuler?: Vec3 } | null = null;
  private marquee: { pointer: number; x: number; y: number; additive: boolean; element: HTMLDivElement } | null = null;
  private state: SceneState | null = null;
  private selected: string | null = null;
  private selectedOperandId: string | null = null;
  private lightPart: LightPart = 'source';
  private selectedRoomObject: { roomId: string; objectId: string } | null = null;
  private joint: Joint | null = null;
  private cameraView = false;
  private jointsVisible = true;
  private helpers = true;
  private readonly componentOverlay = new EditableComponentOverlay();
  private readonly componentProxy = new SelectionGizmoProxyController();
  private readonly booleOperandPivot = new T.Object3D();
  private booleOperandGhost: T.LineSegments | null = null;
  private booleOperandGhostSig: string | null = null;
  private modelingMode: ModelingMode = 'object';
  private componentSelection: ComponentSelection = { mode: 'polygon', vertices: [], edges: [], faces: [] };
  private xRayWireframe = false;
  private coordSpace: 'world' | 'local' = 'local';
  private loopCutActive: { enabled: boolean; cuts: number } = { enabled: false, cuts: 1 };
  private hoveredComponent: { index: number; loopFactor: number } | null = null;
  private liveDraggedEditableMesh: EditableMeshData | null = null;
  private pointerStart = new T.Vector2();
  private recentlyDragged = false;
  private rotationSnapActive = false;
  private lastDragPointerEvent: PointerEvent | null = null;
  private pendingHoverShiftKey = false;
  private nodePointer: number | null = null;
  private hoveredMarker: T.Mesh<T.SphereGeometry, T.MeshBasicMaterial> | null = null;
  private hoveredLightHandle: T.Mesh<T.SphereGeometry, T.MeshBasicMaterial> | null = null;
  private hoverTipActive = false;
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
  private releaseStudioDragLock: (() => void) | null = null;
  private prevDefaultManagerOnLoad: (() => void) | undefined;
  constructor(host: HTMLDivElement, options: EngineOptions) {
    this.host = host; this.options = options;
    (this.host as unknown as { __studio?: Studio }).__studio = this;
    installBvhRaycastAcceleration();
    installPcssSoftShadows(DEFAULT_RENDER_QUALITY);
    this.renderer = new T.WebGLRenderer({ antialias: true, alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.domElement.setAttribute('aria-label', 'Interactive 3D posing viewport');
    this.renderer.domElement.tabIndex = -1;
    this.renderer.domElement.draggable = false;
    this.host.appendChild(this.renderer.domElement);
    this.editorCamera.position.set(3.2, 2.4, 5.2);
    this.editorCamera.layers.enable(HELPER_LAYER);
    this.camera.position.set(0, 1.35, 3.8);
    this.transform = new TransformControls(this.editorCamera, this.renderer.domElement);
    this.transform.setSize(0.85);
    this.scene.add(this.groupPivot);
    this.scene.add(this.jointTarget);
    this.scene.add(this.garmentHandles);
    this.scene.add(this.componentOverlay.group);
    this.scene.add(this.componentProxy.proxyObject);
    this.scene.add(this.gi.group);
    this.booleOperandPivot.layers.set(HELPER_LAYER);
    setLayerRecursive(this.transform.getHelper(), HELPER_LAYER);
    this.transform.getRaycaster().layers.enable(HELPER_LAYER);
    this.scene.add(this.transform.getHelper());
    if (this.renderer.capabilities.isWebGL2) {
      this.depthCopyMaterial = new T.RawShaderMaterial({
        glslVersion: T.GLSL3,
        uniforms: { tDepth: { value: null } },
        vertexShader: /* glsl */ `
          in vec3 position;
          in vec2 uv;
          out vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          precision highp float;
          uniform sampler2D tDepth;
          in vec2 vUv;
          out vec4 fragColor;
          void main() {
            gl_FragDepth = texture(tDepth, vUv).r;
            fragColor = vec4(0.0);
          }
        `,
        colorWrite: false,
        depthWrite: true,
        depthTest: true,
        depthFunc: T.AlwaysDepth,
      });
      this.depthCopyQuad = new FullScreenQuad(this.depthCopyMaterial);
    }
    this.governor = new FrameGovernor({
      perfMonitor: this.perfMonitor,
      settleFrames: 10,
      settleMs: 220,
      adaptiveDpr: true,
      frameBudgetMs: 20,
      onPixelRatioChange: (dpr) => {
        if (!this.alive) return;
        this.renderer.setPixelRatio(dpr);
        this.composer?.setPixelRatio(dpr);
        this.composer?.setSize(this.width, this.height);
      },
      onIdleStateChange: () => {
        this.emitPerfSnapshot(true);
      },
      onRender: (ctx) => this.governedRender(ctx),
    });
    const navContext = this.createNavigationContext();
    const shouldIgnorePointerDown = (event: PointerEvent) =>
      this.transform.dragging ||
      Boolean(this.marquee) ||
      this.nodePointer !== null ||
      (event.button === 0 && !this.cameraView && this.transform.axis !== null);
    this.orbit = new ViewportNavigationController({
      camera: this.editorCamera,
      domElement: this.renderer.domElement,
      context: navContext,
      initialTarget: [0, 0.95, 0],
      minDistance: 0.08,
      minTargetDistance: 0.2,
      maxDistance: 90,
      positionClamp: 99,
      targetClamp: 95,
      shouldIgnorePointerDown,
    });
    this.orbit.update();
    this.recordOrbit();
    this.orbit.addEventListener('start', this.handleOrbitStart);
    this.orbit.addEventListener('change', this.handleOrbitChange);
    this.orbit.addEventListener('end', this.handleOrbitEnd);
    this.cameraOrbit = new ViewportNavigationController({
      camera: this.camera,
      domElement: this.renderer.domElement,
      context: navContext,
      initialTarget: [0, 1.05, 0],
      minDistance: 0.08,
      minTargetDistance: 0.2,
      maxDistance: 85,
      positionClamp: 99,
      targetClamp: 85,
      shouldIgnorePointerDown,
    });
    this.cameraOrbit.enabled = false;
    this.cameraOrbit.update();
    this.recordCameraPose();
    this.cameraOrbit.addEventListener('start', this.handleCameraOrbitStart);
    this.cameraOrbit.addEventListener('change', this.handleCameraOrbitChange);
    this.cameraOrbit.addEventListener('end', this.handleCameraOrbitEnd);
    this.transform.addEventListener('change', this.handleTransformChange);
    this.transform.addEventListener('mouseDown', () => {
      this.fkDragAnchor = null;
      this.solvedDrag = null;
      if (this.transform.object === this.jointTarget) return;
      if (this.fitSelection) { this.beginFitDrag(); return; }
      if (this.transform.object === this.componentProxy.proxyObject && this.selected && this.state) {
        const found = findItemOrOperand(this.state.items, this.selected);
        if (found?.item.kind === 'mesh' && found.item.editableMesh) {
          this.liveDraggedEditableMesh = null;
          this.componentProxy.beginDrag(found.item.editableMesh, this.componentSelection);
        }
        return;
      }
      if (this.joint && this.selected && this.selectedIds.length < 2) {
        const entry = this.entries.get(this.selected);
        if (entry?.figure) {
          this.fkDragAnchor = {
            itemId: this.selected,
            anchor: captureFkDragAnchor(
              this.joint,
              entry.figure.bones[this.joint],
              entry.figure.rotationBases[this.joint],
              getJointRotation(entry.figure, this.joint),
            ),
          };
        }
        return;
      }
      if (this.selectedIds.length < 2 || !this.state) return;
      this.groupPivot.updateMatrix();
      this.groupBase = { items: clone(this.state.items), inverse: this.groupPivot.matrix.clone().invert() };
    });
    this.transform.addEventListener('dragging-changed', e => {
      this.orbit.enabled = !e.value && !this.cameraView;
      this.cameraOrbit.enabled = !e.value && this.cameraView;
      if (e.value) {
        this.recentlyDragged = true;
        this.transformChanged = false;
        this.acquireStudioDragLock();
        this.governor.beginInteraction('gizmo');
      } else {
        this.governor.endInteraction('gizmo');
        if (!this.marquee && this.nodePointer === null) {
          this.clearStudioDragLock();
        }
      }
    });
    this.transform.addEventListener('objectChange', () => {
      this.cancelCloth();
      this.liveShadowRevision++;
      this.liveGiRevision++;
      this.governor.invalidate('scene');
      if (this.fitSelection && this.transform.object?.parent === this.garmentHandles) {
        this.moveFitNode(this.transform.object.position);
        return;
      }
      if (this.componentProxy.isDragging && this.selected && this.state) {
        const entry = this.entries.get(this.selected);
        const found = findItemOrOperand(this.state.items, this.selected);
        if (entry && found?.item.kind === 'mesh') {
          entry.root.updateMatrixWorld(true);
          const dragged = this.componentProxy.computeDraggedMesh(entry.root.matrixWorld);
          if (dragged) {
            this.liveDraggedEditableMesh = dragged;
            const liveItem: Item = { ...found.item, editableMesh: dragged };
            this.populateModelingEntry(entry, liveItem);
            this.refreshComponentOverlay(entry, dragged);
            this.transformChanged = true;
            this.options.meshEdit?.(found.item.id, dragged, this.componentSelection, false);
          }
        }
        return;
      }
      if (this.transform.object === this.booleOperandPivot && this.selected && this.selectedOperandId && this.state) {
        const entry = this.entries.get(this.selected);
        const booleItem = this.state.items.find(i => i.id === this.selected && i.kind === 'boole');
        if (entry && booleItem?.operands) {
          const liveBoole = clone(booleItem);
          const op = liveBoole.operands?.find(o => o.id === this.selectedOperandId);
          if (op) {
            op.position = this.booleOperandPivot.position.toArray() as Vec3;
            op.rotation = cleanSnappedEulerVec(
              this.booleOperandPivot.rotation.toArray().slice(0, 3) as Vec3,
              this.rotationSnapActive,
            );
            op.scale = this.booleOperandPivot.scale.toArray() as Vec3;
            this.populateModelingEntry(entry, liveBoole);
            this.refreshBooleOperandGhost(entry, op);
          }
        }
        this.transformChanged = true;
        const live = this.readLiveState();
        if (live) this.options.liveChange?.(live);
        return;
      }
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
          if (this.transform.object === this.jointTarget) {
            this.applyJointEdit(item, entry.figure, {joint: this.joint, target: this.jointTarget.position});
          } else {
            const anchor = this.fkDragAnchor?.itemId === this.selected &&
              this.fkDragAnchor.anchor.joint === this.joint ? this.fkDragAnchor : null;
            const rotation = cleanSnappedEulerVec(anchor
              ? computeAnchoredFkDragEuler(anchor.anchor, entry.figure.bones[this.joint].quaternion)
              : getJointRotation(entry.figure, this.joint), this.rotationSnapActive);
            const pose = {...item.pose, [this.joint]: rotation};
            if (item.posePins) this.applyJointEdit(item, entry.figure, {joint: this.joint, rotation});
            else setFigurePose(entry.figure, pose, item.handPose);
            if (anchor) anchor.latestEuler = cleanSnappedEulerVec(
              getJointRotation(entry.figure, this.joint),
              this.rotationSnapActive,
            );
          }
        }
      }
      this.syncLinkedLightEntriesInScene();
      if (this.selected) {
        const selEntry = this.entries.get(this.selected);
        if (selEntry) {
          selEntry.root.updateMatrixWorld(true);
          this.componentOverlay.syncTransform(selEntry.root.matrixWorld);
        }
      }
      this.transformChanged = true;
      const live = this.readLiveState();
      if (live) this.options.liveChange?.(live);
    });
    this.transform.addEventListener('mouseUp', () => {
      if (this.fitSelection) {
        this.finishFitDrag(true);
        setTimeout(() => { this.recentlyDragged = false; }, 0);
        return;
      }
      if (this.componentProxy.isDragging && this.selected) {
        const entry = this.entries.get(this.selected);
        let finalMesh = this.liveDraggedEditableMesh;
        if (!finalMesh && entry) {
          entry.root.updateMatrixWorld(true);
          finalMesh = this.componentProxy.computeDraggedMesh(entry.root.matrixWorld);
        }
        this.componentProxy.endDrag();
        this.liveDraggedEditableMesh = null;
        if (this.transformChanged && finalMesh) {
          this.options.meshEdit?.(this.selected, finalMesh, this.componentSelection, true);
        }
        this.transformChanged = false;
        setTimeout(() => { this.recentlyDragged = false; }, 0);
        return;
      }
      if (this.transformChanged) {
        this.commitTransforms();
        this.transformChanged = false;
      }
      this.fkDragAnchor = null;
      this.solvedDrag = null;
      this.groupBase = null;
      setTimeout(() => { this.recentlyDragged = false; }, 0);
    });
    this.hemi = new T.HemisphereLight('#d8e5ff', '#615448', STUDIO_HEMI_INTENSITY);
    this.scene.add(this.hemi);
    this.fill = new T.DirectionalLight('#ffffff', STUDIO_FILL_INTENSITY); this.fill.position.set(-4, 4, -2); this.scene.add(this.fill);
    const floor = new T.Mesh(new T.PlaneGeometry(200, 200), new T.MeshStandardMaterial({ color: '#55514a', roughness: 0.96 }));
    ensureGeometryBvh(floor.geometry);
    this.floor = floor;
    floor.userData.nprFloor = true;
    this.shading.attachStudioShading(floor.material);
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.005; floor.receiveShadow = true; this.scene.add(floor);
    this.grid = new T.GridHelper(20, 40, '#7b7771', '#62605b'); this.grid.position.y = -0.003; this.scene.add(this.grid);
    setLayerRecursive(this.grid, HELPER_LAYER);
    this.prevDefaultManagerOnLoad = T.DefaultLoadingManager.onLoad;
    T.DefaultLoadingManager.onLoad = () => {
      this.prevDefaultManagerOnLoad?.();
      if (!this.alive) return;
      setTimeout(() => {
        if (!this.alive) return;
        this.liveShadowRevision++;
        this.liveGiRevision++;
        this.governor.invalidate('loading');
      }, 0);
    };
    this.host.addEventListener('mousedown', this.hostMouseDown);
    this.host.addEventListener('dragstart', this.blockNativeDrag);
    this.host.addEventListener('selectstart', this.blockNativeDrag);
    this.renderer.domElement.addEventListener('pointerdown', this.pointerDown, true);
    this.renderer.domElement.addEventListener('touchstart', this.cameraTouchStart, { capture: true, passive: true });
    this.renderer.domElement.addEventListener('pointerup', this.nodePointerUp, true);
    this.renderer.domElement.addEventListener('pointermove', this.pointerMove, true);
    this.renderer.domElement.addEventListener('pointerleave', this.pointerLeave);
    this.renderer.domElement.addEventListener('pointercancel', this.pointerCancel);
    this.renderer.domElement.addEventListener('lostpointercapture', this.fitCaptureLost);
    this.renderer.domElement.addEventListener('pointerup', this.pointerUp);
    this.renderer.domElement.addEventListener('dblclick', this.doubleClick);
    this.renderer.domElement.addEventListener('webglcontextlost', this.contextLost);
    window.addEventListener('keydown', this.handleWindowKeySnap, true);
    window.addEventListener('keyup', this.handleWindowKeySnap, true);
    window.addEventListener('blur', this.handleWindowBlurSnap);
    document.addEventListener('visibilitychange', this.handleVisibilityChangeSnap);
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(host);
    this.governor.start();
  }
  private contextLost = (event: Event) => { event.preventDefault(); this.options.error(new Error('WebGL context lost. Save a JSON backup if possible, then reload this tab.')); };
  private markerAt(coords: { clientX: number; clientY: number }) {
    const entry = this.selected ? this.entries.get(this.selected) : null;
    return this.cameraView ? null : pickJointMarker(entry?.markers ?? [], this.editorCamera, this.renderer.domElement.getBoundingClientRect(), coords.clientX, coords.clientY);
  }
  private overlayLightTargets(): T.Mesh<T.SphereGeometry, T.MeshBasicMaterial>[] {
    const out: T.Mesh<T.SphereGeometry, T.MeshBasicMaterial>[] = [];
    for (const entry of this.entries.values()) {
      if (!entry.root.visible || !entry.targetHandle?.visible) continue;
      if (this.isHitLocked(entry.targetHandle)) continue;
      out.push(entry.targetHandle);
    }
    return out;
  }
  private lightSourceHandles(): T.Mesh<T.SphereGeometry, T.MeshBasicMaterial>[] {
    const out: T.Mesh<T.SphereGeometry, T.MeshBasicMaterial>[] = [];
    for (const entry of this.entries.values()) {
      if (!entry.root.visible || !entry.sourceHandle?.visible) continue;
      if (this.isHitLocked(entry.sourceHandle)) continue;
      out.push(entry.sourceHandle);
    }
    return out;
  }
  private lightHandleAt(coords: { clientX: number; clientY: number }): T.Mesh<T.SphereGeometry, T.MeshBasicMaterial> | null {
    if (this.cameraView || this.transform.axis) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const targetHit = pickLightHandle(this.overlayLightTargets(), this.editorCamera, rect, coords.clientX, coords.clientY, 12);
    if (targetHit) return targetHit;
    return pickLightHandle(this.lightSourceHandles(), this.editorCamera, rect, coords.clientX, coords.clientY, 11);
  }
  isDraggingTransform(): boolean {
    // Garment drags preview on the mesh only. An external document/undo change
    // must still reach sync() and cancel the gesture, not get overwritten on release.
    return Boolean(this.transform.dragging && !this.fitSelection);
  }
  focusCanvas(): void {
    claimViewportPointerInteraction(this.renderer.domElement);
  }
  private acquireStudioDragLock(): void {
    if (!this.releaseStudioDragLock) {
      this.releaseStudioDragLock = lockDocumentSelectionDuringDrag(this.renderer.domElement.ownerDocument);
    }
  }
  private clearStudioDragLock(): void {
    if (this.releaseStudioDragLock) {
      this.releaseStudioDragLock();
      this.releaseStudioDragLock = null;
    }
  }
  private hostMouseDown = (event: MouseEvent) => {
    claimViewportPointerInteraction(this.renderer.domElement, event);
  };
  private blockNativeDrag = (event: Event) => {
    event.preventDefault();
  };
  private cameraTouchStart = () => {
    if (this.cameraView && !this.transform.dragging) this.cameraPointerDown = true;
  };
  private emitHoverTip(tip: EngineHoverTip | null): void {
    if (!tip) {
      if (!this.hoverTipActive) return;
      this.hoverTipActive = false;
      this.options.hoverTip?.(null);
      return;
    }
    this.hoverTipActive = true;
    this.options.hoverTip?.(tip);
  }
  private syncRotationSnap(shiftHeld: boolean, reevaluateActiveDrag = false): void {
    const snapRad = resolveRotationSnapRad(shiftHeld);
    const nextActive = snapRad !== null;
    if (this.rotationSnapActive === nextActive && this.transform.rotationSnap === snapRad) {
      return;
    }
    this.rotationSnapActive = nextActive;
    this.transform.setRotationSnap(snapRad);
    if (
      reevaluateActiveDrag &&
      this.transform.dragging &&
      this.transform.getMode() === 'rotate' &&
      this.lastDragPointerEvent
    ) {
      const getPointer = (this.transform as unknown as {
        _getPointer?: (event: PointerEvent) => unknown;
        pointerMove?: (pointer: unknown) => void;
      })._getPointer;
      if (typeof getPointer === 'function') {
        this.transform.pointerMove(
          getPointer.call(this.transform, this.lastDragPointerEvent) as never,
        );
      }
    }
  }
  private handleWindowKeySnap = (event: KeyboardEvent) => {
    if (event.type === 'keydown' && event.key === 'Escape' && this.fitSelection && (this.fitPlane || this.transform.dragging)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.pointerCancel();
      return;
    }
    this.syncRotationSnap(event.shiftKey, true);
  };
  private handleWindowBlurSnap = () => {
    if (this.fitSelection && (this.fitPlane || this.transform.dragging)) this.pointerCancel();
    this.lastDragPointerEvent = null;
    this.syncRotationSnap(false, false);
  };
  private handleVisibilityChangeSnap = () => {
    if (document.hidden) {
      if (this.fitSelection && (this.fitPlane || this.transform.dragging)) this.pointerCancel();
      this.lastDragPointerEvent = null;
      this.syncRotationSnap(false, false);
    }
  };
  private pointerDown = (event: PointerEvent) => {
    this.syncRotationSnap(event.shiftKey, false);
    if (event.button === 0) this.lastDragPointerEvent = event;
    this.emitHoverTip(null);
    claimViewportPointerInteraction(this.renderer.domElement, event);
    this.pointerStart.set(event.clientX, event.clientY);
    if (event.button === 0 && (event.ctrlKey || event.metaKey) && !this.transform.dragging) {
      event.stopImmediatePropagation();
      const element = document.createElement('div'); element.className = 'selection-marquee';
      this.host.appendChild(element);
      this.marquee = { pointer: event.pointerId, x: event.clientX, y: event.clientY, additive: event.shiftKey, element };
      this.acquireStudioDragLock();
      this.orbit.enabled = false; this.cameraOrbit.enabled = false;
      this.renderer.domElement.setPointerCapture(event.pointerId);
      return;
    }
    if (this.cameraView && !this.transform.dragging) {
      this.cameraPointerDown = true;
      return;
    }
    if (event.button !== 0 || this.transform.dragging) return;
    if (this.transform.axis !== null) return;
    if (this.fitSelection && !event.shiftKey) {
      const ray = this.fitRay(event);
      const hit = this.fitHandleAt(event);
      if (!hit) return;
      event.stopImmediatePropagation();
      this.beginFitDrag();
      this.fitSelection = {...this.fitSelection,node:hit.userData.node};
      this.refreshFitHandles();
      this.options.fitSelect?.(this.fitSelection);
      this.attachFitGizmo();
      const plane = new T.Plane().setFromNormalAndCoplanarPoint(this.editorCamera.getWorldDirection(new T.Vector3()),hit.position);
      const point = ray.ray.intersectPlane(plane,new T.Vector3());
      if (!point) return;
      this.fitPlane = {plane,grab:hit.position.clone().sub(point)};
      this.nodePointer = event.pointerId;
      this.acquireStudioDragLock();
      this.renderer.domElement.setPointerCapture(event.pointerId);
      return;
    }
    const marker = event.shiftKey || this.selectedIds.length > 1 ? null : this.markerAt(event);
    if (!marker) return;
    // Visible overlay nodes own the click, even where skin or a gizmo lies in front.
    event.stopImmediatePropagation();
    this.nodePointer = event.pointerId;
    this.acquireStudioDragLock();
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
    if (this.fitPlane) this.finishFitDrag(true);
    this.nodePointer = null;
    if (!this.transform.dragging) this.clearStudioDragLock();
    this.renderer.domElement.releasePointerCapture(event.pointerId);
  };
  private pointerMove = (event: PointerEvent) => {
    this.syncRotationSnap(event.shiftKey, false);
    this.pendingHoverShiftKey = event.shiftKey;
    if (event.buttons !== 0) this.lastDragPointerEvent = event;
    if (this.fitPlane && event.pointerId === this.nodePointer) {
      event.stopImmediatePropagation();
      if (this.pointerStart.distanceTo(new T.Vector2(event.clientX,event.clientY)) < 2 && !this.fitPreview) return;
      const p = this.fitRay(event).ray.intersectPlane(this.fitPlane.plane,new T.Vector3());
      if (p) this.moveFitNode(p.add(this.fitPlane.grab));
      return;
    }
    if (this.marquee) {
      const rect = this.host.getBoundingClientRect(), m = this.marquee;
      Object.assign(m.element.style, {
        left: `${Math.min(m.x, event.clientX) - rect.left}px`, top: `${Math.min(m.y, event.clientY) - rect.top}px`,
        width: `${Math.abs(m.x - event.clientX)}px`, height: `${Math.abs(m.y - event.clientY)}px`,
      });
      return;
    }
    if (event.buttons !== 0 || this.transform.dragging || this.nodePointer !== null) {
      this.emitHoverTip(null);
      return;
    }
    this.governor.queueHoverPointer(event.clientX, event.clientY, false);
  };

  private evaluateHoverAt(clientX: number, clientY: number): void {
    const coords = { clientX, clientY };
    if (this.fitSelection && !this.cameraView && !this.transform.axis) {
      const handle = this.fitHandleAt(coords);
      if (handle) {
        this.renderer.domElement.style.cursor = 'grab';
        this.emitHoverTip({title:handle.userData.kind === 'edge' ? 'Edge node' : 'Surface node',
          description:'Drag in the view plane or use the translation arrows',clientX,clientY});
        return;
      }
    }
    if (!this.cameraView && this.modelingMode !== 'object' && this.selected && this.state) {
      const entry = this.entries.get(this.selected);
      const item = this.state.items.find(i => i.id === this.selected);
      if (entry && item?.kind === 'mesh' && item.editableMesh) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        const pointer = new T.Vector2(
          ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
          -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
        );
        const ray = new T.Raycaster();
        ray.setFromCamera(pointer, this.editorCamera);
        entry.root.updateMatrixWorld(true);
        const hit = pickMeshComponent(
          ray,
          this.editorCamera,
          { width: rect.width, height: rect.height },
          entry.root.matrixWorld,
          item.editableMesh,
          this.modelingMode,
          { xRay: this.xRayWireframe },
        );
        let loopFactor = 0.5;
        if (hit && hit.kind === 'edge') {
          const adj = getCachedHalfEdgeMesh(item.editableMesh);
          const ed = adj.edges[hit.index];
          if (ed) {
            const wa = new T.Vector3(...item.editableMesh.vertices[ed.a]).applyMatrix4(entry.root.matrixWorld);
            const wb = new T.Vector3(...item.editableMesh.vertices[ed.b]).applyMatrix4(entry.root.matrixWorld);
            const ab = wb.clone().sub(wa);
            const lenSq = ab.lengthSq();
            if (lenSq > 1e-8) {
              const hp = new T.Vector3(...hit.worldPoint);
              loopFactor = T.MathUtils.clamp(hp.sub(wa).dot(ab) / lenSq, 0.05, 0.95);
            }
          }
        }
        const nextHover = hit ? { index: hit.index, loopFactor } : null;
        const changed =
          (this.hoveredComponent?.index ?? null) !== (nextHover?.index ?? null) ||
          (this.loopCutActive.enabled &&
            Math.abs((this.hoveredComponent?.loopFactor ?? 0.5) - (nextHover?.loopFactor ?? 0.5)) > 0.01);
        this.hoveredComponent = nextHover;
        if (changed) {
          this.refreshComponentOverlay(entry, item.editableMesh);
        }
        this.renderer.domElement.style.cursor = hit
          ? this.loopCutActive.enabled
            ? 'crosshair'
            : 'pointer'
          : '';
        if (hit) {
          const kindLabel =
            hit.kind === 'vertex' ? 'Point' : hit.kind === 'edge' ? 'Edge' : 'Polygon';
          this.emitHoverTip(
            this.loopCutActive.enabled
              ? {
                  title: `Insert Loop Cut (${Math.round(loopFactor * 100)}%)`,
                  description: 'Click edge to insert quad ring',
                  clientX,
                  clientY,
                }
              : {
                  title: `${kindLabel} #${hit.index}`,
                  description: 'Click to select · Shift to toggle',
                  clientX,
                  clientY,
                },
          );
        } else {
          this.emitHoverTip(null);
        }
        return;
      }
    }
    const prevMarker = this.hoveredMarker;
    const prevLight = this.hoveredLightHandle;
    this.hoveredMarker = this.markerAt(coords);
    this.hoveredLightHandle = this.hoveredMarker ? null : this.lightHandleAt(coords);
    if (prevMarker !== this.hoveredMarker || prevLight !== this.hoveredLightHandle) {
      this.updateMarkerColors();
    }
    if (this.hoveredMarker) {
      const rawJoint = String(this.hoveredMarker.userData.joint ?? '');
      const formattedJoint = rawJoint
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, s => s.toUpperCase());
      this.renderer.domElement.style.cursor = 'pointer';
      this.emitHoverTip({
        title: formattedJoint,
        description: `${this.positionPosing ? 'Select to move' : 'Select to rotate'} · Right-click to ${
          this.state?.items.find(i => i.id === this.selected)?.posePins?.[rawJoint as Joint] ? 'unpin' : 'pin'}`,
        clientX,
        clientY,
      });
      return;
    }
    if (this.hoveredLightHandle) {
      const targetId = this.hoveredLightHandle.userData.lightTargetId as string | undefined;
      const sourceId = this.hoveredLightHandle.userData.lightSourceId as string | undefined;
      const lightItem = this.state?.items.find(i => i.id === (targetId ?? sourceId));
      const label = lightItem?.name ?? 'Light';
      this.renderer.domElement.style.cursor = 'pointer';
      this.emitHoverTip({
        title: label,
        description: targetId ? 'Light target · Click to select' : 'Light source · Click to select',
        clientX,
        clientY,
      });
      return;
    }
    this.renderer.domElement.style.cursor = '';
    this.emitHoverTip(null);
  }
  private pointerLeave = () => {
    const hadHover =
      this.hoveredMarker !== null ||
      this.hoveredLightHandle !== null ||
      this.hoveredComponent !== null;
    this.governor.resetHoverState();
    this.hoveredMarker = null;
    this.hoveredLightHandle = null;
    if (this.hoveredComponent !== null) {
      this.hoveredComponent = null;
      if (this.selected && this.state) {
        const entry = this.entries.get(this.selected);
        const item = this.state.items.find(i => i.id === this.selected);
        if (entry && item?.kind === 'mesh' && item.editableMesh) {
          this.refreshComponentOverlay(entry, item.editableMesh);
        }
      }
    }
    this.updateMarkerColors();
    this.renderer.domElement.style.cursor = '';
    this.emitHoverTip(null);
    if (hadHover) this.governor.invalidate('hover');
  };
  private pointerCancel = () => {
    this.lastDragPointerEvent = null;
    if (this.fitPlane) this.pointerStart.set(Infinity,Infinity);
    this.syncRotationSnap(false, false);
    this.cancelMarquee();
    if (this.fitSelection) this.finishFitDrag(false);
    if (this.nodePointer !== null && this.renderer.domElement.hasPointerCapture(this.nodePointer))
      this.renderer.domElement.releasePointerCapture(this.nodePointer);
    this.nodePointer = null;
    this.clearStudioDragLock();
    this.flushCameraGesture();
    if (this.transform.dragging) this.transform.pointerUp(null);
    if (this.transformChanged) {
      this.commitTransforms();
      this.transformChanged = false;
    }
    this.pointerLeave();
  };
  private fitCaptureLost = (event: PointerEvent) => {
    if (this.fitPlane && event.pointerId === this.nodePointer) this.pointerCancel();
  };
  private cancelMarquee(): void {
    if (!this.marquee) return;
    const { pointer, element } = this.marquee;
    element.remove(); this.marquee = null;
    if (!this.transform.dragging && this.nodePointer === null) this.clearStudioDragLock();
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
    if (!this.cameraView && this.modelingMode !== 'object' && this.selected && this.state) {
      const entry = this.entries.get(this.selected);
      const item = this.state.items.find(i => i.id === this.selected);
      if (entry && item?.kind === 'mesh' && item.editableMesh) {
        entry.root.updateMatrixWorld(true);
        const hits = marqueeSelectMeshComponents(
          {
            x0: left - rect.left,
            y0: top - rect.top,
            x1: right - rect.left,
            y1: bottom - rect.top,
          },
          this.editorCamera,
          { width: rect.width, height: rect.height },
          entry.root.matrixWorld,
          item.editableMesh,
          this.modelingMode,
          this.xRayWireframe,
        );
        this.cancelMarquee();
        const merge = (prev: number[]) =>
          m.additive ? Array.from(new Set([...prev, ...hits])) : hits;
        const nextSel: ComponentSelection = {
          mode: this.modelingMode,
          vertices: this.modelingMode === 'point' ? merge(this.componentSelection.vertices) : [],
          edges: this.modelingMode === 'edge' ? merge(this.componentSelection.edges) : [],
          faces: this.modelingMode === 'polygon' ? merge(this.componentSelection.faces) : [],
        };
        this.options.componentSelect?.(nextSel);
        return;
      }
    }
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
  private handleTransformChange = () => {
    this.governor.invalidate('gizmo');
  };
  private handleOrbitStart = () => {
    this.governor.beginInteraction('camera');
  };
  private handleOrbitChange = () => {
    if (!this.suppressOrbitEmit) this.emitHoverTip(null);
    this.governor.invalidate('camera');
    this.emitOrbit(false);
  };
  private handleOrbitEnd = () => {
    this.governor.endInteraction('camera');
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
    this.cameraOrbit.finishAnimation();
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
    this.cameraOrbit.cancelAnimation();
    if (this.cameraWheelTimer !== null) {
      clearTimeout(this.cameraWheelTimer);
      this.cameraWheelTimer = null;
    }
    this.cameraPointerDown = false;
    this.cameraGestureDirty = false;
  }
  private handleCameraOrbitStart = () => {
    this.governor.beginInteraction('camera');
  };
  private handleCameraOrbitChange = () => {
    this.governor.invalidate('camera');
    if (this.suppressCameraEmit || !this.cameraView) return;
    this.emitHoverTip(null);
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
    if (!this.cameraPointerDown && !this.cameraOrbit.isAnimating) {
      if (this.cameraWheelTimer !== null) clearTimeout(this.cameraWheelTimer);
      this.cameraWheelTimer = setTimeout(() => {
        this.cameraWheelTimer = null;
        this.flushCameraGesture();
      }, 160);
    }
  };
  private handleCameraOrbitEnd = () => {
    this.governor.endInteraction('camera');
    if (this.suppressCameraEmit || !this.cameraView) return;
    if (this.cameraPointerDown || (this.cameraGestureDirty && this.cameraWheelTimer === null)) {
      this.cameraPointerDown = false;
      this.flushCameraGesture();
    }
  };
  private updateMarkerColors(): void {
    for (const entry of this.entries.values()) entry.markers?.forEach(m => {
      const pins = this.state?.items.find(i => i.id === entry.root.userData.itemId)?.posePins;
      m.material.color.set(pins?.[m.userData.joint as Joint] ? '#62e7ee' :
        m.userData.joint === this.joint ? '#ff826b' : m === this.hoveredMarker ? '#ffffff' : '#ffd07d');
    });
  }
  private isHitLocked(hitObject: T.Object3D): boolean {
    if (!this.state) return false;
    const directLightId =
      typeof hitObject.userData.lightTargetId === 'string'
        ? hitObject.userData.lightTargetId
        : typeof hitObject.userData.lightSourceId === 'string'
          ? hitObject.userData.lightSourceId
          : null;
    if (directLightId) {
      const targetItem = this.state.items.find(i => i.id === directLightId);
      return Boolean(targetItem?.locked);
    }
    let node: T.Object3D | null = hitObject;
    let roomObjectId: string | null = null;
    while (node && !node.userData.itemId) {
      if (!roomObjectId && typeof node.userData.roomObjectId === 'string') {
        roomObjectId = node.userData.roomObjectId;
      }
      node = node.parent;
    }
    if (!node) return false;
    const item = this.state.items.find(i => i.id === node!.userData.itemId);
    if (!item) return false;
    if (item.locked) return true;
    if (roomObjectId && item.roomObjects?.[roomObjectId]?.locked) return true;
    return false;
  }
  private doubleClick = (event: MouseEvent) => {
    if (this.cameraView || this.modelingMode !== 'edge' || !this.selected || !this.state) return;
    const entry = this.entries.get(this.selected);
    const item = this.state.items.find(i => i.id === this.selected);
    if (!entry || item?.kind !== 'mesh' || !item.editableMesh) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const pointer = new T.Vector2(
      ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    const ray = new T.Raycaster();
    ray.setFromCamera(pointer, this.editorCamera);
    entry.root.updateMatrixWorld(true);
    const hit = pickMeshComponent(
      ray,
      this.editorCamera,
      { width: rect.width, height: rect.height },
      entry.root.matrixWorld,
      item.editableMesh,
      'edge',
      { xRay: this.xRayWireframe },
    );
    if (!hit) return;
    const loop = selectEdgeLoop(item.editableMesh, hit.index);
    const nextEdges = event.shiftKey
      ? Array.from(new Set([...this.componentSelection.edges, ...loop]))
      : loop;
    this.options.componentSelect?.({
      mode: 'edge',
      vertices: [],
      edges: nextEdges,
      faces: [],
    });
  };
  private populateModelingEntry(entry: Entry, item: Item): void {
    let stageGroup = entry.root.children.find(c => c.userData.isModelingStageGroup) as T.Group | undefined;
    if (stageGroup) {
      while (stageGroup.children.length > 0) {
        const child = stageGroup.children[0]!;
        stageGroup.remove(child);
        disposeObject(child);
      }
    } else {
      stageGroup = new T.Group();
      stageGroup.userData.isModelingStageGroup = true;
      entry.root.add(stageGroup);
    }

    const roughness = item.roughness ?? 0.65;
    const metalness = item.metalness ?? 0.08;

    // Preserve authored multi-material / textured hierarchy when an imported 3D asset has no modifiers
    const hasEnabledModifiers = Boolean(item.modifiers?.some(m => m.enabled));
    if (item.kind === 'imported' && item.assetId && !hasEnabledModifiers) {
      const runtimeAsset = getRuntimeImportedAsset(item.assetId);
      if (runtimeAsset) {
        const cloned = runtimeAsset.root.clone(true);
        const tint = item.color.toLowerCase() !== '#ffffff' ? new T.Color(item.color) : null;
        cloned.traverse((node: T.Object3D) => {
          if (!(node instanceof T.Mesh)) return;
          node.castShadow = true;
          node.receiveShadow = true;
          const mats = Array.isArray(node.material) ? node.material : [node.material];
          const nextMats = mats.map((m: T.Material) => {
            const clonedMat = m.clone();
            if (clonedMat instanceof T.MeshStandardMaterial) {
              if (tint && !clonedMat.map) clonedMat.color.copy(tint);
              if (item.roughness !== undefined) clonedMat.roughness = roughness;
              if (item.metalness !== undefined) clonedMat.metalness = metalness;
              this.shading.attachStudioShading(clonedMat);
            }
            return clonedMat;
          });
          node.material = Array.isArray(node.material) ? nextMats : nextMats[0]!;
        });
        stageGroup.add(cloned);
        const box = computeStageWorldBounds(cloned);
        if (box.isEmpty()) {
          // Placeholder wireframe box when asset is empty
          const ph = new T.Mesh(
            new T.BoxGeometry(0.6, 0.6, 0.6),
            new T.MeshStandardMaterial({ color: item.color, roughness, metalness }),
          );
          ph.castShadow = true;
          ph.receiveShadow = true;
          this.shading.attachStudioShading(ph.material);
          stageGroup.add(ph);
        }
        ensureObjectTreeBvh(stageGroup);
        entry.evaluatedMesh = getImportedBaseEditableMesh(item.assetId) ?? undefined;
        return;
      }
    }

    const node = itemToModelingNode(item, false);
    const evaluated = evaluateModelingNode(node);
    evaluated.wireframeGeometry.dispose();
    const material = new T.MeshStandardMaterial({
      color: item.color,
      roughness,
      metalness,
    });
    this.shading.attachStudioShading(material);
    const mesh = new T.Mesh(evaluated.geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    ensureGeometryBvh(evaluated.geometry);
    stageGroup.add(mesh);
    entry.primaryMesh = mesh;
    entry.evaluatedMesh = evaluated.editableMesh;
  }
  private refreshComponentOverlay(entry: Entry, meshData: EditableMeshData): void {
    entry.root.updateMatrixWorld(true);
    this.componentOverlay.syncTransform(entry.root.matrixWorld);
    const loopPreview =
      this.loopCutActive.enabled && this.hoveredComponent && this.modelingMode === 'edge'
        ? {
            edgeIndex: this.hoveredComponent.index,
            factor: this.hoveredComponent.loopFactor,
            cuts: this.loopCutActive.cuts,
          }
        : null;
    this.componentOverlay.update({
      mesh: meshData,
      mode: this.modelingMode,
      selection: this.componentSelection,
      hoveredIndex: this.hoveredComponent?.index ?? null,
      xRay: this.xRayWireframe,
      showWireframeInObjectMode: this.xRayWireframe,
      loopCutPreview: loopPreview,
    });
    this.componentOverlay.group.visible = !this.cameraView;
  }
  private refreshBooleOperandGhost(parentEntry: Entry | null, operand: Item | null): void {
    if (!parentEntry || !operand || this.cameraView) {
      if (this.booleOperandGhost) {
        if (this.booleOperandGhost.parent) this.booleOperandGhost.parent.remove(this.booleOperandGhost);
        this.booleOperandGhost.geometry.dispose();
        (this.booleOperandGhost.material as T.Material).dispose();
        this.booleOperandGhost = null;
      }
      this.booleOperandGhostSig = null;
      return;
    }
    const opGeomSig = `${operand.id}|${computeModelingSignature(operand)}`;
    if (
      this.booleOperandGhost &&
      this.booleOperandGhost.parent === parentEntry.root &&
      this.booleOperandGhostSig === opGeomSig
    ) {
      this.booleOperandGhost.position.fromArray(operand.position);
      this.booleOperandGhost.rotation.set(...operand.rotation);
      this.booleOperandGhost.scale.fromArray(operand.scale);
      return;
    }
    if (this.booleOperandGhost) {
      if (this.booleOperandGhost.parent) this.booleOperandGhost.parent.remove(this.booleOperandGhost);
      this.booleOperandGhost.geometry.dispose();
      (this.booleOperandGhost.material as T.Material).dispose();
      this.booleOperandGhost = null;
    }
    const opNode = itemToModelingNode(operand, false);
    const evaluated = evaluateModelingNode(opNode);
    evaluated.geometry.dispose();
    const wireGeom = evaluated.wireframeGeometry;
    const wireMat = new T.LineBasicMaterial({
      color: '#ff9d3b',
      transparent: true,
      opacity: 0.85,
      depthTest: false,
    });
    const ghost = new T.LineSegments(wireGeom, wireMat);
    ghost.position.fromArray(operand.position);
    ghost.rotation.set(...operand.rotation);
    ghost.scale.fromArray(operand.scale);
    ghost.layers.set(HELPER_LAYER);
    ghost.renderOrder = 36;
    ghost.userData.ignorePick = true;
    parentEntry.root.add(ghost);
    this.booleOperandGhost = ghost;
    this.booleOperandGhostSig = opGeomSig;
  }
  private pointerUp = (event: PointerEvent) => {
    this.lastDragPointerEvent = null;
    this.syncRotationSnap(event.shiftKey, false);
    if (event.button === 2) {
      if (!event.altKey && !this.transform.dragging && this.selected && this.selectedIds.length === 1 &&
          this.pointerStart.distanceTo(new T.Vector2(event.clientX, event.clientY)) <= 4) {
        const marker = this.markerAt(event);
        if (marker) this.toggleJointPin(this.selected, marker.userData.joint);
      }
      return;
    }
    if (this.recentlyDragged || this.transform.dragging || this.transform.axis !== null || this.pointerStart.distanceTo(new T.Vector2(event.clientX, event.clientY)) > 4) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (!this.cameraView && this.modelingMode !== 'object' && this.selected && this.state) {
      const entry = this.entries.get(this.selected);
      const item = this.state.items.find(i => i.id === this.selected);
      if (entry && item?.kind === 'mesh' && item.editableMesh) {
        const pointer = new T.Vector2(
          ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
          -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
        );
        const ray = new T.Raycaster();
        ray.setFromCamera(pointer, this.editorCamera);
        entry.root.updateMatrixWorld(true);
        const hit = pickMeshComponent(
          ray,
          this.editorCamera,
          { width: rect.width, height: rect.height },
          entry.root.matrixWorld,
          item.editableMesh,
          this.modelingMode,
          { xRay: this.xRayWireframe },
        );
        if (hit) {
          if (this.loopCutActive.enabled && hit.kind === 'edge') {
            const factor = this.hoveredComponent?.index === hit.index ? this.hoveredComponent.loopFactor : 0.5;
            this.options.loopCutClick?.(item.id, hit.index, factor);
            return;
          }
          const toggleIn = (arr: number[], idx: number) =>
            event.shiftKey
              ? arr.includes(idx)
                ? arr.filter(v => v !== idx)
                : [...arr, idx]
              : [idx];
          const nextSel: ComponentSelection = {
            mode: this.modelingMode,
            vertices: this.modelingMode === 'point' ? toggleIn(this.componentSelection.vertices, hit.index) : [],
            edges: this.modelingMode === 'edge' ? toggleIn(this.componentSelection.edges, hit.index) : [],
            faces: this.modelingMode === 'polygon' ? toggleIn(this.componentSelection.faces, hit.index) : [],
          };
          this.options.componentSelect?.(nextSel);
          return;
        }
        if (!event.shiftKey && !this.loopCutActive.enabled) {
          this.options.componentSelect?.({
            mode: this.modelingMode,
            vertices: [],
            edges: [],
            faces: [],
          });
          return;
        }
      }
    }
    if (!this.cameraView && !event.shiftKey) {
      const overlayTarget = pickLightHandle(this.overlayLightTargets(), this.editorCamera, rect, event.clientX, event.clientY, 12);
      if (overlayTarget && typeof overlayTarget.userData.lightTargetId === 'string') {
        const id = overlayTarget.userData.lightTargetId;
        this.select(id, null, [id], null, 'target');
        this.options.select(id, null, false, 'target');
        return;
      }
    }
    const pointer = new T.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    const ray = new T.Raycaster(); ray.layers.enable(HELPER_LAYER); ray.setFromCamera(pointer, this.cameraView ? this.camera : this.editorCamera);
    const targets = [...this.entries.values()]
      .filter(e => e.root.visible)
      .flatMap(e => (e.target && e.targetHandle?.visible ? [e.root, e.target] : [e.root]));
    const pickT0 = performance.now();
    const hits = withFirstHitRaycaster(ray, () => ray.intersectObjects(targets, true));
    this.perfMonitor.recordRaycast(performance.now() - pickT0);
    const hit = hits.find(h => h.object.visible && !h.object.userData.ignorePick && !h.object.userData.joint && !this.isHitLocked(h.object));
    if (!hit) {
      if (!this.cameraView) {
        const nearSource = pickLightHandle(this.lightSourceHandles(), this.editorCamera, rect, event.clientX, event.clientY, 11);
        if (nearSource && typeof nearSource.userData.lightSourceId === 'string') {
          const id = nearSource.userData.lightSourceId;
          if (!event.shiftKey) this.select(id, null, [id], null, 'source');
          this.options.select(id, null, event.shiftKey, 'source');
          return;
        }
      }
      if (!event.shiftKey) {
        this.lightPart = 'source';
        this.options.select(null, null, false, 'source');
      }
      return;
    }
    if (typeof hit.object.userData.lightTargetId === 'string') {
      const id = hit.object.userData.lightTargetId;
      this.select(id, null, [id], null, 'target');
      this.options.select(id, null, false, 'target');
      return;
    }
    if (typeof hit.object.userData.lightSourceId === 'string') {
      const id = hit.object.userData.lightSourceId;
      if (!event.shiftKey) this.select(id, null, [id], null, 'source');
      this.options.select(id, null, event.shiftKey, 'source');
      return;
    }
    this.lightPart = 'source';
    let node: T.Object3D | null = hit.object;
    let roomObjectId: string | null = null;
    const joint: Joint | null = hit.object.userData.joint ?? null;
    while (node && !node.userData.itemId) {
      if (!roomObjectId && typeof node.userData.roomObjectId === 'string') {
        roomObjectId = node.userData.roomObjectId;
      }
      node = node.parent;
    }
    if (node) {
      const garment = hit.object.name.startsWith('Wardrobe: ') ? hit.object.name.slice(10) as Garment : null;
      const id: string = node.userData.itemId;
      if (garment && !event.shiftKey && !this.cameraView && this.posePreviewId !== id &&
          (this.fitSelection?.itemId !== id || this.fitSelection?.garment !== garment)) {
        this.options.select(id,null,false,'source');
        this.select(id,null,[id]);
        this.editGarmentFit(id,garment);
        return;
      }
      if (roomObjectId && this.options.selectRoomObject) {
        this.options.selectRoomObject(node.userData.itemId, roomObjectId);
      } else {
        this.options.select(node.userData.itemId, joint, event.shiftKey, 'source');
      }
    }
  };
  sync(state: SceneState): void {
    this.posePreviewId = null;
    if (this.fitPlane || this.fitPreview || (this.fitSelection && this.transform.dragging)) this.pointerCancel();
    if(this.clothJob) {
      const target=state.items.find(i=>i.id===this.clothJob?.id);
      if(!target || target.locked || clothPoseKey(target)!==this.clothJob.key) this.cancelCloth();
    }
    this.state = clone(state);
    for (const [id, entry] of this.entries) if (!state.items.some(i => i.id === id && i.kind === entry.kind && i.roomId === entry.roomId &&
      (!isBody(i.kind) || (i.modelId ?? defaultModelId(i.kind)) === entry.figure?.modelId) &&
      (i.kind !== 'light' || (i.lightType ?? LIGHT_DEFAULTS.lightType) === (entry.lightType ?? LIGHT_DEFAULTS.lightType)))) {
      this.transform.detach(); this.scene.remove(entry.root);
      removeLightAux(this.scene, entry);
      disposeObject(entry.root); this.entries.delete(id);
    }
    for (const item of state.items) {
      let entry = this.entries.get(item.id);
      const isModelingKind =
        item.kind === 'primitive' ||
        item.kind === 'mesh' ||
        item.kind === 'boole' ||
        item.kind === 'imported' ||
        (!isBody(item.kind) && item.kind !== 'light' && !item.roomId && Boolean(item.modifiers?.some(m => m.enabled)));
      if (!entry) {
        if (isBody(item.kind)) {
          const figure = makeExternalFigure(
            item.kind,
            item.color,
            item.outfitColor ?? defaultCharacterOutfitColor(item.kind, item.modelId),
            item.modelId,
          );
          const markers = JOINTS.map(j => {
            const m = new T.Mesh(new T.SphereGeometry(0.022, 16, 12), new T.MeshBasicMaterial({ color: '#ffd07d', depthTest: false, depthWrite: false }));
            ensureGeometryBvh(m.geometry);
            m.renderOrder = 20; m.userData.joint = j; m.layers.set(HELPER_LAYER); figure.bones[j].add(m); return m;
          });
          entry = { kind: item.kind, root: figure.root, figure, markers };
        } else if (item.kind === 'light') {
          entry = createLightEntry(this.scene, item);
        } else if (item.roomId) entry = { kind: item.kind, root: makeRoom(item.roomId), roomId: item.roomId };
        else if (isModelingKind) {
          const root = new T.Group();
          entry = { kind: item.kind, root, modelingSig: '' };
        }
        else {
          const propRoot = makeProp(item.kind as PropKind, item.color);
          ensureObjectTreeBvh(propRoot);
          entry = { kind: item.kind, root: propRoot };
        }
        entry.root.userData.itemId = item.id; this.entries.set(item.id, entry); this.scene.add(entry.root);
      } else if (isModelingKind && entry.modelingSig === undefined) {
        // Prop transitioned to having enabled modifiers: convert root to modeling entry
        this.scene.remove(entry.root);
        disposeObject(entry.root);
        const root = new T.Group();
        root.userData.itemId = item.id;
        entry = { kind: item.kind, root, modelingSig: '' };
        this.entries.set(item.id, entry);
        this.scene.add(root);
      } else if (!isModelingKind && entry.modelingSig !== undefined && !isBody(item.kind) && item.kind !== 'light' && !item.roomId) {
        // Prop had all modifiers disabled/removed: restore multi-material prop
        this.scene.remove(entry.root);
        disposeObject(entry.root);
        const root = makeProp(item.kind as PropKind, item.color);
        ensureObjectTreeBvh(root);
        root.userData.itemId = item.id;
        entry = { kind: item.kind, root };
        this.entries.set(item.id, entry);
        this.scene.add(root);
      }
      const activeEntry: Entry = entry!;
      if (isModelingKind) {
        const sig = computeModelingSignature(item);
        if (activeEntry.modelingSig !== sig) {
          this.populateModelingEntry(activeEntry, item);
          activeEntry.modelingSig = sig;
        }
      }
      activeEntry.root.position.fromArray(item.position); activeEntry.root.rotation.set(...item.rotation); activeEntry.root.scale.fromArray(item.scale);
      activeEntry.root.visible = item.visible !== false;
      if (activeEntry.roomId) {
        for (const roomObj of getRoomObjects(activeEntry.root)) {
          const ov = item.roomObjects?.[roomObj.id];
          const [bx, by, bz] = roomObj.basePosition;
          const pos = ov?.position ?? [0, 0, 0];
          const rot = ov?.rotation ?? [0, 0, 0];
          const scl = ov?.scale ?? [1, 1, 1];
          roomObj.group.position.set(bx + pos[0], by + pos[1], bz + pos[2]);
          roomObj.group.rotation.set(rot[0], rot[1], rot[2]);
          roomObj.group.scale.set(scl[0], scl[1], scl[2]);
          roomObj.group.visible = !ov?.deleted && ov?.visible !== false;
        }
      }
      if (activeEntry.figure && item.pose && isBody(item.kind)) {
        const effectiveHairColor = item.hairColor ?? defaultCharacterHairColor(item.modelId);
        activeEntry.figure.deformation = { bodyType: item.bodyType ?? DEFAULT_BODY_TYPE, limitMode: item.anatomicalLimits === false ? 'free' : 'anatomical' };
        setFigurePose(activeEntry.figure, item.pose, item.handPose);
        syncWardrobe(activeEntry.figure, item.wardrobe, () => {
         if (item.id === this.fitSelection?.itemId) this.refreshFitHandles();
         this.liveShadowRevision++;
         this.liveGiRevision++;
         this.renderer.shadowMap.needsUpdate = true;
         this.governor.invalidate('scene');
        }, e => this.options.error(e), item.wardrobe?.drape ? clothPoseKey(item) : undefined);
        setFigureHairStyle(activeEntry.figure, item.kind, item.hairStyle, effectiveHairColor);
        setFigureColors(
          activeEntry.figure,
          item.color,
          item.outfitColor ?? defaultCharacterOutfitColor(item.kind, item.modelId),
          effectiveHairColor,
        );
        if (isMannequinCharacter(item.modelId)) {
          const dressSource = item.customDressMapDataUrl || item.dressMapId || DEFAULT_MANNEQUIN_DRESS_ID;
          void setFigureDressMap(activeEntry.figure, dressSource, undefined, () => {
            this.governor.invalidate('scene');
          }).catch(() => undefined);
        }
      }
      else if (!activeEntry.light && !(item.kind === 'imported' && item.color.toLowerCase() === '#ffffff')) activeEntry.root.traverse(node => {
        if (node instanceof T.Mesh && node.material instanceof T.MeshStandardMaterial && !node.userData.fixedColor) node.material.color.set(item.color);
      });
      if (activeEntry.light) {
        updateLightEntry(activeEntry, item);
      }
      activeEntry.root.traverse(node => {
        if (!activeEntry.light && node instanceof T.Light) {
          node.visible = !state.sceneLightsOnly;
        }
        if (!(node instanceof T.Mesh)) return;
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
          if (material instanceof T.MeshStandardMaterial) this.shading.attachStudioShading(material);
        }
      });
    }
    syncLinkedLightTargets(this.state.items, (rId, oId) => this.getRoomObjectBasePosition(rId, oId));
    this.syncLinkedLightEntriesInScene();
    this.floor.visible = !state.items.some(i => i.roomId && i.visible !== false);
    releaseUnusedRooms(state.items.flatMap(i => i.roomId ? [i.roomId] : []));
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
        this.cameraOrbit.cancelAnimation();
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
    this.select(
      this.selected,
      this.joint,
      this.selectedIds,
      this.selectedRoomObject?.objectId ?? null,
      this.lightPart,
      this.selectedOperandId,
    );
    this.resize();
    this.governor.invalidate('scene');
  }
  getRoomObjects(itemId: string): RoomObjectInfo[] {
    const entry = this.entries.get(itemId);
    return entry?.roomId ? getRoomObjects(entry.root) : [];
  }
  getRoomObjectBasePosition(roomId: string, objectId: string): Vec3 | null {
    const entry = this.entries.get(roomId);
    if (!entry?.roomId) return null;
    const roomObj = getRoomObjects(entry.root).find(o => o.id === objectId);
    return roomObj ? ([...roomObj.basePosition] as Vec3) : null;
  }
  private syncLinkedLightEntriesInScene(): void {
    if (!this.state) return;
    for (const item of this.state.items) {
      if (!isTargetedLight(item) || !item.targetObjectId) continue;
      const lightEntry = this.entries.get(item.id);
      if (!lightEntry?.target) continue;
      const parsed = parseTargetObjectRef(item.targetObjectId);
      if (!parsed) continue;
      if (parsed.kind === 'item') {
        if (parsed.itemId === item.id) continue;
        const targetEntry = this.entries.get(parsed.itemId);
        if (!targetEntry) continue;
        targetEntry.root.updateMatrixWorld(true);
        targetEntry.root.getWorldPosition(lightEntry.target.position);
      } else {
        const roomEntry = this.entries.get(parsed.roomId);
        const roomItem = this.state.items.find(i => i.id === parsed.roomId && Boolean(i.roomId));
        if (!roomEntry?.roomId || !roomItem || roomItem.roomObjects?.[parsed.objectId]?.deleted) continue;
        const roomObj = getRoomObjects(roomEntry.root).find(o => o.id === parsed.objectId);
        if (!roomObj) continue;
        roomEntry.root.updateMatrixWorld(true);
        roomObj.group.getWorldPosition(lightEntry.target.position);
      }
    }
  }
  select(
    id: string | null,
    joint: Joint | null,
    ids?: string[],
    roomObjectId?: string | null,
    lightPart?: LightPart,
    operandId?: string | null,
  ): void {
    this.governor.invalidate('gizmo');
    if(this.clothJob && id!==this.clothJob.id) this.cancelCloth();
    this.selectedIds = (ids ?? (id === this.selected ? this.selectedIds : id ? [id] : [])).filter(key => this.entries.has(key));
    if (id && !this.selectedIds.includes(id)) this.selectedIds.push(id);
    if (this.selectedIds.length > 1) joint = null;
    const item = id && this.state ? this.state.items.find(i => i.id === id) : undefined;
    if (this.fitSelection && (id !== this.fitSelection.itemId || joint || this.selectedIds.length > 1 ||
        !item || item.locked || item.visible === false || !isGarmentEquipped(item.wardrobe,this.fitSelection.garment))) this.clearFitSelection();
    const requestedPart = lightPart ?? (id === this.selected ? this.lightPart : 'source');
    this.lightPart =
      this.selectedIds.length <= 1 && !joint && !roomObjectId && !operandId
        ? resolveLightPartForItem(item, requestedPart)
        : 'source';
    this.selected = id; this.joint = joint;
    this.selectedRoomObject = (id && roomObjectId && this.selectedIds.length <= 1) ? { roomId: id, objectId: roomObjectId } : null;
    this.selectedOperandId =
      id && operandId && item?.kind === 'boole' && item.operands?.some(op => op.id === operandId) && this.selectedIds.length <= 1
        ? operandId
        : null;
    const itemLocked = Boolean(item?.locked);
    for (const [key, e] of this.entries) e.markers?.forEach(m => {
      const locked = this.state?.items.find(i => i.id === key)?.locked;
      m.visible = key === id && item?.visible !== false && !locked && !this.fitSelection && this.selectedIds.length < 2 && this.jointsVisible && !this.cameraView;
    });
    this.updateMarkerColors();
    this.transform.detach();
    this.transform.axis = null;
    if (this.booleOperandPivot.parent) {
      this.booleOperandPivot.parent.remove(this.booleOperandPivot);
    }
    const e = id ? this.entries.get(id) : null;
    this.garmentHandles.visible = !!this.fitSelection && !this.cameraView;
    if (this.fitSelection) {
      this.refreshFitHandles();
      if (!this.cameraView) this.attachFitGizmo();
      return;
    }

    // Update Boole operand wireframe ghost + Component Overlay
    if (this.selectedOperandId && e && item?.kind === 'boole') {
      const op = item.operands?.find(o => o.id === this.selectedOperandId) ?? null;
      this.refreshBooleOperandGhost(e, op);
    } else {
      this.refreshBooleOperandGhost(null, null);
    }

    if (e && item && (item.kind === 'mesh' || (this.xRayWireframe && e.evaluatedMesh))) {
      const meshForOverlay = item.kind === 'mesh' ? item.editableMesh : e.evaluatedMesh;
      if (meshForOverlay && (this.modelingMode !== 'object' || this.xRayWireframe)) {
        this.refreshComponentOverlay(e, meshForOverlay);
      } else {
        this.componentOverlay.group.visible = false;
      }
    } else {
      this.componentOverlay.group.visible = false;
    }

    if (this.selectedIds.length >= 2 && !this.cameraView && this.state) {
      const unlocked = this.state.items.filter(i => this.selectedIds.includes(i.id) && !i.locked);
      if (unlocked.length >= 2) {
        this.groupPivot.position.fromArray(selectionCentroid(unlocked));
        this.groupPivot.rotation.set(0, 0, 0); this.groupPivot.scale.set(1, 1, 1);
        this.transform.setMode(this.mode === 'scale' ? 'translate' : this.mode);
        this.transform.setSpace('world'); this.transform.attach(this.groupPivot);
      }
      return;
    }
    if (!this.cameraView && this.modelingMode !== 'object' && e && item?.kind === 'mesh' && item.editableMesh && !itemLocked) {
      e.root.updateMatrixWorld(true);
      const placement = this.componentProxy.syncToSelection(
        item.editableMesh,
        this.componentSelection,
        e.root.matrixWorld,
        this.coordSpace,
      );
      if (placement.hasSelection) {
        this.transform.setMode(this.mode);
        this.transform.setSpace(this.coordSpace);
        this.transform.attach(this.componentProxy.proxyObject);
      }
      return;
    }
    if (this.selectedOperandId && e && item?.kind === 'boole' && !this.cameraView && !itemLocked) {
      const op = item.operands?.find(o => o.id === this.selectedOperandId);
      if (op && !op.locked) {
        e.root.add(this.booleOperandPivot);
        this.booleOperandPivot.position.fromArray(op.position);
        this.booleOperandPivot.rotation.set(...op.rotation);
        this.booleOperandPivot.scale.fromArray(op.scale);
        this.transform.setMode(this.mode);
        this.transform.setSpace(this.coordSpace);
        this.transform.attach(this.booleOperandPivot);
      }
      return;
    }
    if (this.selectedRoomObject && e?.roomId && !this.cameraView) {
      const roomObj = getRoomObjects(e.root).find(o => o.id === this.selectedRoomObject!.objectId);
      const objOv = item?.roomObjects?.[this.selectedRoomObject.objectId];
      if (roomObj && !itemLocked && !objOv?.locked && !objOv?.deleted && objOv?.visible !== false) {
        this.transform.setMode(this.mode);
        this.transform.setSpace('world');
        this.transform.attach(roomObj.group);
      }
      return;
    }
    if (e && e.light && !this.cameraView && !itemLocked) {
      if (this.lightPart === 'target' && e.target) {
        if (!item?.targetObjectId) {
          this.transform.setMode('translate');
          this.transform.setSpace('world');
          this.transform.attach(e.target);
        }
        return;
      }
      this.transform.setMode('translate');
      this.transform.setSpace('world');
      this.transform.attach(e.root);
      return;
    }
    if (e && !this.cameraView && !itemLocked && item?.visible !== false && this.posePreviewId !== id) {
      if (this.positionPosing && joint && e.figure) {
        if (!item?.posePins?.[joint]) {
          e.figure.bones[joint].getWorldPosition(this.jointTarget.position);
          this.transform.setMode('translate');
          this.transform.setSpace('world');
          this.transform.attach(this.jointTarget);
        }
        return;
      }
      this.transform.setMode(joint ? 'rotate' : this.mode);
      this.transform.setSpace(joint ? 'local' : this.coordSpace);
      this.transform.attach(joint && e.figure ? e.figure.bones[joint] : e.root);
    }
  }
  setModelingState(options: {
    mode?: ModelingMode;
    selection?: ComponentSelection;
    xRayWireframe?: boolean;
    coordSpace?: 'world' | 'local';
    loopCut?: { enabled: boolean; cuts: number };
  }): void {
    if (options.mode !== undefined) {
      this.modelingMode = options.mode;
      this.hoveredComponent = null;
    }
    if (options.selection !== undefined) {
      this.componentSelection = {
        mode: options.selection.mode,
        vertices: [...options.selection.vertices],
        edges: [...options.selection.edges],
        faces: [...options.selection.faces],
      };
    }
    if (options.xRayWireframe !== undefined) this.xRayWireframe = options.xRayWireframe;
    if (options.coordSpace !== undefined) this.coordSpace = options.coordSpace;
    if (options.loopCut !== undefined) this.loopCutActive = { ...options.loopCut };
    this.select(
      this.selected,
      this.joint,
      this.selectedIds,
      this.selectedRoomObject?.objectId ?? null,
      this.lightPart,
      this.selectedOperandId,
    );
  }
  extractEditableMesh(itemId: string): EditableMeshData | null {
    const item = this.state?.items.find(i => i.id === itemId);
    if (!item) return null;
    const node = itemToModelingNode(item, false);
    const evaluated = evaluateModelingNode(node);
    evaluated.geometry.dispose();
    evaluated.wireframeGeometry.dispose();
    if (evaluated.editableMesh && evaluated.editableMesh.vertices.length > 0) {
      return cloneEditableMesh(evaluated.editableMesh);
    }
    const entry = this.entries.get(itemId);
    if (entry) {
      return extractEditableMeshFromObject3D(entry.root);
    }
    return null;
  }
  setMode(mode: 'translate' | 'rotate' | 'scale'): void { this.mode = mode; this.select(this.selected, this.joint, this.selectedIds, this.selectedRoomObject?.objectId ?? null, this.lightPart, this.selectedOperandId); }
  setView(cameraView: boolean): void {
    if (cameraView && this.fitSelection && (this.fitPlane || this.transform.dragging)) this.pointerCancel();
    this.emitHoverTip(null);
    if (this.cameraView && !cameraView) this.flushCameraGesture();
    if (!this.cameraView && cameraView) this.orbit.finishAnimation();
    this.cameraView = cameraView;
    this.orbit.enabled = !cameraView && !this.transform.dragging;
    this.cameraOrbit.enabled = cameraView && !this.transform.dragging;
    this.select(this.selected, this.joint, this.selectedIds, this.selectedRoomObject?.objectId ?? null, this.lightPart, this.selectedOperandId);
    this.resize();
  }
  setHelpers(joints: boolean, helpers: boolean): void { this.jointsVisible = joints; this.helpers = helpers; this.select(this.selected, this.joint, this.selectedIds, this.selectedRoomObject?.objectId ?? null, this.lightPart, this.selectedOperandId); }
  private createNavigationContext(): NavigationSceneContext {
    return {
      getRaycastRoots: () =>
        [...this.entries.values()]
          .filter(e => e.root.visible)
          .map(e => e.root),
      getSelectionTarget: () => this.resolveNavigationSelectionTarget(),
      getFrameTarget: () => this.resolveNavigationFrameTarget(),
    };
  }
  private resolveNavigationSelectionTarget(): NavigationSelectionTarget | null {
    if (this.selectedIds.length >= 2) {
      const box = new T.Box3();
      const pointFallbacks: T.Vector3[] = [];
      for (const id of this.selectedIds) {
        const e = this.entries.get(id);
        if (!e || !e.root.visible) continue;
        if (e.roomId) continue;
        const b = computeStageWorldBounds(e.root);
        if (!b.isEmpty()) box.union(b);
        else pointFallbacks.push(e.root.getWorldPosition(new T.Vector3()));
      }
      for (const pt of pointFallbacks) box.expandByPoint(pt);
      if (box.isEmpty()) return null;
      const sphere = box.getBoundingSphere(new T.Sphere());
      return {
        kind: 'multi',
        pivot: box.getCenter(new T.Vector3()),
        bounds: box,
        radius: Math.max(0.45, sphere.radius),
      };
    }

    if (!this.selected) return null;
    const entry = this.entries.get(this.selected);
    if (!entry || !entry.root.visible) return null;

    if (this.selectedRoomObject && entry.roomId) {
      if (this.selectedRoomObject.objectId === 'arch:shell') return null;
      const roomObj = getRoomObjects(entry.root).find(o => o.id === this.selectedRoomObject!.objectId);
      if (!roomObj || !roomObj.group.visible) return null;
      const box = computeStageWorldBounds(roomObj.group);
      if (box.isEmpty()) return null;
      const sphere = box.getBoundingSphere(new T.Sphere());
      return {
        kind: 'room-object',
        pivot: box.getCenter(new T.Vector3()),
        bounds: box,
        radius: Math.max(0.3, sphere.radius),
      };
    }

    if (entry.roomId) {
      return null;
    }

    if (this.joint && entry.figure) {
      entry.root.updateMatrixWorld(true);
      const bonePos = entry.figure.bones[this.joint].getWorldPosition(new T.Vector3());
      const radius = DISTAL_JOINTS.has(this.joint) ? 0.28 : 0.42;
      return { kind: 'joint', pivot: bonePos, radius };
    }

    if (this.lightPart === 'target' && entry.target) {
      entry.target.updateMatrixWorld(true);
      const pos = entry.target.getWorldPosition(new T.Vector3());
      return { kind: 'light-target', pivot: pos, radius: 0.45 };
    }

    if (entry.light) {
      entry.root.updateMatrixWorld(true);
      const pos = entry.root.getWorldPosition(new T.Vector3());
      return { kind: 'object', pivot: pos, radius: 0.65 };
    }

    const box = computeStageWorldBounds(entry.root);
    if (!box.isEmpty()) {
      const sphere = box.getBoundingSphere(new T.Sphere());
      return {
        kind: 'object',
        pivot: box.getCenter(new T.Vector3()),
        bounds: box,
        radius: Math.max(0.3, sphere.radius),
      };
    }
    return {
      kind: 'object',
      pivot: entry.root.getWorldPosition(new T.Vector3()),
      radius: 0.65,
    };
  }
  private computeRoomInteriorFrameTarget(roomRoot: T.Group): NavigationFrameTarget | null {
    const interiorBox = new T.Box3();
    for (const obj of getRoomObjects(roomRoot)) {
      if (obj.id === 'arch:shell' || !obj.group.visible) continue;
      const b = computeStageWorldBounds(obj.group);
      if (!b.isEmpty()) interiorBox.union(b);
    }
    if (!interiorBox.isEmpty()) {
      const sphere = interiorBox.getBoundingSphere(new T.Sphere());
      return {
        center: interiorBox.getCenter(new T.Vector3()),
        radius: T.MathUtils.clamp(sphere.radius, 0.8, 5.5),
      };
    }
    const fullBox = computeStageWorldBounds(roomRoot);
    if (!fullBox.isEmpty()) {
      const sphere = fullBox.getBoundingSphere(new T.Sphere());
      return {
        center: fullBox.getCenter(new T.Vector3()),
        radius: T.MathUtils.clamp(sphere.radius, 0.8, 5.5),
      };
    }
    return null;
  }
  private resolveNavigationFrameTarget(): NavigationFrameTarget {
    const sel = this.resolveNavigationSelectionTarget();
    if (sel) {
      return { center: sel.pivot.clone(), radius: sel.radius ?? 0.85 };
    }

    if (this.selected) {
      const selectedEntry = this.entries.get(this.selected);
      if (selectedEntry?.roomId && selectedEntry.root.visible) {
        const subjectBox = new T.Box3();
        for (const e of this.entries.values()) {
          if (!e.root.visible || e.roomId || e.light) continue;
          const b = computeStageWorldBounds(e.root);
          if (!b.isEmpty()) subjectBox.union(b);
        }
        if (!subjectBox.isEmpty()) {
          const sphere = subjectBox.getBoundingSphere(new T.Sphere());
          return { center: subjectBox.getCenter(new T.Vector3()), radius: Math.max(0.5, sphere.radius) };
        }
        const roomFrame = this.computeRoomInteriorFrameTarget(selectedEntry.root);
        if (roomFrame) return roomFrame;
      }
    }

    const subjectsBox = new T.Box3();
    for (const e of this.entries.values()) {
      if (!e.root.visible || e.roomId || e.light) continue;
      const b = computeStageWorldBounds(e.root);
      if (!b.isEmpty()) subjectsBox.union(b);
    }
    if (!subjectsBox.isEmpty()) {
      const sphere = subjectsBox.getBoundingSphere(new T.Sphere());
      return { center: subjectsBox.getCenter(new T.Vector3()), radius: Math.max(0.5, sphere.radius) };
    }

    for (const e of this.entries.values()) {
      if (e.roomId && e.root.visible) {
        const roomFrame = this.computeRoomInteriorFrameTarget(e.root);
        if (roomFrame) return roomFrame;
      }
    }

    return { center: new T.Vector3(0, 1, 0), radius: 1.0 };
  }
  setOrbitView(position: Vec3, target: Vec3): void {
    this.suppressOrbitEmit = true;
    try {
      this.orbit.cancelAnimation();
      this.orbit.target.fromArray(target);
      this.editorCamera.position.fromArray(position);
      this.orbit.update();
      this.recordOrbit();
    } finally {
      this.suppressOrbitEmit = false;
    }
    this.governor.invalidate('camera');
  }
  getOrbitView(): { position: Vec3; target: Vec3 } {
    return { position: this.editorCamera.position.toArray() as Vec3, target: this.orbit.target.toArray() as Vec3 };
  }
  focusSelected(options?: { immediate?: boolean }): void {
    this.governor.invalidate('camera');
    if (this.cameraView) {
      this.flushCameraGesture();
      if (options?.immediate) {
        this.suppressCameraEmit = true;
        try {
          this.cameraOrbit.frameSelection({ immediate: true });
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
      this.cameraOrbit.frameSelection({ durationMs: 180 });
      return;
    }
    this.orbit.frameSelection({ immediate: options?.immediate, durationMs: 180 });
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
        item.rotation = cleanSnappedEulerVec(
          entry.root.rotation.toArray().slice(0, 3) as Vec3,
          this.rotationSnapActive,
        );
        item.scale = entry.root.scale.toArray() as Vec3;
        if (entry.target && !item.targetObjectId) item.target = entry.target.position.toArray() as Vec3;
      }
      syncLinkedLightTargets(next.items, (rId, oId) => this.getRoomObjectBasePosition(rId, oId));
      return next;
    }
    const entry = this.entries.get(this.selected);
    const item = next.items.find(i => i.id === this.selected);
    if (!entry || !item) return clone(this.state);
    if (this.selectedOperandId && item.kind === 'boole' && item.operands) {
      const op = item.operands.find(o => o.id === this.selectedOperandId);
      if (op && this.booleOperandPivot.parent === entry.root) {
        op.position = this.booleOperandPivot.position.toArray() as Vec3;
        op.rotation = cleanSnappedEulerVec(
          this.booleOperandPivot.rotation.toArray().slice(0, 3) as Vec3,
          this.rotationSnapActive,
        );
        op.scale = this.booleOperandPivot.scale.toArray() as Vec3;
      }
    } else if (this.selectedRoomObject && entry.roomId) {
      const roomObj = getRoomObjects(entry.root).find(o => o.id === this.selectedRoomObject!.objectId);
      if (roomObj) {
        item.roomObjects = { ...(item.roomObjects ?? {}) };
        const [bx, by, bz] = roomObj.basePosition;
        const p = roomObj.group.position;
        item.roomObjects[roomObj.id] = {
          ...(item.roomObjects[roomObj.id] ?? {}),
          position: [p.x - bx, p.y - by, p.z - bz],
          rotation: cleanSnappedEulerVec(
            roomObj.group.rotation.toArray().slice(0, 3) as Vec3,
            this.rotationSnapActive,
          ),
          scale: roomObj.group.scale.toArray() as Vec3,
        };
      }
    } else if (this.joint && this.solvedDrag) {
      Object.assign(item, this.solvedDrag);
    } else if (this.joint && entry.figure && item.pose) {
      item.pose[this.joint] = cleanSnappedEulerVec(
        this.fkDragAnchor &&
          this.fkDragAnchor.itemId === this.selected &&
          this.fkDragAnchor.anchor.joint === this.joint &&
          this.fkDragAnchor.latestEuler
          ? clone(this.fkDragAnchor.latestEuler)
          : getJointRotation(entry.figure, this.joint),
        this.rotationSnapActive,
      );
    } else if (this.lightPart === 'target' && entry.target && !item.targetObjectId) {
      item.target = entry.target.position.toArray() as Vec3;
    } else {
      item.position = entry.root.position.toArray() as Vec3;
      item.rotation = cleanSnappedEulerVec(
        entry.root.rotation.toArray().slice(0, 3) as Vec3,
        this.rotationSnapActive,
      );
      item.scale = entry.root.scale.toArray() as Vec3;
    }
    syncLinkedLightTargets(next.items, (rId, oId) => this.getRoomObjectBasePosition(rId, oId));
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
  setPositionPosing(enabled: boolean) {
    if (enabled === this.positionPosing) return;
    this.positionPosing = enabled;
    if (this.selected && this.joint) this.select(this.selected, this.joint, this.selectedIds);
  }
  toggleJointPin(id: string, joint: Joint) {
    const figure = this.getFigure(id);
    if (!figure || !this.state || this.posePreviewId || this.cameraView || this.transform.dragging) return;
    const next = clone(this.state), item = next.items.find(i => i.id === id);
    if (!item?.pose || item.locked || item.visible === false) return;
    const pins = { ...item.posePins };
    if (pins[joint]) delete pins[joint];
    else pins[joint] = capturePin(figure, joint);
    if (Object.keys(pins).length) item.posePins = pins;
    else delete item.posePins;
    this.options.change(next);
  }
  private applyJointEdit(item: Item, figure: Figure, edit: PoseEdit) {
    if (!item.pose) return;
    const base = this.solvedDrag ?? {pose: item.pose, posePins: item.posePins, position: item.position};
    this.solvedDrag = solvePoseEdit(figure, base, edit);
    setFigurePose(figure, this.solvedDrag.pose, item.handPose);
  }
  editJointRotation(id: string, joint: Joint, rotation: Vec3) {
    const figure = this.getFigure(id);
    if (!figure || !this.state || this.posePreviewId || this.cameraView) return;
    const next = clone(this.state), item = next.items.find(i => i.id === id);
    if (!item?.pose || item.locked || item.visible === false) return;
    Object.assign(item, solvePoseEdit(figure, {pose: item.pose, position: item.position, posePins: item.posePins}, {joint, rotation}));
    setFigurePose(figure, item.pose, item.handPose);
    this.options.change(next);
  }
  private clothJob?: { id:string; key:string; cancel:()=>void };
  editGarmentFit(itemId:string, garment:Garment | null) {
    const item = this.state?.items.find(i => i.id === itemId);
    if (!item || this.selected !== itemId || item.locked || item.visible === false) return;
    if (garment && (this.cameraView || this.posePreviewId === itemId || !isGarmentEquipped(item.wardrobe,garment))) return;
    this.clearFitSelection();
    if (garment) this.fitSelection = {itemId,garment,node:null};
    this.select(itemId,null,[itemId]);
    this.options.fitSelect?.(this.fitSelection);
  }
  private clearFitSelection() {
    if (!this.fitSelection) return;
    if (this.fitPlane || this.fitPreview || this.transform.dragging) this.pointerCancel();
    this.fitSelection = null;
    this.garmentHandles.clear();
    this.garmentHandles.visible = false;
    this.options.fitSelect?.(null);
  }
  private refreshFitHandles() {
    const s = this.fitSelection;
    if (!s || this.cameraView) return;
    const figure = this.getFigure(s.itemId);
    if (!figure) return;
    const w = this.fitPreview ?? this.state?.items.find(i => i.id === s.itemId)?.wardrobe;
    this.garmentHandles.sync(getGarmentNodes(figure,s.garment),s,w?.fit?.[s.garment]);
    this.governor.invalidate('gizmo');
  }
  private attachFitGizmo() {
    const mesh = this.garmentHandles.children.find(m => m.userData.node === this.fitSelection?.node);
    if (!mesh) return;
    this.transform.setMode('translate');
    this.transform.setSpace('world');
    this.transform.attach(mesh);
  }
  private fitRay(event: {clientX:number;clientY:number}) {
    const r = this.renderer.domElement.getBoundingClientRect(), ray = new T.Raycaster();
    ray.layers.set(HELPER_LAYER);
    ray.setFromCamera(new T.Vector2(2*(event.clientX-r.left)/r.width-1,1-2*(event.clientY-r.top)/r.height),this.editorCamera);
    return ray;
  }
  private fitHandleAt(event: {clientX:number;clientY:number}) {
    return pickJointMarker(this.garmentHandles.children,this.editorCamera,this.renderer.domElement.getBoundingClientRect(),event.clientX,event.clientY);
  }
  private moveFitNode(world:T.Vector3) {
    const s = this.fitSelection, item = this.state?.items.find(i => i.id === s?.itemId);
    if (!s?.node || !item?.wardrobe || item.locked) return;
    const figure = this.getFigure(item.id);
    if (!figure) return;
    const offset = getGarmentOffset(figure,s.garment,s.node,world.clone());
    this.fitPreview = setFitOffset(item.wardrobe,s.garment,s.node,offset);
    this.applyFitPreview(figure,this.fitPreview);
  }
  private beginFitDrag() {
    this.cancelCloth();
    this.fitDragDocument = this.options.currentDocument?.() ?? this.state ?? undefined;
  }
  private applyFitPreview(figure:Figure, wardrobe:Item['wardrobe'], key?:string) {
    syncWardrobe(figure,wardrobe,()=>{}, e=>this.options.error(e),key);
    this.refreshFitHandles();
    this.liveShadowRevision++;
    this.liveGiRevision++;
    this.governor.invalidate('scene');
  }
  private finishFitDrag(commit:boolean) {
    const s = this.fitSelection, preview = this.fitPreview, start = this.fitDragDocument;
    this.fitDragDocument = undefined;
    this.fitPlane = undefined;
    this.fitPreview = undefined;
    if (!s || !preview || !this.state) return;
    const latest = this.options.currentDocument?.() ?? this.state;
    // React publishes the document before its effect synchronizes this viewport.
    // A release in that interval must never overwrite an undo, pose change or unequip.
    if (commit && latest === start && s.node) {
      const item = latest.items.find(i => i.id === s.itemId), shown = this.state.items.find(i => i.id === s.itemId);
      if (item?.wardrobe && shown && !item.locked && item.visible !== false &&
          isGarmentEquipped(item.wardrobe,s.garment) && clothPoseKey(item) === clothPoseKey(shown)) {
        const next = clone(latest);
        next.items.find(i => i.id === s.itemId)!.wardrobe =
          setFitOffset(item.wardrobe,s.garment,s.node,preview.fit?.[s.garment]?.[s.node]);
        this.options.change(next);
        return;
      }
    }
    {
      const figure = this.getFigure(s.itemId), item = this.state.items.find(i => i.id === s.itemId);
      if (figure && item) this.applyFitPreview(figure,item.wardrobe,clothPoseKey(item));
    }
  }
  cancelCloth() { this.clothJob?.cancel(); }

  async settleCloth(item: Item): Promise<SettledDrape | null> {
    this.cancelCloth();
    const figure=this.getFigure(item.id);
    if(!figure || item.locked) throw new Error('Select an unlocked mannequin to settle cloth.');
    const input=prepareCloth(figure,item);
    const worker=new Worker(new URL('./clothSettle.worker.ts',import.meta.url),{type:'module'});
    return new Promise((resolve,reject)=>{
      const finish=()=>{ clearTimeout(timer); worker.onmessage=null; worker.onerror=null; worker.terminate(); this.clothJob=undefined; };
      const timer=setTimeout(()=>{finish();reject(new Error('Cloth settle timed out.'));},30000);
      this.clothJob={id:item.id,key:input.poseKey,cancel:()=>{finish();resolve(null);}};
      worker.onmessage=(e:MessageEvent<SettledDrape | {error:string}>)=>{
        finish();
        if('error' in e.data) reject(new Error(e.data.error));
        else resolve(e.data);
      };
      worker.onerror=e=>{finish();reject(new Error(e.message || 'Cloth worker failed'));};
      try { worker.postMessage(input,[input.body.positions.buffer as ArrayBuffer]); }
      catch(e) {finish(); reject(e);}
    });
  }
  groundPoseY(id: string, candidatePose?: Pose, settings?: Pick<Item, 'bodyType' | 'anatomicalLimits'>): number | null {
    const entry = this.entries.get(id);
    const stateItem = this.state?.items.find(i => i.id === id);
    if (!entry?.figure || !stateItem?.pose) return null;
    const prevY = entry.root.position.y, previous = entry.figure.deformation;
    try {
      if (settings) entry.figure.deformation = { bodyType: settings.bodyType ?? DEFAULT_BODY_TYPE, limitMode: settings.anatomicalLimits === false ? 'free' : 'anatomical' };
      entry.root.position.y = 0;
      setFigurePose(entry.figure, candidatePose ?? stateItem.pose, stateItem.handPose);
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
      setFigurePose(entry.figure, stateItem.pose, stateItem.handPose);
    }
  }
  anchoredFigureY(
    id: string,
    next: { kind?: Body; modelId?: ModelId; bodyType?: BodyTypeId; anatomicalLimits?: boolean; pose?: Pose },
  ): number | null {
    return computeStudioAnchoredFigureY(this, id, next);
  }
  previewFigurePose(id: string, pose: Pose, rootY?: number): void {
    this.cancelCloth();
    this.posePreviewId = id;
    if (this.fitSelection) this.editGarmentFit(this.fitSelection.itemId,null);
    const entry = this.entries.get(id);
    const stateItem = this.state?.items.find(i => i.id === id);
    if (!entry?.figure) return;
    if (rootY !== undefined) entry.root.position.y = rootY;
    setFigurePose(entry.figure, pose, stateItem?.handPose);
    entry.root.updateMatrixWorld(true);
    entry.figure.skin.skeleton.update();
    this.syncLinkedLightEntriesInScene();
    if (this.selected === id) this.transform.detach();
    this.liveShadowRevision++;
    this.governor.invalidate('scene');
  }
  selectedFocusDistance(): number | null {
    const sel = this.resolveNavigationSelectionTarget();
    if (!sel) {
      const e = this.selected ? this.entries.get(this.selected) : null;
      if (!e) return null;
      this.camera.updateMatrixWorld(true);
      const fallback = computeStageWorldBounds(e.root);
      const center = fallback.isEmpty()
        ? e.root.getWorldPosition(new T.Vector3())
        : fallback.getCenter(new T.Vector3());
      const point = center.applyMatrix4(this.camera.matrixWorldInverse);
      return T.MathUtils.clamp(-point.z, 0.1, 100);
    }
    this.camera.updateMatrixWorld(true);
    const point = sel.pivot.clone().applyMatrix4(this.camera.matrixWorldInverse);
    return T.MathUtils.clamp(-point.z, 0.1, 100);
  }
  private commitTransforms(): void {
    if (!this.state || !this.selected) return;
    const next = this.readLiveState()!, entry = this.entries.get(this.selected), item = next.items.find(i => i.id === this.selected);
    if (!entry || !item) return;
    try { validatePortable(next); this.options.change(next); }
    catch (error) { this.options.error(error); this.sync(this.state); }
  }
  private resize(): void {
    if (!this.state) return;
    this.governor.refreshNativePixelRatio();
    const width = Math.max(1, this.host.clientWidth), height = Math.max(1, this.host.clientHeight);
    const ratio = aspect(this.state.camera.aspect);
    this.width = Math.floor(this.cameraView ? Math.min(width, height * ratio) : width);
    this.height = Math.floor(this.cameraView ? this.width / ratio : height);
    this.renderer.setSize(this.width, this.height);
    this.editorCamera.aspect = this.width / this.height; this.editorCamera.updateProjectionMatrix();
    this.composer?.setSize(this.width, this.height);
    this.governor.invalidate('scene');
  }

  getPerfSnapshot(out?: PerfMetricsSnapshot): PerfMetricsSnapshot {
    return this.perfMonitor.getSnapshot(out);
  }

  setPerfListener(listener: ((snapshot: PerfMetricsSnapshot) => void) | null): void {
    this.perfListener = listener;
    if (listener) {
      listener(this.perfMonitor.getSnapshot());
    }
  }

  getShadowDiagnostics(): {
    updatesTotal: number;
    skippedFrames: number;
    lastFrameUpdates: number;
    pcssTier: RenderQualityMode;
    pcssInstalled: boolean;
    directionalFits: readonly DirectionalShadowFitResult[];
    spotFits: readonly SpotShadowFitResult[];
  } {
    const stats = this.shadowCache.getStats();
    return {
      updatesTotal: stats.renderedShadowPasses,
      skippedFrames: stats.skippedShadowFrames,
      lastFrameUpdates: this.lastFrameShadowUpdates,
      pcssTier: this.lastPcssQuality,
      pcssInstalled: isPcssSoftShadowsInstalled(),
      directionalFits: this.lastDirectionalShadowFits,
      spotFits: this.lastSpotShadowFits,
    };
  }

  getGiDiagnostics(): RealtimeGiDiagnostics & { aoPassEnabled: boolean } {
    return {
      ...this.gi.getDiagnostics(),
      aoPassEnabled: Boolean(this.giPostPass?.enabled),
    };
  }

  private emitPerfSnapshot(force = false): void {
    if (!this.perfListener) return;
    const now = performance.now();
    if (!force && now - this.lastPerfEmitMs < 240) return;
    this.lastPerfEmitMs = now;
    this.perfListener(this.perfMonitor.getSnapshot());
  }

  private governedRender(ctx: FrameGovernorContext): {
    drawCalls: number;
    triangles: number;
    shadowUpdates: number;
  } | void {
    if (!this.alive) return;
    if (this.cameraView) this.cameraOrbit.update();
    else this.orbit.update();

    if (this.orbit.isAnimating || this.cameraOrbit.isAnimating) {
      this.governor.invalidate('camera');
    }

    if (ctx.hoverPointer) {
      const tHover0 = performance.now();
      this.evaluateHoverAt(ctx.hoverPointer.x, ctx.hoverPointer.y);
      this.perfMonitor.recordRaycast(performance.now() - tHover0);
    }

    let stats: { drawCalls: number; triangles: number; shadowUpdates: number } | undefined;
    try {
      stats = this.render();
    } catch (e) {
      this.governor.stop();
      this.options.error(e);
      return;
    }

    queueMicrotask(() => {
      if (this.alive) this.emitPerfSnapshot(false);
    });
    return stats;
  }

  private prepareAsyncLoadedEntries(sceneLightsOnly: boolean): void {
    for (const [, entry] of this.entries) {
      if (entry.light) continue;
      if (entry.roomId && entry.root.visible && entry.root.children.length === 0 && !entry.root.userData.loadError) {
        this.governor.invalidate('loading');
      }
      let meshCount = 0;
      entry.root.traverse(node => {
        if (node instanceof T.Mesh) meshCount++;
      });
      if (entry.populatedMeshCount !== meshCount) {
        entry.populatedMeshCount = meshCount;
        entry.root.traverse(node => {
          if (node instanceof T.Light) {
            node.visible = !sceneLightsOnly;
          }
          if (!(node instanceof T.Mesh)) return;
          for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
            if (material instanceof T.MeshStandardMaterial) this.shading.attachStudioShading(material);
          }
        });
        if (entry.roomId) {
          invalidateRoomCutaway(entry.root);
        }
        this.liveShadowRevision++;
        this.liveGiRevision++;
      }
    }
  }

  private syncPcssTierIfNeeded(quality: RenderQualityMode): void {
    this.lastPcssQuality = quality;
    const updatedShaderChunk = installPcssSoftShadows(quality);
    if (updatedShaderChunk) {
      this.scene.traverse(node => {
        if (!(node instanceof T.Mesh)) return;
        for (const mat of Array.isArray(node.material) ? node.material : [node.material]) {
          if (mat instanceof T.MeshStandardMaterial) mat.needsUpdate = true;
        }
      });
      this.shadowCache.markDirty('pcss-tier');
    }
  }

  private syncShadowsAndGi(
    style: RenderStyleState,
    sceneLightsOnly: boolean,
    forceImmediate = false,
  ): number {
    if (!this.state) return 0;
    const quality: RenderQualityMode = this.state.renderQuality ?? DEFAULT_RENDER_QUALITY;
    const shadowSoftness = this.state.shadowSoftness ?? DEFAULT_SHADOW_SOFTNESS;
    const giEnabled = this.state.giEnabled ?? DEFAULT_GI_ENABLED;
    const giIntensity = this.state.giIntensity ?? DEFAULT_GI_INTENSITY;

    this.scene.updateMatrixWorld();
    this.syncPcssTierIfNeeded(quality);

    // Collect active lights and caster roots
    const activeShadowLights: Array<T.DirectionalLight | T.SpotLight | T.PointLight> = [];
    const activeSceneLights: T.Light[] = [];
    const nonRoomCasterRoots: T.Object3D[] = [];
    const roomFurnitureRoots: T.Object3D[] = [];
    const allBounceRoots: T.Object3D[] = [];

    let shadowSig = `${quality}|${shadowSoftness.toFixed(3)}|${style.mode}|${sceneLightsOnly ? 1 : 0}|${this.liveShadowRevision}`;
    let giSig = `${quality}|${giEnabled ? 1 : 0}|${giIntensity.toFixed(3)}|${sceneLightsOnly ? 1 : 0}|${style.mode}|${this.floor.visible ? 1 : 0}|${this.liveGiRevision}`;

    for (const item of this.state.items) {
      const entry = this.entries.get(item.id);
      if (!entry || !entry.root.visible) continue;
      if (entry.light) {
        if (entry.light.visible && entry.light.intensity > 0) {
          activeSceneLights.push(entry.light);
          const p = entry.root.position;
          const tp = entry.target?.position;
          giSig += `|L:${item.id}:${entry.lightType}:${item.color}:${entry.light.intensity.toFixed(3)}:${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}:${tp ? `${tp.x.toFixed(3)},${tp.y.toFixed(3)},${tp.z.toFixed(3)}` : ''}:${item.angle ?? ''}:${item.distance ?? ''}`;
          if (entry.light.castShadow) {
            activeShadowLights.push(entry.light);
            shadowSig += `|SL:${item.id}:${entry.lightType}:${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)}:${tp ? `${tp.x.toFixed(4)},${tp.y.toFixed(4)},${tp.z.toFixed(4)}` : ''}:${item.angle ?? ''}:${item.distance ?? ''}:${item.penumbra ?? ''}:${item.shadowExtent ?? ''}`;
          }
        }
        continue;
      }

      allBounceRoots.push(entry.root);
      const rp = entry.root.position;
      const rr = entry.root.rotation;
      const rs = entry.root.scale;
      const xformSig = `${rp.x.toFixed(4)},${rp.y.toFixed(4)},${rp.z.toFixed(4)}:${rr.x.toFixed(4)},${rr.y.toFixed(4)},${rr.z.toFixed(4)}:${rs.x.toFixed(4)},${rs.y.toFixed(4)},${rs.z.toFixed(4)}`;

      if (entry.roomId) {
        let roomObjSig = '';
        for (const roomObj of getRoomObjects(entry.root)) {
          if (roomObj.id !== 'arch:shell' && roomObj.group.visible) {
            roomFurnitureRoots.push(roomObj.group);
          }
          if (roomObj.group.visible) {
            const gp = roomObj.group.position;
            roomObjSig += `${roomObj.id}:${gp.x.toFixed(3)},${gp.y.toFixed(3)},${gp.z.toFixed(3)};`;
          }
        }
        shadowSig += `|R:${item.id}:${xformSig}:${roomObjSig}`;
        giSig += `|R:${item.id}:${xformSig}:${roomObjSig}`;
      } else {
        nonRoomCasterRoots.push(entry.root);
        let poseHash = '';
        if (entry.figure && item.pose) {
          let acc = 0;
          for (let jIdx = 0; jIdx < JOINTS.length; jIdx++) {
            const j = JOINTS[jIdx]!;
            const v = item.pose[j];
            if (v) acc += (jIdx + 1) * (v[0] * 1.31 + v[1] * 2.17 + v[2] * 3.07);
          }
          poseHash = `${item.bodyType ?? ''}:${item.hairStyle ?? ''}:${acc.toFixed(5)}`;
        }
        // Use loaded pieces, not requested slots: the mesh can arrive after the scene edit.
        const clothes = item.wardrobe && entry.figure
          ? entry.figure.skin.children.filter(c => c.name.startsWith('Wardrobe:')).map(c => c.name).join(',') : '';
        if (clothes) { shadowSig += clothes; giSig += clothes; }
        shadowSig += `|C:${item.id}:${xformSig}:${entry.modelingSig ?? ''}:${poseHash}`;
        const dressSig = `${item.dressMapId ?? ''}:${item.customDressMapDataUrl ? item.customDressMapDataUrl.length : 0}`;
        giSig += `|C:${item.id}:${item.color}:${item.outfitColor ?? ''}:${dressSig}:${xformSig}:${entry.modelingSig ?? ''}`;
      }
    }

    if (this.floor.visible) {
      allBounceRoots.push(this.floor);
    }

    this.shadowCache.syncStateSignature(shadowSig);
    if (this.shadowCache.isDirty()) {
      this.lastDirectionalShadowFits = [];
      this.lastSpotShadowFits = [];
      const fallbackTarget = new T.Vector3(0, 1, 0);
      const targetWorld = new T.Vector3();
      const presetSoftness = SHADOW_QUALITY_PRESETS[quality].defaultSoftness;

      for (const item of this.state.items) {
        const entry = this.entries.get(item.id);
        if (!entry?.light || !entry.root.visible || !entry.light.visible || !entry.light.castShadow) continue;

        const effectiveRadius =
          style.mode === 'illustration'
            ? 0.85
            : Math.max(0.25, presetSoftness * shadowSoftness);
        applyLightShadowQuality(entry.light, quality, effectiveRadius);

        if (entry.light instanceof T.SpotLight) {
          if (entry.target) {
            entry.target.updateMatrixWorld(true);
            entry.target.getWorldPosition(targetWorld);
          } else {
            targetWorld.copy(fallbackTarget);
          }
          const casterCandidates =
            nonRoomCasterRoots.length > 0
              ? [...nonRoomCasterRoots, ...roomFurnitureRoots]
              : roomFurnitureRoots.length > 0
                ? roomFurnitureRoots
                : allBounceRoots;
          let spotBounds = computeSceneCasterBounds(casterCandidates, {
            focusPoint: targetWorld,
            maxFocusRadius: 2.1,
          });
          if (spotBounds.isEmpty() && nonRoomCasterRoots.length > 0) {
            spotBounds = computeSceneCasterBounds(nonRoomCasterRoots);
          }
          this.lastSpotShadowFits.push(fitSpotShadowFrustum(entry.light, spotBounds));
        } else if (entry.light instanceof T.DirectionalLight) {
          if (entry.target) {
            entry.target.updateMatrixWorld(true);
            entry.target.getWorldPosition(targetWorld);
          } else {
            targetWorld.copy(fallbackTarget);
          }
          const userExtent = item.shadowExtent ?? LIGHT_DEFAULTS.shadowExtent;
          const customWideExtent = userExtent > LIGHT_DEFAULTS.shadowExtent + 1e-3;
          const focusRadius = customWideExtent ? userExtent : 2.15;
          const casterCandidates =
            nonRoomCasterRoots.length > 0
              ? [...nonRoomCasterRoots, ...roomFurnitureRoots]
              : roomFurnitureRoots.length > 0
                ? roomFurnitureRoots
                : allBounceRoots;
          let dirBounds = computeSceneCasterBounds(casterCandidates, {
            focusPoint: targetWorld,
            maxFocusRadius: focusRadius,
          });
          if (dirBounds.isEmpty() && nonRoomCasterRoots.length > 0) {
            dirBounds = computeSceneCasterBounds(nonRoomCasterRoots);
          }
          this.lastDirectionalShadowFits.push(
            fitDirectionalShadowFrustum(entry.light, dirBounds, {
              maxHalfExtent: customWideExtent ? userExtent : Math.min(userExtent, 2.2),
            }),
          );
        }
      }
    }

    // Update Real-Time VPL + Multi-Bounce Hemisphere GI when scene/light state changes
    const giEffectiveEnabled =
      giEnabled && style.mode !== 'flat' && style.mode !== 'outline';
    if (forceImmediate || giSig !== this.lastGiStateSig) {
      this.lastGiStateSig = giSig;
      this.gi.setQuality(quality);
      this.gi.setEnabled(giEffectiveEnabled);
      this.gi.setGiIntensity(giIntensity);
      this.gi.update({
        lights: activeSceneLights,
        bounceTargets: allBounceRoots,
        sceneLightsOnly,
        immediate: forceImmediate || !this.transform.dragging,
      });
    }

    const updatedShadows = this.shadowCache.beginFrame(this.renderer, activeShadowLights);
    this.lastFrameShadowUpdates = updatedShadows ? Math.max(1, activeShadowLights.length) : 0;
    return this.lastFrameShadowUpdates;
  }

  private render(forceImmediateGi = false): {
    drawCalls: number;
    triangles: number;
    shadowUpdates: number;
  } {
    if (!this.state) return { drawCalls: 0, triangles: 0, shadowUpdates: 0 };
    const style = this.state.renderStyle ?? { ...DEFAULT_RENDER_STYLE };
    const sceneLightsOnly = Boolean(this.state.sceneLightsOnly);
    const quality: RenderQualityMode = this.state.renderQuality ?? DEFAULT_RENDER_QUALITY;
    const aoEnabled = this.state.aoEnabled ?? DEFAULT_AO_ENABLED;

    this.prepareAsyncLoadedEntries(sceneLightsOnly);

    if (!this.cameraView) this.entries.forEach(e => e.markers?.forEach(m => {
      if (m.visible) sizeJointMarker(m, this.editorCamera, this.height);
    }));
    this.grid.visible = this.helpers && !this.cameraView && this.floor.visible;
    this.entries.forEach((e, id) => {
      if (!e.light) return;
      const isSelected = this.selectedIds.includes(id);
      const isPrimarySelected = this.selected === id && this.selectedIds.length <= 1;
      const activePart: LightPart = isPrimarySelected ? this.lightPart : 'source';
      const stateItem = this.state?.items.find(i => i.id === id);
      updateLightVisuals(
        e,
        isSelected,
        activePart,
        Boolean(stateItem?.targetObjectId),
        this.hoveredLightHandle,
        this.helpers,
        this.cameraView,
      );
    });

    this.shading.update(style, this.state.background, sceneLightsOnly);
    applyStudioEnvironmentLighting(
      { hemi: this.hemi, fill: this.fill, scene: this.scene },
      sceneLightsOnly,
      style.mode,
    );
    this.renderer.toneMapping = style.mode === 'realistic' || style.mode === 'clay' ? T.ACESFilmicToneMapping : T.NoToneMapping;

    const activeCamera = this.cameraView ? this.camera : this.editorCamera;
    const target = this.cameraView ? this.cameraOrbit.target : this.orbit.target;
    let cutawayChanged = false;
    for (const item of this.state.items) {
      const entry = this.entries.get(item.id);
      if (item.roomId && entry?.root.visible) {
        if (updateRoomCutaway(entry.root, activeCamera.position, target, item.cutaway !== false)) {
          cutawayChanged = true;
        }
      }
    }
    if (cutawayChanged) {
      this.shadowCache.markDirty('cutaway');
      this.liveGiRevision++;
    }

    const shadowUpdates = this.syncShadowsAndGi(style, sceneLightsOnly, forceImmediateGi);

    const layerMask = activeCamera.layers.mask;
    activeCamera.layers.set(STAGE_LAYER);
    const background = this.scene.background;
    if (style.mode === 'outline') this.scene.background = new T.Color(paperColor(style, this.state.background));

    const useAo = shouldApplyStudioAo(style.mode, quality, aoEnabled);
    const useInk = needsInk(style);
    const useDof = this.cameraView && this.state.camera.dof;
    const composed = useAo || useInk || useDof;

    if (composed) {
      if (!this.composer) {
        const dpr = this.renderer.getPixelRatio();
        const effW = Math.max(1, Math.floor(this.width * dpr));
        const effH = Math.max(1, Math.floor(this.height * dpr));
        const composerTarget = new T.WebGLRenderTarget(effW, effH, {
          type: T.HalfFloatType,
          format: T.RGBAFormat,
          minFilter: T.LinearFilter,
          magFilter: T.LinearFilter,
          depthBuffer: true,
          stencilBuffer: false,
        });
        this.composer = new EffectComposer(this.renderer, composerTarget);
        this.renderPass = new RenderPass(this.scene, activeCamera);
        this.composer.addPass(this.renderPass);
        this.giPostPass = new StudioPostGiPipeline(this.scene, activeCamera, {
          width: effW,
          height: effH,
          quality,
        });
        this.composer.addPass(this.giPostPass);
        this.inkPass = new NprInkPass(this.scene, activeCamera);
        this.composer.addPass(this.inkPass);
        this.bokeh = new BokehPass(this.scene, this.camera, {
          focus: this.state.camera.focus,
          aperture: this.state.camera.aperture,
          maxblur: this.state.camera.maxBlur,
        });
        // Preserve the sampled ink alpha; stock BokehPass forces opaque output.
        this.bokeh.materialBokeh.fragmentShader = this.bokeh.materialBokeh.fragmentShader.replace('gl_FragColor.a = 1.0;', '');
        this.composer.addPass(this.bokeh);
        this.composer.addPass(new OutputPass());
        this.composer.setPixelRatio(dpr);
        this.composer.setSize(this.width, this.height);
      }
      this.renderPass!.camera = activeCamera;
      this.giPostPass!.gtaoPass.camera = activeCamera;
      this.giPostPass!.setQuality(quality);
      this.giPostPass!.setRenderMode(style.mode);
      this.giPostPass!.setAoEnabled(aoEnabled);
      this.inkPass!.camera = activeCamera;
      this.inkPass!.enabled = useInk;
      if (useInk) this.inkPass!.update(style, this.state.background);
      this.bokeh!.enabled = useDof;
      this.composer.render();
    } else {
      this.renderer.render(this.scene, activeCamera);
    }

    this.renderer.shadowMap.needsUpdate = false;

    const stageDrawCalls = this.renderer.info.render.calls;
    const stageTriangles = this.renderer.info.render.triangles;

    this.scene.background = null;
    if (!this.cameraView) {
      this.renderer.autoClear = false;
      if (composed) {
        // Restore hardware stage depth in 1 fullscreen triangle draw call instead
        // of re-rendering every room/character/prop mesh with overrideMaterial!
        const stageDepthTexture =
          (useAo ? this.giPostPass?.getDepthTexture() : null) ??
          (useInk ? this.inkPass?.gBuffer.depthTexture : null) ??
          null;
        this.renderer.clearDepth();
        if (stageDepthTexture && this.depthCopyQuad && this.depthCopyMaterial) {
          this.renderer.setRenderTarget(null);
          this.depthCopyMaterial.uniforms.tDepth.value = stageDepthTexture;
          this.depthCopyQuad.render(this.renderer);
        } else {
          this.scene.overrideMaterial = this.helperDepth;
          this.renderer.render(this.scene, activeCamera);
          this.scene.overrideMaterial = null;
        }
      }
      activeCamera.layers.set(HELPER_LAYER);
      if (this.garmentHandles.visible) this.garmentHandles.sizeFor(this.editorCamera,this.renderer.domElement.clientHeight);
      this.renderer.render(this.scene, activeCamera);
      this.renderer.autoClear = true;
    }
    this.scene.background = background;
    activeCamera.layers.mask = layerMask;

    return {
      drawCalls: stageDrawCalls + this.renderer.info.render.calls,
      triangles: stageTriangles,
      shadowUpdates,
    };
  }
  async exportPng(): Promise<Blob> {
    const wasView = this.cameraView;
    const pixelRatio = this.renderer.getPixelRatio();
    this.setView(true);
    this.renderer.setPixelRatio(1); this.composer?.setPixelRatio(1);
    this.width = 1600; this.height = Math.round(1600 / this.camera.aspect);
    this.renderer.setSize(this.width, this.height); this.composer?.setSize(this.width, this.height);
    try {
      this.shadowCache.markDirty('export');
      this.render(true);
      const blob = await new Promise<Blob>((resolve, reject) => this.renderer.domElement.toBlob(b => b ? resolve(b) : reject(new Error('PNG encoding failed.')), 'image/png'));
      return blob;
    } finally {
      this.renderer.setPixelRatio(pixelRatio); this.composer?.setPixelRatio(pixelRatio);
      this.setView(wasView);
      this.shadowCache.markDirty('post-export');
      this.render(true);
    }
  }
  dispose(): void {
    this.cancelCloth();
    this.emitHoverTip(null);
    this.cancelMarquee();
    this.clearStudioDragLock();
    this.flushCameraGesture();
    this.alive = false;
    this.perfListener = null;
    delete (this.host as unknown as { __studio?: Studio }).__studio;
    T.DefaultLoadingManager.onLoad = this.prevDefaultManagerOnLoad ?? (() => {});
    this.governor.dispose();
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.host.removeEventListener('mousedown', this.hostMouseDown);
    this.host.removeEventListener('dragstart', this.blockNativeDrag);
    this.host.removeEventListener('selectstart', this.blockNativeDrag);
    this.renderer.domElement.removeEventListener('pointerdown', this.pointerDown, true);
    this.renderer.domElement.removeEventListener('touchstart', this.cameraTouchStart, true);
    this.renderer.domElement.removeEventListener('pointerup', this.nodePointerUp, true);
    this.renderer.domElement.removeEventListener('pointermove', this.pointerMove, true);
    this.renderer.domElement.removeEventListener('pointerleave', this.pointerLeave);
    this.renderer.domElement.removeEventListener('pointercancel', this.pointerCancel);
    this.renderer.domElement.removeEventListener('lostpointercapture', this.fitCaptureLost);
    this.renderer.domElement.removeEventListener('pointerup', this.pointerUp);
    this.renderer.domElement.removeEventListener('dblclick', this.doubleClick);
    this.renderer.domElement.removeEventListener('webglcontextlost', this.contextLost);
    window.removeEventListener('keydown', this.handleWindowKeySnap, true);
    window.removeEventListener('keyup', this.handleWindowKeySnap, true);
    window.removeEventListener('blur', this.handleWindowBlurSnap);
    document.removeEventListener('visibilitychange', this.handleVisibilityChangeSnap);
    this.lastDragPointerEvent = null;
    this.syncRotationSnap(false, false);
    this.refreshBooleOperandGhost(null, null);
    this.componentOverlay.dispose();
    this.garmentHandles.dispose();
    this.transform.removeEventListener('change', this.handleTransformChange);
    this.orbit.removeEventListener('start', this.handleOrbitStart);
    this.orbit.removeEventListener('change', this.handleOrbitChange);
    this.orbit.removeEventListener('end', this.handleOrbitEnd);
    this.cameraOrbit.removeEventListener('start', this.handleCameraOrbitStart);
    this.cameraOrbit.removeEventListener('change', this.handleCameraOrbitChange);
    this.cameraOrbit.removeEventListener('end', this.handleCameraOrbitEnd);
    this.transform.dispose();
    this.orbit.dispose();
    this.cameraOrbit.dispose();
    this.gi.dispose();
    this.giPostPass?.dispose();
    this.composer?.dispose();
    this.bokeh?.dispose();
    this.inkPass?.dispose();
    this.depthCopyQuad?.dispose();
    this.depthCopyMaterial?.dispose();
    this.helperDepth.dispose();
    disposeObject(this.scene, true);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
export function computeStudioAnchoredFigureY(
  studio: Studio | null | undefined,
  id: string,
  next: { kind?: Body; modelId?: ModelId; bodyType?: BodyTypeId; anatomicalLimits?: boolean; pose?: Pose },
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
    setFigurePose(entry.figure, stateItem.pose, stateItem.handPose);
    const beforeMinY = measureFigureMinWorldY(entry.figure);

    const nextKind = next.kind ?? stateItem.kind;
    const nextBodyType = next.bodyType ?? stateItem.bodyType ?? DEFAULT_BODY_TYPE;
    const nextLimitMode = (next.anatomicalLimits ?? stateItem.anatomicalLimits) === false ? 'free' : 'anatomical';
    const nextModelId = next.modelId ?? (nextKind === stateItem.kind ? stateItem.modelId : undefined) ?? defaultModelId(nextKind);

    let afterMinY: number;
    if (nextKind === entry.kind && nextModelId === entry.figure.modelId) {
      const nextPose = clampPoseToAnatomicalLimits(
        next.pose ?? stateItem.pose,
        nextLimitMode,
        entry.figure.morphology,
      );
      entry.figure.deformation = { bodyType: nextBodyType, limitMode: nextLimitMode };
      setFigurePose(entry.figure, nextPose, stateItem.handPose);
      afterMinY = measureFigureMinWorldY(entry.figure);
    } else {
      tempFigure = makeExternalFigure(
        nextKind,
        stateItem.color,
        stateItem.outfitColor ?? defaultCharacterOutfitColor(stateItem.kind, nextModelId),
        nextModelId,
      );
      tempFigure.root.position.fromArray(stateItem.position);
      tempFigure.root.rotation.fromArray(stateItem.rotation);
      tempFigure.root.scale.fromArray(stateItem.scale);
      tempFigure.deformation = { bodyType: nextBodyType, limitMode: nextLimitMode };
      const nextPose = clampPoseToAnatomicalLimits(
        next.pose ?? stateItem.pose,
        nextLimitMode,
        tempFigure.morphology,
      );
      setFigurePose(tempFigure, nextPose, stateItem.handPose);
      afterMinY = measureFigureMinWorldY(tempFigure);
    }
    return computeAnchoredPositionY(stateItem.position[1], beforeMinY, afterMinY);
  } finally {
    if (tempFigure) disposeObject(tempFigure.root);
    entry.root.position.copy(prevPos);
    entry.root.rotation.copy(prevRot);
    entry.root.scale.copy(prevScale);
    entry.figure.deformation = prevDeformation;
    setFigurePose(entry.figure, stateItem.pose, stateItem.handPose);
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
      if (!state.items.some(i => i.id === id && i.kind === entry.kind && i.roomId === entry.roomId &&
        (!isBody(i.kind) || (i.modelId ?? defaultModelId(i.kind)) === entry.figure?.modelId) &&
        (i.kind !== 'light' || (i.lightType ?? LIGHT_DEFAULTS.lightType) === (entry.lightType ?? LIGHT_DEFAULTS.lightType)))) {
        internals.transform?.detach();
        internals.scene.remove(entry.root);
        removeLightAux(internals.scene, entry);
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
    if (n instanceof T.Mesh || n instanceof T.LineSegments || n instanceof T.Line) {
      geometries.add(n.geometry);
      (Array.isArray(n.material) ? n.material : [n.material]).forEach((m: T.Material) => materials.add(m));
    }
    if (n instanceof T.Light) n.dispose();
    if (n instanceof T.SkinnedMesh) skeletons.add(n.skeleton);
  });
  if (releaseTextures) {
    const textures = new Set<T.Texture>();
    materials.forEach(m => Object.values(m).forEach(value => { if (value instanceof T.Texture) textures.add(value); }));
    textures.forEach(texture => texture.dispose());
  }
  geometries.forEach(g => {
    if (g.userData?.__sharedRoomTemplateGeometry) return;
    disposeGeometryBvh(g);
    g.dispose();
  });
  materials.forEach(m => m.dispose());
  skeletons.forEach(s => s.dispose());
}

function pickLightHandle(
  handles: readonly T.Mesh<T.SphereGeometry, T.MeshBasicMaterial>[],
  camera: T.PerspectiveCamera,
  viewport: { left: number; top: number; width: number; height: number },
  x: number,
  y: number,
  minHitRadiusPx: number,
): T.Mesh<T.SphereGeometry, T.MeshBasicMaterial> | null {
  camera.updateMatrixWorld(true);
  const halfFovTan = Math.tan(T.MathUtils.degToRad(camera.fov / 2));
  let closest: T.Mesh<T.SphereGeometry, T.MeshBasicMaterial> | null = null;
  let bestDistSq = Infinity;
  let bestDepth = Infinity;
  for (const handle of handles) {
    let visible = true;
    for (let node: T.Object3D | null = handle; node; node = node.parent) {
      if (!node.visible) { visible = false; break; }
    }
    if (!visible) continue;
    const worldPos = handle.getWorldPosition(new T.Vector3());
    const projected = worldPos.clone().project(camera);
    if (projected.z < -1 || projected.z > 1 || Math.abs(projected.x) > 1.05 || Math.abs(projected.y) > 1.05) continue;
    const viewDepth = -worldPos.applyMatrix4(camera.matrixWorldInverse).z;
    const worldScale = handle.getWorldScale(new T.Vector3()).x;
    const worldRadius = handle.geometry.parameters.radius * Math.max(0.5, worldScale);
    const projectedRadiusPx =
      viewDepth > 0.05
        ? (worldRadius * camera.zoom * viewport.height) / (2 * viewDepth * halfFovTan)
        : minHitRadiusPx;
    const hitRadius = Math.max(minHitRadiusPx, Math.min(36, projectedRadiusPx + 4));
    const dx = viewport.left + ((projected.x + 1) * viewport.width) / 2 - x;
    const dy = viewport.top + ((1 - projected.y) * viewport.height) / 2 - y;
    const dSq = dx * dx + dy * dy;
    if (dSq <= hitRadius * hitRadius && (dSq < bestDistSq || (dSq === bestDistSq && projected.z < bestDepth))) {
      closest = handle;
      bestDistSq = dSq;
      bestDepth = projected.z;
    }
  }
  return closest;
}

function buildHandleHaloGeometry(radius: number, withCrosshair: boolean): T.BufferGeometry {
  const pts: number[] = [];
  const segs = 28;
  const pushSeg = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
    pts.push(ax, ay, az, bx, by, bz);
  };
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 1) / segs) * Math.PI * 2;
    pushSeg(Math.cos(a0) * radius, 0, Math.sin(a0) * radius, Math.cos(a1) * radius, 0, Math.sin(a1) * radius);
    pushSeg(Math.cos(a0) * radius, Math.sin(a0) * radius, 0, Math.cos(a1) * radius, Math.sin(a1) * radius, 0);
  }
  if (withCrosshair) {
    const inner = radius * 0.92;
    const outer = radius * 1.42;
    pushSeg(inner, 0, 0, outer, 0, 0);
    pushSeg(-inner, 0, 0, -outer, 0, 0);
    pushSeg(0, inner, 0, 0, outer, 0);
    pushSeg(0, -inner, 0, 0, -outer, 0);
    pushSeg(0, 0, inner, 0, 0, outer);
    pushSeg(0, 0, -inner, 0, 0, -outer);
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.Float32BufferAttribute(pts, 3));
  return geo;
}

function createLightEntry(scene: T.Scene, item: Item): Entry {
  const lightType: LightType = item.lightType ?? LIGHT_DEFAULTS.lightType;
  const root = new T.Group();
  const bulb = new T.Mesh(new T.SphereGeometry(0.072, 16, 12), new T.MeshBasicMaterial({ color: item.color }));
  ensureGeometryBvh(bulb.geometry);
  bulb.layers.set(HELPER_LAYER);
  bulb.userData.lightSourceId = item.id;
  root.add(bulb);

  const sourceRing = new T.LineSegments(
    buildHandleHaloGeometry(0.115, false),
    new T.LineBasicMaterial({ color: '#ff826b', transparent: true, opacity: 0.9, depthTest: false, depthWrite: false }),
  );
  sourceRing.renderOrder = 19;
  sourceRing.layers.set(HELPER_LAYER);
  sourceRing.userData.ignorePick = true;
  root.add(sourceRing);

  let light: StudioLight;
  let target: T.Object3D | undefined;
  let targetHandle: T.Mesh<T.SphereGeometry, T.MeshBasicMaterial> | undefined;
  let targetRing: T.LineSegments<T.BufferGeometry, T.LineBasicMaterial> | undefined;
  let aimLine: T.Line<T.BufferGeometry, T.LineBasicMaterial> | undefined;

  if (lightType === 'directional') {
    const dir = new T.DirectionalLight(item.color, item.intensity ?? LIGHT_DEFAULTS.directionalIntensity);
    dir.castShadow = item.castShadow ?? LIGHT_DEFAULTS.castShadow;
    dir.shadow.mapSize.set(1024, 1024);
    dir.shadow.bias = -0.0004;
    dir.shadow.normalBias = 0.02;
    const ext = item.shadowExtent ?? LIGHT_DEFAULTS.shadowExtent;
    dir.shadow.camera.left = -ext;
    dir.shadow.camera.right = ext;
    dir.shadow.camera.top = ext;
    dir.shadow.camera.bottom = -ext;
    dir.shadow.camera.near = 0.2;
    dir.shadow.camera.far = 80;
    light = dir;
  } else if (lightType === 'point') {
    const pt = new T.PointLight(
      item.color,
      item.intensity ?? LIGHT_DEFAULTS.intensity,
      item.distance ?? LIGHT_DEFAULTS.distance,
      item.decay ?? LIGHT_DEFAULTS.decay,
    );
    pt.castShadow = item.castShadow ?? LIGHT_DEFAULTS.castShadow;
    pt.shadow.mapSize.set(512, 512);
    pt.shadow.bias = -0.0005;
    light = pt;
  } else {
    const spot = new T.SpotLight(
      item.color,
      item.intensity ?? LIGHT_DEFAULTS.intensity,
      item.distance ?? LIGHT_DEFAULTS.distance,
      radians(item.angle ?? LIGHT_DEFAULTS.angle),
      item.penumbra ?? LIGHT_DEFAULTS.penumbra,
      item.decay ?? LIGHT_DEFAULTS.decay,
    );
    spot.castShadow = item.castShadow ?? LIGHT_DEFAULTS.castShadow;
    spot.shadow.mapSize.set(1024, 1024);
    spot.shadow.bias = -0.0003;
    light = spot;
  }
  root.add(light);

  if (light instanceof T.SpotLight || light instanceof T.DirectionalLight) {
    target = new T.Object3D();
    target.position.fromArray(item.target ?? [0, 1, 0]);
    scene.add(target);
    light.target = target;

    targetHandle = new T.Mesh(
      new T.SphereGeometry(0.06, 16, 12),
      new T.MeshBasicMaterial({ color: '#ffd07d', transparent: true, opacity: 0.9, depthTest: false, depthWrite: false }),
    );
    ensureGeometryBvh(targetHandle.geometry);
    targetHandle.renderOrder = 19;
    targetHandle.layers.set(HELPER_LAYER);
    targetHandle.userData.lightTargetId = item.id;
    target.add(targetHandle);

    targetRing = new T.LineSegments(
      buildHandleHaloGeometry(0.105, true),
      new T.LineBasicMaterial({ color: '#ffd07d', transparent: true, opacity: 0.75, depthTest: false, depthWrite: false }),
    );
    targetRing.renderOrder = 19;
    targetRing.layers.set(HELPER_LAYER);
    targetRing.userData.ignorePick = true;
    target.add(targetRing);

    const aimGeo = new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3(0, -1, 0)]);
    aimLine = new T.Line(
      aimGeo,
      new T.LineBasicMaterial({ color: item.color, transparent: true, opacity: 0.42 }),
    );
    aimLine.layers.set(HELPER_LAYER);
    aimLine.userData.ignorePick = true;
    aimLine.frustumCulled = false;
    scene.add(aimLine);
  }

  const lightGizmo = buildLightGizmo(lightType, item.color, item.angle ?? LIGHT_DEFAULTS.angle);
  root.add(lightGizmo);

  const entry: Entry = {
    kind: item.kind,
    root,
    light,
    lightType,
    sourceHandle: bulb,
    sourceRing,
    lightGizmo,
    aimLine,
    target,
    targetHandle,
    targetRing,
  };
  updateLightEntry(entry, item);
  return entry;
}

function removeLightAux(scene: T.Scene, entry: Entry): void {
  if (entry.target) {
    scene.remove(entry.target);
    disposeObject(entry.target);
  }
  if (entry.aimLine) {
    scene.remove(entry.aimLine);
    disposeObject(entry.aimLine);
  }
}

function buildLightGizmo(lightType: LightType, color: string, angleDeg: number): T.LineSegments<T.BufferGeometry, T.LineBasicMaterial> {
  const geo = buildLightGizmoGeometry(lightType, angleDeg);
  const mat = new T.LineBasicMaterial({ color, transparent: true, opacity: 0.72 });
  const gizmo = new T.LineSegments(geo, mat);
  gizmo.layers.set(HELPER_LAYER);
  gizmo.userData.ignorePick = true;
  gizmo.userData.angleDeg = angleDeg;
  return gizmo;
}

function buildLightGizmoGeometry(lightType: LightType, angleDeg: number): T.BufferGeometry {
  const pts: number[] = [];
  const pushSeg = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
    pts.push(ax, ay, az, bx, by, bz);
  };
  const segs = 24;
  if (lightType === 'point') {
    const r = 0.2;
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      pushSeg(Math.cos(a0) * r, Math.sin(a0) * r, 0, Math.cos(a1) * r, Math.sin(a1) * r, 0);
      pushSeg(Math.cos(a0) * r, 0, Math.sin(a0) * r, Math.cos(a1) * r, 0, Math.sin(a1) * r);
      pushSeg(0, Math.cos(a0) * r, Math.sin(a0) * r, 0, Math.cos(a1) * r, Math.sin(a1) * r);
    }
  } else if (lightType === 'directional') {
    const r = 0.16;
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      pushSeg(Math.cos(a0) * r, Math.sin(a0) * r, 0, Math.cos(a1) * r, Math.sin(a1) * r, 0);
    }
    const rayLen = 0.85;
    for (const [ox, oy] of [[r, 0], [-r, 0], [0, r], [0, -r]] as const) {
      pushSeg(ox, oy, 0, ox, oy, rayLen);
    }
  } else {
    const len = 1.1;
    const radius = Math.tan(Math.min(Math.PI * 0.47, radians(angleDeg))) * len;
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      pushSeg(Math.cos(a0) * radius, Math.sin(a0) * radius, len, Math.cos(a1) * radius, Math.sin(a1) * radius, len);
    }
    for (const [ox, oy] of [[radius, 0], [-radius, 0], [0, radius], [0, -radius]] as const) {
      pushSeg(0, 0, 0, ox, oy, len);
    }
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.Float32BufferAttribute(pts, 3));
  return geo;
}

function updateLightEntry(entry: Entry, item: Item): void {
  if (!entry.light) return;
  const lightType = entry.lightType ?? LIGHT_DEFAULTS.lightType;
  entry.light.visible = item.visible !== false;
  entry.light.color.set(item.color);
  entry.light.intensity = item.intensity ?? (lightType === 'directional' ? LIGHT_DEFAULTS.directionalIntensity : LIGHT_DEFAULTS.intensity);
  entry.light.castShadow = item.castShadow ?? LIGHT_DEFAULTS.castShadow;

  if (entry.light instanceof T.SpotLight) {
    const angleDeg = item.angle ?? LIGHT_DEFAULTS.angle;
    entry.light.angle = radians(angleDeg);
    entry.light.penumbra = item.penumbra ?? LIGHT_DEFAULTS.penumbra;
    entry.light.distance = item.distance ?? LIGHT_DEFAULTS.distance;
    entry.light.decay = item.decay ?? LIGHT_DEFAULTS.decay;
    if (entry.lightGizmo && entry.lightGizmo.userData.angleDeg !== angleDeg) {
      entry.lightGizmo.geometry.dispose();
      entry.lightGizmo.geometry = buildLightGizmoGeometry('spot', angleDeg);
      entry.lightGizmo.userData.angleDeg = angleDeg;
    }
  } else if (entry.light instanceof T.PointLight) {
    entry.light.distance = item.distance ?? LIGHT_DEFAULTS.distance;
    entry.light.decay = item.decay ?? LIGHT_DEFAULTS.decay;
  }

  if (entry.target) {
    entry.target.position.fromArray(item.target ?? [0, 1, 0]);
  }
  const bulb = entry.sourceHandle ?? (entry.root.children[0] as T.Mesh<T.SphereGeometry, T.MeshBasicMaterial>);
  bulb.material.color.set(item.color);
  if (entry.lightGizmo) entry.lightGizmo.material.color.set(item.color);
  if (entry.aimLine) entry.aimLine.material.color.set(item.color);
}

function updateLightVisuals(
  entry: Entry,
  isSelected: boolean,
  activePart: LightPart,
  isLinkedTarget: boolean,
  hoveredHandle: T.Mesh<T.SphereGeometry, T.MeshBasicMaterial> | null,
  helpers: boolean,
  cameraView: boolean,
): void {
  const bulb = entry.sourceHandle ?? (entry.root.children[0] as T.Mesh<T.SphereGeometry, T.MeshBasicMaterial>);
  bulb.visible = !cameraView && entry.root.visible;
  const showHelpers = helpers && !cameraView && entry.root.visible;
  const sourceHovered = hoveredHandle === bulb;
  const targetHovered = Boolean(entry.targetHandle && hoveredHandle === entry.targetHandle);
  const sourceActive = isSelected && activePart === 'source';
  const targetActive = isSelected && activePart === 'target';

  bulb.scale.setScalar(sourceActive ? 1.15 : sourceHovered ? 1.1 : 1.0);
  if (entry.sourceRing) {
    entry.sourceRing.visible = !cameraView && entry.root.visible && (sourceActive || sourceHovered || (isSelected && showHelpers));
    entry.sourceRing.material.color.set(sourceActive ? '#ff826b' : sourceHovered ? '#ffffff' : '#ffd07d');
    entry.sourceRing.material.opacity = sourceActive ? 0.96 : sourceHovered ? 0.88 : 0.45;
    entry.sourceRing.scale.setScalar(sourceActive ? 1.12 : 1.0);
  }

  if (entry.lightGizmo) {
    entry.lightGizmo.visible = showHelpers;
    entry.lightGizmo.material.opacity = isSelected ? 0.95 : 0.45;
    if (entry.target && (entry.lightType === 'spot' || entry.lightType === 'directional')) {
      entry.root.updateMatrixWorld(true);
      entry.lightGizmo.lookAt(entry.target.position);
    }
  }
  if (entry.targetHandle) {
    entry.targetHandle.visible = showHelpers;
    entry.targetHandle.material.color.set(
      targetActive
        ? '#ff826b'
        : targetHovered
          ? '#ffffff'
          : isLinkedTarget
            ? '#6cb6ff'
            : '#ffd07d',
    );
    entry.targetHandle.material.opacity = targetActive || targetHovered ? 1.0 : isSelected ? 0.88 : 0.72;
    entry.targetHandle.scale.setScalar(targetActive ? 1.2 : targetHovered ? 1.12 : 1.0);
  }
  if (entry.targetRing) {
    entry.targetRing.visible = showHelpers && (isSelected || targetHovered || isLinkedTarget);
    entry.targetRing.material.color.set(
      targetActive
        ? (isLinkedTarget ? '#6cb6ff' : '#ff826b')
        : targetHovered
          ? '#ffffff'
          : isLinkedTarget
            ? '#6cb6ff'
            : '#ffd07d',
    );
    entry.targetRing.material.opacity = targetActive ? 0.96 : targetHovered ? 0.88 : isLinkedTarget ? 0.68 : 0.45;
    entry.targetRing.scale.setScalar(targetActive ? 1.14 : 1.0);
  }
  if (entry.aimLine && entry.target) {
    entry.aimLine.visible = showHelpers;
    entry.aimLine.material.opacity = isSelected ? 0.7 : 0.25;
    const posAttr = entry.aimLine.geometry.getAttribute('position') as T.BufferAttribute;
    posAttr.setXYZ(0, entry.root.position.x, entry.root.position.y, entry.root.position.z);
    posAttr.setXYZ(1, entry.target.position.x, entry.target.position.y, entry.target.position.z);
    posAttr.needsUpdate = true;
  }
}
