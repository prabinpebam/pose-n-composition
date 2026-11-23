import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  ANIMATION_ACCEPT_EXTENSIONS,
  BUILTIN_ANIMATION_CYCLES,
  extractPoseAtFrame,
  loadBuiltinAnimationCycle,
  loadUserAnimationFile,
  MAX_ANIMATION_FILE_BYTES,
  type AnimationCycleCategory,
  type AnimationCycleClip,
} from './animationPoseExtractor';
import {
  AUTHORED_DRESS_COLOR_SWATCHES,
  AUTHORED_HAIR_COLOR_SWATCHES,
  AUTHORED_SKIN_TONE_SWATCHES,
  BooleObjectPanel,
  CharacterMaterialPanel,
  EditableMeshObjectPanel,
  HandArticulationPanel,
  ImportedAssetObjectPanel,
  MannequinDressMapControls,
  MaterialTagPanel,
  ModifierStackPanel,
  PrimitiveObjectPanel,
  STUDIO_DRESS_COLOR_SWATCHES,
  STUDIO_HAIR_COLOR_SWATCHES,
  STUDIO_SKIN_TONE_SWATCHES,
} from './components/c4dAttributePanels';
import {
  C4DFlyoutButton,
  C4DIconButton,
  C4DIcons,
  C4DOperatorCaddy,
  getBooleanIcon,
  getModifierIcon,
  getPrimitiveIcon,
  type C4DCaddyField,
  type C4DFlyoutItem,
} from './components/c4dPalette';
import {
  TooltipButton,
  ViewportHoverTooltipHost,
  useStudioTooltip,
  type ViewportHoverTip,
} from './components/studioTooltip';
import {
  ColorField,
  Icons,
  LayerTreeRow,
  ListRow,
  NumericField,
  SegmentedControl,
  SelectDropdown,
  SliderField,
  SwitchRow,
  Vector3Field,
  type SelectOption,
} from './components/ui';
import { computeStudioAnchoredFigureY, getCachedHalfEdgeMesh, Studio, syncStudioScene } from './engine';
import {
  IMPORT_FILE_ACCEPT,
  detect3DFormat,
  import3dFiles,
  serializeImportedAsset,
  serializedAssetToPortableJson,
} from './importers/import3d';
import { hasOpenSelectDropdown, resolveStudioShortcut } from './inputRouting';
import {
  getCharacterMorphology,
  hasPoseableFingers,
  inspectorDegreesToPoseJoint,
  loadExternalFigures,
  poseJointToInspectorDegrees,
} from './external-rig';
import { adaptCanonicalPoseToMorphology, translatePoseAcrossMorphologies } from './morphology-rig';
import {
  BOOLEAN_OP_TYPES,
  MODIFIER_TYPES,
  PRIMITIVE_KINDS,
  bevelEdges,
  bevelFaces,
  bridgeEdges,
  bridgeFaces,
  chamferVertices,
  cloneEditableMesh,
  closePolygonHoles,
  collapseEdges,
  connectVertices,
  convertSelection,
  createEmptySelection,
  createPrimitiveEditableMesh,
  deleteFaces,
  dissolveEdges,
  dissolveFaces,
  extrudeFaces,
  flipFaceNormals,
  growSelection,
  insetFaces,
  loopCut,
  selectEdgeLoop,
  selectEdgeRing,
  shrinkSelection,
  splitDisconnectFaces,
  subdivideFaces,
  weldVertices,
  type BooleanOpType,
  type ComponentSelection,
  type EditableMeshData,
  type ModelingMode,
  type ModifierSpec,
  type ModifierType,
  type PrimitiveKind,
} from './modeling';
import { loadRooms } from './rooms';
import { ROOMS, ROOM_IDS, type RoomId } from './roomCatalog';
import { CHARACTERS, MODEL_IDS, defaultModelId, isModelId, type ModelId } from './characterCatalog';
import { BODY_TYPES, DEFAULT_BODY_TYPE, isBodyTypeId, type BodyTypeId } from './bodyProportions';
import { clampPoseToAnatomicalLimits } from './skinDeformer';
import { HAIR_STYLE_LABELS, HAIR_STYLES } from './hair';
import {
  BOOLEAN_OP_LABELS,
  MODIFIER_LABELS,
  PRIMITIVE_LABELS,
  addOperandToBoole,
  applyCharacterModelColorTransition,
  applyChibiDefaultRenderStyle,
  applyLightPartPosition,
  applyPose,
  canAttachModifiers,
  canBeBooleOperand,
  canMakeEditable,
  clone,
  copyPoseNodes,
  createDefaultModifierSpec,
  createPrimitiveItem,
  extractBooleOperands,
  findItemOrOperand,
  formatRoomObjectTargetRef,
  groupItemsIntoBoole,
  isModelingKind,
  isTargetedLight,
  LIGHT_DEFAULTS,
  LIGHT_TYPES,
  LIGHT_TYPE_LABELS,
  linkLightTarget,
  MAX_RICH_SCENE_FILE_BYTES,
  parseTargetObjectRef,
  resolveLightActiveVector,
  resolveLightPartForItem,
  swapBooleOperands,
  switchLightType,
  syncLinkedLightTargets,
  updateItemOrOperand,
  type LightPart,
  type LightType,
  createItem,
  DEFAULT_AO_ENABLED,
  DEFAULT_GI_ENABLED,
  DEFAULT_GI_INTENSITY,
  DEFAULT_RENDER_QUALITY,
  DEFAULT_RENDER_STYLE,
  DEFAULT_SHADOW_SOFTNESS,
  DEFAULT_HAIR_COLOR,
  defaultCharacterHairColor,
  defaultCharacterHairStyle,
  defaultCharacterOutfitColor,
  defaultCharacterSkinColor,
  defaultOutfitColor,
  defaultSkinColor,
  degrees,
  hasAuthoredHair,
  hasCharacterOutfitSlot,
  initialScene,
  sanitizeWorkingDraftCharacterColors,
  isBody,
  flipItems,
  JOINTS,
  clothPoseKey, heldTrenchGesture, type Garment, type TrenchGrip,
  MAX_FILE_BYTES,
  mirrorCharacterPose,
  neutralPose,
  normalizeCharacterHandPoses,
  parseFile,
  parsePoseFile,
  poseFile,
  RENDER_QUALITY_LABELS,
  RENDER_QUALITY_MODES,
  type RoomObjectOverride,
  pastePoseNodes,
  PRESETS,
  preset,
  PROP_KINDS,
  radians,
  RENDER_MODES,
  selectionCentroid,
  swapItemBodyKind,
  validatePortable,
  type HairStyleId,
  type Item,
  type Joint,
  type Portable,
  type Pose,
  type PoseClipboard,
  type RenderQualityMode,
  type RenderStyleState,
  type SceneState,
  type Vec3,
} from './model';
import {
  DEFAULT_ORBIT_VIEW,
  deleteLocal,
  download,
  downloadBlob,
  embedSceneImportedAssetsForExport,
  flushScheduledWorkingSceneSave,
  hydrateSceneImportedAssets,
  listSaved,
  loadWorkingDraft,
  registerRuntimeImportedAsset,
  saveImportedAssetToStorage,
  sanitizeWorkingView,
  saveLocal,
  scheduleSaveWorkingScene,
  WorkingDraftAutoSaver,
  type AutosaveStatus,
  type OrbitViewState,
  type Saved,
  type WorkingDraft,
  type WorkingViewState,
} from './storage';

const MAX_UNDO_HISTORY = 50;
const UNDO_COALESCE_WINDOW_MS = 250;
const CONTINUOUS_ITEM_KEYS = new Set([
  'position',
  'rotation',
  'scale',
  'pose',
  'handPose',
  'color',
  'outfitColor',
  'hairColor',
  'intensity',
  'angle',
  'penumbra',
  'distance',
  'decay',
  'shadowExtent',
  'target',
  'primitive',
]);

const ANIM_CATEGORIES: readonly AnimationCycleCategory[] = [
  'Locomotion',
  'Idle & Gesture',
  'Stealth & Ground',
  'Action & Athletic',
];
const BODY_BADGES: Record<string, string> = {
  realistic: 'Natural',
  heroic: 'Athletic',
  lean: 'Toned',
  slender: 'Slim',
  busty: 'Full chest',
  chubby: 'Soft',
  fat: 'Heavy',
  obese: 'Very heavy',
  chibi: '2.5-head anime',
};
const BODY_OPTIONS: SelectOption[] = BODY_TYPES.map(type => ({
  value: type.id,
  label: type.label,
  meta: BODY_BADGES[type.id] ?? type.label,
}));

const SHADING_ITEMS = RENDER_MODES.map((value, index) => ({
  value, label: value[0].toUpperCase() + value.slice(1),
  icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.3" fill={index === 3 ? 'currentColor' : 'none'} />{index !== 2 && <path d={index === 1 ? 'M4 10 10 4M6 12 12 6' : 'M8 2.5a5.5 5.5 0 0 1 0 11Z'} stroke="currentColor" fill={index === 1 ? 'none' : 'currentColor'} />}</svg>,
}));
const POSE_BRANCHES: Record<string, readonly Joint[]> = {
  All: JOINTS, None: [],
  'Upper body': JOINTS.slice(0, 11), 'Lower body': JOINTS.slice(11),
  'Left arm': JOINTS.slice(5, 8), 'Right arm': JOINTS.slice(8, 11), 'Spine & head': JOINTS.slice(0, 5),
};
const JOINT_DEPTH: Record<Joint, number> = {
  hips: 0, spine: 1, chest: 2, neck: 3, head: 4,
  leftShoulder: 3, leftElbow: 4, leftWrist: 5, rightShoulder: 3, rightElbow: 4, rightWrist: 5,
  leftHip: 1, leftKnee: 2, leftAnkle: 3, rightHip: 1, rightKnee: 2, rightAnkle: 3,
};

const JOINT_GROUPS: Record<Joint, string> = {
  hips: 'Torso & Head',
  spine: 'Torso & Head',
  chest: 'Torso & Head',
  neck: 'Torso & Head',
  head: 'Torso & Head',
  leftShoulder: 'Left Arm',
  leftElbow: 'Left Arm',
  leftWrist: 'Left Arm',
  rightShoulder: 'Right Arm',
  rightElbow: 'Right Arm',
  rightWrist: 'Right Arm',
  leftHip: 'Left Leg',
  leftKnee: 'Left Leg',
  leftAnkle: 'Left Leg',
  rightHip: 'Right Leg',
  rightKnee: 'Right Leg',
  rightAnkle: 'Right Leg',
};

const PROP_META: Record<(typeof PROP_KINDS)[number], string> = {
  chair: 'Studio seat',
  table: 'Work surface',
  desk: 'Drafting desk',
  couch: '2-seat sofa',
  bed: 'Low platform',
  lamp: 'Floor stand',
  room: 'Corner walls',
};

type Tab = 'object' | 'coord' | 'material' | 'modifiers' | 'pose' | 'camera' | 'library';
type CaddyOp = 'extrude' | 'inset' | 'bevel' | 'loopCut' | 'weld';
type Notice = { text: string; error: boolean };

interface CaddyParamsState {
  offset: number;
  groupNormals: boolean;
  inset: number;
  individual: boolean;
  width: number;
  segments: number;
  slide: number;
  cuts: number;
  weldMode: 'center' | 'threshold';
  threshold: number;
}

const DEFAULT_CADDY_PARAMS: CaddyParamsState = {
  offset: 0.2,
  groupNormals: true,
  inset: 0.12,
  individual: false,
  width: 0.08,
  segments: 2,
  slide: 0.5,
  cuts: 1,
  weldMode: 'threshold',
  threshold: 0.05,
};

function posesMatch(a: Pose | undefined, b: Pose): boolean {
  if (!a) return false;
  for (const j of JOINTS) {
    for (let k = 0; k < 3; k++) {
      if (Math.abs(a[j][k] - b[j][k]) > 1e-3) return false;
    }
  }
  return true;
}

function AutosaveStatusBadge({ status }: { status: AutosaveStatus }) {
  const { triggerRef, triggerProps, tooltipNode } = useStudioTooltip<HTMLSpanElement>({
    title: status === 'error' ? 'Autosave error' : 'Saved locally',
    description: 'Scene state autosaved locally to IndexedDB',
    placement: 'bottom',
    dismissOnPress: false,
  });

  return (
    <>
      <span
        ref={triggerRef}
        {...triggerProps}
        className={`autosave-badge ${status}`}
        role="status"
        aria-live="polite"
      >
        <span className="autosave-dot" aria-hidden="true" />
        <span>
          {status === 'saving' ? 'Saving' : status === 'error' ? 'Error' : 'Saved'}
        </span>
      </span>
      {tooltipNode}
    </>
  );
}

