import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  ColorField,
  Icons,
  ListRow,
  NumericField,
  SegmentedControl,
  SelectDropdown,
  SliderField,
  SwitchRow,
  Vector3Field,
  type SelectOption,
} from './components/ui';
import { computeStudioAnchoredFigureY, Studio, syncStudioScene } from './engine';
import { loadExternalFigures } from './external-rig';
import { BODY_TYPES, DEFAULT_BODY_TYPE, isBodyTypeId, type BodyTypeId } from './bodyProportions';
import { clampPoseToAnatomicalLimits } from './skinDeformer';
import { defaultHairStyle, HAIR_STYLE_LABELS, HAIR_STYLES } from './hair';
import {
  applyChibiDefaultRenderStyle,
  applyPose,
  clone,
  copyPoseNodes,
  createDefaultScene,
  createItem,
  DEFAULT_RENDER_STYLE,
  DEFAULT_HAIR_COLOR,
  defaultOutfitColor,
  degrees,
  initialScene,
  isBody,
  flipItems,
  JOINTS,
  MAX_FILE_BYTES,
  parseFile,
  parsePoseFile,
  poseFile,
  pastePoseNodes,
  PRESETS,
  preset,
  PROP_KINDS,
  radians,
  RENDER_MODES,
  selectionCentroid,
  swapItemBodyKind,
  validatePortable,
  type Body,
  type HairStyleId,
  type Item,
  type Joint,
  type Portable,
  type Pose,
  type PoseClipboard,
  type RenderStyleState,
  type SceneState,
  type Vec3,
} from './model';
import {
  DEFAULT_ORBIT_VIEW,
  deleteLocal,
  download,
  downloadBlob,
  listSaved,
  loadWorkingDraft,
  sanitizeWorkingView,
  saveLocal,
  WorkingDraftAutoSaver,
  type AutosaveStatus,
  type OrbitViewState,
  type Saved,
  type WorkingDraft,
  type WorkingViewState,
} from './storage';

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

type Tab = 'object' | 'camera' | 'library';
type Notice = { text: string; error: boolean };

function posesMatch(a: Pose | undefined, b: Pose): boolean {
  if (!a) return false;
  for (const j of JOINTS) {
    for (let k = 0; k < 3; k++) {
      if (Math.abs(a[j][k] - b[j][k]) > 1e-3) return false;
    }
  }
  return true;
}

export function App() {
  const [doc, setDoc] = useState(initialScene);
  const current = useRef(doc);
  const past = useRef<SceneState[]>([]),
    future = useRef<SceneState[]>([]);
  const [historyTick, historyUpdate] = useState(0);
  const [selected, setSelected] = useState<string | null>(doc.items[0].id);
  const [selectedIds, setSelectedIds] = useState<string[]>([doc.items[0].id]);
  const selection = selected && !selectedIds.includes(selected) ? [selected] : selectedIds.filter(id => doc.items.some(i => i.id === id));
  const selectionRef = useRef(selection); selectionRef.current = selection;
  const [poseClipboard, setPoseClipboard] = useState<PoseClipboard | null>(null);
  const [copyNodes, setCopyNodes] = useState<Joint[]>([...JOINTS]);
  const [joint, setJoint] = useState<Joint | null>(null);
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
    engine = useRef<Studio | null>(null),
    file = useRef<HTMLInputElement>(null),
    poseJsonFile = useRef<HTMLInputElement>(null),
    animFile = useRef<HTMLInputElement>(null);
  const orbitViewRef = useRef<OrbitViewState>(clone(DEFAULT_ORBIT_VIEW));
  const cameraGestureBaseRef = useRef<SceneState | null>(null);
  const isDraggingCameraRef = useRef(false);
  const saverRef = useRef<WorkingDraftAutoSaver | null>(null);

  const liveSettings = useRef({ selected, joint, view, mode, showJoints, showHelpers });
  liveSettings.current = { selected, joint, view, mode, showJoints, showHelpers };

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    setTheme(next);
  };

  const notify = useCallback((text: string, error = false) => setNotice({ text, error }), []);
  const report = useCallback((e: unknown) => notify(e instanceof Error ? e.message : String(e), true), [notify]);

  if (!saverRef.current) {
    saverRef.current = new WorkingDraftAutoSaver({
      throttleMs: 120,
      onStatus: (status, err) => {
        setAutosaveStatus(status);
        if (status === 'error' && err) {
          setNotice({ text: err instanceof Error ? err.message : String(err), error: true });
        }
      },
    });
  }

  const buildDraft = useCallback(
    (sceneOverride?: SceneState, viewPatch?: Partial<WorkingViewState>): WorkingDraft => {
      const s = liveSettings.current;
      return {
        scene: sceneOverride ?? current.current,
        view: {
          editorCamera: viewPatch?.editorCamera ?? orbitViewRef.current,
          selectedId: viewPatch && 'selectedId' in viewPatch ? viewPatch.selectedId : s.selected,
          selectedJoint: viewPatch && 'selectedJoint' in viewPatch ? viewPatch.selectedJoint : s.joint,
          cameraView: viewPatch?.cameraView ?? s.view,
          transformMode: viewPatch?.transformMode ?? s.mode,
        },
      };
    },
    [],
  );

  const commit = useCallback(
    (next: SceneState, viewPatch?: Partial<WorkingViewState>) => {
      for (const figure of next.items) {
        if (!isBody(figure.kind) || !figure.pose) continue;
        const previous = current.current.items.find(i => i.id === figure.id);
        const pose = figure.pose, previousPose = previous?.pose;
        const poseChanged = !previousPose || JOINTS.some(j => pose[j].some((v, axis) => v !== previousPose[j][axis]));
        if (poseChanged || (figure.anatomicalLimits !== false && previous?.anatomicalLimits === false)) {
          figure.pose = clampPoseToAnatomicalLimits(figure.pose, figure.anatomicalLimits === false ? 'free' : 'anatomical');
        }
      }
      past.current.push(clone(current.current));
      if (past.current.length > 100) past.current.shift();
      future.current = [];
      current.current = next;
      setDoc(next);
      historyUpdate(t => t + 1);
      void saverRef.current?.saveNow(buildDraft(next, viewPatch));
    },
    [buildDraft],
  );
  const update = (fn: (next: SceneState) => void) => {
    const next = clone(current.current);
    fn(next);
    commit(next);
  };

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

  const select = useCallback(
    (id: string | null, j: Joint | null, additive = false) => {
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
      setSelectedIds(ids);
      setSelected(additive ? ids.at(-1) ?? null : id);
      setJoint(ids.length > 1 ? null : j);
      if (id) setTab('object');
    },
    [applyActiveAnimPose],
  );

  const item = doc.items.find(i => i.id === selected);
  const editItem = (patch: Partial<Item>) => {
    if ((patch.bodyType !== undefined || patch.anatomicalLimits !== undefined) && previewStateRef.current.animPreviewing) {
      setAnimPlaying(false);
      setAnimPreviewing(false);
    }
    update(next => {
      const i = next.items.find(i => i.id === selected);
      if (i) {
        const needsAnchor =
          isBody(i.kind) &&
          Boolean(i.pose) &&
          (patch.bodyType !== undefined || patch.anatomicalLimits !== undefined);
        Object.assign(i, patch);
        if (needsAnchor && isBody(i.kind) && i.pose) {
          i.pose = clampPoseToAnatomicalLimits(i.pose, i.anatomicalLimits === false ? 'free' : 'anatomical');
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
    });
  };
  const swapBaseFigure = (nextKind: Body) => {
    const currentItem = current.current.items.find(i => i.id === selected);
    if (!currentItem || !isBody(currentItem.kind) || currentItem.kind === nextKind) return;
    if (previewStateRef.current.animPreviewing) {
      setAnimPlaying(false);
      setAnimPreviewing(false);
    }
    update(next => {
      const idx = next.items.findIndex(i => i.id === selected);
      const target = idx >= 0 ? next.items[idx] : undefined;
      if (!target || !isBody(target.kind)) return;
      const anchoredY = computeStudioAnchoredFigureY(engine.current, target.id, {
        kind: nextKind,
        bodyType: target.bodyType,
        anatomicalLimits: target.anatomicalLimits,
        pose: target.pose,
      });
      next.items[idx] = swapItemBodyKind(target, nextKind, anchoredY ?? target.position[1]);
    });
  };
  const editCamera = (patch: Partial<SceneState['camera']>) => update(next => Object.assign(next.camera, patch));
  const renderStyle = { ...DEFAULT_RENDER_STYLE, ...doc.renderStyle };
  const editRenderStyle = (patch: Partial<RenderStyleState>) => update(next => {
    next.renderStyle = { ...DEFAULT_RENDER_STYLE, ...next.renderStyle, ...patch };
  });
  const flipSelection = (axis: 0 | 1 | 2) => {
    try {
      const next = clone(current.current);
      next.items = flipItems(next.items, selection, axis);
      validatePortable(next);
      commit(next);
    } catch (error) { report(error); }
  };
  const selectMany = (ids: string[]) => {
    cancelAnimPreview();
    setSelectedIds(ids); setSelected(ids.at(-1) ?? null); setJoint(null);
    if (ids.length) setTab('object');
  };
  const copyNodesToClipboard = (nodes: readonly Joint[]) => {
    if (!item) return;
    setPoseClipboard(copyPoseNodes(item, nodes));
    notify(`Copied ${nodes.length}/17 joints from ${item.name}.`);
  };
  const pasteClipboard = () => {
    if (!item || !poseClipboard) return;
    cancelAnimPreview();
    editItem({ pose: pastePoseNodes(item, poseClipboard).pose });
    notify(`Pasted ${poseClipboard.joints.length}/17 joints from ${poseClipboard.source}.`);
  };
  const undo = useCallback(
    (redo = false) => {
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
      current.current = next;
      const curSelected = liveSettings.current.selected;
      const resolvedSelected =
        curSelected && next.items.some(i => i.id === curSelected) ? curSelected : (next.items[0]?.id ?? null);
      const resolvedItem = resolvedSelected ? next.items.find(i => i.id === resolvedSelected) : undefined;
      const resolvedJoint =
        resolvedItem && isBody(resolvedItem.kind) ? liveSettings.current.joint : null;
      if (resolvedSelected !== curSelected) setSelected(resolvedSelected);
      setSelectedIds(resolvedSelected ? [resolvedSelected] : []);
      if (resolvedJoint !== liveSettings.current.joint) setJoint(resolvedJoint);
      setDoc(next);
      historyUpdate(t => t + 1);
      void saverRef.current?.saveNow(
        buildDraft(next, { selectedId: resolvedSelected, selectedJoint: resolvedJoint }),
      );
    },
    [buildDraft],
  );

  const startNewScene = useCallback(() => {
    engine.current?.cancelCameraGesture();
    cameraGestureBaseRef.current = null;
    isDraggingCameraRef.current = false;
    setAnimPlaying(false);
    setAnimPreviewing(false);
    const fresh = createDefaultScene();
    const nextSelected = fresh.items[0]?.id ?? null;
    const resetOrbit = clone(DEFAULT_ORBIT_VIEW);
    orbitViewRef.current = resetOrbit;
    engine.current?.setOrbitView(resetOrbit.position, resetOrbit.target);
    setSelected(nextSelected);
    setSelectedIds(nextSelected ? [nextSelected] : []);
    setJoint(null);
    setView(false);
    setMode('translate');
    setSaveName('My study');
    commit(fresh, {
      editorCamera: resetOrbit,
      selectedId: nextSelected,
      selectedJoint: null,
      cameraView: false,
      transformMode: 'translate',
    });
    notify('Started new scene — Undo to restore');
  }, [commit, notify]);

  const removeItemById = useCallback(
    (id: string) => {
      setAnimPlaying(false);
      setAnimPreviewing(false);
      const next = clone(current.current);
      next.items = next.items.filter(i => i.id !== id);
      const nextSelected = selected === id ? (next.items[0]?.id ?? null) : selected;
      const nextJoint = selected === id ? null : joint;
      if (selected === id) {
        setSelected(nextSelected);
        setJoint(null);
      }
      commit(next, { selectedId: nextSelected, selectedJoint: nextJoint });
    },
    [selected, joint, commit],
  );

  const removeSelected = useCallback(() => {
    if (selected) removeItemById(selected);
  }, [selected, removeItemById]);

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
        saverRef.current?.schedule(buildDraft(liveNext));
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
      past.current.push(base);
      if (past.current.length > 100) past.current.shift();
      future.current = [];
      current.current = finalScene;
      setDoc(finalScene);
      historyUpdate(t => t + 1);
      void saverRef.current?.saveNow(buildDraft(finalScene));
    },
    [buildDraft],
  );

  const studioCallbacksRef = useRef({
    change: (next: SceneState) => commit(next),
    liveChange: (liveScene: SceneState) => {
      saverRef.current?.schedule(buildDraft(liveScene));
    },
    orbitChange: (orbit: OrbitViewState, settled: boolean) => {
      orbitViewRef.current = orbit;
      if (settled) {
        void saverRef.current?.saveNow(buildDraft(undefined, { editorCamera: orbit }));
      } else {
        saverRef.current?.schedule(buildDraft(undefined, { editorCamera: orbit }));
      }
    },
    cameraChange: handleCameraOrbitGesture,
    select,
    selectMany,
    error: report,
  });
  studioCallbacksRef.current = {
    change: (next: SceneState) => commit(next),
    liveChange: (liveScene: SceneState) => {
      saverRef.current?.schedule(buildDraft(liveScene));
    },
    orbitChange: (orbit: OrbitViewState, settled: boolean) => {
      orbitViewRef.current = orbit;
      if (settled) {
        void saverRef.current?.saveNow(buildDraft(undefined, { editorCamera: orbit }));
      } else {
        saverRef.current?.schedule(buildDraft(undefined, { editorCamera: orbit }));
      }
    },
    cameraChange: handleCameraOrbitGesture,
    select,
    selectMany,
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
      .then(([, loaded]) => {
        if (cancelled) return;

        let bootScene = current.current;
        let bootSelected = liveSettings.current.selected;
        let bootJoint = liveSettings.current.joint;
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
            bootScene = loaded.draft.scene;
            const v = sanitizeWorkingView(loaded.draft.view, bootScene);
            bootSelected = v.selectedId ?? null;
            bootJoint = v.selectedJoint ?? null;
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
              joint: bootJoint,
              view: bootCameraView,
              mode: bootMode,
            };
            setDoc(bootScene);
            setSelected(bootSelected);
            setJoint(bootJoint);
            setView(bootCameraView);
            setMode(bootMode);
          }
        }

        const studio = new Studio(host.current!, {
          change: next => studioCallbacksRef.current.change(next),
          liveChange: live => studioCallbacksRef.current.liveChange(live),
          orbitChange: (orbit, settled) => studioCallbacksRef.current.orbitChange(orbit, settled),
          cameraChange: (pose, settled) => studioCallbacksRef.current.cameraChange(pose, settled),
          select: (id, j, additive) => studioCallbacksRef.current.select(id, j, additive),
          selectMany: ids => studioCallbacksRef.current.selectMany(ids),
          error: err => studioCallbacksRef.current.error(err),
        });
        engine.current = studio;
        (host.current as (HTMLDivElement & { __studio?: Studio }) | null)!.__studio = studio;
        try {
          const s = liveSettings.current;
          studio.sync(bootScene);
          studio.setOrbitView(bootOrbit.position, bootOrbit.target);
          studio.setMode(bootMode);
          studio.setHelpers(s.showJoints, s.showHelpers);
          studio.setView(bootCameraView);
          studio.select(bootSelected, bootJoint);
          if (!saverRef.current?.isHydrated()) {
            saverRef.current?.markHydrated(
              {
                scene: bootScene,
                view: {
                  editorCamera: bootOrbit,
                  selectedId: bootSelected,
                  selectedJoint: bootJoint,
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
    if (!saverRef.current?.isHydrated() || isDraggingCameraRef.current) return;
    void saverRef.current.saveNow(
      buildDraft(doc, {
        selectedId: selected,
        selectedJoint: joint,
        cameraView: view,
        transformMode: mode,
      }),
    );
  }, [doc, selected, joint, view, mode, buildDraft]);

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
      void saver.saveNow(buildDraft(liveScene, { editorCamera: liveOrbit }));
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
  }, [buildDraft]);

  useEffect(() => {
    syncStudioScene(engine.current, doc);
  }, [doc]);
  useEffect(() => {
    engine.current?.select(selected, joint, selection);
  }, [selected, selectedIds, joint, doc]);
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
      if ((e.target as HTMLElement)?.closest('input, textarea, select, [role="combobox"], [role="listbox"], [contenteditable]')) return;
      if (loading || loadError) return;
      if (e.key === 'Escape') {
        setHelp(false);
        setJoint(null);
      }
      if (help) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo(e.shiftKey);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        undo(true);
      } else if (!e.ctrlKey && !e.metaKey && /^[1-5]$/.test(e.key)) {
        const next = clone(current.current);
        next.renderStyle = { ...DEFAULT_RENDER_STYLE, ...next.renderStyle, mode: RENDER_MODES[Number(e.key) - 1] };
        commit(next);
      } else if (e.key.toLowerCase() === 'w') {
        setJoint(null);
        setMode('translate');
      } else if (e.key.toLowerCase() === 'e') {
        setJoint(null);
        setMode('rotate');
      } else if (e.key.toLowerCase() === 'r' && selectionRef.current.length < 2) {
        setJoint(null);
        setMode('scale');
      } else if (e.key.toLowerCase() === 'f') engine.current?.focusSelected();
      else if (e.key === 'Delete') removeSelected();
      else if (e.key.toLowerCase() === 'c') setView(v => !v);
      else if (e.key === '?') setHelp(true);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, removeSelected, help, loading, loadError, commit]);

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

  const add = (kind: Item['kind']) => {
    if (doc.items.length >= 64) {
      report(new Error('Scene limit: 64 objects.'));
      return;
    }
    if (kind === 'light' && doc.items.filter(i => i.kind === 'light').length >= 8) {
      report(new Error('Scene limit: 8 lights.'));
      return;
    }
    const added = createItem(kind, doc.items.filter(i => i.kind === kind).length, newBodyType);
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
    const nextPose = preset(presetName);
    const groundedY = engine.current?.groundPoseY(item.id, nextPose);
    const nextPosition: Vec3 = [item.position[0], groundedY ?? item.position[1], item.position[2]];
    const next = clone(current.current);
    const dst = next.items.find(i => i.id === item.id);
    if (dst) {
      dst.pose = nextPose;
      dst.position = nextPosition;
    }
    setJoint(null);
    commit(next, { selectedJoint: null });
  };

  const loadPortable = (data: Portable) => {
    setAnimPlaying(false);
    setAnimPreviewing(false);
    const valid = validatePortable(data);
    if (valid.type === 'scene') {
      const nextSelected = valid.items[0]?.id ?? null;
      setSelected(nextSelected);
      setSelectedIds(nextSelected ? [nextSelected] : []);
      setJoint(null);
      setSaveName(valid.name);
      commit(valid, { selectedId: nextSelected, selectedJoint: null });
      notify('Scene loaded. Undo returns to the previous scene.');
    } else {
      if (!item || !isBody(item.kind)) throw new Error('Select a figure before loading a pose.');
      editItem(applyPose(item, valid));
      notify(`Applied "${valid.name}" to ${item.name}. Root transform preserved.`);
    }
  };

  const save = async (type: 'scene' | 'pose') => {
    setBusy(true);
    try {
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
      editItem(applyPose(item, parsed));
      notify(`Imported pose "${parsed.name}" onto ${item.name}.`);
    } catch (err) {
      report(err);
    }
  };

  const exportJson = (type: 'scene' | 'pose') => {
    try {
      download(validatePortable(type === 'scene' ? { ...doc, name: saveName.trim() || doc.name } : poseFile(item!, saveName.trim() || 'My pose')));
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
      if (posesMatch(item.pose, preset(p))) return p;
    }
    return null;
  }, [item, animPreviewing]);

  void historyTick;

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="./" aria-label="Pose and Composition home">
          <span className="brand-mark">P/C</span>
          <span className="brand-copy">
            <strong>Pose & Composition</strong>
            <small>FIGURE STUDIO · LOCAL FIRST</small>
          </span>
        </a>
        <div className="top-actions">
          <span
            className={`autosave-badge ${autosaveStatus}`}
            role="status"
            aria-live="polite"
            title="All viewport and inspector edits are saved automatically to IndexedDB on this browser"
          >
            <span className="autosave-dot" aria-hidden="true" />
            <span>
              {autosaveStatus === 'saving'
                ? 'Saving…'
                : autosaveStatus === 'saved'
                  ? 'Saved'
                  : autosaveStatus === 'error'
                    ? 'Save error'
                    : 'Autosave'}
            </span>
          </span>
          <button type="button" onClick={() => undo()} disabled={!past.current.length} title="Undo · Ctrl Z">
            Undo
          </button>
          <button type="button" onClick={() => undo(true)} disabled={!future.current.length} title="Redo · Ctrl Shift Z">
            Redo
          </button>
          <button
            type="button"
            onClick={startNewScene}
            disabled={loading || loadError !== null}
            title="Start a fresh studio scene (Undoable)"
          >
            {Icons.plus} New scene
          </button>
          <button type="button" onClick={() => setTab('library')}>
            Library
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            onClick={toggleTheme}
          >
            {theme === 'dark' ? Icons.sun : Icons.moon}
          </button>
          <button type="button" onClick={() => setHelp(true)}>
            Help <kbd>?</kbd>
          </button>
          <button type="button" className="primary" onClick={png} disabled={busy || loading || loadError !== null}>
            Export PNG
          </button>
        </div>
      </header>

      <div className="workspace" inert={loading || loadError !== null}>
        <aside className="scene-panel" aria-label="Scene objects">
          <div className="panel-heading">
            <h2>Scene</h2>
            <span className="pill-badge">{doc.items.length}</span>
          </div>
          <div className="scroll">
            <section>
              <h3>Add to stage</h3>
              <div className="select-field">
                <span className="field-label">New figure proportion</span>
                <SelectDropdown ariaLabel="New figure proportion" value={newBodyType} options={BODY_OPTIONS} onChange={value => { if (isBodyTypeId(value)) setNewBodyType(value); }} />
              </div>
              <div className="two">
                <button type="button" onClick={() => add('male')}>
                  {Icons.plus} Male
                </button>
                <button type="button" onClick={() => add('female')}>
                  {Icons.plus} Female
                </button>
              </div>
              <div className="stack-gap">
                <SelectDropdown
                  id="add-prop"
                  ariaLabel="Add prop"
                  value=""
                  actionMenu
                  leadingIcon={Icons.plus}
                  placeholder="Add studio prop…"
                  options={propOptions}
                  onChange={v => add(v as Item['kind'])}
                />
                <button type="button" className="full-btn" onClick={() => add('light')}>
                  {Icons.light} Add studio light
                </button>
              </div>
            </section>

            <section>
              <div className="section-head">
                <h3>Outliner</h3>
                <span className="meta-note">Click to inspect</span>
              </div>
              {doc.items.length === 0 ? (
                <div className="empty-card">Stage is empty. Add a figure, prop, or light above.</div>
              ) : (
                <ul className="list-stack" aria-label="Object list">
                  {doc.items.map(i => {
                    const subtitle = isBody(i.kind)
                      ? `${label(i.kind)} · ${HAIR_STYLE_LABELS[i.hairStyle ?? defaultHairStyle(i.kind)]}`
                      : i.kind === 'light'
                        ? `Spot light · ${Math.round(i.intensity ?? 30)} lx`
                        : `${label(i.kind)} prop`;
                    return (
                      <ListRow
                        key={i.id}
                        icon={isBody(i.kind) ? Icons.figure : i.kind === 'light' ? Icons.light : Icons.prop}
                        title={i.name}
                        meta={subtitle}
                        selected={selection.includes(i.id)}
                        onSelect={event => select(i.id, null, event.shiftKey)}
                        onDelete={() => removeItemById(i.id)}
                        deleteLabel={`Delete ${i.name}`}
                      />
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="hint">
              <strong>Autosaved locally</strong>
              <p>Viewport and inspector edits are immediately saved to IndexedDB and restored on reload. Use Library for named studies or JSON backups.</p>
            </section>
          </div>
        </aside>

        <main className="viewport-column">
          <div className="viewport-toolbar">
            <div className="toolbar-group">
              <SegmentedControl
                ariaLabel="Transform mode"
                value={selection.length > 1 && mode === 'scale' ? 'translate' : mode}
                disabled={view}
                items={[
                  { value: 'translate', label: 'Move', shortcut: 'W' },
                  { value: 'rotate', label: 'Rotate', shortcut: 'E' },
                  ...(selection.length > 1 ? [] : [{ value: 'scale' as const, label: 'Scale', shortcut: 'R' }]),
                ]}
                onChange={m => {
                  setJoint(null);
                  setMode(m);
                }}
              />
              <button type="button" onClick={() => engine.current?.focusSelected()}>
                Frame <kbd>F</kbd>
              </button>
            </div>
            <div className="toolbar-group">
              <SegmentedControl
                ariaLabel="Viewport mode"
                value={view ? 'camera' : 'editor'}
                items={[
                  { value: 'editor', label: 'Editor' },
                  { value: 'camera', label: 'Camera', shortcut: 'C' },
                ]}
                onChange={v => setView(v === 'camera')}
              />
            </div>
          </div>

          <div className={`viewport ${view ? 'camera-view' : ''} ${renderStyle.mode === 'outline' && renderStyle.outlinePaper === 'transparent' ? 'transparent-paper' : ''}`}>
            <div ref={host} className="canvas-host" />
            <div className="viewport-shading-hud">
              <SegmentedControl ariaLabel="Viewport shading" value={renderStyle.mode} items={SHADING_ITEMS} onChange={mode => editRenderStyle({ mode })} />
            </div>
            <div className="viewport-caption">
              <span className="view-pill">
                {view
                  ? `COMPOSITION · ${doc.camera.focalLength} MM · ${doc.camera.aspect}${doc.camera.dof ? ' · DOF' : ''}`
                  : joint
                    ? `JOINT FK · ${label(joint).toUpperCase()}`
                    : 'PERSPECTIVE · EDITOR'}
              </span>
            </div>
            <div className="viewport-bottom">
              <span className="hud-chip">
                {view
                  ? 'Camera framing · Left drag: orbit · Right drag: pan · Wheel: zoom'
                  : 'Left drag: orbit · Right drag: pan · Wheel: zoom'}
              </span>
              <button type="button" className="hud-btn" onClick={() => setHelp(true)}>
                Controls & workflow
              </button>
            </div>
            {selection.length > 1 && <div className="group-toolbar" aria-label="Group actions">
              <span>{selection.length} selected</span>
              {(['X', 'Y', 'Z'] as const).map((axis, index) => <button key={axis} type="button" onClick={() => flipSelection(index as 0 | 1 | 2)}>Flip {axis}</button>)}
              <button type="button" onClick={() => select(null, null)}>Clear selection</button>
            </div>}
          </div>

          <footer className="statusbar">
            <span>{item ? `${item.name}${joint ? ` · ${label(joint)}` : ' · Root transform'}` : 'Select an object to begin'}</span>
            <span>
              {view ? 'Camera view · drag to frame · helpers hidden' : 'Meters · 17-joint FK rig · WebGL'} ·{' '}
              <a href={`${import.meta.env.BASE_URL}THIRD_PARTY_NOTICES.txt`} target="_blank" rel="noreferrer">
                Licenses
              </a>
            </span>
          </footer>
        </main>

        <aside className="inspector" aria-label="Inspector">
          <div className="inspector-tabs">
            <SegmentedControl
              ariaLabel="Inspector tabs"
              role="tablist"
              fullWidth
              value={tab}
              items={[
                { value: 'object', label: 'Object' },
                { value: 'camera', label: 'Camera' },
                { value: 'library', label: 'Library' },
              ]}
              onChange={setTab}
            />
          </div>

          <div className="scroll inspector-content">
            {tab === 'object' &&
              (selection.length > 1 ? (
                <section aria-label="Multi-selection">
                  <div className="eyebrow">TRANSFORM · GROUP</div>
                  <h2>{selection.length} objects selected</h2>
                  <p className="muted">Move or rotate the group gizmo around the shared position centroid. Shift-click toggles objects; Ctrl-drag selects a region.</p>
                  <Vector3Field label="Group position (m)" value={selectionCentroid(doc.items.filter(i => selection.includes(i.id)))} min={-100} max={100} onChange={position => update(next => {
                    const center = selectionCentroid(next.items.filter(i => selection.includes(i.id)));
                    const offset = position.map((v, axis) => v - center[axis]);
                    for (const target of next.items.filter(i => selection.includes(i.id))) {
                      target.position = target.position.map((v, axis) => v + offset[axis]) as Vec3;
                      if (target.target) target.target = target.target.map((v, axis) => v + offset[axis]) as Vec3;
                    }
                  })} />
                  <p className="muted">Centroid: {selectionCentroid(doc.items.filter(i => selection.includes(i.id))).map(v => v.toFixed(2)).join(', ')} m</p>
                  <div className="three">{(['X', 'Y', 'Z'] as const).map((axis, index) => <button key={axis} type="button" onClick={() => flipSelection(index as 0 | 1 | 2)}>Flip {axis}</button>)}</div>
                  <button type="button" className="full-btn" onClick={() => select(null, null)}>Clear selection</button>
                </section>
              ) : item ? (
                <>
                  <section>
                    <div className="eyebrow">
                      {isBody(item.kind) ? 'POSE · FIGURE' : item.kind === 'light' ? 'STAGE · LIGHT' : 'STAGE · PROP'}
                    </div>
                    <h2>{item.name}</h2>
                    <div className="field-block">
                      <label className="text-field">
                        <span className="field-label">Name</span>
                        <input
                          aria-label="Object name"
                          value={item.name}
                          maxLength={80}
                          onChange={e => editItem({ name: e.target.value })}
                        />
                      </label>
                      <ColorField
                        label={isBody(item.kind) ? 'Skin color' : item.kind === 'light' ? 'Light color' : 'Surface tint'}
                        value={item.color}
                        onChange={color => editItem({ color })}
                      />
                      {isBody(item.kind) && (
                        <>
                          <div className="select-field">
                            <span className="field-label">Base figure</span>
                            <SegmentedControl
                              ariaLabel="Base figure"
                              fullWidth
                              value={item.kind}
                              items={[
                                { value: 'female', label: 'Female' },
                                { value: 'male', label: 'Male' },
                              ]}
                              onChange={nextKind => swapBaseFigure(nextKind)}
                            />
                          </div>
                          <div className="select-field">
                            <span className="field-label">Body proportion</span>
                            <SelectDropdown
                              ariaLabel="Body proportion"
                              value={item.bodyType ?? DEFAULT_BODY_TYPE}
                              options={BODY_OPTIONS}
                              onChange={value => {
                                if (isBodyTypeId(value) && value !== (item.bodyType ?? DEFAULT_BODY_TYPE)) {
                                  editItem({ bodyType: value });
                                }
                              }}
                            />
                          </div>
                          <ColorField
                            label="Outfit / dress color"
                            value={item.outfitColor ?? defaultOutfitColor(item.kind)}
                            onChange={outfitColor => editItem({ outfitColor })}
                          />
                          <div className="select-field">
                            <span className="field-label">Hairstyle</span>
                            <SelectDropdown
                              ariaLabel="Hairstyle"
                              value={item.hairStyle ?? defaultHairStyle(item.kind)}
                              options={hairOptions}
                              onChange={v => editItem({ hairStyle: v as HairStyleId })}
                            />
                          </div>
                          <ColorField
                            label="Hair & brow color"
                            value={item.hairColor ?? DEFAULT_HAIR_COLOR}
                            onChange={hairColor => editItem({ hairColor })}
                          />
                        </>
                      )}
                    </div>
                  </section>

                  {isBody(item.kind) && item.pose && (
                    <section>
                      <div className="section-head">
                        <h3>Joint & preset posing</h3>
                        <span className="pill-badge">{joint ? label(joint) : 'Root'}</span>
                      </div>
                      <p className="muted">
                        Click any gold marker on the figure (turns coral) and drag its rotation rings, or pick a joint below.
                      </p>
                      <SwitchRow label="Anatomical joint limits" description="Constrain rotation to anatomical ranges; switch off for free posing" checked={item.anatomicalLimits !== false} onChange={anatomicalLimits => editItem({ anatomicalLimits })} />
                      <div className="two">
                        <button type="button" onClick={() => copyNodesToClipboard(JOINTS)}>Copy Pose</button>
                        <button type="button" disabled={!poseClipboard} onClick={pasteClipboard}>{!poseClipboard || poseClipboard.joints.length === 17 ? 'Paste Pose' : 'Paste Partial Pose'}</button>
                      </div>
                      {poseClipboard && <p className="muted">Clipboard: {poseClipboard.joints.length}/17 joints from {poseClipboard.source}</p>}
                      <details className="pose-copy-tree">
                        <summary>Advanced Copy · Skeleton Tree</summary>
                        <div className="branch-pills">{Object.entries(POSE_BRANCHES).map(([name, nodes]) => <button key={name} type="button" onClick={() => setCopyNodes([...nodes])}>{name}</button>)}</div>
                        <div role="group" aria-label="Skeleton hierarchy">
                          {JOINTS.map(node => <label key={node} className="skeleton-node" style={{ paddingInlineStart: `${8 + JOINT_DEPTH[node] * 14}px` }}>
                            <input type="checkbox" checked={copyNodes.includes(node)} onChange={event => setCopyNodes(previous => event.target.checked ? [...previous, node] : previous.filter(j => j !== node))} />
                            {node === 'spine' ? 'Waist' : label(node)}
                          </label>)}
                        </div>
                        <button type="button" className="full-btn" disabled={!copyNodes.length} onClick={() => copyNodesToClipboard(copyNodes)}>Copy Selected Nodes ({copyNodes.length}/17)</button>
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

                      {joint && (
                        <Vector3Field
                          label="Joint rotation (°)"
                          value={item.pose[joint].map(degrees) as Vec3}
                          min={-360}
                          max={360}
                          step={5}
                          precision={1}
                          onChange={v => {
                            const p = clone(item.pose!);
                            p[joint] = v.map(radians) as Vec3;
                            editItem({ pose: p });
                          }}
                          onReset={() => {
                            const p = clone(item.pose!);
                            p[joint] = [0, 0, 0];
                            editItem({ pose: p });
                          }}
                        />
                      )}

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
                              editItem({ position: [item.position[0], groundedY, item.position[2]] });
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
                  )}

                  {isBody(item.kind) && item.pose && (
                    <section aria-label="Pose from animation">
                      <div className="section-head">
                        <h3>Pose from animation</h3>
                        <span className="pill-badge">
                          {activeClip ? (activeClip.source === 'file' ? `${activeClip.rigFormat}` : 'CC0') : 'Mixamo · CC0'}
                        </span>
                      </div>
                      <p className="muted">
                        Choose a motion cycle or import a Mixamo <code>.fbx</code> / <code>.glb</code> clip locally, scrub the frame slider, then apply that frame as an editable pose.
                      </p>

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

                      <button type="button" className="full-btn" disabled={animBusy} onClick={() => animFile.current?.click()}>
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
                            displayValue={`F${Math.min(animFrame, Math.max(0, activeClip.frameCount - 1)) + 1}/${activeClip.frameCount} · ${(
                              (activeClip.frameCount > 1 ? animFrame / (activeClip.frameCount - 1) : 0) * activeClip.duration
                            ).toFixed(2)}s`}
                            onChange={nextFrame => {
                              setAnimPlaying(false);
                              setAnimFrame(nextFrame);
                              previewCycleFrame(activeClip, nextFrame, groundAnim, item);
                            }}
                          />

                          <SwitchRow
                            label="Ground figure to floor"
                            description="Plant feet or knees on studio floor"
                            checked={groundAnim}
                            onChange={checked => {
                              setGroundAnim(checked);
                              previewCycleFrame(activeClip, animFrame, checked, item);
                            }}
                          />

                          {animPreviewing && (
                            <div className="callout-banner">
                              Previewing frame <strong>{animFrame + 1}</strong> on {item.name}. Click <strong>Use this pose</strong> to commit to FK joints.
                            </div>
                          )}

                          <div className="two">
                            <button
                              type="button"
                              className={animPlaying ? 'active' : ''}
                              onClick={() => setAnimPlaying(p => !p)}
                              disabled={activeClip.frameCount <= 1}
                            >
                              {animPlaying ? Icons.pause : Icons.play}
                              {animPlaying ? 'Pause cycle' : 'Play cycle'}
                            </button>
                            <button type="button" className="primary" onClick={() => applyActiveAnimPose(false)}>
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
                  )}

                  <section>
                    <h3>Root transform</h3>
                    <div className="three">{(['X', 'Y', 'Z'] as const).map((axis, index) => <button key={axis} type="button" onClick={() => flipSelection(index as 0 | 1 | 2)}>Flip {axis}</button>)}</div>
                    <Vector3Field
                      label="Position (m)"
                      value={item.position}
                      min={-100}
                      max={100}
                      onChange={position => editItem({ position })}
                    />
                    <Vector3Field
                      label="Rotation (°)"
                      value={item.rotation.map(degrees) as Vec3}
                      min={-360}
                      max={360}
                      step={5}
                      precision={1}
                      onChange={v => editItem({ rotation: v.map(radians) as Vec3 })}
                    />
                    <Vector3Field
                      label="Scale"
                      value={item.scale}
                      min={-10}
                      max={10}
                      onChange={scale => {
                        if (scale.some(v => Math.abs(v) < 0.05)) { notify('Scale magnitude must be at least 0.05. Use Flip to mirror.', true); return; }
                        editItem({ scale });
                      }}
                    />
                  </section>

                  {item.kind === 'light' && (
                    <section>
                      <h3>Studio spotlight</h3>
                      <p className="muted">Points from root position toward the aim target below.</p>
                      <Vector3Field
                        label="Light target (m)"
                        value={item.target!}
                        min={-100}
                        max={100}
                        onChange={target => editItem({ target })}
                      />
                      <SliderField
                        label="Intensity"
                        value={item.intensity ?? 30}
                        min={0}
                        max={200}
                        step={1}
                        displayValue={`${Math.round(item.intensity ?? 30)} lx`}
                        onChange={intensity => editItem({ intensity })}
                      />
                    </section>
                  )}

                  <section>
                    <div className="two">
                      <button
                        type="button"
                        onClick={() => {
                          const copy = clone(item);
                          copy.id = crypto.randomUUID();
                          copy.name = `${item.name.slice(0, 70)} copy`;
                          copy.position[0] += 0.6;
                          update(d => d.items.push(copy));
                          select(copy.id, null);
                        }}
                        disabled={doc.items.length >= 64 || (item.kind === 'light' && doc.items.filter(i => i.kind === 'light').length >= 8)}
                      >
                        Duplicate
                      </button>
                      <button type="button" className="danger" onClick={removeSelected}>
                        {Icons.trash} Delete object
                      </button>
                    </div>
                  </section>
                </>
              ) : (
                <section>
                  <h2>No object selected</h2>
                  <p className="muted">Choose a figure, prop, or light in the Scene outliner on the left, or add a new item to begin.</p>
                </section>
              ))}

            {tab === 'camera' && (
              <>
                <section>
                  <div className="eyebrow">COMPOSE · CAMERA</div>
                  <h2>Composition frame</h2>
                  <p className="muted">
                    Orbit, pan, and zoom directly in Camera view to frame your shot, or fine-tune coordinates below.
                  </p>
                  <div className="two">
                    <button type="button" className={view ? 'active' : ''} onClick={() => setView(!view)}>
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

                <section>
                  <h3>Lens & framing</h3>
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
                  <SelectDropdown ariaLabel="Shading mode" value={renderStyle.mode} options={SHADING_ITEMS} onChange={mode => editRenderStyle({ mode: mode as RenderStyleState['mode'] })} />
                  {(renderStyle.mode === 'illustration' || renderStyle.mode === 'outline' || (renderStyle.mode === 'clay' && renderStyle.clayOutlines)) && <>
                    <ColorField label="Ink color" value={renderStyle.inkColor} onChange={inkColor => editRenderStyle({ inkColor })} />
                    <SliderField label="Ink thickness" value={renderStyle.inkWidth} min={0.5} max={3} step={0.1} displayValue={`${renderStyle.inkWidth.toFixed(1)} px`} onChange={inkWidth => editRenderStyle({ inkWidth })} />
                    <SliderField label="Interior detail" value={renderStyle.interiorDetail} min={0} max={1} step={0.05} displayValue={`${Math.round(renderStyle.interiorDetail * 100)}%`} onChange={interiorDetail => editRenderStyle({ interiorDetail })} />
                  </>}
                  {renderStyle.mode === 'illustration' && <>
                    <SegmentedControl ariaLabel="Shadow steps" fullWidth value={String(renderStyle.shadowSteps)} items={[{ value: '2', label: '2-tone' }, { value: '3', label: '3-tone' }]} onChange={steps => editRenderStyle({ shadowSteps: steps === '2' ? 2 : 3 })} />
                    <SegmentedControl ariaLabel="Shadow temperature" fullWidth value={renderStyle.shadowTemp} items={[{ value: 'cool', label: 'Cool' }, { value: 'warm', label: 'Warm' }, { value: 'neutral', label: 'Neutral' }]} onChange={shadowTemp => editRenderStyle({ shadowTemp })} />
                  </>}
                  {renderStyle.mode === 'outline' && <div className="select-field">
                    <span className="field-label">Paper background / Transparent PNG</span>
                    <SelectDropdown ariaLabel="Paper background" value={renderStyle.outlinePaper} options={[{ value: 'warm', label: 'Warm paper' }, { value: 'white', label: 'Pure white' }, { value: 'scene', label: 'Scene background' }, { value: 'transparent', label: 'Transparent PNG' }]} onChange={paper => editRenderStyle({ outlinePaper: paper as RenderStyleState['outlinePaper'] })} />
                  </div>}
                  {renderStyle.mode === 'clay' && <>
                    <SelectDropdown ariaLabel="Clay tone" value={renderStyle.clayFinish} options={[{ value: 'terracotta', label: 'Terracotta' }, { value: 'grey', label: 'Studio Grey' }, { value: 'plaster', label: 'Warm Plaster' }]} onChange={tone => editRenderStyle({ clayFinish: tone as RenderStyleState['clayFinish'] })} />
                    <SwitchRow label="Contour ink" checked={renderStyle.clayOutlines} onChange={clayOutlines => editRenderStyle({ clayOutlines })} />
                  </>}
                  {renderStyle.mode === 'realistic' && <p className="muted">Physically based studio lighting with soft shadows.</p>}
                  {renderStyle.mode === 'flat' && <p className="muted">Unlit local colors for silhouette and value checks.</p>}
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
                  <button type="button" className="primary full-btn" onClick={png} disabled={busy}>
                    Export camera PNG
                  </button>
                </section>
              </>
            )}

            {tab === 'library' && (
              <>
                <section>
                  <div className="eyebrow">LIBRARY · LOCAL & PORTABLE</div>
                  <h2>Save study</h2>
                  <p className="muted">Stored privately in this browser (IndexedDB). Saving with an existing name updates that entry.</p>
                  <button
                    type="button"
                    className="full-btn"
                    onClick={startNewScene}
                    disabled={loading || loadError !== null}
                    title="Start a fresh studio scene (Undoable)"
                  >
                    {Icons.plus} New scene
                  </button>
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
                    <button type="button" className="primary" disabled={busy || !saveName.trim()} onClick={() => save('scene')}>
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
                    <button type="button" onClick={() => exportJson('scene')}>
                      {Icons.download} Scene JSON
                    </button>
                    <button type="button" disabled={!item || !isBody(item.kind)} onClick={() => exportJson('pose')}>
                      {Icons.download} Pose JSON
                    </button>
                  </div>
                  <button type="button" className="full-btn" onClick={() => file.current?.click()}>
                    {Icons.upload} Import pose / scene JSON…
                  </button>
                  <p className="muted">
                    Versioned v1 files · max 1 MB / 64 objects / 8 lights. Poses transfer across both male and female rigs.
                  </p>
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
                        if (f.size > MAX_FILE_BYTES) throw new Error('File exceeds the 1 MB import limit.');
                        loadPortable(parseFile(await f.text()));
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
                    <div className="empty-card">No saved studies yet. Name your study above and click Save scene or Save pose.</div>
                  ) : (
                    <ul className="list-stack" aria-label="Saved studies">
                      {saved.map(s => (
                        <ListRow
                          key={s.id}
                          icon={s.type === 'scene' ? Icons.scene : Icons.pose}
                          title={s.name}
                          meta={`${label(s.type)} · ${new Date(s.savedAt).toLocaleDateString()}`}
                          onSelect={() => {
                            try {
                              loadPortable(s.data);
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

            <section className="view-options">
              <h3>Viewport helpers</h3>
              <SwitchRow
                label="Selected figure joints"
                description="Show clickable FK markers & rings"
                checked={showJoints}
                onChange={v => preference('joints', v)}
              />
              <SwitchRow
                label="Studio ground grid"
                description="Show 1 m floor grid & light helpers"
                checked={showHelpers}
                onChange={v => preference('helpers', v)}
              />
            </section>
          </div>
        </aside>
      </div>

      {(loading || loadError) && (
        <div className="boot-overlay">
          <div className={`boot-card ${loadError ? 'error' : ''}`} role={loadError ? 'alert' : 'status'}>
            <div className="eyebrow">QUATERNIUS · CC0 RIGGED FIGURES</div>
            <h2>{loadError ? 'The figure assets could not be loaded' : 'Opening your figure studio'}</h2>
            <p>
              {loadError ??
                'Loading the sculpted male and female rigs, hairstyles, and textures locally. No scene data is uploaded.'}
            </p>
            {loadError && (
              <button type="button" className="primary" onClick={() => setRetry(n => n + 1)}>
                Retry loading figures
              </button>
            )}
            <small>Your existing local scenes and poses remain untouched.</small>
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
              <h2>A small studio. A clear workflow.</h2>
              <button type="button" className="icon-btn" onClick={() => setHelp(false)} aria-label="Close help">
                ×
              </button>
            </div>
            <div className="modal-content">
              <h3>01 / Pose & Extract from Motion</h3>
              <p>
                Select a male or female figure and pick any of the 10 auto-grounded studio presets — or use{' '}
                <strong>Pose from animation</strong> to scrub 12 built-in CC0 motion cycles or import a Mixamo{' '}
                <code>.fbx</code> / <code>.glb</code> clip locally, scrub the frame slider, and click{' '}
                <strong>Use this pose</strong>. Refine any of the 17 FK joints via viewport rotation rings or XYZ degrees.
              </p>
              <h3>02 / Style & Compose</h3>
              <p>
                Customize true-color skin tones, outfit / dress colors, sculpted hairstyles (side-parted, shoulder-length
                waves, twin buns, short crop, parted + beard, or bald), and hair &amp; brow colors independently. Add
                props and lights, orbit / pan / zoom directly inside Camera view to frame your shot, and export clean
                1600 px PNG renders.
              </p>
              <h3>03 / Keep your work</h3>
              <p>
                Every viewport drag, camera move, and inspector edit autosaves immediately to IndexedDB and reloads
                automatically — use <strong>New scene</strong> anytime to return to a fresh stage (with Undo). Export or
                import portable <code>.pose.json</code> files directly from a figure&rsquo;s Pose panel, or manage full
                scenes in Library.
              </p>
              <dl className="shortcuts">
                <dt>Left drag / Right drag / Wheel</dt>
                <dd>Orbit / Pan / Zoom</dd>
                <dt>W / E / R</dt>
                <dd>Root Move / Rotate / Scale</dd>
                <dt>1 / 2 / 3 / 4 / 5</dt>
                <dd>Realistic / Illustration / Outline / Clay / Flat</dd>
                <dt>Shift-click / Ctrl-drag</dt>
                <dd>Toggle selection / Marquee (Shift adds)</dd>
                <dt>F / C / Escape</dt>
                <dd>Frame selected / Toggle Camera / Root mode</dd>
                <dt>Ctrl Z / Ctrl Shift Z</dt>
                <dd>Undo / Redo (up to 100 steps)</dd>
                <dt>Delete / ?</dt>
                <dd>Delete selected / Open help</dd>
              </dl>
              <p className="muted">
                Figures & sculpted hairstyles: Quaternius Universal Base Characters [Standard], CC0. Built-in motion
                cycles: Quaternius Universal Animation Library [Standard], CC0. Imported Mixamo .fbx/.glb files are
                processed 100% locally in your browser.
              </p>
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