export function App() {
  const [doc, setDoc] = useState(initialScene);
  const current = useRef(doc);
  const past = useRef<SceneState[]>([]),
    future = useRef<SceneState[]>([]);
  const [historyTick, historyUpdate] = useState(0);
  const [selected, setSelected] = useState<string | null>(doc.items[0].id);
  const [selectedIds, setSelectedIds] = useState<string[]>([doc.items[0].id]);
  const [selectedOperandId, setSelectedOperandId] = useState<string | null>(null);
  const [focusedModifierId, setFocusedModifierId] = useState<string | null>(null);
  const [selectedRoomObject, setSelectedRoomObject] = useState<{ roomId: string; objectId: string } | null>(null);
  const [expandedLayers, setExpandedLayers] = useState<Record<string, boolean>>({
    room: true,
    characters: true,
    props: true,
    lights: true,
  });
  const [modelingMode, setModelingMode] = useState<ModelingMode>('object');
  const [componentSelection, setComponentSelection] = useState<ComponentSelection>(() =>
    createEmptySelection('polygon'),
  );
  const [xRayWireframe, setXRayWireframe] = useState(false);
  const [coordSpace, setCoordSpace] = useState<'world' | 'local'>('world');
  const [lastPrimKind, setLastPrimKind] = useState<PrimitiveKind>('cube');
  const [lastBooleOp, setLastBooleOp] = useState<BooleanOpType>('subtract');
  const [lastModType, setLastModType] = useState<ModifierType>('bevel');
  const [activeCaddyOp, setActiveCaddyOp] = useState<CaddyOp | null>(null);
  const [caddyParams, setCaddyParams] = useState<CaddyParamsState>(DEFAULT_CADDY_PARAMS);
  const [dragOver3d, setDragOver3d] = useState(false);
  const caddySessionRef = useRef<{
    op: CaddyOp;
    targetId: string;
    baseMesh: EditableMeshData;
    baseSelection: ComponentSelection;
    preOpScene: SceneState;
    loopCutEdge: number | null;
    dirty: boolean;
  } | null>(null);
  const [roomTreeTick, setRoomTreeTick] = useState(0);
  const roomSyncSigRef = useRef('');
  const selection = selected && !selectedIds.includes(selected) ? [selected] : selectedIds.filter(id => doc.items.some(i => i.id === id));
  const selectionRef = useRef(selection); selectionRef.current = selection;
  const [poseClipboard, setPoseClipboard] = useState<PoseClipboard | null>(null);
  const [copyNodes, setCopyNodes] = useState<Joint[]>([...JOINTS]);
  const [joint, setJoint] = useState<Joint | null>(null);
  const [lightPart, setLightPart] = useState<LightPart>('source');
  const [tab, setTab] = useState<Tab>('object');
  const [view, setView] = useState(false),
    [help, setHelp] = useState(false);
  const [showJoints, setShowJoints] = useState(true),
    [showHelpers, setShowHelpers] = useState(true);
  const [mode, setMode] = useState<'translate' | 'rotate' | 'scale'>('translate');
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light',
  );
  const [notice, setNotice] = useState<Notice | null>(null);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [saveName, setSaveName] = useState('My study');
  const [busy, setBusy] = useState(false);
  const [roomBusy, setRoomBusy] = useState(false);
  const [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState<string | null>(null),
    [retry, setRetry] = useState(0);
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>('idle');
  const [animClips, setAnimClips] = useState<Record<string, AnimationCycleClip>>({});
  const [userClipIds, setUserClipIds] = useState<string[]>([]);
  const [activeCycleId, setActiveCycleId] = useState('');
  const [animFrame, setAnimFrame] = useState(0);
  const [animPlaying, setAnimPlaying] = useState(false);
  const [animBusy, setAnimBusy] = useState(false);
  const [groundAnim, setGroundAnim] = useState(true);
  const [animPreviewing, setAnimPreviewing] = useState(false);
  const [newBodyType, setNewBodyType] = useState<BodyTypeId>(DEFAULT_BODY_TYPE);
  const host = useRef<HTMLDivElement>(null),
    perfBadgeRef = useRef<HTMLSpanElement>(null),
    engine = useRef<Studio | null>(null),
    viewportHoverEmitterRef = useRef<((tip: ViewportHoverTip | null) => void) | null>(null),
    file = useRef<HTMLInputElement>(null),
    poseJsonFile = useRef<HTMLInputElement>(null),
    animFile = useRef<HTMLInputElement>(null),
    import3dFileRef = useRef<HTMLInputElement>(null);
  const orbitViewRef = useRef<OrbitViewState>(clone(DEFAULT_ORBIT_VIEW));
  const cameraGestureBaseRef = useRef<SceneState | null>(null);
  const isDraggingCameraRef = useRef(false);
  const saverRef = useRef<WorkingDraftAutoSaver | null>(null);
  const lastUndoCommitRef = useRef<{ timeMs: number; key: string | null }>({ timeMs: 0, key: null });

  const liveSettings = useRef({ selected, lightPart, joint, view, mode, showJoints, showHelpers });
  liveSettings.current = { selected, lightPart, joint, view, mode, showJoints, showHelpers };

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    setTheme(next);
  };

  const notify = useCallback((text: string, error = false) => setNotice({ text, error }), []);
  const report = useCallback((e: unknown) => notify(e instanceof Error ? e.message : String(e), true), [notify]);

  const handleAutosaveStatus = useCallback((status: AutosaveStatus, err?: unknown) => {
    setAutosaveStatus(status);
    if (status === 'error' && err) {
      setNotice({ text: err instanceof Error ? err.message : String(err), error: true });
    }
  }, []);

  if (!saverRef.current) {
    saverRef.current = new WorkingDraftAutoSaver({
      throttleMs: 120,
      onStatus: handleAutosaveStatus,
    });
  }

  const queueDraftPersistence = useCallback(
    (draft: WorkingDraft, delayMs = 280) => {
      if (!saverRef.current?.isHydrated()) return;
      // A previous history entry may already be saved. While the new draft is
      // debouncing, don't advertise it as durable (notably Reset -> Undo).
      setAutosaveStatus('saving');
      scheduleSaveWorkingScene(draft, delayMs, { onStatus: handleAutosaveStatus });
    },
    [handleAutosaveStatus],
  );

  const buildDraft = useCallback(
    (sceneOverride?: SceneState, viewPatch?: Partial<WorkingViewState>): WorkingDraft => {
      const s = liveSettings.current;
      return {
        scene: sceneOverride ?? current.current,
        view: {
          editorCamera: viewPatch?.editorCamera ?? orbitViewRef.current,
          selectedId: viewPatch && 'selectedId' in viewPatch ? viewPatch.selectedId : s.selected,
          selectedJoint: viewPatch && 'selectedJoint' in viewPatch ? viewPatch.selectedJoint : s.joint,
          selectedLightPart: viewPatch && 'selectedLightPart' in viewPatch ? viewPatch.selectedLightPart : s.lightPart,
          cameraView: viewPatch?.cameraView ?? s.view,
          transformMode: viewPatch?.transformMode ?? s.mode,
        },
      };
    },
    [],
  );

  const commit = useCallback(
    (next: SceneState, viewPatch?: Partial<WorkingViewState>, coalesceKey?: string | null) => {
      for (const figure of next.items) {
        if (!isBody(figure.kind) || !figure.pose) continue;
        const previous = current.current.items.find(i => i.id === figure.id);
        const pose = figure.pose, previousPose = previous?.pose;
        const poseChanged = !previousPose || JOINTS.some(j => pose[j].some((v, axis) => v !== previousPose[j][axis]));
        if (poseChanged || (figure.anatomicalLimits !== false && previous?.anatomicalLimits === false)) {
          const morph =
            engine.current?.getFigure(figure.id)?.morphology ??
            getCharacterMorphology(figure.modelId ?? defaultModelId(figure.kind));
          figure.pose = clampPoseToAnatomicalLimits(
            figure.pose,
            figure.anatomicalLimits === false ? 'free' : 'anatomical',
            morph,
          );
        }
        if (figure.wardrobe?.drape && figure.wardrobe.drape.poseKey!==clothPoseKey(figure)) delete figure.wardrobe.drape;
      }
      syncLinkedLightTargets(
        next.items,
        (rId, oId) => engine.current?.getRoomObjectBasePosition(rId, oId) ?? null,
      );
      const nowMs = performance.now();
      const canCoalesce =
        Boolean(coalesceKey) &&
        past.current.length > 0 &&
        future.current.length === 0 &&
        lastUndoCommitRef.current.key === coalesceKey &&
        nowMs - lastUndoCommitRef.current.timeMs < UNDO_COALESCE_WINDOW_MS;
      if (!canCoalesce) {
        past.current.push(clone(current.current));
        if (past.current.length > MAX_UNDO_HISTORY) past.current.shift();
      }
      lastUndoCommitRef.current = { timeMs: nowMs, key: coalesceKey ?? null };
      future.current = [];
      current.current = next;
      setDoc(next);
      historyUpdate(t => t + 1);
      queueDraftPersistence(buildDraft(next, viewPatch));
    },
    [buildDraft, queueDraftPersistence],
  );
  const update = useCallback(
    (fn: (next: SceneState) => void, coalesceKey?: string | null) => {
      const next = clone(current.current);
      fn(next);
      commit(next, undefined, coalesceKey);
    },
    [commit],
  );

  const activeClip = activeCycleId ? animClips[activeCycleId] ?? null : null;
  const previewStateRef = useRef({
    animPreviewing: false,
    activeClip: null as AnimationCycleClip | null,
    animFrame: 0,
    groundAnim: true,
    selected,
  });
  previewStateRef.current = { animPreviewing, activeClip, animFrame, groundAnim, selected };

  const computeExtractedForItem = useCallback(
    (clip: AnimationCycleClip, frame: number, ground: boolean, target: Item) => {
      if (!isBody(target.kind)) return null;
      const fig = engine.current?.getFigure(target.id) ?? undefined;
      const extracted = extractPoseAtFrame(clip, frame, { body: target.kind, figure: fig });
      let nextY = target.position[1];
      if (ground && engine.current) {
        const floorY = engine.current.groundPoseY(target.id, extracted.pose) ?? 0;
        nextY = Math.max(floorY, extracted.suggestedRootY ?? floorY);
      }
      return { extracted, nextY };
    },
    [],
  );

  const previewCycleFrame = useCallback(
    (clip: AnimationCycleClip, frame: number, ground: boolean, target?: Item) => {
      const t = target ?? current.current.items.find(i => i.id === liveSettings.current.selected);
      if (!t || !isBody(t.kind) || !engine.current) return;
      const res = computeExtractedForItem(clip, frame, ground, t);
      if (!res) return;
      engine.current.previewFigurePose(t.id, res.extracted.pose, res.nextY);
      setAnimPreviewing(true);
    },
    [computeExtractedForItem],
  );

  const applyActiveAnimPose = useCallback(
    (silent = false) => {
      const { activeClip: clip, animFrame: frame, groundAnim: ground, selected: selId } = previewStateRef.current;
      const target = current.current.items.find(i => i.id === selId);
      if (!clip || !target || !isBody(target.kind)) return;
      setAnimPlaying(false);
      const res = computeExtractedForItem(clip, frame, ground, target);
      if (!res) return;
      const next = clone(current.current);
      const dst = next.items.find(i => i.id === target.id);
      if (dst) {
        dst.pose = res.extracted.pose;
        dst.position = [dst.position[0], res.nextY, dst.position[2]];
        commit(next);
      }
      setAnimPreviewing(false);
      if (!silent) notify(`Applied frame ${res.extracted.frame + 1}/${clip.frameCount} of "${clip.name}" as figure pose.`);
    },
    [commit, computeExtractedForItem, notify],
  );

  const cancelAnimPreview = useCallback(() => {
    setAnimPlaying(false);
    setAnimPreviewing(false);
    engine.current?.sync(current.current);
  }, []);

  const commitActiveCaddyIfOpen = useCallback((silent = true) => {
    const sess = caddySessionRef.current;
    if (!sess) return;
    caddySessionRef.current = null;
    setActiveCaddyOp(null);
    if (sess.dirty) {
      lastUndoCommitRef.current = { timeMs: 0, key: null };
      past.current.push(sess.preOpScene);
      if (past.current.length > MAX_UNDO_HISTORY) past.current.shift();
      future.current = [];
      historyUpdate(t => t + 1);
      queueDraftPersistence(buildDraft(current.current));
      if (!silent) notify(`Applied ${sess.op}.`);
    }
  }, [buildDraft, notify, queueDraftPersistence]);

  const cancelActiveCaddy = useCallback(() => {
    const sess = caddySessionRef.current;
    if (!sess) return;
    caddySessionRef.current = null;
    setActiveCaddyOp(null);
    lastUndoCommitRef.current = { timeMs: 0, key: null };
    current.current = sess.preOpScene;
    setDoc(sess.preOpScene);
    setComponentSelection(sess.baseSelection);
    queueDraftPersistence(buildDraft(sess.preOpScene));
  }, [buildDraft, queueDraftPersistence]);

  const select = useCallback(
    (id: string | null, j: Joint | null, additive = false, nextLightPart?: LightPart) => {
      lastUndoCommitRef.current = { timeMs: 0, key: null };
      commitActiveCaddyIfOpen(true);
      const ps = previewStateRef.current;
      if (ps.animPreviewing) {
        if (id && id === ps.selected && j !== null) {
          applyActiveAnimPose(true);
        } else if (id !== ps.selected) {
          setAnimPlaying(false);
          setAnimPreviewing(false);
          engine.current?.sync(current.current);
        }
      }
      const ids = additive && id
        ? selectionRef.current.includes(id) ? selectionRef.current.filter(key => key !== id) : [...selectionRef.current, id]
        : id ? [id] : [];
      const primaryId = additive ? ids.at(-1) ?? null : id;
      const primaryItem = primaryId ? current.current.items.find(i => i.id === primaryId) : undefined;
      const resolvedPart: LightPart =
        ids.length === 1 && !j
          ? resolveLightPartForItem(
              primaryItem,
              nextLightPart ?? (primaryId === liveSettings.current.selected ? liveSettings.current.lightPart : 'source'),
            )
          : 'source';
      setSelectedIds(ids);
      setSelected(primaryId);
      setSelectedOperandId(null);
      setFocusedModifierId(null);
      setSelectedRoomObject(null);
      setJoint(ids.length > 1 ? null : j);
      setLightPart(resolvedPart);
      if (!primaryItem || primaryItem.kind !== 'mesh') {
        setModelingMode('object');
      }
      if (id && (tab === 'camera' || tab === 'library' || (tab === 'pose' && (!primaryItem || !isBody(primaryItem.kind))))) {
        setTab('object');
      }
    },
    [applyActiveAnimPose, commitActiveCaddyIfOpen, tab],
  );

  const selectOperand = useCallback((booleId: string, operandId: string) => {
    commitActiveCaddyIfOpen(true);
    if (previewStateRef.current.animPreviewing) {
      setAnimPlaying(false);
      setAnimPreviewing(false);
      engine.current?.sync(current.current);
    }
    setSelectedIds([booleId]);
    setSelected(booleId);
    setSelectedOperandId(operandId);
    setFocusedModifierId(null);
    setSelectedRoomObject(null);
    setJoint(null);
    setLightPart('source');
    setModelingMode('object');
    setExpandedLayers(prev => ({ ...prev, [`item:${booleId}`]: true }));
    if (tab === 'camera' || tab === 'library' || tab === 'pose') setTab('object');
  }, [commitActiveCaddyIfOpen, tab]);

  const selectRoomObject = useCallback(
    (roomId: string, objectId: string | null) => {
      commitActiveCaddyIfOpen(true);
      if (previewStateRef.current.animPreviewing) {
        setAnimPlaying(false);
        setAnimPreviewing(false);
        engine.current?.sync(current.current);
      }
      setSelectedIds([roomId]);
      setSelected(roomId);
      setSelectedOperandId(null);
      setFocusedModifierId(null);
      setJoint(null);
      setLightPart('source');
      setModelingMode('object');
      setSelectedRoomObject(objectId ? { roomId, objectId } : null);
      setTab('object');
    },
    [commitActiveCaddyIfOpen],
  );

  const item = doc.items.find(i => i.id === selected);
  const resolvedTargetLookup = useMemo(
    () => findItemOrOperand(doc.items, selectedOperandId ?? selected),
    [doc.items, selectedOperandId, selected],
  );
  const activeTarget = resolvedTargetLookup?.item ?? item;
  const activeParentBoole = resolvedTargetLookup?.parentBoole ?? null;
  const [clothBusy,setClothBusy]=useState(false);
  const [fitSelection,setFitSelection]=useState<import('./garmentHandles').FitSelection|null>(null);
  const clothControls = {
    busy: clothBusy, preview: animPreviewing,
    fit:fitSelection, cameraView:view,
    editFit: (i:Item,id:Garment|null) => {
      if (animPreviewing || view) return;
      setJoint(null);
      engine.current?.editGarmentFit(i.id,id);
    },
    equipHeld: (i: Item, grip:TrenchGrip='both') => {
      if (i.locked || (i.wardrobe?.outer === 'trenchHeld' && (i.wardrobe.grip??'both')===grip)) return;
      const gesture = heldTrenchGesture(grip);
      const y = engine.current?.groundPoseY(i.id, gesture.pose);
      if (y == null) { notify('The mannequin must finish loading before equipping this coat.'); return; }
      setAnimPlaying(false);
      setAnimPreviewing(false);
      update(next => updateItemOrOperand(next.items, i.id, target => {
        Object.assign(target, gesture);
        target.position[1] = y;
        target.wardrobe = {...target.wardrobe, outer:'trenchHeld', grip, drape:undefined};
      }));
    },
    settle: async (target: Item) => {
      const studio=engine.current;
      if (!studio || clothBusy || animPreviewing) return;
      setClothBusy(true);
      try {
        const drape=await studio.settleCloth(target);
        const latest=current.current.items.find(i=>i.id===target.id);
        if (!drape || !latest?.wardrobe || clothPoseKey(latest)!==drape.poseKey || latest.locked) return;
        update(next => {next.items.find(i=>i.id===target.id)!.wardrobe!.drape=drape;});
        notify('Cloth settled for this pose.');
      } catch(e) {report(e);} finally {setClothBusy(false);}
    },
    cancel: () => engine.current?.cancelCloth(),
  };

  const editActiveTarget = useCallback((patch: Partial<Item>) => {
    const targetId = selectedOperandId ?? selected;
    if (!targetId) return;
    const keys = Object.keys(patch).sort();
    const isContinuous = keys.length > 0 && keys.every(k => CONTINUOUS_ITEM_KEYS.has(k));
    update(
      next => {
        updateItemOrOperand(next.items, targetId, candidate => Object.assign(candidate, patch));
      },
      isContinuous ? `active:${targetId}:${keys.join(',')}` : null,
    );
  }, [selectedOperandId, selected, update]);
  const editItem = (patch: Partial<Item>) => {
    if ((patch.bodyType !== undefined || patch.anatomicalLimits !== undefined) && previewStateRef.current.animPreviewing) {
      setAnimPlaying(false);
      setAnimPreviewing(false);
    }
    const keys = Object.keys(patch).sort();
    const isContinuous = keys.length > 0 && keys.every(k => CONTINUOUS_ITEM_KEYS.has(k));
    update(
      next => {
        const i = next.items.find(i => i.id === selected);
        if (i) {
          const needsAnchor =
            isBody(i.kind) &&
            Boolean(i.pose) &&
            (patch.bodyType !== undefined || patch.anatomicalLimits !== undefined);
          Object.assign(i, patch);
          if ('handPose' in patch) {
            const normalizedHands = normalizeCharacterHandPoses(patch.handPose);
            if (normalizedHands) i.handPose = normalizedHands;
            else delete i.handPose;
          }
          if (needsAnchor && isBody(i.kind) && i.pose) {
            i.pose = clampPoseToAnatomicalLimits(
              i.pose,
              i.anatomicalLimits === false ? 'free' : 'anatomical',
              resolveItemMorphology(i),
            );
            const y = computeStudioAnchoredFigureY(engine.current, i.id, {
              kind: i.kind,
              bodyType: i.bodyType,
              anatomicalLimits: i.anatomicalLimits,
              pose: i.pose,
            });
            if (y !== null && y !== undefined) i.position = [i.position[0], y, i.position[2]];
          }
          if (isBody(i.kind) && patch.bodyType === 'chibi') {
            applyChibiDefaultRenderStyle(next, patch.bodyType);
          }
        }
      },
      isContinuous ? `item:${selected ?? ''}:${keys.join(',')}` : null,
    );
  };
  const selectedModelId = item && isBody(item.kind) ? (item.modelId ?? defaultModelId(item.kind)) : undefined;
  const selectedRig = selectedModelId ? CHARACTERS[selectedModelId].source : undefined;
  const authoredHair = hasAuthoredHair(selectedModelId);
  const resolveItemMorphology = useCallback((target: Item) => {
    if (!isBody(target.kind)) return null;
    return (
      engine.current?.getFigure(target.id)?.morphology ??
      getCharacterMorphology(target.modelId ?? defaultModelId(target.kind))
    );
  }, []);
  const resolvePresetPoseForItem = useCallback(
    (presetName: (typeof PRESETS)[number], target: Item): Pose => {
      if (presetName === 'Neutral') return neutralPose();
      const canonical = preset(presetName);
      const morphology = resolveItemMorphology(target);
      if (!morphology || morphology.isCanonicalMannequin) return canonical;
      return adaptCanonicalPoseToMorphology(canonical, morphology, {
        limitMode: target.anatomicalLimits === false ? 'free' : 'anatomical',
      });
    },
    [resolveItemMorphology],
  );
  const swapBaseFigure = (modelId: ModelId) => {
    const nextKind = CHARACTERS[modelId].body;
    const currentItem = current.current.items.find(i => i.id === selected);
    if (!currentItem || !isBody(currentItem.kind) || (currentItem.modelId ?? defaultModelId(currentItem.kind)) === modelId) return;
    if (previewStateRef.current.animPreviewing) {
      setAnimPlaying(false);
      setAnimPreviewing(false);
    }
    update(next => {
      const idx = next.items.findIndex(i => i.id === selected);
      const target = idx >= 0 ? next.items[idx] : undefined;
      if (!target || !isBody(target.kind)) return;
      const prevModelId = target.modelId ?? defaultModelId(target.kind);
      const fromMorphology = resolveItemMorphology(target);
      const toMorphology = getCharacterMorphology(modelId);
      const limitMode = target.anatomicalLimits === false ? 'free' : 'anatomical';
      const translatedPose =
        !target.pose || posesMatch(target.pose, neutralPose())
          ? neutralPose()
          : fromMorphology && toMorphology
            ? translatePoseAcrossMorphologies(target.pose, fromMorphology, toMorphology, { limitMode })
            : clone(target.pose);
      const anchoredY = computeStudioAnchoredFigureY(engine.current, target.id, {
        kind: nextKind,
        modelId,
        bodyType: target.bodyType,
        anatomicalLimits: target.anatomicalLimits,
        pose: translatedPose,
      });
      const swapped = swapItemBodyKind(target, nextKind, anchoredY ?? target.position[1], modelId);
      swapped.pose = translatedPose;
      applyCharacterModelColorTransition(swapped, prevModelId, modelId);
      next.items[idx] = swapped;
    });
  };
  const editCamera = (patch: Partial<SceneState['camera']>) => {
    const keys = Object.keys(patch).sort();
    const isDiscrete = keys.some(k => k === 'aspect' || k === 'dof');
    update(
      next => Object.assign(next.camera, patch),
      isDiscrete ? null : `camera:${keys.join(',')}`,
    );
  };
  const renderStyle = { ...DEFAULT_RENDER_STYLE, ...doc.renderStyle };
  const renderQuality: RenderQualityMode = doc.renderQuality ?? DEFAULT_RENDER_QUALITY;
  const giEnabled = doc.giEnabled ?? DEFAULT_GI_ENABLED;
  const giIntensity = doc.giIntensity ?? DEFAULT_GI_INTENSITY;
  const aoEnabled = doc.aoEnabled ?? DEFAULT_AO_ENABLED;
  const shadowSoftness = doc.shadowSoftness ?? DEFAULT_SHADOW_SOFTNESS;
  const sceneLightsOnly = Boolean(doc.sceneLightsOnly);
  const setSceneLightsOnly = (enabled: boolean) => update(next => {
    next.sceneLightsOnly = enabled;
  });
  const editRenderStyle = (patch: Partial<RenderStyleState>) => {
    const keys = Object.keys(patch).sort();
    const isDiscrete = keys.some(k => k === 'mode' || k === 'outlinePaper' || k === 'clayOutlines');
    update(
      next => {
        next.renderStyle = { ...DEFAULT_RENDER_STYLE, ...next.renderStyle, ...patch };
      },
      isDiscrete ? null : `render-style:${keys.join(',')}`,
    );
  };
  const editRenderSettings = (
    patch: Partial<Pick<SceneState, 'renderQuality' | 'giEnabled' | 'giIntensity' | 'aoEnabled' | 'shadowSoftness'>>,
    coalesceKey?: string | null,
  ) => update(next => Object.assign(next, patch), coalesceKey);
  const flipSelection = (axis: 0 | 1 | 2) => {
    try {
      const next = clone(current.current);
      next.items = flipItems(next.items, selection, axis);
      validatePortable(next);
      commit(next);
    } catch (error) { report(error); }
  };
  const selectMany = (ids: string[]) => {
    commitActiveCaddyIfOpen(true);
    cancelAnimPreview();
    setSelectedIds(ids);
    setSelected(ids.at(-1) ?? null);
    setSelectedOperandId(null);
    setFocusedModifierId(null);
    setJoint(null);
    setLightPart('source');
    setModelingMode('object');
    if (ids.length) setTab('object');
  };
  const copyNodesToClipboard = (nodes: readonly Joint[]) => {
    if (!item) return;
    setPoseClipboard(copyPoseNodes(item, nodes));
    notify(`Copied ${nodes.length}/17 joints from ${item.name}.`);
  };
  const pasteClipboard = () => {
    if (!item || !isBody(item.kind) || !poseClipboard) return;
    cancelAnimPreview();
    let adaptedClipboard = poseClipboard;
    if (poseClipboard.sourceModelId && !posesMatch(poseClipboard.pose, neutralPose())) {
      const fromMorph = getCharacterMorphology(poseClipboard.sourceModelId);
      const toMorph = resolveItemMorphology(item);
      if (fromMorph && toMorph && fromMorph !== toMorph) {
        adaptedClipboard = {
          ...poseClipboard,
          pose: translatePoseAcrossMorphologies(poseClipboard.pose, fromMorph, toMorph, {
            limitMode: item.anatomicalLimits === false ? 'free' : 'anatomical',
          }),
        };
      }
    }
    const pastedItem = pastePoseNodes(item, adaptedClipboard);
    const nextPose = pastedItem.pose!;
    const anchoredY = computeStudioAnchoredFigureY(engine.current, item.id, { pose: nextPose });
    editItem({
      pose: nextPose,
      handPose: pastedItem.handPose,
      ...(anchoredY !== null && anchoredY !== undefined ? { position: [item.position[0], anchoredY, item.position[2]] } : {}),
    });
    notify(`Pasted ${poseClipboard.joints.length}/17 joints from ${poseClipboard.source}.`);
  };
  const mirrorSelectedPose = () => {
    if (!item || !isBody(item.kind) || !item.pose) return;
    cancelAnimPreview();
    const mirrored = mirrorCharacterPose(item);
    const nextPose = clampPoseToAnatomicalLimits(
      mirrored.pose!,
      item.anatomicalLimits === false ? 'free' : 'anatomical',
      resolveItemMorphology(item),
    );
    const anchoredY = computeStudioAnchoredFigureY(engine.current, item.id, { pose: nextPose });
    editItem({
      pose: nextPose,
      handPose: mirrored.handPose,
      ...(anchoredY !== null && anchoredY !== undefined ? { position: [item.position[0], anchoredY, item.position[2]] } : {}),
    });
    notify(`Mirrored left ↔ right pose on ${item.name}.`);
  };
  const undo = useCallback(
    (redo = false) => {
      engine.current?.cancelCloth();
      lastUndoCommitRef.current = { timeMs: 0, key: null };
      engine.current?.cancelCameraGesture();
      cameraGestureBaseRef.current = null;
      isDraggingCameraRef.current = false;
      setAnimPlaying(false);
      setAnimPreviewing(false);
      const from = redo ? future.current : past.current,
        to = redo ? past.current : future.current;
      const next = from.pop();
      if (!next) return;
      to.push(current.current);
      if (to.length > MAX_UNDO_HISTORY) to.shift();
      current.current = next;
      const curSelected = liveSettings.current.selected;
      const resolvedSelected =
        curSelected && next.items.some(i => i.id === curSelected) ? curSelected : (next.items[0]?.id ?? null);
      const resolvedItem = resolvedSelected ? next.items.find(i => i.id === resolvedSelected) : undefined;
      const resolvedJoint =
        resolvedItem && isBody(resolvedItem.kind) ? liveSettings.current.joint : null;
      const resolvedLightPart = resolveLightPartForItem(resolvedItem, liveSettings.current.lightPart);
      if (resolvedSelected !== curSelected) setSelected(resolvedSelected);
      setSelectedIds(resolvedSelected ? [resolvedSelected] : []);
      if (resolvedJoint !== liveSettings.current.joint) setJoint(resolvedJoint);
      if (resolvedLightPart !== liveSettings.current.lightPart) setLightPart(resolvedLightPart);
      setDoc(next);
      historyUpdate(t => t + 1);
      queueDraftPersistence(
        buildDraft(next, {
          selectedId: resolvedSelected,
          selectedJoint: resolvedJoint,
          selectedLightPart: resolvedLightPart,
        }),
      );
    },
    [buildDraft, queueDraftPersistence],
  );

  const startNewScene = useCallback(() => {
    lastUndoCommitRef.current = { timeMs: 0, key: null };
    engine.current?.cancelCameraGesture();
    cameraGestureBaseRef.current = null;
    isDraggingCameraRef.current = false;
    setAnimPlaying(false);
    setAnimPreviewing(false);
    const fresh = initialScene();
    const nextSelected = fresh.items[0]?.id ?? null;
    const resetOrbit = clone(DEFAULT_ORBIT_VIEW);
    orbitViewRef.current = resetOrbit;
    engine.current?.setOrbitView(resetOrbit.position, resetOrbit.target);
    setSelected(nextSelected);
    setSelectedIds(nextSelected ? [nextSelected] : []);
    setJoint(null);
    setLightPart('source');
    setView(false);
    setMode('translate');
    setSaveName('My study');
    commit(fresh, {
      editorCamera: resetOrbit,
      selectedId: nextSelected,
      selectedJoint: null,
      selectedLightPart: 'source',
      cameraView: false,
      transformMode: 'translate',
    });
    void flushScheduledWorkingSceneSave();
    notify('Started new scene — Undo to restore');
  }, [commit, notify]);

  const removeItemById = useCallback(
    (id: string) => {
      commitActiveCaddyIfOpen(true);
      const found = findItemOrOperand(current.current.items, id);
      if (found?.item.locked) {
        notify(`Unlock "${found.item.name}" before deleting.`);
        return;
      }
      setAnimPlaying(false);
      setAnimPreviewing(false);
      const next = clone(current.current);
      if (found?.parentBoole) {
        const dstBoole = next.items.find(i => i.id === found.parentBoole!.id);
        if (dstBoole?.operands) {
          dstBoole.operands = dstBoole.operands.filter(op => op.id !== id);
        }
        setSelectedOperandId(null);
        commit(next);
        return;
      }
      next.items = next.items.filter(i => i.id !== id);
      const nextSelected = selected === id ? (next.items[0]?.id ?? null) : selected;
      const nextJoint = selected === id ? null : joint;
      const nextLightPart: LightPart = selected === id ? 'source' : lightPart;
      if (selected === id) {
        setSelected(nextSelected);
        setSelectedIds(nextSelected ? [nextSelected] : []);
        setSelectedOperandId(null);
        setFocusedModifierId(null);
        setSelectedRoomObject(null);
        setJoint(null);
        setLightPart('source');
        setModelingMode('object');
      }
      commit(next, { selectedId: nextSelected, selectedJoint: nextJoint, selectedLightPart: nextLightPart });
    },
    [selected, joint, lightPart, commit, notify, commitActiveCaddyIfOpen],
  );

  const deleteRoomObject = useCallback(
    (roomId: string, objectId: string) => {
      const room = current.current.items.find(i => i.id === roomId);
      if (!room) return;
      if (room.locked || room.roomObjects?.[objectId]?.locked) {
        notify('Unlock the object and Room layer before deleting.');
        return;
      }
      update(next => {
        const target = next.items.find(i => i.id === roomId);
        if (!target) return;
        target.roomObjects = { ...(target.roomObjects ?? {}) };
        target.roomObjects[objectId] = { ...(target.roomObjects[objectId] ?? {}), deleted: true };
      });
      if (selectedRoomObject?.roomId === roomId && selectedRoomObject.objectId === objectId) {
        setSelectedRoomObject(null);
      }
    },
    [notify, selectedRoomObject, update],
  );

  const removeSelected = useCallback(() => {
    if (modelingMode !== 'object' && activeTarget?.kind === 'mesh' && activeTarget.editableMesh) {
      commitActiveCaddyIfOpen(true);
      const sel = componentSelection;
      let nextMesh: EditableMeshData | null = null;
      if (modelingMode === 'polygon' && sel.faces.length > 0) {
        nextMesh = deleteFaces(activeTarget.editableMesh, sel.faces).mesh;
      } else if (modelingMode === 'edge' && sel.edges.length > 0) {
        nextMesh = dissolveEdges(activeTarget.editableMesh, sel.edges).mesh;
      } else if (modelingMode === 'point' && sel.vertices.length > 0) {
        const vSet = new Set(sel.vertices);
        const facesWithVerts = activeTarget.editableMesh.faces
          .map((f, idx) => (f.verts.some(v => vSet.has(v)) ? idx : -1))
          .filter(idx => idx >= 0);
        if (facesWithVerts.length > 0) {
          nextMesh = deleteFaces(activeTarget.editableMesh, facesWithVerts).mesh;
        }
      }
      if (nextMesh) {
        editActiveTarget({ editableMesh: nextMesh });
        setComponentSelection(createEmptySelection(modelingMode));
        return;
      }
      return;
    }
    if (selectedRoomObject) {
      deleteRoomObject(selectedRoomObject.roomId, selectedRoomObject.objectId);
      return;
    }
    if (selectedOperandId) {
      removeItemById(selectedOperandId);
      return;
    }
    if (selected) removeItemById(selected);
  }, [
    modelingMode,
    activeTarget,
    componentSelection,
    commitActiveCaddyIfOpen,
    editActiveTarget,
    selectedRoomObject,
    deleteRoomObject,
    selectedOperandId,
    selected,
    removeItemById,
  ]);

  const toggleExpandLayer = useCallback((key: string) => {
    setExpandedLayers(prev => ({ ...prev, [key]: prev[key] === false }));
  }, []);

  const toggleItemVisible = useCallback((id: string) => {
    update(next => {
      updateItemOrOperand(next.items, id, target => {
        target.visible = target.visible === false;
      });
    });
  }, [update]);

  const toggleItemLocked = useCallback((id: string) => {
    update(next => {
      updateItemOrOperand(next.items, id, target => {
        target.locked = !target.locked;
      });
    });
  }, [update]);

  const toggleGroupVisible = useCallback((ids: string[]) => {
    update(next => {
      const targets = next.items.filter(i => ids.includes(i.id));
      const allVisible = targets.every(i => i.visible !== false);
      for (const t of targets) t.visible = !allVisible;
    });
  }, [update]);

  const toggleGroupLocked = useCallback((ids: string[]) => {
    update(next => {
      const targets = next.items.filter(i => ids.includes(i.id));
      const allLocked = targets.every(i => Boolean(i.locked));
      for (const t of targets) t.locked = !allLocked;
    });
  }, [update]);

  const editRoomObjectOverride = useCallback((roomId: string, objectId: string, patch: Partial<RoomObjectOverride>) => {
    update(next => {
      const target = next.items.find(i => i.id === roomId);
      if (!target) return;
      target.roomObjects = { ...(target.roomObjects ?? {}) };
      target.roomObjects[objectId] = { ...(target.roomObjects[objectId] ?? {}), ...patch };
    });
  }, [update]);

  const toggleRoomObjectVisible = useCallback((roomId: string, objectId: string) => {
    const room = current.current.items.find(i => i.id === roomId);
    const curVisible = room?.roomObjects?.[objectId]?.visible !== false;
    editRoomObjectOverride(roomId, objectId, { visible: !curVisible });
  }, [editRoomObjectOverride]);

  const toggleRoomObjectLocked = useCallback((roomId: string, objectId: string) => {
    const room = current.current.items.find(i => i.id === roomId);
    const curLocked = Boolean(room?.roomObjects?.[objectId]?.locked);
    editRoomObjectOverride(roomId, objectId, { locked: !curLocked });
  }, [editRoomObjectOverride]);

  // ---------------------------------------------------------------------------
  // Cinema 4D Modeling, Primitives, Booleans, Modifiers, Caddy & 3D Import
  // ---------------------------------------------------------------------------

  const spawnPrimitive = useCallback((primKind: PrimitiveKind) => {
    commitActiveCaddyIfOpen(true);
    if (current.current.items.length >= 64) {
      report(new Error('Scene limit: 64 objects.'));
      return;
    }
    const index = current.current.items.filter(
      i => i.kind === 'primitive' && i.primitive?.kind === primKind,
    ).length;
    const added = createPrimitiveItem(primKind, index);
    setLastPrimKind(primKind);
    const next = clone(current.current);
    next.items.push(added);
    setSelected(added.id);
    setSelectedIds([added.id]);
    setSelectedOperandId(null);
    setFocusedModifierId(null);
    setSelectedRoomObject(null);
    setJoint(null);
    setModelingMode('object');
    setView(false);
    setTab('object');
    commit(next, { selectedId: added.id, selectedJoint: null, cameraView: false });
  }, [commit, commitActiveCaddyIfOpen, report]);

  const makeItemEditable = useCallback((targetId?: string, switchMode?: ModelingMode) => {
    commitActiveCaddyIfOpen(true);
    const idToBake = targetId ?? selectedOperandId ?? selected;
    if (!idToBake) return;
    const found = findItemOrOperand(current.current.items, idToBake);
    if (!found || !canMakeEditable(found.item)) {
      notify('Select a Primitive, Boole, Prop, or Imported 3D mesh to Make Editable.', true);
      return;
    }
    const bakedMesh = engine.current?.extractEditableMesh(found.item.id);
    if (!bakedMesh || bakedMesh.vertices.length === 0 || bakedMesh.faces.length === 0) {
      notify('Unable to extract editable polygon geometry for this object.', true);
      return;
    }
    const next = clone(current.current);
    updateItemOrOperand(next.items, found.item.id, dst => {
      dst.kind = 'mesh';
      dst.editableMesh = bakedMesh;
      delete dst.primitive;
      delete dst.booleanOp;
      delete dst.operands;
      delete dst.booleanEnabled;
      delete dst.assetId;
      delete dst.sourceFormat;
      delete dst.fileName;
      delete dst.embeddedGlbBase64;
      dst.modifiers = [];
    });
    const nextMode = switchMode ?? (modelingMode === 'object' ? 'polygon' : modelingMode);
    const elemMode = nextMode === 'object' ? 'polygon' : nextMode;
    setModelingMode(nextMode);
    setComponentSelection(createEmptySelection(elemMode));
    setTab('object');
    commit(next);
    notify(`Converted "${found.item.name}" to Editable Mesh (${bakedMesh.vertices.length} pts · ${bakedMesh.faces.length} faces).`);
  }, [commit, commitActiveCaddyIfOpen, modelingMode, notify, selected, selectedOperandId]);

  const switchModelingMode = useCallback((nextMode: ModelingMode) => {
    commitActiveCaddyIfOpen(true);
    if (nextMode === 'object') {
      setModelingMode('object');
      return;
    }
    if (!activeTarget) {
      notify('Select a mesh or primitive first.');
      return;
    }
    if (activeTarget.kind !== 'mesh') {
      if (canMakeEditable(activeTarget)) {
        makeItemEditable(activeTarget.id, nextMode);
      } else {
        notify(`"${activeTarget.name}" does not support Point/Edge/Polygon mode.`);
      }
      return;
    }
    if (modelingMode !== 'object' && activeTarget.editableMesh) {
      setComponentSelection(prev => convertSelection(activeTarget.editableMesh!, prev, nextMode));
    } else {
      setComponentSelection(createEmptySelection(nextMode));
    }
    setModelingMode(nextMode);
  }, [activeTarget, commitActiveCaddyIfOpen, makeItemEditable, modelingMode, notify]);

  const createOrWrapBoole = useCallback((op: BooleanOpType) => {
    commitActiveCaddyIfOpen(true);
    setLastBooleOp(op);
    const next = clone(current.current);
    const validSelected = selection.filter(id => {
      const it = next.items.find(x => x.id === id);
      return it && canBeBooleOperand(it);
    });
    const existingBooleCount = next.items.filter(x => x.kind === 'boole').length;
    if (validSelected.length >= 2) {
      const grouped = groupItemsIntoBoole(next.items, validSelected, op, existingBooleCount);
      next.items = grouped.items;
      setSelected(grouped.booleItem.id);
      setSelectedIds([grouped.booleItem.id]);
      setSelectedOperandId(null);
      setExpandedLayers(prev => ({ ...prev, [`item:${grouped.booleItem.id}`]: true }));
      setModelingMode('object');
      setTab('object');
      commit(next, { selectedId: grouped.booleItem.id, selectedJoint: null });
      notify(`Created ${BOOLEAN_OP_LABELS[op]} Boole from ${grouped.booleItem.operands?.length ?? 2} operands.`);
      return;
    }
    const singleOperand = validSelected.length === 1
      ? next.items.find(x => x.id === validSelected[0])
      : undefined;
    const groupedSingle = groupItemsIntoBoole(
      next.items,
      singleOperand ? [singleOperand.id] : [],
      op,
      existingBooleCount,
    );
    next.items = groupedSingle.items;
    const booleItem = groupedSingle.booleItem;
    setSelected(booleItem.id);
    setSelectedIds([booleItem.id]);
    setSelectedOperandId(null);
    setExpandedLayers(prev => ({ ...prev, [`item:${booleItem.id}`]: true }));
    setModelingMode('object');
    setTab('object');
    commit(next, { selectedId: booleItem.id, selectedJoint: null });
    notify(
      singleOperand
        ? `Wrapped "${singleOperand.name}" in Boole — add a cutter operand in the Attribute Manager.`
        : 'Created empty Boole generator — add Operand A & Operand B in the Attribute Manager.',
    );
  }, [commit, commitActiveCaddyIfOpen, notify, selection]);

  const handleSwapBooleOperands = useCallback((booleId: string) => {
    update(next => {
      next.items = next.items.map(it => (it.id === booleId ? swapBooleOperands(it) : it));
    });
  }, [update]);

  const handleExtractBooleOperands = useCallback((booleId: string) => {
    const next = clone(current.current);
    const res = extractBooleOperands(next.items, booleId);
    next.items = res.items;
    const nextSel = res.extractedIds[0] ?? next.items[0]?.id ?? null;
    setSelected(nextSel);
    setSelectedIds(res.extractedIds.length > 0 ? res.extractedIds : nextSel ? [nextSel] : []);
    setSelectedOperandId(null);
    commit(next, { selectedId: nextSel, selectedJoint: null });
    notify('Unpacked Boole operands back into scene.');
  }, [commit, notify]);

  const handleAddSceneOperandToBoole = useCallback((booleId: string, operandItemId: string) => {
    update(next => {
      next.items = addOperandToBoole(next.items, booleId, operandItemId);
    });
    setExpandedLayers(prev => ({ ...prev, [`item:${booleId}`]: true }));
  }, [update]);

  const attachModifierToActive = useCallback((modType: ModifierType) => {
    commitActiveCaddyIfOpen(true);
    setLastModType(modType);
    const target = activeTarget;
    if (!target || !canAttachModifiers(target)) {
      notify('Select a Primitive, Mesh, Boole, Prop, or Imported 3D object to attach a Modifier.', true);
      return;
    }
    const spec = createDefaultModifierSpec(modType);
    update(next => {
      updateItemOrOperand(next.items, target.id, dst => {
        dst.modifiers = [...(dst.modifiers ?? []), spec];
      });
    });
    setExpandedLayers(prev => ({ ...prev, [`item:${target.id}`]: true }));
    setFocusedModifierId(spec.id);
    setTab('modifiers');
    notify(`Attached ${MODIFIER_LABELS[modType]} modifier to "${target.name}".`);
  }, [activeTarget, commitActiveCaddyIfOpen, notify, update]);

  const updateModifierOnItem = useCallback(
    (targetItemId: string, modId: string, updater: (mod: ModifierSpec) => ModifierSpec) => {
      update(
        next => {
          updateItemOrOperand(next.items, targetItemId, dst => {
            dst.modifiers = (dst.modifiers ?? []).map(m => (m.id === modId ? updater(m) : m));
          });
        },
        `mod:${targetItemId}:${modId}`,
      );
    },
    [update],
  );

  const toggleModifierEnabledOnItem = useCallback((targetItemId: string, modId: string) => {
    update(next => {
      updateItemOrOperand(next.items, targetItemId, dst => {
        dst.modifiers = (dst.modifiers ?? []).map(m =>
          m.id === modId ? ({ ...m, enabled: !m.enabled } as ModifierSpec) : m,
        );
      });
    });
  }, [update]);

  const moveModifierOnItem = useCallback((targetItemId: string, modId: string, dir: -1 | 1) => {
    update(next => {
      updateItemOrOperand(next.items, targetItemId, dst => {
        const list = [...(dst.modifiers ?? [])];
        const idx = list.findIndex(m => m.id === modId);
        const swapIdx = idx + dir;
        if (idx < 0 || swapIdx < 0 || swapIdx >= list.length) return;
        const tmp = list[idx]!;
        list[idx] = list[swapIdx]!;
        list[swapIdx] = tmp;
        dst.modifiers = list;
      });
    });
  }, [update]);

  const removeModifierOnItem = useCallback((targetItemId: string, modId: string) => {
    update(next => {
      updateItemOrOperand(next.items, targetItemId, dst => {
        dst.modifiers = (dst.modifiers ?? []).filter(m => m.id !== modId);
      });
    });
    if (focusedModifierId === modId) setFocusedModifierId(null);
  }, [focusedModifierId, update]);

  const evaluateCaddyOperation = useCallback(
    (
      op: CaddyOp,
      baseMesh: EditableMeshData,
      baseSelection: ComponentSelection,
      params: CaddyParamsState,
      loopEdge: number | null,
    ): { mesh: EditableMeshData; selection?: ComponentSelection } => {
      switch (op) {
        case 'extrude': {
          const faces = baseSelection.faces.length > 0
            ? baseSelection.faces
            : baseMesh.faces.map((_, idx) => idx);
          return extrudeFaces(baseMesh, faces, {
            offset: params.offset,
            groupNormals: params.groupNormals,
          });
        }
        case 'inset': {
          const faces = baseSelection.faces.length > 0
            ? baseSelection.faces
            : baseMesh.faces.map((_, idx) => idx);
          return insetFaces(baseMesh, faces, {
            inset: params.inset,
            individual: params.individual,
          });
        }
        case 'bevel': {
          if (baseSelection.mode === 'point' && baseSelection.vertices.length > 0) {
            return chamferVertices(baseMesh, baseSelection.vertices, { width: params.width });
          }
          if (baseSelection.mode === 'edge' && baseSelection.edges.length > 0) {
            return bevelEdges(baseMesh, baseSelection.edges, {
              width: params.width,
              segments: params.segments,
            });
          }
          const faces = baseSelection.faces.length > 0
            ? baseSelection.faces
            : baseMesh.faces.map((_, idx) => idx);
          return bevelFaces(baseMesh, faces, {
            inset: params.inset,
            offset: params.width,
            segments: params.segments,
          });
        }
        case 'loopCut': {
          const edgeIdx = loopEdge ?? baseSelection.edges[0] ?? 0;
          return loopCut(baseMesh, edgeIdx, {
            factor: params.slide,
            cuts: params.cuts,
          });
        }
        case 'weld': {
          if (params.weldMode === 'center' && baseSelection.vertices.length >= 2) {
            return weldVertices(baseMesh, baseSelection.vertices, { mode: 'center' });
          }
          const verts = baseSelection.vertices.length >= 2
            ? baseSelection.vertices
            : baseMesh.vertices.map((_, idx) => idx);
          return weldVertices(baseMesh, verts, {
            mode: 'threshold',
            threshold: params.threshold,
          });
        }
      }
    },
    [],
  );

  const previewCaddyStep = useCallback((op: CaddyOp, nextParams: CaddyParamsState, explicitLoopEdge?: number | null) => {
    const sess = caddySessionRef.current;
    if (!sess || sess.op !== op) return;
    if (explicitLoopEdge !== undefined) {
      sess.loopCutEdge = explicitLoopEdge;
    }
    if (op === 'loopCut' && sess.loopCutEdge === null && sess.baseSelection.edges.length === 0) {
      return;
    }
    const evaluated = evaluateCaddyOperation(
      op,
      sess.baseMesh,
      sess.baseSelection,
      nextParams,
      sess.loopCutEdge,
    );
    const liveScene = clone(sess.preOpScene);
    updateItemOrOperand(liveScene.items, sess.targetId, dst => {
      dst.editableMesh = evaluated.mesh;
    });
    sess.dirty = true;
    current.current = liveScene;
    setDoc(liveScene);
    if (evaluated.selection) {
      setComponentSelection(evaluated.selection);
    }
  }, [evaluateCaddyOperation]);

  const startCaddyOp = useCallback((op: CaddyOp, initialLoopEdge: number | null = null) => {
    commitActiveCaddyIfOpen(true);
    if (!activeTarget || activeTarget.kind !== 'mesh' || !activeTarget.editableMesh) {
      notify('Make the selected object Editable first to use polygon modeling tools.', true);
      return;
    }
    let effectiveMode = modelingMode === 'object' ? 'polygon' : modelingMode;
    let effectiveSelection = componentSelection;
    if (op === 'extrude' || op === 'inset') {
      if (effectiveMode !== 'polygon') {
        effectiveSelection = convertSelection(activeTarget.editableMesh, effectiveSelection, 'polygon');
        effectiveMode = 'polygon';
        setModelingMode('polygon');
      }
    } else if (op === 'loopCut') {
      effectiveMode = 'edge';
      setModelingMode('edge');
    } else if (op === 'weld' && effectiveMode !== 'point') {
      effectiveSelection = convertSelection(activeTarget.editableMesh, effectiveSelection, 'point');
      effectiveMode = 'point';
      setModelingMode('point');
    }
    const initialParams = { ...DEFAULT_CADDY_PARAMS };
    setCaddyParams(initialParams);
    setActiveCaddyOp(op);
    caddySessionRef.current = {
      op,
      targetId: activeTarget.id,
      baseMesh: cloneEditableMesh(activeTarget.editableMesh),
      baseSelection: clone({ ...effectiveSelection, mode: effectiveMode }),
      preOpScene: clone(current.current),
      loopCutEdge: initialLoopEdge ?? (effectiveSelection.edges[0] ?? null),
      dirty: false,
    };
    if (op !== 'loopCut' || initialLoopEdge !== null || effectiveSelection.edges.length > 0) {
      previewCaddyStep(op, initialParams, initialLoopEdge ?? (effectiveSelection.edges[0] ?? null));
    } else {
      notify('Loop Cut active: hover an edge ring in the viewport and click to insert loop cut.');
    }
  }, [activeTarget, commitActiveCaddyIfOpen, componentSelection, modelingMode, notify, previewCaddyStep]);

  const updateCaddyParam = useCallback(<K extends keyof CaddyParamsState>(key: K, val: CaddyParamsState[K]) => {
    setCaddyParams(prev => {
      const next = { ...prev, [key]: val };
      if (caddySessionRef.current) {
        previewCaddyStep(caddySessionRef.current.op, next);
      }
      return next;
    });
  }, [previewCaddyStep]);

  const runDirectMeshTool = useCallback((
    tool:
      | 'bridge'
      | 'connect'
      | 'subdivide'
      | 'dissolve'
      | 'flipNormals'
      | 'closeHoles'
      | 'split'
      | 'edgeLoop'
      | 'edgeRing'
      | 'growSelection'
      | 'shrinkSelection',
  ) => {
    commitActiveCaddyIfOpen(true);
    if (!activeTarget || activeTarget.kind !== 'mesh' || !activeTarget.editableMesh) {
      notify('Select an Editable Mesh first.', true);
      return;
    }
    const mesh = activeTarget.editableMesh;
    if (tool === 'edgeLoop') {
      const seed = componentSelection.edges[0];
      if (seed === undefined) {
        notify('Select at least one edge first.');
        return;
      }
      const loopEdges = selectEdgeLoop(mesh, seed);
      setModelingMode('edge');
      setComponentSelection({ mode: 'edge', vertices: [], edges: loopEdges, faces: [] });
      return;
    }
    if (tool === 'edgeRing') {
      const seed = componentSelection.edges[0];
      if (seed === undefined) {
        notify('Select at least one edge first.');
        return;
      }
      const ringEdges = selectEdgeRing(mesh, seed);
      setModelingMode('edge');
      setComponentSelection({ mode: 'edge', vertices: [], edges: ringEdges, faces: [] });
      return;
    }
    if (tool === 'growSelection') {
      setComponentSelection(prev => growSelection(mesh, prev));
      return;
    }
    if (tool === 'shrinkSelection') {
      setComponentSelection(prev => shrinkSelection(mesh, prev));
      return;
    }

    let opResult: { mesh: EditableMeshData; selection?: ComponentSelection } | null = null;
    switch (tool) {
      case 'bridge':
        if (modelingMode === 'edge' && componentSelection.edges.length >= 2) {
          const half = Math.max(1, Math.floor(componentSelection.edges.length / 2));
          opResult = bridgeEdges(
            mesh,
            componentSelection.edges.slice(0, half),
            componentSelection.edges.slice(half),
          );
        } else if (componentSelection.faces.length >= 2) {
          opResult = bridgeFaces(mesh, componentSelection.faces.slice(0, 2));
        } else {
          notify('Select 2 faces or 2+ boundary edges to Bridge.');
          return;
        }
        break;
      case 'connect':
        if (componentSelection.vertices.length >= 2) {
          opResult = connectVertices(mesh, componentSelection.vertices);
        } else if (componentSelection.edges.length >= 1) {
          opResult = collapseEdges(mesh, componentSelection.edges);
        } else {
          notify('Select 2+ vertices on a shared face to Connect (or edges to Collapse).');
          return;
        }
        break;
      case 'subdivide': {
        const faces = componentSelection.faces.length > 0
          ? componentSelection.faces
          : mesh.faces.map((_, idx) => idx);
        opResult = subdivideFaces(mesh, faces);
        break;
      }
      case 'dissolve':
        if (modelingMode === 'edge' && componentSelection.edges.length > 0) {
          opResult = dissolveEdges(mesh, componentSelection.edges);
        } else if (componentSelection.faces.length > 0) {
          opResult = dissolveFaces(mesh, componentSelection.faces);
        } else {
          notify('Select edges or faces to Dissolve.');
          return;
        }
        break;
      case 'flipNormals':
        opResult = flipFaceNormals(
          mesh,
          componentSelection.faces.length > 0 ? componentSelection.faces : undefined,
        );
        break;
      case 'closeHoles': {
        const prevFaces = mesh.faces.length;
        const res = closePolygonHoles(mesh);
        opResult = res;
        const added = Math.max(0, res.mesh.faces.length - prevFaces);
        notify(
          added > 0
            ? `Closed ${added} boundary hole(s).`
            : 'Mesh is already closed (0 boundary holes).',
        );
        break;
      }
      case 'split':
        if (componentSelection.faces.length > 0) {
          opResult = splitDisconnectFaces(mesh, componentSelection.faces);
        } else {
          notify('Select faces to Split / Disconnect.');
          return;
        }
        break;
    }
    if (opResult) {
      editActiveTarget({ editableMesh: opResult.mesh });
      if (opResult.selection) {
        setComponentSelection(opResult.selection);
      }
    }
  }, [activeTarget, commitActiveCaddyIfOpen, componentSelection, editActiveTarget, modelingMode, notify]);

  const handleImport3DFiles = useCallback(async (files: FileList | File[]) => {
    const fileArr = Array.from(files);
    if (fileArr.length === 0) return;
    commitActiveCaddyIfOpen(true);
    setBusy(true);
    try {
      const primaries = fileArr.filter(f => detect3DFormat(f.name) !== null);
      const companions = fileArr.filter(f => detect3DFormat(f.name) === null);
      const batches =
        primaries.length <= 1
          ? [fileArr]
          : primaries.map(primary => [primary, ...companions]);

      const next = clone(current.current);
      let lastAddedId: string | null = null;
      let lastFileName = '';
      let lastVerts = 0;

      for (const batch of batches) {
        if (next.items.length >= 64) {
          throw new Error('Scene limit: 64 objects.');
        }
        const primaryFile = batch.find(f => detect3DFormat(f.name) !== null) ?? batch[0]!;
        const asset = await import3dFiles(batch);
        const assetId = crypto.randomUUID();
        const serialized = await serializeImportedAsset(asset);
        const portable = serializedAssetToPortableJson(serialized);
        registerRuntimeImportedAsset(assetId, asset, portable);
        await saveImportedAssetToStorage(assetId, portable);

        const importedItem: Item = {
          id: crypto.randomUUID(),
          kind: 'imported',
          name: asset.name,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          color: '#cbd5e1',
          visible: true,
          assetId,
          sourceFormat: asset.format,
          fileName: primaryFile.name,
          modifiers: [],
          phongAngleDeg: 40,
          roughness: 0.62,
          metalness: 0.08,
        };
        next.items.push(importedItem);
        lastAddedId = importedItem.id;
        lastFileName = primaryFile.name;
        lastVerts = asset.vertexCount;
      }

      if (lastAddedId) {
        setSelected(lastAddedId);
        setSelectedIds([lastAddedId]);
        setSelectedOperandId(null);
        setFocusedModifierId(null);
        setModelingMode('object');
        setTab('object');
        commit(next, { selectedId: lastAddedId, selectedJoint: null });
        notify(
          batches.length === 1
            ? `Imported "${lastFileName}" (${lastVerts.toLocaleString()} verts).`
            : `Imported ${batches.length} 3D assets into scene.`,
        );
      }
    } catch (err) {
      report(err);
    } finally {
      setBusy(false);
    }
  }, [commit, commitActiveCaddyIfOpen, notify, report]);

  const snapSelectedToFloor = useCallback(() => {
    if (!activeTarget) return;
    if (activeTarget.kind === 'primitive' && activeTarget.primitive) {
      const mesh = createPrimitiveEditableMesh(activeTarget.primitive);
      let minY = Infinity;
      for (const v of mesh.vertices) if (v[1] < minY) minY = v[1];
      if (Number.isFinite(minY)) {
        editActiveTarget({
          position: [
            activeTarget.position[0],
            Number((-minY * activeTarget.scale[1]).toFixed(4)),
            activeTarget.position[2],
          ],
        });
        return;
      }
    }
    if (activeTarget.kind === 'mesh' && activeTarget.editableMesh) {
      let minY = Infinity;
      for (const v of activeTarget.editableMesh.vertices) if (v[1] < minY) minY = v[1];
      if (Number.isFinite(minY)) {
        editActiveTarget({
          position: [
            activeTarget.position[0],
            Number((-minY * activeTarget.scale[1]).toFixed(4)),
            activeTarget.position[2],
          ],
        });
        return;
      }
    }
    editActiveTarget({ position: [activeTarget.position[0], 0, activeTarget.position[2]] });
  }, [activeTarget, editActiveTarget]);

  const handleCameraOrbitGesture = useCallback(
    (cameraPose: OrbitViewState, settled: boolean) => {
      if (!settled) {
        if (!cameraGestureBaseRef.current) {
          cameraGestureBaseRef.current = clone(current.current);
        }
        isDraggingCameraRef.current = true;
        const liveNext: SceneState = {
          ...current.current,
          camera: {
            ...current.current.camera,
            position: clone(cameraPose.position),
            target: clone(cameraPose.target),
          },
        };
        current.current = liveNext;
        setDoc(liveNext);
        queueDraftPersistence(buildDraft(liveNext));
        return;
      }

      isDraggingCameraRef.current = false;
      const base = cameraGestureBaseRef.current ?? clone(current.current);
      cameraGestureBaseRef.current = null;
      const finalScene: SceneState = {
        ...clone(current.current),
        camera: {
          ...current.current.camera,
          position: clone(cameraPose.position),
          target: clone(cameraPose.target),
        },
      };
      const unchanged =
        base.camera.position.every((v, idx) => Math.abs(v - finalScene.camera.position[idx]!) <= 1e-4) &&
        base.camera.target.every((v, idx) => Math.abs(v - finalScene.camera.target[idx]!) <= 1e-4);
      if (unchanged) return;
      lastUndoCommitRef.current = { timeMs: 0, key: null };
      past.current.push(base);
      if (past.current.length > MAX_UNDO_HISTORY) past.current.shift();
      future.current = [];
      current.current = finalScene;
      setDoc(finalScene);
      historyUpdate(t => t + 1);
      queueDraftPersistence(buildDraft(finalScene));
    },
    [buildDraft, queueDraftPersistence],
  );

  const handleViewportComponentSelect = useCallback((nextSel: ComponentSelection) => {
    commitActiveCaddyIfOpen(true);
    setComponentSelection(nextSel);
  }, [commitActiveCaddyIfOpen]);

  const handleViewportMeshEdit = useCallback(
    (itemId: string, nextMesh: EditableMeshData, nextSel: ComponentSelection, settled: boolean) => {
      const nextScene = clone(current.current);
      updateItemOrOperand(nextScene.items, itemId, dst => {
        dst.editableMesh = nextMesh;
      });
      setComponentSelection(nextSel);
      if (!settled) {
        setDoc(nextScene);
        queueDraftPersistence(buildDraft(nextScene));
        return;
      }
      commit(nextScene);
    },
    [buildDraft, commit, queueDraftPersistence],
  );

  const handleViewportLoopCutClick = useCallback(
    (_itemId: string, edgeIndex: number, factor: number) => {
      if (caddySessionRef.current?.op === 'loopCut') {
        const nextParams = { ...caddyParams, slide: Number(factor.toFixed(3)) };
        setCaddyParams(nextParams);
        previewCaddyStep('loopCut', nextParams, edgeIndex);
        commitActiveCaddyIfOpen(false);
      }
    },
    [caddyParams, commitActiveCaddyIfOpen, previewCaddyStep],
  );

  const studioCallbacksRef = useRef({
    change: (next: SceneState) => commit(next),
    liveChange: (liveScene: SceneState) => {
      setDoc(liveScene);
      queueDraftPersistence(buildDraft(liveScene));
    },
    orbitChange: (orbit: OrbitViewState, _settled: boolean) => {
      orbitViewRef.current = orbit;
      queueDraftPersistence(buildDraft(undefined, { editorCamera: orbit }));
    },
    cameraChange: handleCameraOrbitGesture,
    select,
    selectMany,
    selectRoomObject,
    componentSelect: handleViewportComponentSelect,
    meshEdit: handleViewportMeshEdit,
    loopCutClick: handleViewportLoopCutClick,
    error: report,
  });
  studioCallbacksRef.current = {
    change: (next: SceneState) => commit(next),
    liveChange: (liveScene: SceneState) => {
      setDoc(liveScene);
      queueDraftPersistence(buildDraft(liveScene));
    },
    orbitChange: (orbit: OrbitViewState, _settled: boolean) => {
      orbitViewRef.current = orbit;
      queueDraftPersistence(buildDraft(undefined, { editorCamera: orbit }));
    },
    cameraChange: handleCameraOrbitGesture,
    select,
    selectMany,
    selectRoomObject,
    componentSelect: handleViewportComponentSelect,
    meshEdit: handleViewportMeshEdit,
    loopCutClick: handleViewportLoopCutClick,
    error: report,
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    const draftPromise = saverRef.current?.isHydrated()
      ? Promise.resolve(null)
      : loadWorkingDraft().catch(err => {
          report(err);
          return null;
        });

    Promise.all([loadExternalFigures(), draftPromise])
      .then(async ([, loaded]) => {
        if (cancelled) return;

        let bootScene = current.current;
        let bootSelected = liveSettings.current.selected;
        let bootJoint = liveSettings.current.joint;
        let bootLightPart = liveSettings.current.lightPart;
        let bootCameraView = liveSettings.current.view;
        let bootMode = liveSettings.current.mode;
        let bootOrbit = orbitViewRef.current;
        let restoredFromStorage = false;

        if (loaded && !saverRef.current?.isHydrated()) {
          if (loaded.corrupted && loaded.warning) {
            notify(loaded.warning, true);
          }
          if (loaded.draft) {
            restoredFromStorage = true;
            bootScene = sanitizeWorkingDraftCharacterColors(loaded.draft.scene);
            const v = sanitizeWorkingView(loaded.draft.view, bootScene);
            bootSelected = v.selectedId ?? null;
            bootJoint = v.selectedJoint ?? null;
            bootLightPart = v.selectedLightPart ?? 'source';
            bootCameraView = v.cameraView ?? false;
            bootMode = v.transformMode ?? 'translate';
            bootOrbit = v.editorCamera ? clone(v.editorCamera) : clone(DEFAULT_ORBIT_VIEW);

            current.current = bootScene;
            past.current = [];
            future.current = [];
            orbitViewRef.current = bootOrbit;
            liveSettings.current = {
              ...liveSettings.current,
              selected: bootSelected,
              lightPart: bootLightPart,
              joint: bootJoint,
              view: bootCameraView,
              mode: bootMode,
            };
            setDoc(bootScene);
            setSelected(bootSelected);
            setSelectedIds(bootSelected ? [bootSelected] : []);
            setJoint(bootJoint);
            setLightPart(bootLightPart);
            setView(bootCameraView);
            setMode(bootMode);
          }
        }

        await Promise.all([
          loadRooms(bootScene.items.flatMap(i => i.roomId ? [i.roomId] : [])),
          hydrateSceneImportedAssets(bootScene),
        ]);
        if (cancelled) return;
        const studio = new Studio(host.current!, {
          currentDocument: () => current.current,
          change: next => studioCallbacksRef.current.change(next),
          liveChange: live => studioCallbacksRef.current.liveChange(live),
          orbitChange: (orbit, settled) => studioCallbacksRef.current.orbitChange(orbit, settled),
          cameraChange: (pose, settled) => studioCallbacksRef.current.cameraChange(pose, settled),
          select: (id, j, additive, part) => studioCallbacksRef.current.select(id, j, additive, part),
          selectMany: ids => studioCallbacksRef.current.selectMany(ids),
          selectRoomObject: (roomId, objectId) => studioCallbacksRef.current.selectRoomObject(roomId, objectId),
          componentSelect: sel => studioCallbacksRef.current.componentSelect(sel),
          meshEdit: (itemId, mesh, sel, settled) =>
            studioCallbacksRef.current.meshEdit(itemId, mesh, sel, settled),
          loopCutClick: (itemId, edgeIdx, factor) =>
            studioCallbacksRef.current.loopCutClick(itemId, edgeIdx, factor),
          hoverTip: tip => viewportHoverEmitterRef.current?.(tip),
          fitSelect: setFitSelection,
          error: err => studioCallbacksRef.current.error(err),
        });
        engine.current = studio;
        (host.current as (HTMLDivElement & { __studio?: Studio }) | null)!.__studio = studio;
        studio.setPerfListener(snap => {
          const el = perfBadgeRef.current;
          if (!el) return;
          if (snap.idlePaused) {
            el.textContent = 'Idle · 0 fps';
            el.dataset.idle = 'true';
          } else {
            const fps = Math.max(
              1,
              Math.round(snap.fps > 0 ? snap.fps : snap.frameMs > 0 ? 1000 / snap.frameMs : 60),
            );
            el.textContent = `${fps} fps · ${snap.frameMs.toFixed(1)} ms`;
            el.dataset.idle = 'false';
          }
        });
        try {
          const s = liveSettings.current;
          studio.sync(bootScene);
          studio.setOrbitView(bootOrbit.position, bootOrbit.target);
          studio.setMode(bootMode);
          studio.setHelpers(s.showJoints, s.showHelpers);
          studio.setView(bootCameraView);
          studio.select(bootSelected, bootJoint, bootSelected ? [bootSelected] : [], null, bootLightPart);
          roomSyncSigRef.current = bootScene.items
            .filter(i => i.roomId)
            .map(i => `${i.id}:${studio.getRoomObjects(i.id).length}`)
            .join(',');
          setRoomTreeTick(t => t + 1);
          if (!saverRef.current?.isHydrated()) {
            saverRef.current?.markHydrated(
              {
                scene: bootScene,
                view: {
                  editorCamera: bootOrbit,
                  selectedId: bootSelected,
                  selectedJoint: bootJoint,
                  selectedLightPart: bootLightPart,
                  cameraView: bootCameraView,
                  transformMode: bootMode,
                },
              },
              restoredFromStorage,
            );
          }
          setLoading(false);
        } catch (error) {
          engine.current = null;
          studio.dispose();
          throw error;
        }
      })
      .catch(error => {
        if (cancelled) return;
        setLoading(false);
        setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
      engine.current?.dispose();
      engine.current = null;
    };
  }, [notify, report, retry]);

  useEffect(() => {
    if (!saverRef.current?.isHydrated() || isDraggingCameraRef.current || engine.current?.isDraggingTransform()) return;
    queueDraftPersistence(
      buildDraft(doc, {
        selectedId: selected,
        selectedJoint: joint,
        selectedLightPart: lightPart,
        cameraView: view,
        transformMode: mode,
      }),
    );
  }, [doc, selected, joint, lightPart, view, mode, buildDraft, queueDraftPersistence]);

  useEffect(() => {
    const flushNow = (commitActiveInput: boolean) => {
      const saver = saverRef.current;
      if (!saver?.isHydrated()) return;
      if (commitActiveInput && document.activeElement instanceof HTMLInputElement && document.activeElement.type === 'number') {
        document.activeElement.blur();
      }
      const liveScene = engine.current?.readLiveState() ?? current.current;
      const liveOrbit = engine.current?.getOrbitView() ?? orbitViewRef.current;
      orbitViewRef.current = liveOrbit;
      scheduleSaveWorkingScene(buildDraft(liveScene, { editorCamera: liveOrbit }), 0, {
        onStatus: handleAutosaveStatus,
      });
      void flushScheduledWorkingSceneSave();
    };
    const onPageHide = () => flushNow(true);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushNow(false);
    };
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onPageHide);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onPageHide);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [buildDraft, handleAutosaveStatus]);

  useEffect(() => {
    if (engine.current?.isDraggingTransform()) return;
    syncStudioScene(engine.current, doc);
    const sig = doc.items
      .filter(i => i.roomId)
      .map(i => `${i.id}:${engine.current?.getRoomObjects(i.id).length ?? 0}`)
      .join(',');
    if (sig !== roomSyncSigRef.current) {
      roomSyncSigRef.current = sig;
      setRoomTreeTick(t => t + 1);
    }
  }, [doc]);
  useEffect(() => {
    if (engine.current?.isDraggingTransform()) return;
    const objId = selectedRoomObject && selectedRoomObject.roomId === selected ? selectedRoomObject.objectId : null;
    engine.current?.select(selected, joint, selection, objId, lightPart, selectedOperandId);
  }, [selected, selectedIds, joint, selectedRoomObject, lightPart, selectedOperandId, doc]);
  useEffect(() => {
    engine.current?.setModelingState({
      mode: modelingMode,
      selection: componentSelection,
      xRayWireframe,
      coordSpace,
      loopCut: {
        enabled: activeCaddyOp === 'loopCut',
        cuts: caddyParams.cuts,
      },
    });
  }, [modelingMode, componentSelection, xRayWireframe, coordSpace, activeCaddyOp, caddyParams.cuts]);
  useEffect(() => {
    engine.current?.setView(view);
  }, [view]);
  useEffect(() => {
    engine.current?.setMode(mode);
  }, [mode]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('pose-n-composition:preferences');
      if (raw) {
        const p: unknown = JSON.parse(raw);
        if (
          !p ||
          typeof p !== 'object' ||
          !('joints' in p) ||
          typeof p.joints !== 'boolean' ||
          !('helpers' in p) ||
          typeof p.helpers !== 'boolean'
        )
          throw new Error('Stored preferences are malformed. Toggle viewport helpers to replace them.');
        setShowJoints(p.joints);
        setShowHelpers(p.helpers);
      }
    } catch (e) {
      report(new Error(`Preferences unavailable: ${e instanceof Error ? e.message : String(e)}`));
    }
    listSaved().then(setSaved).catch(report);
  }, [report]);

  useEffect(() => {
    engine.current?.setHelpers(showJoints, showHelpers);
  }, [showJoints, showHelpers]);

  const preference = (key: 'joints' | 'helpers', value: boolean) => {
    if (key === 'joints') setShowJoints(value);
    else setShowHelpers(value);
    try {
      localStorage.setItem(
        'pose-n-composition:preferences',
        JSON.stringify({ joints: key === 'joints' ? value : showJoints, helpers: key === 'helpers' ? value : showHelpers }),
      );
    } catch (e) {
      report(new Error(`Preferences not saved: ${e instanceof Error ? e.message : String(e)}`));
    }
  };

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), notice.error ? 14000 : 4800);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const cmd = resolveStudioShortcut(e, {
        activeElement: document.activeElement,
        hasOpenDropdown: hasOpenSelectDropdown(document),
        helpOpen: help,
        blocked: loading || Boolean(loadError),
        selectionCount: selectionRef.current.length,
      });
      if (cmd.action === 'none') return;
      if (cmd.preventDefault) e.preventDefault();

      switch (cmd.action) {
        case 'blur-text-input':
          cmd.target.blur();
          engine.current?.focusCanvas();
          break;
        case 'escape':
          setHelp(false);
          if (caddySessionRef.current) {
            cancelActiveCaddy();
          } else if (modelingMode !== 'object') {
            setModelingMode('object');
          } else if (selectedOperandId) {
            setSelectedOperandId(null);
          } else if (liveSettings.current.joint !== null) {
            setJoint(null);
          } else if (liveSettings.current.lightPart === 'target') {
            setLightPart('source');
          }
          break;
        case 'undo':
          undo(false);
          break;
        case 'redo':
          undo(true);
          break;
        case 'render-mode': {
          const next = clone(current.current);
          next.renderStyle = {
            ...DEFAULT_RENDER_STYLE,
            ...next.renderStyle,
            mode: RENDER_MODES[cmd.modeIndex]!,
          };
          commit(next);
          break;
        }
        case 'mode-translate':
          setJoint(null);
          setMode('translate');
          break;
        case 'mode-rotate':
          setJoint(null);
          setMode('rotate');
          break;
        case 'mode-scale':
          setJoint(null);
          setMode('scale');
          break;
        case 'frame-selection':
          engine.current?.focusSelected();
          break;
        case 'delete-selection':
          removeSelected();
          break;
        case 'toggle-camera':
          setView(v => !v);
          break;
        case 'open-help':
          setHelp(true);
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, removeSelected, help, loading, loadError, commit, cancelActiveCaddy, modelingMode, selectedOperandId]);

  useEffect(() => {
    if (!animPlaying || !activeClip) return;
    let raf = 0;
    let last = performance.now();
    let cursor = animFrame;
    const step = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      cursor += dt * activeClip.fps;
      if (cursor >= activeClip.frameCount) {
        if (activeClip.loop) cursor %= activeClip.frameCount;
        else {
          cursor = activeClip.frameCount - 1;
          const endFrame = Math.round(cursor);
          setAnimFrame(endFrame);
          previewCycleFrame(activeClip, endFrame, groundAnim);
          setAnimPlaying(false);
          return;
        }
      }
      const nextFrame = Math.floor(cursor);
      setAnimFrame(prev => (prev === nextFrame ? prev : nextFrame));
      previewCycleFrame(activeClip, nextFrame, groundAnim);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [animPlaying, activeClip, groundAnim, previewCycleFrame]);

  const chooseCycle = async (cycleId: string) => {
    setAnimPlaying(false);
    if (!cycleId) {
      setActiveCycleId('');
      if (animPreviewing) cancelAnimPreview();
      return;
    }
    const existing = animClips[cycleId];
    if (existing) {
      setActiveCycleId(cycleId);
      setAnimFrame(0);
      previewCycleFrame(existing, 0, groundAnim);
      return;
    }
    setAnimBusy(true);
    try {
      const clip = await loadBuiltinAnimationCycle(cycleId);
      setAnimClips(prev => ({ ...prev, [clip.id]: clip }));
      setActiveCycleId(clip.id);
      setAnimFrame(0);
      previewCycleFrame(clip, 0, groundAnim);
    } catch (e) {
      report(e);
    } finally {
      setAnimBusy(false);
    }
  };

  const importAnimFile = async (f: File) => {
    setAnimPlaying(false);
    setAnimBusy(true);
    try {
      if (f.size > MAX_ANIMATION_FILE_BYTES) {
        throw new Error(`Animation file exceeds the ${Math.round(MAX_ANIMATION_FILE_BYTES / (1024 * 1024))} MB limit.`);
      }
      const clips = await loadUserAnimationFile(f);
      const added: Record<string, AnimationCycleClip> = {};
      const ids: string[] = [];
      for (const c of clips) {
        const uniqueId = `user:${crypto.randomUUID()}`;
        const stored: AnimationCycleClip = { ...c, id: uniqueId };
        added[uniqueId] = stored;
        ids.push(uniqueId);
      }
      const firstId = ids[0]!;
      const firstClip = added[firstId]!;
      setAnimClips(prev => ({ ...prev, ...added }));
      setUserClipIds(prev => [...ids, ...prev]);
      setActiveCycleId(firstId);
      setAnimFrame(0);
      previewCycleFrame(firstClip, 0, groundAnim);
      notify(`Loaded "${firstClip.name}" (${firstClip.frameCount} frames · ${firstClip.rigFormat} rig). Scrub slider and click Use this pose.`);
    } catch (e) {
      report(e);
    } finally {
      setAnimBusy(false);
    }
  };

  const add = (kind: Item['kind'], modelId?: ModelId) => {
    if (doc.items.length >= 64) {
      report(new Error('Scene limit: 64 objects.'));
      return;
    }
    if (kind === 'light' && doc.items.filter(i => i.kind === 'light').length >= 8) {
      report(new Error('Scene limit: 8 lights.'));
      return;
    }
    const index = doc.items.filter(i => i.kind === kind).length;
    const added = createItem(kind, index, modelId ? DEFAULT_BODY_TYPE : newBodyType);
    if (modelId && isBody(kind)) {
      added.modelId = modelId;
      added.name = `${CHARACTERS[modelId].label} ${index + 1}`;
      added.color = defaultCharacterSkinColor(kind, modelId);
      added.outfitColor = defaultCharacterOutfitColor(kind, modelId);
      added.hairColor = defaultCharacterHairColor(modelId);
      added.hairStyle = defaultCharacterHairStyle(kind, modelId);
    }
    const next = clone(current.current);
    next.items.push(added);
    if (isBody(kind)) {
      applyChibiDefaultRenderStyle(next, added.bodyType);
    }
    select(added.id, null);
    setView(false);
    commit(next, { selectedId: added.id, selectedJoint: null, cameraView: false });
  };

  const applyPresetPose = (presetName: (typeof PRESETS)[number]) => {
    if (!item || !isBody(item.kind)) return;
    setAnimPlaying(false);
    setAnimPreviewing(false);
    const nextPose = resolvePresetPoseForItem(presetName, item);
    const groundedY = engine.current?.groundPoseY(item.id, nextPose);
    const nextPosition: Vec3 = [item.position[0], groundedY ?? item.position[1], item.position[2]];
    const next = clone(current.current);
    const dst = next.items.find(i => i.id === item.id);
    if (dst) {
      dst.pose = nextPose;
      dst.position = nextPosition;
      if (presetName === 'Neutral') delete dst.handPose;
    }
    setJoint(null);
    commit(next, { selectedJoint: null });
  };

  const setPresetRoom = async (id: RoomId | '__studio__') => {
    setRoomBusy(true);
    try {
      if (id !== '__studio__') await loadRooms([id]);
      const next = clone(current.current);
      next.items = next.items.filter(i => !i.roomId);
      let selectedId = next.items.find(i => i.id === selected)?.id ?? next.items[0]?.id ?? null;
      if (id !== '__studio__') {
        if (next.items.length >= 64) throw new Error('Scene limit: 64 objects.');
        const added: Item = { ...createItem('room'), roomId: id, name: ROOMS[id].label,
          position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true, cutaway: true };
        next.items.push(added);
        selectedId = added.id;
      }
      select(selectedId, null);
      commit(next, { selectedId, selectedJoint: null });
    } catch (error) {
      report(error);
    } finally {
      setRoomBusy(false);
    }
  };

  const loadPortable = async (data: Portable) => {
    engine.current?.cancelCloth();
    commitActiveCaddyIfOpen(true);
    setAnimPlaying(false);
    setAnimPreviewing(false);
    const valid = validatePortable(data);
    if (valid.type === 'scene') {
      await Promise.all([
        loadRooms(valid.items.flatMap(i => i.roomId ? [i.roomId] : [])),
        hydrateSceneImportedAssets(valid),
      ]);
      const nextSelected = valid.items[0]?.id ?? null;
      setSelected(nextSelected);
      setSelectedIds(nextSelected ? [nextSelected] : []);
      setSelectedOperandId(null);
      setFocusedModifierId(null);
      setModelingMode('object');
      setJoint(null);
      setLightPart('source');
      setSaveName(valid.name);
      commit(valid, { selectedId: nextSelected, selectedJoint: null, selectedLightPart: 'source' });
      notify('Scene loaded. Undo returns to the previous scene.');
    } else {
      if (!item || !isBody(item.kind)) throw new Error('Select a figure before loading a pose.');
      const applied = applyPose(item, valid);
      editItem({ pose: applied.pose, handPose: applied.handPose });
      notify(`Applied "${valid.name}" to ${item.name}. Root transform preserved.`);
    }
  };

  const save = async (type: 'scene' | 'pose') => {
    setBusy(true);
    try {
      await flushScheduledWorkingSceneSave();
      const data = type === 'scene' ? { ...doc, name: saveName.trim() } : poseFile(item!, saveName.trim());
      await saveLocal(data);
      setSaved(await listSaved());
      notify(`${type === 'scene' ? 'Scene' : 'Pose'} saved on this browser.`);
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  };

  const exportSelectedPoseJson = () => {
    try {
      if (!item || !isBody(item.kind)) throw new Error('Select a figure before exporting a pose.');
      const poseTitle = `${(item.name || item.kind).trim()}-pose`;
      download(validatePortable(poseFile(item, poseTitle)));
      notify(`Exported pose JSON for ${item.name}.`);
    } catch (e) {
      report(e);
    }
  };

  const importSelectedPoseJson = async (f: File) => {
    try {
      if (!item || !isBody(item.kind)) throw new Error('Select a figure before importing a pose JSON file.');
      if (f.size > MAX_FILE_BYTES) throw new Error('File exceeds the 1 MB import limit.');
      const parsed = parsePoseFile(await f.text());
      setAnimPlaying(false);
      setAnimPreviewing(false);
      const applied = applyPose(item, parsed);
      editItem({ pose: applied.pose, handPose: applied.handPose });
      notify(`Imported pose "${parsed.name}" onto ${item.name}.`);
    } catch (err) {
      report(err);
    }
  };

  const exportJson = async (type: 'scene' | 'pose') => {
    try {
      await flushScheduledWorkingSceneSave();
      if (type === 'scene') {
        const embedded = await embedSceneImportedAssetsForExport({
          ...doc,
          name: saveName.trim() || doc.name,
        });
        download(validatePortable(embedded));
      } else {
        download(validatePortable(poseFile(item!, saveName.trim() || 'My pose')));
      }
      notify(`${label(type)} JSON downloaded.`);
    } catch (e) {
      report(e);
    }
  };

  const png = async () => {
    setBusy(true);
    try {
      if (!engine.current) throw new Error('3D viewport is unavailable.');
      downloadBlob(await engine.current.exportPng(), 'composition.png');
      notify('1600 px camera composition exported as PNG.');
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  };

  const propOptions = useMemo<SelectOption[]>(
    () =>
      PROP_KINDS.map(k => ({
        value: k,
        label: label(k),
        meta: PROP_META[k],
        icon: Icons.prop,
      })),
    [],
  );

  const hairOptions = useMemo<SelectOption[]>(
    () =>
      HAIR_STYLES.map(id => ({
        value: id,
        label: HAIR_STYLE_LABELS[id],
      })),
    [],
  );

  const jointOptions = useMemo<SelectOption[]>(
    () => [
      { value: '__root__', label: 'Root · whole figure', group: 'Transform target', meta: 'Move / Rotate' },
      ...JOINTS.map(j => ({
        value: j,
        label: label(j),
        group: JOINT_GROUPS[j],
      })),
    ],
    [],
  );

  const animOptions = useMemo<SelectOption[]>(() => {
    const list: SelectOption[] = [];
    for (const id of userClipIds) {
      const c = animClips[id];
      if (c) {
        list.push({
          value: id,
          label: c.name,
          group: 'Imported Mixamo / Custom',
          meta: `${c.frameCount}f`,
          icon: Icons.motion,
        });
      }
    }
    for (const cat of ANIM_CATEGORIES) {
      for (const c of BUILTIN_ANIMATION_CYCLES) {
        if (c.category === cat) {
          list.push({
            value: c.id,
            label: c.name,
            group: cat,
            meta: 'CC0',
            icon: Icons.motion,
          });
        }
      }
    }
    return list;
  }, [userClipIds, animClips]);

  const activePreset = useMemo(() => {
    if (!item || !isBody(item.kind) || !item.pose || animPreviewing) return null;
    for (const p of PRESETS) {
      if (posesMatch(item.pose, resolvePresetPoseForItem(p, item))) return p;
    }
    return null;
  }, [item, animPreviewing, resolvePresetPoseForItem]);

  const activeLightPart: LightPart = useMemo(
    () => resolveLightPartForItem(item, lightPart),
    [item, lightPart],
  );

  const resolveLinkedObjectLabel = useCallback(
    (refId: string | undefined): string | null => {
      void roomTreeTick;
      const parsed = parseTargetObjectRef(refId);
      if (!parsed) return null;
      if (parsed.kind === 'item') {
        return doc.items.find(i => i.id === parsed.itemId)?.name ?? null;
      }
      const room = doc.items.find(i => i.id === parsed.roomId && Boolean(i.roomId));
      if (!room || room.roomObjects?.[parsed.objectId]?.deleted) return null;
      const roomObj = engine.current?.getRoomObjects(room.id).find(o => o.id === parsed.objectId);
      return roomObj?.name ?? `${room.name} object`;
    },
    [doc.items, roomTreeTick],
  );

  const lightTargetLinkOptions = useMemo<SelectOption[]>(() => {
    void roomTreeTick;
    if (!item || !isTargetedLight(item)) return [];
    const opts: SelectOption[] = [{ value: '__none__', label: 'None (free target)' }];
    for (const candidate of doc.items) {
      if (candidate.id === item.id) continue;
      if (isBody(candidate.kind)) {
        opts.push({
          value: candidate.id,
          label: candidate.name,
          group: 'Characters',
          icon: Icons.figure,
        });
      } else if (candidate.kind === 'light') {
        opts.push({
          value: candidate.id,
          label: candidate.name,
          group: 'Lights',
          meta: LIGHT_TYPE_LABELS[candidate.lightType ?? LIGHT_DEFAULTS.lightType],
          icon: Icons.light,
        });
      } else if (isModelingKind(candidate.kind)) {
        opts.push({
          value: candidate.id,
          label: candidate.name,
          group: '3D Objects',
          meta: candidate.kind === 'primitive' && candidate.primitive
            ? PRIMITIVE_LABELS[candidate.primitive.kind]
            : label(candidate.kind),
          icon: C4DIcons.primCube,
        });
      } else if (!candidate.roomId) {
        opts.push({
          value: candidate.id,
          label: candidate.name,
          group: 'Props',
          meta: label(candidate.kind),
          icon: Icons.prop,
        });
      }
    }
    for (const room of doc.items.filter(i => Boolean(i.roomId))) {
      opts.push({
        value: room.id,
        label: `${room.name} (origin)`,
        group: 'Room',
        icon: Icons.room,
      });
      const roomObjs = (engine.current?.getRoomObjects(room.id) ?? []).filter(
        o => o.id !== 'arch:shell' && !room.roomObjects?.[o.id]?.deleted,
      );
      for (const obj of roomObjs) {
        opts.push({
          value: formatRoomObjectTargetRef(room.id, obj.id),
          label: obj.name,
          group: `${room.name} objects`,
          meta: obj.category,
          icon: obj.category === 'lighting' ? Icons.light : Icons.prop,
        });
      }
    }
    return opts;
  }, [item, doc.items, roomTreeTick]);

  const primitiveIconForKind = (kind: PrimitiveKind): React.ReactNode => {
    switch (kind) {
      case 'cube': return C4DIcons.primCube;
      case 'sphere': return C4DIcons.primSphere;
      case 'cylinder': return C4DIcons.primCylinder;
      case 'cone': return C4DIcons.primCone;
      case 'pyramid': return C4DIcons.primPyramid;
      case 'torus': return C4DIcons.primTorus;
      case 'capsule': return C4DIcons.primCapsule;
      case 'tube': return C4DIcons.primTube;
      case 'plane': return C4DIcons.primPlane;
      case 'disc': return C4DIcons.primDisc;
      case 'platonic': return C4DIcons.primPlatonic;
    }
  };

  const modifierIconForType = (type: ModifierType): React.ReactNode => {
    switch (type) {
      case 'bevel': return C4DIcons.modBevel;
      case 'subdivision': return C4DIcons.modSubdivision;
      case 'mirror': return C4DIcons.modMirror;
      case 'solidify': return C4DIcons.modSolidify;
      case 'bend': return C4DIcons.modBend;
      case 'twist': return C4DIcons.modTwist;
      case 'taper': return C4DIcons.modTaper;
      case 'array': return C4DIcons.modArray;
    }
  };

  const booleIconForOp = (op: BooleanOpType): React.ReactNode => {
    switch (op) {
      case 'union': return C4DIcons.booleUnion;
      case 'subtract': return C4DIcons.booleSubtract;
      case 'intersect': return C4DIcons.booleIntersect;
    }
  };

  const itemTreeIcon = (i: Item): React.ReactNode => {
    if (isBody(i.kind)) return Icons.figure;
    if (i.roomId) return Icons.room;
    if (i.kind === 'light') {
      const lt = i.lightType ?? LIGHT_DEFAULTS.lightType;
      return lt === 'directional' ? Icons.lightParallel : lt === 'point' ? Icons.lightOmni : Icons.lightSpot;
    }
    if (i.kind === 'primitive' && i.primitive) {
      const hasFillet = 'fillet' in i.primitive.params && Boolean(i.primitive.params.fillet);
      return getPrimitiveIcon(i.primitive.kind, hasFillet);
    }
    if (i.kind === 'mesh') return C4DIcons.polygonMode;
    if (i.kind === 'boole') return getBooleanIcon(i.booleanOp ?? 'subtract');
    if (i.kind === 'imported') return C4DIcons.import3d;
    return Icons.prop;
  };

  const addLightOfType = (lt: LightType) => {
    if (doc.items.length >= 64) {
      report(new Error('Scene limit: 64 objects.'));
      return;
    }
    if (doc.items.filter(i => i.kind === 'light').length >= 8) {
      report(new Error('Scene limit: 8 lights.'));
      return;
    }
    const index = doc.items.filter(i => i.kind === 'light').length;
    const base = createItem('light', index);
    const patched: Item = {
      ...base,
      ...switchLightType(base, lt),
      name: `${LIGHT_TYPE_LABELS[lt]} ${index + 1}`,
    };
    const next = clone(current.current);
    next.items.push(patched);
    select(patched.id, null);
    setView(false);
    commit(next, { selectedId: patched.id, selectedJoint: null, cameraView: false });
  };

  const isMeshActive = activeTarget?.kind === 'mesh' && Boolean(activeTarget.editableMesh);
  const canEditTargetAsMesh = Boolean(activeTarget && (activeTarget.kind === 'mesh' || canMakeEditable(activeTarget)));
  const hasMaterialTab = Boolean(
    activeTarget &&
    !activeTarget.roomId &&
    activeTarget.kind !== 'light',
  );
  const hasModifiersTab = Boolean(activeTarget && canAttachModifiers(activeTarget));
  const hasPoseTab = Boolean(item && !selectedOperandId && isBody(item.kind));

  const caddyFields = useMemo<C4DCaddyField[]>(() => {
    if (!activeCaddyOp) return [];
    switch (activeCaddyOp) {
      case 'extrude':
        return [
          {
            key: 'offset',
            label: 'Offset',
            kind: 'number',
            value: caddyParams.offset,
            min: -5,
            max: 5,
            step: 0.02,
            unit: 'm',
          },
          {
            key: 'groupNormals',
            label: 'Group Normals',
            kind: 'boolean',
            value: caddyParams.groupNormals,
          },
        ];
      case 'inset':
        return [
          {
            key: 'inset',
            label: 'Inset',
            kind: 'number',
            value: caddyParams.inset,
            min: 0.005,
            max: 2,
            step: 0.01,
            unit: 'm',
          },
          {
            key: 'individual',
            label: 'Individual Polys',
            kind: 'boolean',
            value: caddyParams.individual,
          },
        ];
      case 'bevel':
        return [
          {
            key: 'width',
            label: modelingMode === 'polygon' ? 'Extrude Height' : 'Bevel Offset',
            kind: 'number',
            value: caddyParams.width,
            min: 0.002,
            max: 2,
            step: 0.01,
            unit: 'm',
          },
          ...(modelingMode === 'polygon'
            ? [
                {
                  key: 'inset',
                  label: 'Inner Inset',
                  kind: 'number' as const,
                  value: caddyParams.inset,
                  min: 0.002,
                  max: 1,
                  step: 0.01,
                  unit: 'm',
                },
              ]
            : modelingMode === 'edge'
              ? [
                  {
                    key: 'segments',
                    label: 'Fillet Subdiv',
                    kind: 'integer' as const,
                    value: caddyParams.segments,
                    min: 1,
                    max: 8,
                  },
                ]
              : []),
        ];
      case 'loopCut':
        return [
          {
            key: 'slide',
            label: 'Slide',
            kind: 'number',
            value: Math.round(caddyParams.slide * 100),
            min: 5,
            max: 95,
            step: 1,
            precision: 0,
            unit: '%',
          },
          {
            key: 'cuts',
            label: 'Cuts',
            kind: 'integer',
            value: caddyParams.cuts,
            min: 1,
            max: 8,
          },
        ];
      case 'weld':
        return [
          {
            key: 'threshold',
            label: 'Distance Threshold',
            kind: 'number',
            value: caddyParams.threshold,
            min: 0.001,
            max: 1,
            step: 0.005,
            precision: 3,
            unit: 'm',
          },
          {
            key: 'center',
            label: 'Collapse to Center',
            kind: 'boolean',
            value: caddyParams.weldMode === 'center',
          },
        ];
    }
  }, [activeCaddyOp, caddyParams, modelingMode]);

  const handleCaddyFieldChange = useCallback(
    (key: string, val: number | boolean | string) => {
      switch (key) {
        case 'offset':
          updateCaddyParam('offset', Number(val));
          break;
        case 'groupNormals':
          updateCaddyParam('groupNormals', Boolean(val));
          break;
        case 'inset':
          updateCaddyParam('inset', Number(val));
          break;
        case 'individual':
          updateCaddyParam('individual', Boolean(val));
          break;
        case 'width':
          updateCaddyParam('width', Number(val));
          break;
        case 'segments':
          updateCaddyParam('segments', Math.max(1, Math.round(Number(val))));
          break;
        case 'slide':
          updateCaddyParam('slide', Math.min(0.95, Math.max(0.05, Number(val) / 100)));
          break;
        case 'cuts':
          updateCaddyParam('cuts', Math.max(1, Math.round(Number(val))));
          break;
        case 'threshold':
          updateCaddyParam('threshold', Number(val));
          break;
        case 'center':
          updateCaddyParam('weldMode', val ? 'center' : 'threshold');
          break;
      }
    },
    [updateCaddyParam],
  );

  void historyTick;

  return (
    <div className="app" onDragStart={e => e.preventDefault()}>
      {/* ================================================================= */}
      {/* TOP CINEMA 4D COMPACT ICON COMMAND BAR                            */}
      {/* ================================================================= */}
      <header className="topbar c4d-topbar" role="toolbar" aria-label="Studio command palette">
        <a className="c4d-brand" href="./" aria-label="Pose and Composition home">
          <span className="brand-mark">P/C</span>
          <span className="c4d-brand-title">Pose &amp; Composition</span>
        </a>

        <AutosaveStatusBadge status={autosaveStatus} />

        <div className="c4d-top-sep" aria-hidden="true" />

        {/* Scene / History / Import / Export */}
        <div className="c4d-top-group" role="group" aria-label="Scene and history">
          <C4DIconButton
            icon={C4DIcons.newScene}
            label="New Scene"
            disabled={loading || loadError !== null}
            onClick={startNewScene}
          />
          <C4DIconButton
            icon={C4DIcons.undo}
            label="Undo"
            shortcut="Ctrl Z"
            disabled={!past.current.length}
            onClick={() => undo(false)}
          />
          <C4DIconButton
            icon={C4DIcons.redo}
            label="Redo"
            shortcut="Ctrl Shift Z"
            disabled={!future.current.length}
            onClick={() => undo(true)}
          />
          <C4DIconButton
            icon={C4DIcons.import3d}
            label="Import 3D Model (.glb, .gltf, .obj, .fbx, .stl, .ply, .dae, .3ds)"
            disabled={busy || loading || loadError !== null}
            onClick={() => import3dFileRef.current?.click()}
          />
          <C4DIconButton
            icon={C4DIcons.library}
            label="Scene & Pose Library"
            active={tab === 'library'}
            onClick={() => setTab('library')}
          />
          <C4DFlyoutButton
            icon={C4DIcons.exportImg}
            label="Export PNG (1600px)"
            description="Click to export 1600px PNG · Hold or right-click for JSON export/import"
            columns={1}
            disabled={busy || loading || loadError !== null}
            onPrimaryClick={() => { void png(); }}
            onSelectItem={id => {
              if (id === 'png') void png();
              else if (id === 'scene-json') void exportJson('scene');
              else if (id === 'import-json') file.current?.click();
            }}
            items={[
              {
                id: 'png',
                label: 'Export Camera PNG (1600px)',
                icon: C4DIcons.exportImg,
              },
              {
                id: 'scene-json',
                label: 'Download Scene JSON',
                icon: Icons.download,
              },
              {
                id: 'import-json',
                label: 'Import Scene / Pose JSON…',
                icon: Icons.upload,
              },
            ]}
          />
        </div>

        <div className="c4d-top-sep" aria-hidden="true" />

        {/* Parametric Primitives, Make Editable, Booleans, Modifiers */}
        <div className="c4d-top-group" role="group" aria-label="Primitives and generators">
          <C4DFlyoutButton
            icon={primitiveIconForKind(lastPrimKind)}
            label={`Add ${PRIMITIVE_LABELS[lastPrimKind]}`}
            description="Click to spawn primitive · Hold or right-click for all 11 Fillet/Chamfer primitives"
            columns={2}
            activeItemId={lastPrimKind}
            disabled={loading || loadError !== null}
            onPrimaryClick={() => spawnPrimitive(lastPrimKind)}
            onSelectItem={pk => spawnPrimitive(pk)}
            items={PRIMITIVE_KINDS.map(pk => ({
              id: pk,
              label: PRIMITIVE_LABELS[pk],
              icon: primitiveIconForKind(pk),
            }))}
          />
          <C4DIconButton
            icon={C4DIcons.makeEditable}
            label="Make Editable (Bake to Quad Polygon Mesh)"
            disabled={!activeTarget || !canMakeEditable(activeTarget)}
            onClick={() => makeItemEditable()}
          />
          <C4DFlyoutButton
            icon={booleIconForOp(lastBooleOp)}
            label={`Boole (${BOOLEAN_OP_LABELS[lastBooleOp]})`}
            description="Select 2 meshes & click for live CSG Boole · Hold or right-click for Union / Subtract / Intersect"
            columns={1}
            activeItemId={lastBooleOp}
            disabled={loading || loadError !== null}
            onPrimaryClick={() => createOrWrapBoole(lastBooleOp)}
            onSelectItem={op => createOrWrapBoole(op)}
            items={BOOLEAN_OP_TYPES.map(op => ({
              id: op,
              label: BOOLEAN_OP_LABELS[op],
              icon: booleIconForOp(op),
            }))}
          />
          <C4DFlyoutButton
            icon={modifierIconForType(lastModType)}
            label={`Attach ${MODIFIER_LABELS[lastModType]}`}
            description="Attach non-destructive modifier to selected object · Hold or right-click for all 8 modifiers"
            columns={2}
            activeItemId={lastModType}
            disabled={!activeTarget || !canAttachModifiers(activeTarget)}
            onPrimaryClick={() => attachModifierToActive(lastModType)}
            onSelectItem={mt => attachModifierToActive(mt)}
            items={MODIFIER_TYPES.map(mt => ({
              id: mt,
              label: MODIFIER_LABELS[mt],
              icon: modifierIconForType(mt),
            }))}
          />
        </div>

        <div className="c4d-top-sep" aria-hidden="true" />

        {/* Stage Assets: Characters, Props, Rooms, Lights */}
        <div className="c4d-top-group" role="group" aria-label="Characters, props, rooms, and lights">
          <C4DFlyoutButton
            icon={Icons.figure}
            label="Add Female Figure"
            description="Click to add Female Figure · Hold or right-click for all 15 rigged characters"
            columns={2}
            disabled={loading || loadError !== null}
            onPrimaryClick={() => add('female')}
            onSelectItem={id => {
              if (id === 'mannequin_f') add('female');
              else if (id === 'mannequin_m') add('male');
              else if (isModelId(id)) add(CHARACTERS[id].body, id);
            }}
            items={[
              {
                id: 'mannequin_f',
                label: 'Female Mannequin',
                icon: Icons.figure,
              },
              {
                id: 'mannequin_m',
                label: 'Male Mannequin',
                icon: Icons.figure,
              },
              ...MODEL_IDS.filter(id => CHARACTERS[id].source).map(id => ({
                id,
                label: CHARACTERS[id].label,
                icon: Icons.figure,
              })),
            ]}
          />
          <C4DFlyoutButton
            icon={Icons.prop}
            label="Add Studio Chair"
            description="Click to add Chair · Hold or right-click for all studio props"
            columns={2}
            disabled={loading || loadError !== null}
            onPrimaryClick={() => add('chair')}
            onSelectItem={pk => add(pk)}
            items={PROP_KINDS.map(pk => ({
              id: pk,
              label: label(pk),
              icon: Icons.prop,
            }))}
          />
          <C4DFlyoutButton
            icon={Icons.room}
            label="Preset Interior Rooms"
            description="Click to toggle preset room · Hold or right-click for all 11 interior rooms"
            columns={2}
            activeItemId={doc.items.find(i => i.roomId)?.roomId ?? '__studio__'}
            disabled={roomBusy || loading || loadError !== null}
            onPrimaryClick={() => {
              const cur = doc.items.find(i => i.roomId)?.roomId;
              void setPresetRoom(cur ? '__studio__' : ROOM_IDS[0]!);
            }}
            onSelectItem={rid => {
              void setPresetRoom(rid as RoomId | '__studio__');
            }}
            items={[
              {
                id: '__studio__',
                label: 'Studio Floor (No Room)',
                icon: C4DIcons.grid,
              },
              ...ROOM_IDS.map(rid => ({
                id: rid,
                label: ROOMS[rid].label,
                icon: Icons.room,
              })),
            ]}
          />
          <C4DFlyoutButton
            icon={Icons.lightSpot}
            label="Add Spotlight"
            description="Click to add Spotlight · Hold or right-click for Spotlight, Parallel, or Omni"
            columns={1}
            disabled={loading || loadError !== null}
            onPrimaryClick={() => addLightOfType('spot')}
            onSelectItem={lt => addLightOfType(lt as LightType)}
            items={[
              {
                id: 'spot',
                label: 'Spotlight (Cone + Target)',
                icon: Icons.lightSpot,
              },
              {
                id: 'directional',
                label: 'Parallel / Sun Light',
                icon: Icons.lightParallel,
              },
              {
                id: 'point',
                label: 'Omni / Point Light',
                icon: Icons.lightOmni,
              },
            ]}
          />
        </div>

        <div className="c4d-top-spacer" />

        {/* Viewport / Render / Theme / Help */}
        <div className="c4d-top-group" role="group" aria-label="Viewport and shading">
          <C4DIconButton
            icon={C4DIcons.camera}
            label={view ? 'Exit Camera View (Return to Editor)' : 'Composition Camera View'}
            shortcut="C"
            active={view}
            onClick={() => setView(v => !v)}
          />
          <C4DFlyoutButton
            icon={C4DIcons.shading}
            label={`Shading: ${label(renderStyle.mode)}`}
            description="Click for Render & Camera settings · Hold or right-click to switch shading mode (1-5)"
            columns={1}
            activeItemId={renderStyle.mode}
            onPrimaryClick={() => setTab('camera')}
            onSelectItem={rm => editRenderStyle({ mode: rm })}
            items={RENDER_MODES.map((rm, idx) => ({
              id: rm,
              label: label(rm),
              shortcut: String(idx + 1),
              icon: C4DIcons.shading,
            }))}
          />
          <C4DFlyoutButton
            icon={C4DIcons.renderQuality}
            label={`Render Quality: ${RENDER_QUALITY_LABELS[renderQuality]}`}
            description="Click for Render, GI & Shadow settings · Hold or right-click for Performance / Balanced / Ultra"
            columns={1}
            activeItemId={renderQuality}
            onPrimaryClick={() => setTab('camera')}
            onSelectItem={rq => editRenderSettings({ renderQuality: rq as RenderQualityMode })}
            items={RENDER_QUALITY_MODES.map(rq => ({
              id: rq,
              label: RENDER_QUALITY_LABELS[rq],
              icon: C4DIcons.renderQuality,
            }))}
          />
          <C4DIconButton
            icon={C4DIcons.globalIllumination}
            label="Global Illumination (Real-Time Bounce)"
            description="Toggle indirect surface color bleeding & multi-bounce studio GI"
            active={giEnabled}
            onClick={() => editRenderSettings({ giEnabled: !giEnabled })}
          />
          <C4DIconButton
            icon={C4DIcons.sceneLightsOnly}
            label="Scene Lights Only"
            description="Disable studio ambient & fill light — lit strictly by scene lights"
            active={sceneLightsOnly}
            onClick={() => setSceneLightsOnly(!sceneLightsOnly)}
          />
          <C4DIconButton
            icon={C4DIcons.joints}
            label="Show Rig Joint Markers"
            active={showJoints}
            onClick={() => preference('joints', !showJoints)}
          />
          <C4DIconButton
            icon={C4DIcons.grid}
            label="Show Ground Grid & Light Helpers"
            active={showHelpers}
            onClick={() => preference('helpers', !showHelpers)}
          />
          <div className="c4d-top-sep" aria-hidden="true" />
          <C4DIconButton
            icon={theme === 'dark' ? Icons.sun : Icons.moon}
            label={theme === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
            onClick={toggleTheme}
          />
          <C4DIconButton
            icon={C4DIcons.help}
            label="Controls & Workflow Help"
            shortcut="?"
            active={help}
            onClick={() => setHelp(true)}
          />
        </div>
      </header>

      <input
        ref={import3dFileRef}
        className="sr-only"
        aria-label="Import 3D model files"
        type="file"
        multiple
        accept={IMPORT_FILE_ACCEPT}
        onChange={async e => {
          const files = e.target.files;
          if (files && files.length > 0) {
            await handleImport3DFiles(Array.from(files));
          }
          e.target.value = '';
        }}
      />

      {/* ================================================================= */}
      {/* C4D 3-COLUMN WORKSPACE: LEFT MODE DOCK | VIEWPORT | RIGHT SPLIT   */}
      {/* ================================================================= */}
      <div className="workspace c4d-workspace" inert={loading || loadError !== null}>
        {/* LEFT VERTICAL C4D COMPONENT MODE & MODELING TOOL DOCK */}
        <aside className="c4d-left-dock" role="toolbar" aria-label="Component modes and modeling tools">
          <C4DIconButton
            icon={C4DIcons.objectMode}
            label="Model / Object Mode"
            tooltipPlacement="right"
            active={modelingMode === 'object'}
            onClick={() => switchModelingMode('object')}
          />
          <C4DIconButton
            icon={C4DIcons.pointMode}
            label="Point Mode (Vertices)"
            tooltipPlacement="right"
            active={modelingMode === 'point'}
            disabled={!canEditTargetAsMesh}
            onClick={() => switchModelingMode('point')}
          />
          <C4DIconButton
            icon={C4DIcons.edgeMode}
            label="Edge Mode"
            tooltipPlacement="right"
            active={modelingMode === 'edge'}
            disabled={!canEditTargetAsMesh}
            onClick={() => switchModelingMode('edge')}
          />
          <C4DIconButton
            icon={C4DIcons.polygonMode}
            label="Polygon Mode (Faces)"
            tooltipPlacement="right"
            active={modelingMode === 'polygon'}
            disabled={!canEditTargetAsMesh}
            onClick={() => switchModelingMode('polygon')}
          />
          <C4DIconButton
            icon={C4DIcons.wireframeOverlay}
            label="X-Ray / Quad Wireframe Overlay"
            tooltipPlacement="right"
            active={xRayWireframe}
            onClick={() => setXRayWireframe(x => !x)}
          />

          <div className="c4d-left-sep" aria-hidden="true" />

          <C4DIconButton
            icon={C4DIcons.moveTool}
            label="Move Tool"
            shortcut="W"
            tooltipPlacement="right"
            active={mode === 'translate'}
            disabled={view}
            onClick={() => {
              setJoint(null);
              setMode('translate');
            }}
          />
          <C4DIconButton
            icon={C4DIcons.rotateTool}
            label="Rotate Tool"
            description="Rotate selected object or component (hold Shift to snap 15°)"
            shortcut="E"
            tooltipPlacement="right"
            active={mode === 'rotate'}
            disabled={view || (selection.length === 1 && item?.kind === 'light')}
            onClick={() => {
              setJoint(null);
              setMode('rotate');
            }}
          />
          <C4DIconButton
            icon={C4DIcons.scaleTool}
            label="Scale Tool"
            shortcut="R"
            tooltipPlacement="right"
            active={mode === 'scale'}
            disabled={view || selection.length > 1 || (selection.length === 1 && item?.kind === 'light')}
            onClick={() => {
              setJoint(null);
              setMode('scale');
            }}
          />
          <C4DIconButton
            icon={coordSpace === 'world' ? C4DIcons.worldSpace : C4DIcons.localSpace}
            label={`Coordinate Space: ${coordSpace === 'world' ? 'World' : 'Local / Normal'} (Click to Switch)`}
            tooltipPlacement="right"
            active={coordSpace === 'local'}
            onClick={() => setCoordSpace(s => (s === 'world' ? 'local' : 'world'))}
          />
          <C4DIconButton
            icon={C4DIcons.frameSelection}
            label="Frame Selected"
            shortcut="F"
            tooltipPlacement="right"
            onClick={() => engine.current?.focusSelected()}
          />
          <C4DIconButton
            icon={C4DIcons.snapFloor}
            label="Drop / Snap to Studio Floor"
            tooltipPlacement="right"
            disabled={!activeTarget}
            onClick={snapSelectedToFloor}
          />

          <div className="c4d-left-sep" aria-hidden="true" />

          {/* Polygon / Edge / Point Modeling Tools */}
          <C4DIconButton
            icon={C4DIcons.toolExtrude}
            label="Extrude Polygons"
            tooltipPlacement="right"
            active={activeCaddyOp === 'extrude'}
            disabled={!isMeshActive}
            onClick={() => startCaddyOp('extrude')}
          />
          <C4DIconButton
            icon={C4DIcons.toolInset}
            label="Inset / Extrude Inner"
            tooltipPlacement="right"
            active={activeCaddyOp === 'inset'}
            disabled={!isMeshActive}
            onClick={() => startCaddyOp('inset')}
          />
          <C4DIconButton
            icon={C4DIcons.toolBevel}
            label="Bevel / Chamfer / Fillet"
            tooltipPlacement="right"
            active={activeCaddyOp === 'bevel'}
            disabled={!isMeshActive}
            onClick={() => startCaddyOp('bevel')}
          />
          <C4DIconButton
            icon={C4DIcons.toolLoopCut}
            label="Loop / Path Cut"
            tooltipPlacement="right"
            active={activeCaddyOp === 'loopCut'}
            disabled={!isMeshActive}
            onClick={() => startCaddyOp('loopCut')}
          />
          <C4DIconButton
            icon={C4DIcons.toolBridge}
            label="Bridge Faces / Edges"
            tooltipPlacement="right"
            disabled={!isMeshActive}
            onClick={() => runDirectMeshTool('bridge')}
          />
          <C4DIconButton
            icon={C4DIcons.toolWeld}
            label="Weld / Collapse Points"
            tooltipPlacement="right"
            active={activeCaddyOp === 'weld'}
            disabled={!isMeshActive}
            onClick={() => startCaddyOp('weld')}
          />
          <C4DIconButton
            icon={C4DIcons.toolConnect}
            label="Connect Points / Collapse Edges"
            tooltipPlacement="right"
            disabled={!isMeshActive}
            onClick={() => runDirectMeshTool('connect')}
          />
          <C4DIconButton
            icon={C4DIcons.toolSubdivide}
            label="Subdivide Polygons"
            tooltipPlacement="right"
            disabled={!isMeshActive}
            onClick={() => runDirectMeshTool('subdivide')}
          />
          <C4DIconButton
            icon={C4DIcons.toolDissolve}
            label="Dissolve Edges / Faces"
            tooltipPlacement="right"
            disabled={!isMeshActive}
            onClick={() => runDirectMeshTool('dissolve')}
          />
          <C4DIconButton
            icon={C4DIcons.toolFlipNormals}
            label="Reverse / Flip Normals"
            tooltipPlacement="right"
            disabled={!isMeshActive}
            onClick={() => runDirectMeshTool('flipNormals')}
          />
          <C4DIconButton
            icon={C4DIcons.toolCloseHole}
            label="Close Polygon Holes"
            tooltipPlacement="right"
            disabled={!isMeshActive}
            onClick={() => runDirectMeshTool('closeHoles')}
          />
          <C4DIconButton
            icon={C4DIcons.toolEdgeLoop}
            label="Select Edge Loop"
            tooltipPlacement="right"
            disabled={!isMeshActive}
            onClick={() => runDirectMeshTool('edgeLoop')}
          />
          <C4DIconButton
            icon={C4DIcons.toolEdgeRing}
            label="Select Edge Ring"
            tooltipPlacement="right"
            disabled={!isMeshActive}
            onClick={() => runDirectMeshTool('edgeRing')}
          />
          <C4DIconButton
            icon={C4DIcons.toolGrowSelection}
            label="Grow Selection"
            tooltipPlacement="right"
            disabled={!isMeshActive}
            onClick={() => runDirectMeshTool('growSelection')}
          />
          <C4DIconButton
            icon={C4DIcons.toolShrinkSelection}
            label="Shrink Selection"
            tooltipPlacement="right"
            disabled={!isMeshActive}
            onClick={() => runDirectMeshTool('shrinkSelection')}
          />
        </aside>

        {/* CENTRAL 3D VIEWPORT */}
        <main className="viewport-column">
          <div
            className={`viewport ${view ? 'camera-view' : ''} ${renderStyle.mode === 'outline' && renderStyle.outlinePaper === 'transparent' ? 'transparent-paper' : ''}`}
            onPointerDownCapture={e => {
              if (e.target === e.currentTarget || e.target === host.current) {
                e.preventDefault();
                engine.current?.focusCanvas();
              }
            }}
            onDragOver={e => {
              if (e.dataTransfer.types.includes('Files')) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                if (!dragOver3d) setDragOver3d(true);
              }
            }}
            onDragLeave={e => {
              if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node | null)) {
                setDragOver3d(false);
              }
            }}
            onDrop={e => {
              e.preventDefault();
              setDragOver3d(false);
              if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                void handleImport3DFiles(Array.from(e.dataTransfer.files));
              }
            }}
          >
            <div ref={host} className="canvas-host" />

            {dragOver3d && (
              <div className="c4d-drop-overlay" aria-hidden="true">
                <div className="c4d-drop-card">
                  <strong>Drop 3D File to Import</strong>
                  <span>Supports .glb · .gltf · .obj (+ .mtl) · .fbx · .stl · .ply · .dae · .3ds</span>
                </div>
              </div>
            )}

            <div className="viewport-caption">
              <span className="view-pill">
                {view
                  ? `COMPOSITION · ${doc.camera.focalLength} MM · ${doc.camera.aspect}${doc.camera.dof ? ' · DOF' : ''}`
                  : modelingMode !== 'object'
                    ? `${modelingMode.toUpperCase()} MODE · ${activeTarget?.name ?? ''}`
                    : selectedOperandId && activeTarget
                      ? `BOOLE OPERAND · ${activeTarget.name.toUpperCase()}`
                      : joint
                        ? `JOINT FK · ${label(joint).toUpperCase()}`
                        : selection.length === 1 && item && isTargetedLight(item)
                          ? `PERSPECTIVE · ${activeLightPart === 'target' ? 'LIGHT TARGET' : 'LIGHT SOURCE'}`
                          : 'PERSPECTIVE · MODEL'}
              </span>
              <span
                ref={perfBadgeRef}
                className="view-pill perf-pill"
                data-idle="false"
                aria-label="Viewport performance telemetry"
              >
                60 fps · 0.0 ms
              </span>
            </div>

            {modelingMode !== 'object' && activeTarget?.kind === 'mesh' && activeTarget.editableMesh && (
              <div className="c4d-mode-banner" role="status">
                <strong>{modelingMode.toUpperCase()}</strong>
                <span>
                  {modelingMode === 'point'
                    ? `${componentSelection.vertices.length}/${activeTarget.editableMesh.vertices.length} pts`
                    : modelingMode === 'edge'
                      ? `${componentSelection.edges.length} edges`
                      : `${componentSelection.faces.length}/${activeTarget.editableMesh.faces.length} polys`}
                </span>
                <button type="button" onClick={() => switchModelingMode('object')}>
                  Done (Esc)
                </button>
              </div>
            )}

            {activeCaddyOp && (
              <C4DOperatorCaddy
                title={
                  activeCaddyOp === 'extrude'
                    ? 'Extrude Polygons'
                    : activeCaddyOp === 'inset'
                      ? 'Inset / Extrude Inner'
                      : activeCaddyOp === 'bevel'
                        ? modelingMode === 'point'
                          ? 'Chamfer Points'
                          : modelingMode === 'edge'
                            ? 'Bevel / Fillet Edges'
                            : 'Bevel Polygons'
                        : activeCaddyOp === 'loopCut'
                          ? 'Loop / Path Cut'
                          : 'Weld Points'
                }
                icon={
                  activeCaddyOp === 'extrude'
                    ? C4DIcons.toolExtrude
                    : activeCaddyOp === 'inset'
                      ? C4DIcons.toolInset
                      : activeCaddyOp === 'bevel'
                        ? C4DIcons.toolBevel
                        : activeCaddyOp === 'loopCut'
                          ? C4DIcons.toolLoopCut
                          : C4DIcons.toolWeld
                }
                fields={caddyFields}
                onChangeField={handleCaddyFieldChange}
                onApply={() => commitActiveCaddyIfOpen(false)}
                onReset={() => {
                  const fresh = { ...DEFAULT_CADDY_PARAMS };
                  setCaddyParams(fresh);
                  previewCaddyStep(activeCaddyOp, fresh);
                }}
                onCancel={cancelActiveCaddy}
              />
            )}

            <div className="viewport-bottom">
              <span className="hud-chip">
                {modelingMode !== 'object'
                  ? 'Click / Shift-click / Ctrl-drag to select components · W/E/R gizmo transforms · Esc: Object mode'
                  : view
                    ? 'Camera framing · Left drag: orbit · Middle/Right drag: pan · Wheel: zoom · F: frame'
                    : 'Left drag: orbit · Middle/Right drag: pan · Wheel: cursor zoom · Drop 3D files onto stage'}
              </span>
              <button type="button" className="hud-btn" onClick={() => setHelp(true)}>
                Shortcuts
              </button>
            </div>

            {selection.length > 1 && modelingMode === 'object' && (
              <div className="group-toolbar" aria-label="Group actions">
                <span>{selection.length} selected</span>
                <button
                  type="button"
                  onClick={() => createOrWrapBoole('subtract')}
                  disabled={selection.filter(id => { const it = doc.items.find(x => x.id === id); return it && canBeBooleOperand(it); }).length < 2}
                >
                  Boole A−B
                </button>
                {(['X', 'Y', 'Z'] as const).map((axis, index) => (
                  <button key={axis} type="button" onClick={() => flipSelection(index as 0 | 1 | 2)}>
                    Flip {axis}
                  </button>
                ))}
                <button type="button" onClick={() => select(null, null)}>
                  Clear
                </button>
              </div>
            )}
          </div>
          <ViewportHoverTooltipHost emitterRef={viewportHoverEmitterRef} />

          <footer className="statusbar">
            <span>
              {activeTarget
                ? `${activeParentBoole ? `${activeParentBoole.name} ▸ ` : ''}${activeTarget.name}${
                    modelingMode !== 'object'
                      ? ` · ${label(modelingMode)} mode`
                      : joint
                        ? ` · ${label(joint)}`
                        : isTargetedLight(activeTarget)
                          ? activeLightPart === 'target'
                            ? ' · Light target'
                            : ' · Light source'
                          : ''
                  }`
                : 'Select or create an object to begin'}
            </span>
            <span>
              {label(renderStyle.mode)} · {doc.items.length} obj ·{' '}
              <a href={`${import.meta.env.BASE_URL}THIRD_PARTY_NOTICES.txt`} target="_blank" rel="noreferrer">
                Licenses
              </a>
            </span>
          </footer>
        </main>

        {/* =============================================================== */}
        {/* RIGHT SPLIT C4D DOCK: TOP OBJECT MANAGER + BOTTOM ATTRIBUTES    */}
        {/* =============================================================== */}
        <aside className="c4d-right-dock" aria-label="Object and Attribute Managers">
          {/* TOP PANE: C4D HIERARCHICAL OBJECT MANAGER */}
          <section className="c4d-object-manager" aria-label="Scene objects">
            <div className="c4d-pane-header">
              <h2>Objects</h2>
              <div className="c4d-pane-header-meta">
                <span>✓ · Eye · Lock</span>
                <span className="pill-badge">{doc.items.length}</span>
              </div>
            </div>
            <div className="scroll">
              {doc.items.length === 0 ? (
                <div style={{ padding: 12 }}>
                  <div className="empty-card">
                    Stage is empty. Click Cube, Characters, Lights, or Import 3D in the top bar.
                  </div>
                </div>
              ) : (
                <ul className="layer-tree" aria-label="Object list" style={{ padding: '4px 6px' }}>
                  {doc.items.map(i => {
                    const mods = i.modifiers ?? [];
                    const booleOps = i.kind === 'boole' ? (i.operands ?? []) : [];
                    const roomObjs = i.roomId
                      ? (engine.current?.getRoomObjects(i.id) ?? []).filter(
                          o => !i.roomObjects?.[o.id]?.deleted,
                        )
                      : [];
                    const hasChildren = mods.length > 0 || booleOps.length > 0 || roomObjs.length > 0;
                    const expandKey = i.roomId ? 'room' : `item:${i.id}`;
                    const isExpanded = expandedLayers[expandKey] !== false;
                    const lt = i.lightType ?? LIGHT_DEFAULTS.lightType;
                    const linkedName =
                      i.kind === 'light' && isTargetedLight(i)
                        ? resolveLinkedObjectLabel(i.targetObjectId)
                        : null;
                    const metaText = isBody(i.kind)
                      ? CHARACTERS[i.modelId ?? defaultModelId(i.kind)].label
                      : i.roomId
                        ? `Room · ${roomObjs.length}`
                        : i.kind === 'light'
                          ? `${LIGHT_TYPE_LABELS[lt]}${linkedName ? ` → ${linkedName}` : ''}`
                          : i.kind === 'primitive' && i.primitive
                            ? `${PRIMITIVE_LABELS[i.primitive.kind]}${'fillet' in i.primitive.params && i.primitive.params.fillet ? ' · Fillet' : ''}`
                            : i.kind === 'mesh' && i.editableMesh
                              ? `Mesh · ${i.editableMesh.faces.length}f`
                              : i.kind === 'boole'
                                ? `${BOOLEAN_OP_LABELS[i.booleanOp ?? 'subtract']} · ${booleOps.length}`
                                : i.kind === 'imported'
                                  ? `${(i.sourceFormat ?? '3d').toUpperCase()}`
                                  : label(i.kind);

                    return (
                      <div key={i.id}>
                        <LayerTreeRow
                          depth={0}
                          isGroup={hasChildren}
                          expanded={hasChildren ? isExpanded : undefined}
                          onToggleExpand={hasChildren ? () => toggleExpandLayer(expandKey) : undefined}
                          icon={itemTreeIcon(i)}
                          title={i.name}
                          meta={metaText}
                          selected={
                            selection.includes(i.id) && !selectedOperandId && !selectedRoomObject
                          }
                          visible={i.visible !== false}
                          locked={Boolean(i.locked)}
                          generatorEnabled={
                            i.kind === 'boole' ? i.booleanEnabled !== false : undefined
                          }
                          onToggleGenerator={
                            i.kind === 'boole'
                              ? () =>
                                  update(next => {
                                    const b = next.items.find(x => x.id === i.id);
                                    if (b) b.booleanEnabled = b.booleanEnabled === false;
                                  })
                              : undefined
                          }
                          extraActions={
                            i.kind === 'boole' && booleOps.length >= 2 ? (
                              <TooltipButton
                                className="layer-icon-btn"
                                tooltip="Swap Operand A ↔ B"
                                tooltipPlacement="top"
                                aria-label={`Swap operands of ${i.name}`}
                                onClick={() => handleSwapBooleOperands(i.id)}
                              >
                                {C4DIcons.swap}
                              </TooltipButton>
                            ) : undefined
                          }
                          onSelect={event => select(i.id, null, event.shiftKey)}
                          onToggleVisible={() => toggleItemVisible(i.id)}
                          onToggleLock={() => toggleItemLocked(i.id)}
                          onDelete={() => removeItemById(i.id)}
                          deleteLabel={`Delete ${i.name}`}
                        />

                        {/* Attached Modifiers under top-level object */}
                        {isExpanded &&
                          mods.map(mod => (
                            <LayerTreeRow
                              key={`${i.id}:mod:${mod.id}`}
                              depth={1}
                              icon={modifierIconForType(mod.type)}
                              title={mod.name || MODIFIER_LABELS[mod.type]}
                              meta="Modifier"
                              selected={
                                selected === i.id &&
                                !selectedOperandId &&
                                tab === 'modifiers' &&
                                focusedModifierId === mod.id
                              }
                              visible={mod.enabled}
                              locked={Boolean(i.locked)}
                              generatorEnabled={mod.enabled}
                              onToggleGenerator={() => toggleModifierEnabledOnItem(i.id, mod.id)}
                              onSelect={() => {
                                select(i.id, null);
                                setFocusedModifierId(mod.id);
                                setTab('modifiers');
                              }}
                              onDelete={() => removeModifierOnItem(i.id, mod.id)}
                              deleteLabel={`Remove ${mod.name || MODIFIER_LABELS[mod.type]}`}
                            />
                          ))}

                        {/* Child Operands inside a Boole Generator */}
                        {isExpanded &&
                          booleOps.map((op, opIdx) => {
                            const opMods = op.modifiers ?? [];
                            const opRole = opIdx === 0 ? 'A' : `B${booleOps.length > 2 ? opIdx : ''}`;
                            return (
                              <div key={`${i.id}:op:${op.id}`}>
                                <LayerTreeRow
                                  depth={1}
                                  icon={itemTreeIcon(op)}
                                  title={`${opRole}: ${op.name}`}
                                  meta={
                                    op.kind === 'primitive' && op.primitive
                                      ? PRIMITIVE_LABELS[op.primitive.kind]
                                      : label(op.kind)
                                  }
                                  selected={selectedOperandId === op.id}
                                  visible={op.visible !== false}
                                  locked={Boolean(op.locked)}
                                  inheritedLocked={Boolean(i.locked)}
                                  onSelect={() => selectOperand(i.id, op.id)}
                                  onToggleVisible={() => toggleItemVisible(op.id)}
                                  onToggleLock={() => toggleItemLocked(op.id)}
                                  onDelete={() => removeItemById(op.id)}
                                  deleteLabel={`Remove operand ${op.name}`}
                                />
                                {opMods.map(mod => (
                                  <LayerTreeRow
                                    key={`${op.id}:mod:${mod.id}`}
                                    depth={2}
                                    icon={modifierIconForType(mod.type)}
                                    title={mod.name || MODIFIER_LABELS[mod.type]}
                                    meta="Mod"
                                    selected={
                                      selectedOperandId === op.id &&
                                      tab === 'modifiers' &&
                                      focusedModifierId === mod.id
                                    }
                                    visible={mod.enabled}
                                    locked={Boolean(op.locked)}
                                    generatorEnabled={mod.enabled}
                                    onToggleGenerator={() =>
                                      toggleModifierEnabledOnItem(op.id, mod.id)
                                    }
                                    onSelect={() => {
                                      selectOperand(i.id, op.id);
                                      setFocusedModifierId(mod.id);
                                      setTab('modifiers');
                                    }}
                                    onDelete={() => removeModifierOnItem(op.id, mod.id)}
                                    deleteLabel={`Remove ${mod.name || MODIFIER_LABELS[mod.type]}`}
                                  />
                                ))}
                              </div>
                            );
                          })}

                        {/* Room interior child objects */}
                        {isExpanded &&
                          roomObjs.map(obj => {
                            const ov = i.roomObjects?.[obj.id];
                            const objVisible = ov?.visible !== false;
                            const objLocked = Boolean(ov?.locked);
                            const isObjSelected =
                              selectedRoomObject?.roomId === i.id &&
                              selectedRoomObject.objectId === obj.id;
                            return (
                              <LayerTreeRow
                                key={`${i.id}:${obj.id}`}
                                depth={1}
                                icon={
                                  obj.category === 'lighting'
                                    ? Icons.light
                                    : obj.category === 'architecture'
                                      ? Icons.room
                                      : Icons.prop
                                }
                                title={obj.name}
                                meta={obj.category}
                                selected={isObjSelected}
                                visible={objVisible}
                                locked={objLocked}
                                inheritedLocked={Boolean(i.locked)}
                                onSelect={() => selectRoomObject(i.id, obj.id)}
                                onToggleVisible={() => toggleRoomObjectVisible(i.id, obj.id)}
                                onToggleLock={() => toggleRoomObjectLocked(i.id, obj.id)}
                                onDelete={() => deleteRoomObject(i.id, obj.id)}
                                deleteLabel={`Delete ${obj.name}`}
                              />
                            );
                          })}
                      </div>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>

          {/* BOTTOM PANE: C4D TABBED ATTRIBUTE MANAGER */}
          <section className="c4d-attribute-manager" aria-label="Inspector">
            <div className="c4d-attr-tabs" role="tablist" aria-label="Attribute Manager tabs">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'object'}
                className={`c4d-attr-tab${tab === 'object' ? ' active' : ''}`}
                onClick={() => setTab('object')}
              >
                Object
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'coord'}
                className={`c4d-attr-tab${tab === 'coord' ? ' active' : ''}`}
                onClick={() => setTab('coord')}
              >
                Coord.
              </button>
              {hasMaterialTab && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'material'}
                  className={`c4d-attr-tab${tab === 'material' ? ' active' : ''}`}
                  onClick={() => setTab('material')}
                >
                  Material
                </button>
              )}
              {hasModifiersTab && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'modifiers'}
                  className={`c4d-attr-tab${tab === 'modifiers' ? ' active' : ''}`}
                  onClick={() => setTab('modifiers')}
                >
                  Modifiers
                  {(activeTarget?.modifiers?.length ?? 0) > 0
                    ? ` (${activeTarget!.modifiers!.length})`
                    : ''}
                </button>
              )}
              {hasPoseTab && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'pose'}
                  className={`c4d-attr-tab${tab === 'pose' ? ' active' : ''}`}
                  onClick={() => setTab('pose')}
                >
                  Pose
                </button>
              )}
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'camera'}
                className={`c4d-attr-tab${tab === 'camera' ? ' active' : ''}`}
                onClick={() => setTab('camera')}
              >
                Camera
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'library'}
                className={`c4d-attr-tab${tab === 'library' ? ' active' : ''}`}
                onClick={() => setTab('library')}
              >
                Library
              </button>
            </div>

            <div className="scroll inspector-content">
              {/* ========================================================= */}
              {/* TAB: OBJECT                                               */}
              {/* ========================================================= */}
              {tab === 'object' &&
                (selectedRoomObject && item?.roomId ? (() => {
                  const roomObj = engine.current?.getRoomObjects(item.id).find(
                    o => o.id === selectedRoomObject.objectId,
                  );
                  const ov = item.roomObjects?.[selectedRoomObject.objectId];
                  if (!roomObj || ov?.deleted) {
                    return (
                      <div className="empty-card">
                        Room object not found. Select another layer or item.
                      </div>
                    );
                  }
                  const objLocked = Boolean(item.locked || ov?.locked);
                  const pos = ov?.position ?? [0, 0, 0];
                  const rot = ov?.rotation ?? [0, 0, 0];
                  const scl = ov?.scale ?? [1, 1, 1];
                  return (
                    <section aria-label="Room object inspector">
                      <div className="eyebrow">ROOM OBJECT · {roomObj.category.toUpperCase()}</div>
                      <h2>{roomObj.name}</h2>
                      <div className="field-block">
                        <SwitchRow
                          label="Visible"
                          description="Show or hide this object in the room."
                          checked={ov?.visible !== false}
                          onChange={visible => editRoomObjectOverride(item.id, roomObj.id, { visible })}
                        />
                        <SwitchRow
                          label="Locked"
                          description={item.locked ? 'Parent Room layer is locked.' : 'Prevent viewport selection & moving.'}
                          checked={Boolean(ov?.locked)}
                          onChange={locked => editRoomObjectOverride(item.id, roomObj.id, { locked })}
                        />
                      </div>
                      <div className="field-block" style={objLocked ? { opacity: 0.55, pointerEvents: 'none' } : undefined}>
                        <Vector3Field
                          label="Offset position (m)"
                          value={pos}
                          min={-50}
                          max={50}
                          onChange={position => editRoomObjectOverride(item.id, roomObj.id, { position })}
                        />
                        <Vector3Field
                          label="Rotation (°)"
                          value={rot.map(degrees) as Vec3}
                          min={-360}
                          max={360}
                          step={1}
                          onChange={v => editRoomObjectOverride(item.id, roomObj.id, { rotation: v.map(radians) as Vec3 })}
                        />
                        <Vector3Field
                          label="Scale"
                          value={scl}
                          min={0.05}
                          max={10}
                          onChange={scale => editRoomObjectOverride(item.id, roomObj.id, { scale })}
                        />
                      </div>
                      <div className="two">
                        <button
                          type="button"
                          disabled={objLocked}
                          onClick={() =>
                            editRoomObjectOverride(item.id, roomObj.id, {
                              position: [0, 0, 0],
                              rotation: [0, 0, 0],
                              scale: [1, 1, 1],
                            })
                          }
                        >
                          Reset transform
                        </button>
                        <button
                          type="button"
                          className="danger-btn"
                          disabled={objLocked}
                          onClick={() => deleteRoomObject(item.id, roomObj.id)}
                        >
                          Delete object
                        </button>
                      </div>
                    </section>
                  );
                })() : selection.length > 1 && !selectedOperandId ? (
                  <section aria-label="Multi-selection">
                    <div className="eyebrow">GROUP · {selection.length} SELECTED</div>
                    <h2>{selection.length} objects selected</h2>
                    <div className="two">
                      <button
                        type="button"
                        className="primary"
                        disabled={
                          selection.filter(id => {
                            const it = doc.items.find(x => x.id === id);
                            return it && canBeBooleOperand(it);
                          }).length < 2
                        }
                        onClick={() => createOrWrapBoole('subtract')}
                      >
                        {C4DIcons.booleSubtract} Boole Subtract (A−B)
                      </button>
                      <button
                        type="button"
                        disabled={
                          selection.filter(id => {
                            const it = doc.items.find(x => x.id === id);
                            return it && canBeBooleOperand(it);
                          }).length < 2
                        }
                        onClick={() => createOrWrapBoole('union')}
                      >
                        {C4DIcons.booleUnion} Boole Union
                      </button>
                    </div>
                    <Vector3Field
                      label="Group position (m)"
                      value={selectionCentroid(doc.items.filter(i => selection.includes(i.id)))}
                      min={-100}
                      max={100}
                      onChange={position =>
                        update(next => {
                          const center = selectionCentroid(
                            next.items.filter(i => selection.includes(i.id)),
                          );
                          const offset = position.map((v, axis) => v - center[axis]);
                          for (const target of next.items.filter(i => selection.includes(i.id))) {
                            target.position = target.position.map(
                              (v, axis) => v + offset[axis]!,
                            ) as Vec3;
                            if (target.target && !target.targetObjectId) {
                              target.target = target.target.map(
                                (v, axis) => v + offset[axis]!,
                              ) as Vec3;
                            }
                          }
                        })
                      }
                    />
                    <div className="three">
                      {(['X', 'Y', 'Z'] as const).map((axis, index) => (
                        <button
                          key={axis}
                          type="button"
                          onClick={() => flipSelection(index as 0 | 1 | 2)}
                        >
                          Flip {axis}
                        </button>
                      ))}
                    </div>
                    <button type="button" className="full-btn" onClick={() => select(null, null)}>
                      Clear selection
                    </button>
                  </section>
                ) : activeTarget ? (
                  <>
                    {/* Basic Header + Name */}
                    <section>
                      <div className="eyebrow">
                        {activeParentBoole
                          ? `BOOLE OPERAND · ${activeParentBoole.name.toUpperCase()}`
                          : isBody(activeTarget.kind)
                            ? 'CHARACTER · RIG'
                            : activeTarget.roomId
                              ? 'STAGE · ROOM'
                              : activeTarget.kind === 'light'
                                ? 'STAGE · LIGHT'
                                : activeTarget.kind === 'primitive'
                                  ? 'PARAMETRIC · PRIMITIVE'
                                  : activeTarget.kind === 'mesh'
                                    ? 'POLYGON · EDITABLE MESH'
                                    : activeTarget.kind === 'boole'
                                      ? 'GENERATOR · CSG BOOLE'
                                      : activeTarget.kind === 'imported'
                                        ? 'ASSET · IMPORTED 3D'
                                        : 'STAGE · PROP'}
                      </div>
                      <div className="field-block">
                        <label className="text-field">
                          <span className="field-label">Name</span>
                          <input
                            aria-label="Object name"
                            value={activeTarget.name}
                            maxLength={80}
                            onChange={e => editActiveTarget({ name: e.target.value })}
                          />
                        </label>
                      </div>
                    </section>

                    {/* Parametric Primitive Panel (with Fillet / Chamfer) */}
                    {activeTarget.kind === 'primitive' && activeTarget.primitive && (
                      <PrimitiveObjectPanel
                        spec={activeTarget.primitive}
                        disabled={Boolean(activeTarget.locked)}
                        onChangeSpec={primitive => editActiveTarget({ primitive })}
                        onMakeEditable={() => makeItemEditable(activeTarget.id)}
                      />
                    )}

                    {/* Editable Mesh Panel */}
                    {activeTarget.kind === 'mesh' && activeTarget.editableMesh && (
                      <EditableMeshObjectPanel
                        mesh={activeTarget.editableMesh}
                        modelingMode={modelingMode}
                        selection={componentSelection}
                        disabled={Boolean(activeTarget.locked)}
                        onSetModelingMode={switchModelingMode}
                        onRunMeshAction={action => {
                          switch (action) {
                            case 'extrude':
                            case 'inset':
                            case 'bevel':
                            case 'loopCut':
                            case 'weld':
                              startCaddyOp(action);
                              break;
                            case 'bridge':
                              runDirectMeshTool('bridge');
                              break;
                            case 'connect':
                              runDirectMeshTool('connect');
                              break;
                            case 'subdivide':
                              runDirectMeshTool('subdivide');
                              break;
                            case 'dissolve':
                              runDirectMeshTool('dissolve');
                              break;
                            case 'flipNormals':
                              runDirectMeshTool('flipNormals');
                              break;
                            case 'closeHole':
                              runDirectMeshTool('closeHoles');
                              break;
                            case 'edgeLoop':
                              runDirectMeshTool('edgeLoop');
                              break;
                            case 'edgeRing':
                              runDirectMeshTool('edgeRing');
                              break;
                            case 'grow':
                              runDirectMeshTool('growSelection');
                              break;
                            case 'shrink':
                              runDirectMeshTool('shrinkSelection');
                              break;
                            case 'selectAll': {
                              const m = activeTarget.editableMesh!;
                              if (modelingMode === 'point') {
                                setComponentSelection({
                                  mode: 'point',
                                  vertices: m.vertices.map((_, idx) => idx),
                                  edges: [],
                                  faces: [],
                                });
                              } else if (modelingMode === 'edge') {
                                const adj = getCachedHalfEdgeMesh(m);
                                setComponentSelection({
                                  mode: 'edge',
                                  vertices: [],
                                  edges: adj.edges.map((_, idx) => idx),
                                  faces: [],
                                });
                              } else if (modelingMode === 'polygon') {
                                setComponentSelection({
                                  mode: 'polygon',
                                  vertices: [],
                                  edges: [],
                                  faces: m.faces.map((_, idx) => idx),
                                });
                              }
                              break;
                            }
                            case 'clearSelection':
                              if (modelingMode !== 'object') {
                                setComponentSelection(createEmptySelection(modelingMode));
                              }
                              break;
                            case 'invertSelection': {
                              const m = activeTarget.editableMesh!;
                              if (modelingMode === 'point') {
                                const cur = new Set(componentSelection.vertices);
                                setComponentSelection({
                                  mode: 'point',
                                  vertices: m.vertices
                                    .map((_, idx) => idx)
                                    .filter(idx => !cur.has(idx)),
                                  edges: [],
                                  faces: [],
                                });
                              } else if (modelingMode === 'edge') {
                                const adj = getCachedHalfEdgeMesh(m);
                                const cur = new Set(componentSelection.edges);
                                setComponentSelection({
                                  mode: 'edge',
                                  vertices: [],
                                  edges: adj.edges
                                    .map((_, idx) => idx)
                                    .filter(idx => !cur.has(idx)),
                                  faces: [],
                                });
                              } else if (modelingMode === 'polygon') {
                                const cur = new Set(componentSelection.faces);
                                setComponentSelection({
                                  mode: 'polygon',
                                  vertices: [],
                                  edges: [],
                                  faces: m.faces
                                    .map((_, idx) => idx)
                                    .filter(idx => !cur.has(idx)),
                                });
                              }
                              break;
                            }
                          }
                        }}
                      />
                    )}

                    {/* Live CSG Boole Generator Panel */}
                    {activeTarget.kind === 'boole' && (
                      <BooleObjectPanel
                        booleItem={activeTarget}
                        selectedOperandId={selectedOperandId}
                        availableOperandCandidates={doc.items.filter(
                          c => c.id !== activeTarget.id && canBeBooleOperand(c),
                        )}
                        disabled={Boolean(activeTarget.locked)}
                        onChangeOp={booleanOp => editActiveTarget({ booleanOp })}
                        onToggleEnabled={booleanEnabled => editActiveTarget({ booleanEnabled })}
                        onSelectOperand={opId => selectOperand(activeTarget.id, opId)}
                        onSwapOperands={() => handleSwapBooleOperands(activeTarget.id)}
                        onExtractOperands={() => handleExtractBooleOperands(activeTarget.id)}
                        onAssignSceneOperand={opItemId =>
                          handleAddSceneOperandToBoole(activeTarget.id, opItemId)
                        }
                        onSpawnCutterPrimitive={primKind => {
                          const cutter = createPrimitiveItem(primKind, 0);
                          cutter.name = `${PRIMITIVE_LABELS[primKind]} Cutter`;
                          cutter.position = [0.25, 0.25, 0.25];
                          cutter.scale = [0.75, 0.75, 0.75];
                          update(next => {
                            updateItemOrOperand(next.items, activeTarget.id, dst => {
                              dst.operands = [...(dst.operands ?? []), cutter];
                            });
                          });
                          setExpandedLayers(prev => ({ ...prev, [`item:${activeTarget.id}`]: true }));
                          selectOperand(activeTarget.id, cutter.id);
                        }}
                        onMakeEditable={() => makeItemEditable(activeTarget.id)}
                      />
                    )}

                    {/* Imported 3D Asset Panel */}
                    {activeTarget.kind === 'imported' && (
                      <ImportedAssetObjectPanel
                        item={activeTarget}
                        disabled={Boolean(activeTarget.locked)}
                        onSnapToFloor={snapSelectedToFloor}
                        onMakeEditable={() => makeItemEditable(activeTarget.id)}
                      />
                    )}

                    {/* Prop Panel */}
                    {!isBody(activeTarget.kind) &&
                      !activeTarget.roomId &&
                      activeTarget.kind !== 'light' &&
                      !isModelingKind(activeTarget.kind) && (
                        <section aria-label="Studio prop parameters">
                          <ColorField
                            label="Surface tint"
                            value={activeTarget.color}
                            onChange={color => editActiveTarget({ color })}
                          />
                          <button
                            type="button"
                            className="full-btn"
                            onClick={() => makeItemEditable(activeTarget.id)}
                          >
                            {C4DIcons.makeEditable} Make Editable (Convert to Polygon Mesh)
                          </button>
                        </section>
                      )}

                    {/* Room Settings */}
                    {activeTarget.roomId && (
                      <section aria-label="Room settings">
                        <SwitchRow
                          label="Room visibility"
                          description="Hide the room without losing its transform."
                          checked={activeTarget.visible !== false}
                          onChange={visible => editActiveTarget({ visible })}
                        />
                        <SwitchRow
                          label="Cutaway walls and ceiling"
                          description="Hide near-side architecture as you orbit; keep furniture visible."
                          checked={activeTarget.cutaway !== false}
                          onChange={cutaway => editActiveTarget({ cutaway })}
                        />
                        <div className="select-field" inert={roomBusy}>
                          <span className="field-label">Switch preset room</span>
                          <SelectDropdown
                            ariaLabel="Preset room"
                            value={activeTarget.roomId}
                            options={[
                              { value: '__studio__', label: 'Studio floor (remove room)' },
                              ...ROOM_IDS.map(id => ({ value: id, label: ROOMS[id].label })),
                            ]}
                            onChange={id => {
                              void setPresetRoom(id as RoomId | '__studio__');
                            }}
                          />
                        </div>
                      </section>
                    )}

                    {/* Character Appearance + Quick Pose Access */}
                    {item && !selectedOperandId && isBody(item.kind) && (
                      <section aria-label="Character appearance">
                        <div className="field-block">
                          <div className="select-field">
                            <span className="field-label">Base figure</span>
                            <SelectDropdown
                              ariaLabel="Base figure"
                              value={item.modelId ?? defaultModelId(item.kind)}
                              options={MODEL_IDS.map(id => ({
                                value: id,
                                label: CHARACTERS[id].label,
                              }))}
                              onChange={id => {
                                if (isModelId(id)) swapBaseFigure(id);
                              }}
                            />
                          </div>
                          {!CHARACTERS[item.modelId ?? defaultModelId(item.kind)].source && (
                            <div className="select-field">
                              <span className="field-label">Body proportion</span>
                              <SelectDropdown
                                ariaLabel="Body proportion"
                                value={item.bodyType ?? DEFAULT_BODY_TYPE}
                                options={BODY_OPTIONS}
                                onChange={value => {
                                  if (
                                    isBodyTypeId(value) &&
                                    value !== (item.bodyType ?? DEFAULT_BODY_TYPE)
                                  ) {
                                    editItem({ bodyType: value });
                                  }
                                }}
                              />
                            </div>
                          )}
                          <ColorField
                            label="Skin tone"
                            value={item.color}
                            resetValue={selectedRig ? '#ffffff' : defaultSkinColor(item.kind)}
                            resetLabel={selectedRig ? 'Original' : 'Default'}
                            swatches={
                              selectedRig
                                ? AUTHORED_SKIN_TONE_SWATCHES
                                : STUDIO_SKIN_TONE_SWATCHES
                            }
                            onChange={color => editItem({ color })}
                          />
                          {!selectedRig && (
                            <MannequinDressMapControls
                              cloth={clothControls}
                              item={item}
                              disabled={Boolean(item.locked)}
                              onEdit={patch => editItem(patch)}
                            />
                          )}
                          {hasCharacterOutfitSlot(selectedModelId) && (
                            <ColorField
                              label="Dress color"
                              value={
                                item.outfitColor ??
                                (selectedRig ? '#ffffff' : defaultOutfitColor(item.kind))
                              }
                              resetValue={
                                selectedRig || Boolean(item.customDressMapDataUrl)
                                  ? '#ffffff'
                                  : defaultOutfitColor(item.kind)
                              }
                              resetLabel={
                                selectedRig || Boolean(item.customDressMapDataUrl)
                                  ? 'Original'
                                  : 'Default'
                              }
                              swatches={AUTHORED_DRESS_COLOR_SWATCHES}
                              onChange={outfitColor => editItem({ outfitColor })}
                            />
                          )}
                          {!authoredHair && (
                            <div className="select-field">
                              <span className="field-label">Hairstyle</span>
                              <SelectDropdown
                                ariaLabel="Hairstyle"
                                value={
                                  item.hairStyle ??
                                  defaultCharacterHairStyle(item.kind, selectedModelId)
                                }
                                options={hairOptions}
                                onChange={v => editItem({ hairStyle: v as HairStyleId })}
                              />
                            </div>
                          )}
                          <ColorField
                            label={authoredHair ? 'Hair tint' : 'Hair & brow color'}
                            value={
                              item.hairColor ?? (authoredHair ? '#ffffff' : DEFAULT_HAIR_COLOR)
                            }
                            resetValue={authoredHair ? '#ffffff' : DEFAULT_HAIR_COLOR}
                            resetLabel={authoredHair ? 'Original' : 'Default'}
                            swatches={
                              authoredHair
                                ? AUTHORED_HAIR_COLOR_SWATCHES
                                : STUDIO_HAIR_COLOR_SWATCHES
                            }
                            onChange={hairColor => editItem({ hairColor })}
                          />
                          <button
                            type="button"
                            className="primary full-btn"
                            onClick={() => setTab('pose')}
                          >
                            Open Joint &amp; Animation Pose Controls →
                          </button>
                        </div>
                      </section>
                    )}

                    {/* Light Parameters + Spotlight Source/Target & Link */}
                    {item && !selectedOperandId && item.kind === 'light' && (() => {
                      const lt: LightType = item.lightType ?? LIGHT_DEFAULTS.lightType;
                      const isDirectional = lt === 'directional';
                      const isSpot = lt === 'spot';
                      const isPoint = lt === 'point';
                      const targeted = isTargetedLight(item);
                      const isTargetSelected = targeted && activeLightPart === 'target';
                      const isTargetLinked = Boolean(item.targetObjectId);
                      const linkedLabel = resolveLinkedObjectLabel(item.targetObjectId);
                      const activeVec = resolveLightActiveVector(item, activeLightPart);
                      const transformDisabled =
                        Boolean(item.locked) || (isTargetSelected && isTargetLinked);
                      const intensityVal =
                        item.intensity ??
                        (isDirectional
                          ? LIGHT_DEFAULTS.directionalIntensity
                          : LIGHT_DEFAULTS.intensity);
                      const castShadow = item.castShadow ?? LIGHT_DEFAULTS.castShadow;
                      const angleVal = item.angle ?? LIGHT_DEFAULTS.angle;
                      const penumbraVal = item.penumbra ?? LIGHT_DEFAULTS.penumbra;
                      const distanceVal = item.distance ?? LIGHT_DEFAULTS.distance;
                      const decayVal = item.decay ?? LIGHT_DEFAULTS.decay;
                      const shadowExtentVal = item.shadowExtent ?? LIGHT_DEFAULTS.shadowExtent;
                      return (
                        <>
                          <section aria-label="Scene lighting">
                            <h3>Scene Lighting</h3>
                            <div className="field-block">
                              <SwitchRow
                                label="Scene lights only"
                                description="No ambient or studio fill — lit strictly by scene lights"
                                checked={sceneLightsOnly}
                                onChange={setSceneLightsOnly}
                              />
                              <SwitchRow
                                label="Global illumination bounce"
                                description="Bounce colored indirect light off room walls, floor & props"
                                checked={giEnabled}
                                onChange={enabled => editRenderSettings({ giEnabled: enabled })}
                              />
                            </div>
                          </section>

                          <section aria-label="Light transform">
                            <div className="section-head">
                              <h3>Light Transform</h3>
                              <span className="pill-badge">
                                {isTargetSelected ? 'Light target' : 'Light source'}
                              </span>
                            </div>
                            <div className="field-block">
                              {targeted && (
                                <SegmentedControl
                                  ariaLabel="Light transform target"
                                  fullWidth
                                  value={activeLightPart}
                                  items={[
                                    { value: 'source', label: 'Light source' },
                                    { value: 'target', label: 'Target' },
                                  ]}
                                  onChange={part => setLightPart(part)}
                                />
                              )}
                              <Vector3Field
                                label="Position (m)"
                                value={activeVec}
                                min={-100}
                                max={100}
                                disabled={transformDisabled}
                                onChange={vec =>
                                  editItem(applyLightPartPosition(item, activeLightPart, vec))
                                }
                                onReset={
                                  transformDisabled
                                    ? undefined
                                    : () =>
                                        editItem(
                                          isTargetSelected
                                            ? { target: [0, 1, 0] }
                                            : { position: [2.2, 3.2, 2.4] },
                                        )
                                }
                              />
                              {targeted && (
                                <div className="select-field" inert={Boolean(item.locked)}>
                                  <div className="field-head">
                                    <span className="field-label">Link target to</span>
                                    {isTargetLinked && (
                                      <button
                                        type="button"
                                        className="text-btn"
                                        disabled={Boolean(item.locked)}
                                        onClick={() =>
                                          update(next => {
                                            linkLightTarget(
                                              next.items,
                                              item.id,
                                              null,
                                              (rId, oId) =>
                                                engine.current?.getRoomObjectBasePosition(
                                                  rId,
                                                  oId,
                                                ) ?? null,
                                            );
                                          })
                                        }
                                      >
                                        Unlink
                                      </button>
                                    )}
                                  </div>
                                  <SelectDropdown
                                    ariaLabel="Link target to"
                                    value={item.targetObjectId ?? '__none__'}
                                    options={lightTargetLinkOptions}
                                    onChange={val => {
                                      if (item.locked) return;
                                      update(next => {
                                        linkLightTarget(
                                          next.items,
                                          item.id,
                                          val === '__none__' ? null : val,
                                          (rId, oId) =>
                                            engine.current?.getRoomObjectBasePosition(rId, oId) ??
                                            null,
                                        );
                                      });
                                    }}
                                  />
                                  {isTargetLinked && (
                                    <p className="muted">
                                      Tracking <strong>{linkedLabel ?? 'linked object'}</strong> (
                                      {(item.target ?? [0, 1, 0]).map(v => v.toFixed(2)).join(', ')}{' '}
                                      m).
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                          </section>

                          <section aria-label="Light parameters">
                            <h3>{LIGHT_TYPE_LABELS[lt]}</h3>
                            <div className="field-block">
                              <ColorField
                                label="Light color"
                                value={item.color}
                                onChange={color => editItem({ color })}
                              />
                              <div className="select-field">
                                <span className="field-label">Light type</span>
                                <SelectDropdown
                                  ariaLabel="Light type"
                                  value={lt}
                                  options={LIGHT_TYPES.map(type => ({
                                    value: type,
                                    label: LIGHT_TYPE_LABELS[type],
                                    icon:
                                      type === 'directional'
                                        ? Icons.lightParallel
                                        : type === 'point'
                                          ? Icons.lightOmni
                                          : Icons.lightSpot,
                                  }))}
                                  onChange={nextType => {
                                    const typed = nextType as LightType;
                                    if (typed === 'point' && lightPart === 'target') {
                                      setLightPart('source');
                                    }
                                    editItem(switchLightType(item, typed));
                                  }}
                                />
                              </div>
                              <SliderField
                                label="Intensity"
                                value={intensityVal}
                                min={0}
                                max={isDirectional ? 20 : 200}
                                step={isDirectional ? 0.1 : 1}
                                displayValue={
                                  isDirectional
                                    ? `${intensityVal.toFixed(1)} lx`
                                    : `${Math.round(intensityVal)} lx`
                                }
                                onChange={intensity => editItem({ intensity })}
                              />
                              <SwitchRow
                                label="Cast shadows"
                                checked={castShadow}
                                onChange={nextCastShadow => editItem({ castShadow: nextCastShadow })}
                              />
                              {castShadow && (
                                <>
                                  <SliderField
                                    label="Shadow softness (PCSS)"
                                    ariaLabel="Shadow softness"
                                    value={shadowSoftness}
                                    min={0}
                                    max={2.5}
                                    step={0.05}
                                    displayValue={`${shadowSoftness.toFixed(2)}×`}
                                    onChange={val =>
                                      editRenderSettings({ shadowSoftness: val }, 'shadow-softness')
                                    }
                                  />
                                  <div className="select-field">
                                    <span className="field-label">Shadow quality</span>
                                    <SegmentedControl
                                      ariaLabel="Shadow quality"
                                      fullWidth
                                      value={renderQuality}
                                      items={[
                                        { value: 'performance', label: 'Perf · 1K' },
                                        { value: 'balanced', label: 'Bal · 2K' },
                                        { value: 'ultra', label: 'Ultra · 4K' },
                                      ]}
                                      onChange={rq => editRenderSettings({ renderQuality: rq })}
                                    />
                                  </div>
                                </>
                              )}
                              {isSpot && (
                                <>
                                  <SliderField
                                    label="Cone angle"
                                    value={angleVal}
                                    min={5}
                                    max={85}
                                    step={1}
                                    displayValue={`${Math.round(angleVal)}°`}
                                    onChange={angle => editItem({ angle })}
                                  />
                                  <SliderField
                                    label="Penumbra"
                                    value={penumbraVal}
                                    min={0}
                                    max={1}
                                    step={0.05}
                                    displayValue={`${Math.round(penumbraVal * 100)}%`}
                                    onChange={penumbra => editItem({ penumbra })}
                                  />
                                </>
                              )}
                              {(isSpot || isPoint) && (
                                <>
                                  <SliderField
                                    label="Range"
                                    value={distanceVal}
                                    min={0}
                                    max={200}
                                    step={1}
                                    displayValue={
                                      distanceVal === 0
                                        ? 'Unlimited'
                                        : `${Math.round(distanceVal)} m`
                                    }
                                    onChange={distance => editItem({ distance })}
                                  />
                                  <SliderField
                                    label="Decay"
                                    value={decayVal}
                                    min={0}
                                    max={3}
                                    step={0.1}
                                    displayValue={decayVal.toFixed(1)}
                                    onChange={decay => editItem({ decay })}
                                  />
                                </>
                              )}
                              {isDirectional && castShadow && (
                                <SliderField
                                  label="Shadow coverage"
                                  value={shadowExtentVal}
                                  min={2}
                                  max={40}
                                  step={1}
                                  displayValue={`±${Math.round(shadowExtentVal)} m`}
                                  onChange={shadowExtent => editItem({ shadowExtent })}
                                />
                              )}
                            </div>
                          </section>
                        </>
                      );
                    })()}

                    {/* Duplicate & Delete Actions */}
                    <section>
                      <div className="two">
                        {!selectedOperandId && item && (
                          <button
                            type="button"
                            onClick={() => {
                              const assignFreshIds = (src: Item): Item => ({
                                ...clone(src),
                                id: crypto.randomUUID(),
                                modifiers: src.modifiers?.map(m => ({ ...clone(m), id: crypto.randomUUID() })),
                                operands: src.operands?.map(assignFreshIds),
                              });
                              const copy = assignFreshIds(item);
                              copy.name = `${item.name.slice(0, 70)} copy`;
                              copy.position[0] += 0.6;
                              update(d => d.items.push(copy));
                              select(copy.id, null);
                            }}
                            disabled={
                              doc.items.length >= 64 ||
                              (item.kind === 'light' &&
                                doc.items.filter(i => i.kind === 'light').length >= 8)
                            }
                          >
                            {C4DIcons.duplicate} Duplicate
                          </button>
                        )}
                        <button type="button" className="danger" onClick={removeSelected}>
                          {Icons.trash} Delete
                        </button>
                      </div>
                    </section>
                  </>
                ) : (
                  <section>
                    <h2>No object selected</h2>
                    <p className="muted">
                      Select an object in the Object Manager above, or spawn a Primitive, Character, Room, Light, or 3D Model from the top bar.
                    </p>
                  </section>
                ))}

              {/* ========================================================= */}
              {/* TAB: COORD. (Position, Rotation, Scale, Mirror, Floor)    */}
              {/* ========================================================= */}
              {tab === 'coord' &&
                (activeTarget ? (
                  <section aria-label="Object coordinates">
                    <div className="eyebrow">COORDINATES · {activeTarget.name.toUpperCase()}</div>
                    {activeTarget.locked && (
                      <p className="muted">Locked — unlock in Object Manager to edit coordinates.</p>
                    )}
                    <div className="field-block">
                      <Vector3Field
                        label="Position P (m)"
                        value={activeTarget.position}
                        min={-100}
                        max={100}
                        disabled={Boolean(activeTarget.locked)}
                        onChange={position => editActiveTarget({ position })}
                        onReset={
                          activeTarget.locked
                            ? undefined
                            : () => editActiveTarget({ position: [0, 0, 0] })
                        }
                      />
                      {activeTarget.kind !== 'light' && (
                        <>
                          <Vector3Field
                            label="Rotation R (°)"
                            value={activeTarget.rotation.map(degrees) as Vec3}
                            min={-360}
                            max={360}
                            step={5}
                            precision={1}
                            disabled={Boolean(activeTarget.locked)}
                            onChange={v =>
                              editActiveTarget({ rotation: v.map(radians) as Vec3 })
                            }
                            onReset={
                              activeTarget.locked
                                ? undefined
                                : () => editActiveTarget({ rotation: [0, 0, 0] })
                            }
                          />
                          <Vector3Field
                            label="Scale S"
                            value={activeTarget.scale}
                            min={-10}
                            max={10}
                            disabled={Boolean(activeTarget.locked)}
                            onChange={scale => {
                              if (scale.some(v => Math.abs(v) < 0.05)) {
                                notify(
                                  'Scale magnitude must be at least 0.05. Use Flip to mirror.',
                                  true,
                                );
                                return;
                              }
                              editActiveTarget({ scale });
                            }}
                            onReset={
                              activeTarget.locked
                                ? undefined
                                : () => editActiveTarget({ scale: [1, 1, 1] })
                            }
                          />
                        </>
                      )}
                      {!selectedOperandId && (
                        <div className="three">
                          {(['X', 'Y', 'Z'] as const).map((axis, index) => (
                            <button
                              key={axis}
                              type="button"
                              disabled={Boolean(activeTarget.locked)}
                              onClick={() => flipSelection(index as 0 | 1 | 2)}
                            >
                              Flip {axis}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="two">
                        <button
                          type="button"
                          disabled={Boolean(activeTarget.locked)}
                          onClick={snapSelectedToFloor}
                        >
                          {C4DIcons.snapFloor} Snap to floor
                        </button>
                        <button type="button" onClick={() => engine.current?.focusSelected()}>
                          {C4DIcons.frameSelection} Frame <kbd>F</kbd>
                        </button>
                      </div>
                    </div>
                  </section>
                ) : (
                  <section>
                    <p className="muted">Select an object to inspect its coordinates.</p>
                  </section>
                ))}

              {/* ========================================================= */}
              {/* TAB: MATERIAL & PHONG TAG                                 */}
              {/* ========================================================= */}
              {tab === 'material' &&
                activeTarget &&
                (isBody(activeTarget.kind) ? (
                  <CharacterMaterialPanel
                    cloth={clothControls}
                    item={activeTarget}
                    hairOptions={hairOptions}
                    disabled={Boolean(activeTarget.locked)}
                    onEdit={patch => editActiveTarget(patch)}
                  />
                ) : (
                  <MaterialTagPanel
                    item={activeTarget}
                    disabled={Boolean(activeTarget.locked)}
                    onEdit={patch => editActiveTarget(patch)}
                  />
                ))}

              {/* ========================================================= */}
              {/* TAB: MODIFIERS STACK                                      */}
              {/* ========================================================= */}
              {tab === 'modifiers' && activeTarget && canAttachModifiers(activeTarget) && (
                <ModifierStackPanel
                  targetName={activeTarget.name}
                  modifiers={activeTarget.modifiers ?? []}
                  focusedModifierId={focusedModifierId}
                  disabled={Boolean(activeTarget.locked)}
                  onAddModifier={attachModifierToActive}
                  onUpdateModifier={(modId, updater) =>
                    updateModifierOnItem(activeTarget.id, modId, updater)
                  }
                  onMoveModifier={(modId, dir) =>
                    moveModifierOnItem(activeTarget.id, modId, dir)
                  }
                  onRemoveModifier={modId => removeModifierOnItem(activeTarget.id, modId)}
                  onBakeToMesh={
                    canMakeEditable(activeTarget)
                      ? () => makeItemEditable(activeTarget.id)
                      : undefined
                  }
                />
              )}

              {/* ========================================================= */}
              {/* TAB: POSE (17-JOINT FK + PRESETS + MIXAMO MOTION)         */}
              {/* ========================================================= */}
              {tab === 'pose' && item && isBody(item.kind) && item.pose && (
                <>
                  <section>
                    <div className="section-head">
                      <h3>Joint &amp; preset posing</h3>
                      <span className="pill-badge">{joint ? label(joint) : 'Root'}</span>
                    </div>
                    <SwitchRow
                      label="Anatomical joint limits"
                      description="Constrain rotation to anatomical ranges; switch off for free posing"
                      checked={item.anatomicalLimits !== false}
                      onChange={anatomicalLimits => editItem({ anatomicalLimits })}
                    />
                    <div className="two">
                      <button type="button" onClick={() => copyNodesToClipboard(JOINTS)}>
                        Copy Pose
                      </button>
                      <button type="button" disabled={!poseClipboard} onClick={pasteClipboard}>
                        {!poseClipboard || poseClipboard.joints.length === 17
                          ? 'Paste Pose'
                          : 'Paste Partial Pose'}
                      </button>
                    </div>
                    <button type="button" className="full-btn" onClick={mirrorSelectedPose}>
                      Mirror Pose (L ↔ R)
                    </button>
                    {poseClipboard && (
                      <p className="muted">
                        Clipboard: {poseClipboard.joints.length}/17 joints from{' '}
                        {poseClipboard.source}
                      </p>
                    )}
                    <details className="pose-copy-tree">
                      <summary>Advanced Copy · Skeleton Tree</summary>
                      <div className="branch-pills">
                        {Object.entries(POSE_BRANCHES).map(([name, nodes]) => (
                          <button
                            key={name}
                            type="button"
                            onClick={() => setCopyNodes([...nodes])}
                          >
                            {name}
                          </button>
                        ))}
                      </div>
                      <div role="group" aria-label="Skeleton hierarchy">
                        {JOINTS.map(node => (
                          <label
                            key={node}
                            className="skeleton-node"
                            style={{ paddingInlineStart: `${8 + JOINT_DEPTH[node] * 14}px` }}
                          >
                            <input
                              type="checkbox"
                              checked={copyNodes.includes(node)}
                              onChange={event =>
                                setCopyNodes(previous =>
                                  event.target.checked
                                    ? [...previous, node]
                                    : previous.filter(j => j !== node),
                                )
                              }
                            />
                            {node === 'spine' ? 'Waist' : label(node)}
                          </label>
                        ))}
                      </div>
                      <button
                        type="button"
                        className="full-btn"
                        disabled={!copyNodes.length}
                        onClick={() => copyNodesToClipboard(copyNodes)}
                      >
                        Copy Selected Nodes ({copyNodes.length}/17)
                      </button>
                    </details>

                    <div className="select-field">
                      <span className="field-label">Editing target</span>
                      <SelectDropdown
                        ariaLabel="Editing joint"
                        value={joint ?? '__root__'}
                        options={jointOptions}
                        onChange={v => setJoint(v === '__root__' ? null : (v as Joint))}
                      />
                    </div>

                    {joint && (() => {
                      const activeFigure = engine.current?.getFigure(item.id);
                      const handRigs = activeFigure?.handRigs ?? null;
                      const isWrist = joint === 'leftWrist' || joint === 'rightWrist';
                      const inspectorDeg = poseJointToInspectorDegrees(
                        item.pose[joint],
                        joint,
                        handRigs,
                      );
                      const commitInspectorDeg = (nextDeg: Vec3) => {
                        const effectiveDeg: Vec3 =
                          isWrist && handRigs && item.anatomicalLimits !== false
                            ? [
                                Math.max(-115, Math.min(115, nextDeg[0])),
                                Math.max(-180, Math.min(180, nextDeg[1])),
                                Math.max(-95, Math.min(95, nextDeg[2])),
                              ]
                            : nextDeg;
                        const p = clone(item.pose!);
                        p[joint] = inspectorDegreesToPoseJoint(effectiveDeg, joint, handRigs);
                        const clamped = clampPoseToAnatomicalLimits(
                          p,
                          item.anatomicalLimits === false ? 'free' : 'anatomical',
                          resolveItemMorphology(item),
                        );
                        editItem({ pose: clamped });
                      };
                      return (
                        <>
                          <Vector3Field
                            label={
                              isWrist && handRigs
                                ? 'Wrist Flex · Twist · Tilt (°)'
                                : 'Joint rotation (°)'
                            }
                            value={inspectorDeg}
                            min={-360}
                            max={360}
                            step={5}
                            precision={1}
                            onChange={commitInspectorDeg}
                            onReset={() => {
                              const p = clone(item.pose!);
                              p[joint] = [0, 0, 0];
                              editItem({ pose: p });
                            }}
                          />
                          {isWrist && handRigs && (
                            <div className="wrist-quick-sliders">
                              <SliderField
                                label="Wrist Flex / Extend"
                                value={Math.round(inspectorDeg[0])}
                                min={item.anatomicalLimits === false ? -180 : -115}
                                max={item.anatomicalLimits === false ? 180 : 115}
                                step={1}
                                displayValue={`${Math.round(inspectorDeg[0])}°`}
                                onChange={flex => commitInspectorDeg([flex, inspectorDeg[1], inspectorDeg[2]])}
                              />
                              <SliderField
                                label="Wrist Twist (Pronate / Supinate)"
                                value={Math.round(inspectorDeg[1])}
                                min={-180}
                                max={180}
                                step={1}
                                displayValue={`${Math.round(inspectorDeg[1])}°`}
                                onChange={twist => commitInspectorDeg([inspectorDeg[0], twist, inspectorDeg[2]])}
                              />
                              <SliderField
                                label="Wrist Tilt (Radial / Ulnar)"
                                value={Math.round(inspectorDeg[2])}
                                min={item.anatomicalLimits === false ? -180 : -95}
                                max={item.anatomicalLimits === false ? 180 : 95}
                                step={1}
                                displayValue={`${Math.round(inspectorDeg[2])}°`}
                                onChange={tilt => commitInspectorDeg([inspectorDeg[0], inspectorDeg[1], tilt])}
                              />
                            </div>
                          )}
                        </>
                      );
                    })()}

                    <HandArticulationPanel
                      handPose={item.handPose}
                      activeJoint={joint}
                      hasFingers={hasPoseableFingers(engine.current?.getFigure(item.id)?.handRigs)}
                      onChangeHandPose={nextHandPose => editItem({ handPose: nextHandPose })}
                      onSelectWristJoint={w => setJoint(w)}
                    />

                    <div className="preset-block">
                      <div className="field-head">
                        <span className="field-label">Studio presets</span>
                        <span className="meta-note">Auto-grounded</span>
                      </div>
                      <div className="preset-grid" role="list" aria-label="Preset poses">
                        {PRESETS.map(p => {
                          const isCurrent = activePreset === p;
                          return (
                            <button
                              key={p}
                              type="button"
                              role="listitem"
                              className={isCurrent ? 'preset-tile active' : 'preset-tile'}
                              onClick={() => applyPresetPose(p)}
                            >
                              <span>{p}</span>
                              {isCurrent && <span className="preset-check">{Icons.check}</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="two">
                      <button
                        type="button"
                        onClick={() => {
                          const groundedY = engine.current?.groundPoseY(item.id, item.pose);
                          if (groundedY !== null && groundedY !== undefined) {
                            editItem({
                              position: [item.position[0], groundedY, item.position[2]],
                            });
                          }
                        }}
                      >
                        Snap to floor
                      </button>
                      <button type="button" onClick={() => setTab('library')}>
                        Save pose…
                      </button>
                    </div>
                    <div className="stack-gap">
                      <div className="two">
                        <button type="button" onClick={exportSelectedPoseJson}>
                          {Icons.download} Export pose JSON
                        </button>
                        <button type="button" onClick={() => poseJsonFile.current?.click()}>
                          {Icons.upload} Import pose JSON
                        </button>
                      </div>
                    </div>
                    <input
                      ref={poseJsonFile}
                      className="sr-only"
                      aria-label="Import pose JSON file"
                      type="file"
                      accept=".pose.json,.json,application/json"
                      onChange={async e => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        if (f) await importSelectedPoseJson(f);
                      }}
                    />
                  </section>

                  <section aria-label="Pose from animation">
                    <div className="section-head">
                      <h3>Pose from animation</h3>
                      <span className="pill-badge">
                        {activeClip
                          ? activeClip.source === 'file'
                            ? `${activeClip.rigFormat}`
                            : 'CC0'
                          : 'Mixamo · CC0'}
                      </span>
                    </div>
                    <div className="select-field">
                      <span className="field-label">Animation cycle</span>
                      <SelectDropdown
                        ariaLabel="Animation cycle"
                        value={activeCycleId}
                        placeholder={animBusy ? 'Loading animation…' : 'Select motion cycle…'}
                        leadingIcon={Icons.motion}
                        options={animOptions}
                        onChange={id => {
                          void chooseCycle(id);
                        }}
                      />
                    </div>
                    <button
                      type="button"
                      className="full-btn"
                      disabled={animBusy}
                      onClick={() => animFile.current?.click()}
                    >
                      {Icons.upload} Import Mixamo (.fbx / .glb)…
                    </button>
                    <input
                      ref={animFile}
                      className="sr-only"
                      aria-label="Import animation file"
                      type="file"
                      accept={ANIMATION_ACCEPT_EXTENSIONS}
                      onChange={async e => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        if (f) await importAnimFile(f);
                      }}
                    />
                    {activeClip && (
                      <div className="anim-controls">
                        <SliderField
                          label="Frame timeline"
                          ariaLabel="Animation frame"
                          min={0}
                          max={Math.max(0, activeClip.frameCount - 1)}
                          step={1}
                          value={Math.min(animFrame, Math.max(0, activeClip.frameCount - 1))}
                          displayValue={`F${Math.min(animFrame, Math.max(0, activeClip.frameCount - 1)) + 1}/${activeClip.frameCount}`}
                          onChange={nextFrame => {
                            setAnimPlaying(false);
                            setAnimFrame(nextFrame);
                            previewCycleFrame(activeClip, nextFrame, groundAnim, item);
                          }}
                        />
                        <SwitchRow
                          label="Ground figure to floor"
                          checked={groundAnim}
                          onChange={checked => {
                            setGroundAnim(checked);
                            previewCycleFrame(activeClip, animFrame, checked, item);
                          }}
                        />
                        <div className="two">
                          <button
                            type="button"
                            className={animPlaying ? 'active' : ''}
                            onClick={() => setAnimPlaying(p => !p)}
                            disabled={activeClip.frameCount <= 1}
                          >
                            {animPlaying ? Icons.pause : Icons.play}
                            {animPlaying ? 'Pause' : 'Play'}
                          </button>
                          <button
                            type="button"
                            className="primary"
                            onClick={() => applyActiveAnimPose(false)}
                          >
                            {Icons.check} Use this pose
                          </button>
                        </div>
                        {animPreviewing && (
                          <button type="button" className="full-btn" onClick={cancelAnimPreview}>
                            Cancel preview
                          </button>
                        )}
                      </div>
                    )}
                  </section>
                </>
              )}

              {/* ========================================================= */}
              {/* TAB: CAMERA & RENDER STYLE                                */}
              {/* ========================================================= */}
              {tab === 'camera' && (
                <>
                  <section>
                    <div className="eyebrow">COMPOSE · CAMERA</div>
                    <h2>Composition frame</h2>
                    <div className="two">
                      <button
                        type="button"
                        className={view ? 'active' : ''}
                        onClick={() => setView(!view)}
                      >
                        {view ? 'Return to editor' : 'Inspect camera'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const c = engine.current?.useEditorCamera();
                          if (c) editCamera(c);
                        }}
                      >
                        Match editor view
                      </button>
                    </div>
                  </section>

                  <section aria-label="Scene lighting">
                    <h3>Scene lighting</h3>
                    <SwitchRow
                      label="Scene lights only"
                      description="No ambient or studio fill — lit strictly by scene lights"
                      checked={sceneLightsOnly}
                      onChange={setSceneLightsOnly}
                    />
                  </section>

                  <section aria-label="Quality, shadows and global illumination">
                    <h3>Quality, GI &amp; shadows</h3>
                    <div className="field-block">
                      <div className="select-field">
                        <span className="field-label">Render quality</span>
                        <SegmentedControl
                          ariaLabel="Render quality"
                          fullWidth
                          value={renderQuality}
                          items={RENDER_QUALITY_MODES.map(rq => ({
                            value: rq,
                            label: RENDER_QUALITY_LABELS[rq],
                          }))}
                          onChange={rq => editRenderSettings({ renderQuality: rq })}
                        />
                      </div>
                      <SwitchRow
                        label="Global illumination"
                        description="Real-time surface color bleeding & multi-bounce indirect fill"
                        checked={giEnabled}
                        onChange={enabled => editRenderSettings({ giEnabled: enabled })}
                      />
                      {giEnabled && (
                        <SliderField
                          label="Bounce intensity"
                          ariaLabel="GI bounce intensity"
                          value={giIntensity}
                          min={0}
                          max={2.5}
                          step={0.05}
                          displayValue={`${Math.round(giIntensity * 100)}%`}
                          onChange={val => editRenderSettings({ giIntensity: val }, 'gi-intensity')}
                        />
                      )}
                      <SwitchRow
                        label="Ambient occlusion (GTAO)"
                        description="Ground-truth contact crease shading on stage surfaces"
                        checked={aoEnabled}
                        onChange={enabled => editRenderSettings({ aoEnabled: enabled })}
                      />
                      <SliderField
                        label="Shadow softness (PCSS)"
                        ariaLabel="Shadow softness"
                        value={shadowSoftness}
                        min={0}
                        max={2.5}
                        step={0.05}
                        displayValue={`${shadowSoftness.toFixed(2)}×`}
                        onChange={val =>
                          editRenderSettings({ shadowSoftness: val }, 'shadow-softness')
                        }
                      />
                    </div>
                  </section>

                  <section>
                    <h3>Lens &amp; framing</h3>
                    <Vector3Field
                      label="Camera position (m)"
                      value={doc.camera.position}
                      min={-100}
                      max={100}
                      onChange={position => editCamera({ position })}
                    />
                    <Vector3Field
                      label="Aim target (m)"
                      value={doc.camera.target}
                      min={-100}
                      max={100}
                      onChange={target => editCamera({ target })}
                    />
                    <SliderField
                      label="Focal length"
                      ariaLabel="Lens (mm)"
                      value={doc.camera.focalLength}
                      min={15}
                      max={150}
                      step={1}
                      displayValue={`${doc.camera.focalLength} mm`}
                      onChange={focalLength => editCamera({ focalLength })}
                    />
                    <div className="select-field">
                      <span className="field-label">Output aspect ratio</span>
                      <SegmentedControl
                        ariaLabel="Output aspect"
                        fullWidth
                        value={doc.camera.aspect}
                        items={[
                          { value: '3:2', label: '3:2' },
                          { value: '16:9', label: '16:9' },
                          { value: '1:1', label: '1:1' },
                          { value: '4:5', label: '4:5' },
                        ]}
                        onChange={aspect => editCamera({ aspect })}
                      />
                    </div>
                    <div className="two">
                      <NumericField
                        label="Near clip (m)"
                        ariaLabel="Near clip (m)"
                        value={doc.camera.near}
                        min={0.01}
                        max={Math.min(10, doc.camera.far - 0.01)}
                        onChange={near => editCamera({ near })}
                      />
                      <NumericField
                        label="Far clip (m)"
                        ariaLabel="Far clip (m)"
                        value={doc.camera.far}
                        min={Math.max(1, doc.camera.near + 0.01)}
                        max={500}
                        step={1}
                        onChange={far => editCamera({ far })}
                      />
                    </div>
                  </section>

                  <section>
                    <h3>Depth of field</h3>
                    <SwitchRow
                      label="Enable real lens blur"
                      description="Rendered in Camera view and exported PNG"
                      checked={doc.camera.dof}
                      onChange={dof => editCamera({ dof })}
                    />
                    <div className="stack-gap">
                      <NumericField
                        label="Focus distance (m)"
                        ariaLabel="Focus distance (m)"
                        value={doc.camera.focus}
                        min={0.1}
                        max={100}
                        onChange={focus => editCamera({ focus })}
                      />
                      <div className="two">
                        <NumericField
                          label="Aperture"
                          ariaLabel="Aperture / blur strength"
                          value={doc.camera.aperture}
                          min={0.00001}
                          max={0.005}
                          step={0.00005}
                          precision={5}
                          onChange={aperture => editCamera({ aperture })}
                        />
                        <NumericField
                          label="Max blur"
                          ariaLabel="Maximum blur"
                          value={doc.camera.maxBlur}
                          min={0.001}
                          max={0.05}
                          step={0.001}
                          precision={3}
                          onChange={maxBlur => editCamera({ maxBlur })}
                        />
                      </div>
                      <button
                        type="button"
                        className="full-btn"
                        onClick={() => {
                          const focus = engine.current?.selectedFocusDistance();
                          if (focus != null) editCamera({ focus });
                        }}
                        disabled={!item}
                      >
                        Focus on selected object
                      </button>
                    </div>
                  </section>

                  <section aria-label="Render style">
                    <h3>Render style</h3>
                    <SelectDropdown
                      ariaLabel="Shading mode"
                      value={renderStyle.mode}
                      options={SHADING_ITEMS}
                      onChange={mode => editRenderStyle({ mode: mode as RenderStyleState['mode'] })}
                    />
                    {(renderStyle.mode === 'illustration' ||
                      renderStyle.mode === 'outline' ||
                      (renderStyle.mode === 'clay' && renderStyle.clayOutlines)) && (
                      <>
                        <ColorField
                          label="Ink color"
                          value={renderStyle.inkColor}
                          onChange={inkColor => editRenderStyle({ inkColor })}
                        />
                        <SliderField
                          label="Ink thickness"
                          value={renderStyle.inkWidth}
                          min={0.5}
                          max={3}
                          step={0.1}
                          displayValue={`${renderStyle.inkWidth.toFixed(1)} px`}
                          onChange={inkWidth => editRenderStyle({ inkWidth })}
                        />
                        <SliderField
                          label="Interior detail"
                          value={renderStyle.interiorDetail}
                          min={0}
                          max={1}
                          step={0.05}
                          displayValue={`${Math.round(renderStyle.interiorDetail * 100)}%`}
                          onChange={interiorDetail => editRenderStyle({ interiorDetail })}
                        />
                      </>
                    )}
                    {renderStyle.mode === 'illustration' && (
                      <>
                        <SegmentedControl
                          ariaLabel="Shadow steps"
                          fullWidth
                          value={String(renderStyle.shadowSteps)}
                          items={[
                            { value: '2', label: '2-tone' },
                            { value: '3', label: '3-tone' },
                          ]}
                          onChange={steps => editRenderStyle({ shadowSteps: steps === '2' ? 2 : 3 })}
                        />
                        <SegmentedControl
                          ariaLabel="Shadow temperature"
                          fullWidth
                          value={renderStyle.shadowTemp}
                          items={[
                            { value: 'cool', label: 'Cool' },
                            { value: 'warm', label: 'Warm' },
                            { value: 'neutral', label: 'Neutral' },
                          ]}
                          onChange={shadowTemp => editRenderStyle({ shadowTemp })}
                        />
                      </>
                    )}
                    {renderStyle.mode === 'outline' && (
                      <div className="select-field">
                        <span className="field-label">Paper background / Transparent PNG</span>
                        <SelectDropdown
                          ariaLabel="Paper background"
                          value={renderStyle.outlinePaper}
                          options={[
                            { value: 'warm', label: 'Warm paper' },
                            { value: 'white', label: 'Pure white' },
                            { value: 'scene', label: 'Scene background' },
                            { value: 'transparent', label: 'Transparent PNG' },
                          ]}
                          onChange={paper =>
                            editRenderStyle({
                              outlinePaper: paper as RenderStyleState['outlinePaper'],
                            })
                          }
                        />
                      </div>
                    )}
                    {renderStyle.mode === 'clay' && (
                      <>
                        <SelectDropdown
                          ariaLabel="Clay tone"
                          value={renderStyle.clayFinish}
                          options={[
                            { value: 'terracotta', label: 'Terracotta' },
                            { value: 'grey', label: 'Studio Grey' },
                            { value: 'plaster', label: 'Warm Plaster' },
                          ]}
                          onChange={tone =>
                            editRenderStyle({ clayFinish: tone as RenderStyleState['clayFinish'] })
                          }
                        />
                        <SwitchRow
                          label="Contour ink"
                          checked={renderStyle.clayOutlines}
                          onChange={clayOutlines => editRenderStyle({ clayOutlines })}
                        />
                      </>
                    )}
                  </section>

                  <section>
                    <h3>Stage backdrop</h3>
                    <ColorField
                      label="Background color"
                      value={doc.background}
                      onChange={background =>
                        update(d => {
                          d.background = background;
                        })
                      }
                    />
                    <button
                      type="button"
                      className="primary full-btn"
                      onClick={png}
                      disabled={busy}
                    >
                      Export camera PNG
                    </button>
                  </section>
                </>
              )}

              {/* ========================================================= */}
              {/* TAB: LIBRARY                                              */}
              {/* ========================================================= */}
              {tab === 'library' && (
                <>
                  <section>
                    <div className="eyebrow">LIBRARY · LOCAL &amp; PORTABLE</div>
                    <h2>Save study</h2>
                    <label className="text-field">
                      <span className="field-label">Study name</span>
                      <input
                        aria-label="Save name"
                        value={saveName}
                        maxLength={80}
                        onChange={e => setSaveName(e.target.value)}
                      />
                    </label>
                    <div className="two">
                      <button
                        type="button"
                        className="primary"
                        disabled={busy || !saveName.trim()}
                        onClick={() => save('scene')}
                      >
                        Save scene
                      </button>
                      <button
                        type="button"
                        disabled={busy || !saveName.trim() || !item || !isBody(item.kind)}
                        onClick={() => save('pose')}
                      >
                        Save pose
                      </button>
                    </div>
                  </section>

                  <section>
                    <h3>Portable JSON files</h3>
                    <div className="two">
                      <button type="button" onClick={() => void exportJson('scene')}>
                        {Icons.download} Scene JSON
                      </button>
                      <button
                        type="button"
                        disabled={!item || !isBody(item.kind)}
                        onClick={() => void exportJson('pose')}
                      >
                        {Icons.download} Pose JSON
                      </button>
                    </div>
                    <button
                      type="button"
                      className="full-btn"
                      onClick={() => file.current?.click()}
                    >
                      {Icons.upload} Import pose / scene JSON…
                    </button>
                    <input
                      ref={file}
                      className="sr-only"
                      aria-label="Import JSON file"
                      type="file"
                      accept=".json,application/json"
                      onChange={async e => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        try {
                          if (f.size > MAX_RICH_SCENE_FILE_BYTES) {
                            throw new Error('File exceeds the 64 MB scene import limit.');
                          }
                          await loadPortable(parseFile(await f.text(), MAX_RICH_SCENE_FILE_BYTES));
                        } catch (err) {
                          report(err);
                        } finally {
                          e.target.value = '';
                        }
                      }}
                    />
                  </section>

                  <section>
                    <div className="section-head">
                      <h3>Saved on this browser</h3>
                      <span className="pill-badge">{saved.length}</span>
                    </div>
                    {saved.length === 0 ? (
                      <div className="empty-card">
                        No saved studies yet. Name your study above and click Save scene or Save pose.
                      </div>
                    ) : (
                      <ul className="list-stack" aria-label="Saved studies">
                        {saved.map(s => (
                          <ListRow
                            key={s.id}
                            icon={s.type === 'scene' ? Icons.scene : Icons.pose}
                            title={s.name}
                            meta={`${label(s.type)} · ${new Date(s.savedAt).toLocaleDateString()}`}
                            onSelect={async () => {
                              try {
                                await loadPortable(s.data);
                              } catch (e) {
                                report(e);
                              }
                            }}
                            onDelete={async () => {
                              try {
                                await deleteLocal(s.id);
                                setSaved(await listSaved());
                                notify('Local save deleted.');
                              } catch (e) {
                                report(e);
                              }
                            }}
                            deleteLabel={`Delete saved ${s.name}`}
                          />
                        ))}
                      </ul>
                    )}
                  </section>
                </>
              )}
            </div>
          </section>
        </aside>
      </div>

      {(loading || loadError) && (
        <div className="boot-overlay">
          <div className={`boot-card ${loadError ? 'error' : ''}`} role={loadError ? 'alert' : 'status'}>
            <div className="eyebrow">LOCAL ASSETS · C4D MODELING &amp; FIGURE STUDIO</div>
            <h2>{loadError ? 'The studio assets could not be loaded' : 'Opening your 3D studio'}</h2>
            <p>
              {loadError ??
                'Loading character rigs, hairstyles, textures, rooms, and modeling assets locally.'}
            </p>
            {loadError && (
              <button type="button" className="primary" onClick={() => setRetry(n => n + 1)}>
                Retry loading assets
              </button>
            )}
            <small>Your existing local scenes, models, and poses remain untouched.</small>
          </div>
        </div>
      )}

      {notice && (
        <div className={`toast ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}>
          <span>{notice.text}</span>
          <button type="button" className="icon-btn" aria-label="Dismiss notification" onClick={() => setNotice(null)}>
            ×
          </button>
        </div>
      )}

      {help && (
        <div className="modal-backdrop" onClick={() => setHelp(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="Studio help" onClick={e => e.stopPropagation()}>
            <div className="panel-heading">
              <h2>Pose, Composition &amp; Cinema 4D Modeling Studio</h2>
              <button type="button" className="icon-btn" onClick={() => setHelp(false)} aria-label="Close help">
                ×
              </button>
            </div>
            <div className="modal-content">
              <h3>01 / Parametric Primitives, Modifiers &amp; Live CSG Booleans</h3>
              <p>
                Spawn 11 parametric primitives (Cube, Sphere, Cylinder, Cone, Pyramid, Torus, Capsule, Tube, Plane, Disc,
                Platonic) with live <strong>Fillet &amp; Chamfer</strong> controls. Attach non-destructive{' '}
                <strong>Modifiers</strong> (Bevel, Subdivision Surface, Mirror, Solidify, Bend, Twist, Taper, Array) or
                select 2 objects and click <strong>Boole</strong> for live Union, Subtract (A − B), or Intersect!
              </p>
              <h3>02 / Quad Polygon Modeling &amp; Multi-Format 3D Import</h3>
              <p>
                Click <strong>Make Editable</strong> on any Primitive, Boole, Prop, or Imported 3D file to unlock{' '}
                <strong>Point, Edge, and Polygon</strong> component modes on the left strip — with Extrude, Inset, Bevel
                / Fillet, Loop Cut, Bridge, Weld, Subdivide, Dissolve, Flip Normals, and Close Holes. Drag &amp; drop{' '}
                <code>.glb</code>, <code>.gltf</code>, <code>.obj</code> (+ <code>.mtl</code>), <code>.fbx</code>,{' '}
                <code>.stl</code>, <code>.ply</code>, <code>.dae</code>, or <code>.3ds</code> files directly onto the
                stage!
              </p>
              <h3>03 / Rigged Characters, Lighting &amp; Camera Composition</h3>
              <p>
                Pose 15 characters with 17 FK joints, studio presets, or Mixamo motion clips; aim Spotlights with linked
                targets; and render 1600 px PNGs in Realistic, Illustration, Clay, Outline, or Flat shading.
              </p>
              <dl className="shortcuts">
                <dt>Left drag / Middle or Right drag / Wheel</dt>
                <dd>Surface-depth orbit / 1:1 depth pan / Cursor zoom</dd>
                <dt>W / E / R</dt>
                <dd>Move / Rotate / Scale (Objects, Operands, Joints &amp; Mesh Components)</dd>
                <dt>Shift + Drag (Rotate)</dt>
                <dd>Snap rotation to 15° increments</dd>
                <dt>1 / 2 / 3 / 4 / 5</dt>
                <dd>Realistic / Illustration / Outline / Clay / Flat</dd>
                <dt>Shift-click / Ctrl-drag</dt>
                <dd>Multi-select objects or mesh vertices/edges/polygons</dd>
                <dt>F / C / Escape</dt>
                <dd>Frame selected / Toggle Camera / Exit tool or component mode</dd>
                <dt>Ctrl Z / Ctrl Shift Z / Delete</dt>
                <dd>Undo / Redo (100 steps) / Delete selected object or mesh faces</dd>
              </dl>
              <button type="button" className="primary" onClick={() => setHelp(false)}>
                Start creating
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function label(value: string) {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^\w/, c => c.toUpperCase());
}

