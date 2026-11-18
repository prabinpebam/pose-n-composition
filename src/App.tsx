import { useCallback, useEffect, useRef, useState } from 'react';
import { Studio } from './engine';
import { loadExternalFigures } from './external-rig';
import { applyPose, clone, createItem, DEFAULT_HAIR_COLOR, degrees, initialScene, isBody, JOINTS, MAX_FILE_BYTES, parseFile, poseFile, PRESETS, preset, PROP_KINDS, radians, validatePortable, type Item, type Joint, type Portable, type SceneState, type Vec3 } from './model';
import { deleteLocal, download, downloadBlob, listSaved, saveLocal, type Saved } from './storage';

type Tab = 'object' | 'camera' | 'library';
type Notice = { text: string; error: boolean };
export function App() {
  const [doc, setDoc] = useState(initialScene);
  const current = useRef(doc);
  const past = useRef<SceneState[]>([]), future = useRef<SceneState[]>([]);
  const [historyTick, historyUpdate] = useState(0);
  const [selected, setSelected] = useState<string | null>(doc.items[0].id);
  const [joint, setJoint] = useState<Joint | null>(null);
  const [tab, setTab] = useState<Tab>('object');
  const [view, setView] = useState(false), [help, setHelp] = useState(false);
  const [showJoints, setShowJoints] = useState(true), [showHelpers, setShowHelpers] = useState(true);
  const [mode, setMode] = useState<'translate' | 'rotate' | 'scale'>('translate');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [saveName, setSaveName] = useState('My study');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true), [loadError, setLoadError] = useState<string | null>(null), [retry, setRetry] = useState(0);
  const host = useRef<HTMLDivElement>(null), engine = useRef<Studio | null>(null), file = useRef<HTMLInputElement>(null);
  const liveSettings = useRef({ selected, joint, view, mode, showJoints, showHelpers });
  liveSettings.current = { selected, joint, view, mode, showJoints, showHelpers };
  const notify = useCallback((text: string, error = false) => setNotice({ text, error }), []);
  const report = useCallback((e: unknown) => notify(e instanceof Error ? e.message : String(e), true), [notify]);
  const commit = useCallback((next: SceneState) => {
    past.current.push(clone(current.current)); if (past.current.length > 100) past.current.shift();
    future.current = []; current.current = next; setDoc(next); historyUpdate(t => t + 1);
  }, []);
  const update = (fn: (next: SceneState) => void) => { const next = clone(current.current); fn(next); commit(next); };
  const select = useCallback((id: string | null, j: Joint | null) => { setSelected(id); setJoint(j); if (id) setTab('object'); }, []);
  const item = doc.items.find(i => i.id === selected);
  const editItem = (patch: Partial<Item>) => update(next => { const i = next.items.find(i => i.id === selected); if (i) Object.assign(i, patch); });
  const editCamera = (patch: Partial<SceneState['camera']>) => update(next => Object.assign(next.camera, patch));
  const undo = useCallback((redo = false) => {
    const from = redo ? future.current : past.current, to = redo ? past.current : future.current;
    const next = from.pop(); if (!next) return;
    to.push(current.current); current.current = next; setDoc(next); historyUpdate(t => t + 1);
  }, []);
  const removeSelected = useCallback(() => {
    if (!selected) return;
    const next = clone(current.current); next.items = next.items.filter(i => i.id !== selected); commit(next); setSelected(null); setJoint(null);
  }, [selected, commit]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setLoadError(null);
    loadExternalFigures().then(() => {
      if (cancelled) return;
      const studio = new Studio(host.current!, { change: commit, select, error: report });
      engine.current = studio;
      try {
        const s = liveSettings.current;
        studio.sync(current.current); studio.select(s.selected, s.joint); studio.setMode(s.mode);
        studio.setHelpers(s.showJoints, s.showHelpers); studio.setView(s.view);
        setLoading(false);
      } catch (error) { engine.current = null; studio.dispose(); throw error; }
    }).catch(error => {
      if (cancelled) return;
      setLoading(false); setLoadError(error instanceof Error ? error.message : String(error));
    });
    return () => { cancelled = true; engine.current?.dispose(); engine.current = null; };
  }, [commit, select, report, retry]);
  useEffect(() => { engine.current?.sync(doc); }, [doc]);
  useEffect(() => { engine.current?.select(selected, joint); }, [selected, joint, doc]);
  useEffect(() => { engine.current?.setView(view); }, [view]);
  useEffect(() => { engine.current?.setMode(mode); }, [mode]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('pose-n-composition:preferences');
      if (raw) {
        const p: unknown = JSON.parse(raw);
        if (!p || typeof p !== 'object' || !('joints' in p) || typeof p.joints !== 'boolean' || !('helpers' in p) || typeof p.helpers !== 'boolean') throw new Error('Stored preferences are malformed. Toggle viewport helpers to replace them.');
        setShowJoints(p.joints); setShowHelpers(p.helpers);
      }
    } catch (e) { report(new Error(`Preferences unavailable: ${e instanceof Error ? e.message : String(e)}`)); }
    listSaved().then(setSaved).catch(report);
  }, [report]);
  useEffect(() => { engine.current?.setHelpers(showJoints, showHelpers); }, [showJoints, showHelpers]);
  const preference = (key: 'joints' | 'helpers', value: boolean) => {
    if (key === 'joints') setShowJoints(value); else setShowHelpers(value);
    try { localStorage.setItem('pose-n-composition:preferences', JSON.stringify({ joints: key === 'joints' ? value : showJoints, helpers: key === 'helpers' ? value : showHelpers })); }
    catch (e) { report(new Error(`Preferences not saved: ${e instanceof Error ? e.message : String(e)}`)); }
  };
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), notice.error ? 14000 : 5500); return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select, [contenteditable]')) return;
      if (loading || loadError) return;
      if (e.key === 'Escape') { setHelp(false); setJoint(null); }
      if (help) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(e.shiftKey); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); undo(true); }
      else if (e.key.toLowerCase() === 'w') { setJoint(null); setMode('translate'); }
      else if (e.key.toLowerCase() === 'e') { setJoint(null); setMode('rotate'); }
      else if (e.key.toLowerCase() === 'r') { setJoint(null); setMode('scale'); }
      else if (e.key.toLowerCase() === 'f') engine.current?.focusSelected();
      else if (e.key === 'Delete') removeSelected();
      else if (e.key.toLowerCase() === 'c') setView(v => !v);
      else if (e.key === '?') setHelp(true);
    };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, [undo, removeSelected, help, loading, loadError]);
  const add = (kind: Item['kind']) => {
    if (doc.items.length >= 64) { report(new Error('Scene limit: 64 objects.')); return; }
    if (kind === 'light' && doc.items.filter(i => i.kind === 'light').length >= 8) { report(new Error('Scene limit: 8 lights.')); return; }
    const next = createItem(kind, doc.items.filter(i => i.kind === kind).length);
    update(d => { d.items.push(next); }); select(next.id, null); setView(false);
  };
  const loadPortable = (data: Portable) => {
    const valid = validatePortable(data);
    if (valid.type === 'scene') { commit(valid); setSelected(valid.items[0]?.id ?? null); setJoint(null); notify('Scene loaded. Undo returns to the previous scene.'); }
    else {
      if (!item) throw new Error('Select a figure before loading a pose.');
      editItem(applyPose(item, valid)); notify(`Applied "${valid.name}" to ${item.name}. Root transform preserved.`);
    }
  };
  const save = async (type: 'scene' | 'pose') => {
    setBusy(true);
    try {
      const data = type === 'scene' ? { ...doc, name: saveName.trim() } : poseFile(item!, saveName.trim());
      await saveLocal(data); setSaved(await listSaved()); notify(`${type === 'scene' ? 'Scene' : 'Pose'} saved on this browser. Download JSON for a portable backup.`);
    } catch (e) { report(e); } finally { setBusy(false); }
  };
  const exportJson = (type: 'scene' | 'pose') => {
    try { download(validatePortable(type === 'scene' ? { ...doc, name: saveName.trim() || doc.name } : poseFile(item!, saveName.trim() || 'My pose'))); notify(`${type} JSON downloaded.`); } catch (e) { report(e); }
  };
  const png = async () => {
    setBusy(true);
    try {
      if (!engine.current) throw new Error('3D viewport is unavailable.');
      downloadBlob(await engine.current.exportPng(), 'composition.png'); notify('1600 px camera composition exported as PNG.');
    } catch (e) { report(e); } finally { setBusy(false); }
  };
  void historyTick;
  return <div className="app">
    <header className="topbar">
      <a className="brand" href="./" aria-label="Pose and Composition home"><span className="brand-mark">P/C</span><span>Pose & Composition<small>FIGURE STUDIO / LOCAL FIRST</small></span></a>
      <div className="top-actions">
        <button onClick={() => undo()} disabled={!past.current.length} title="Undo · Ctrl Z">Undo</button>
        <button onClick={() => undo(true)} disabled={!future.current.length} title="Redo · Ctrl Shift Z">Redo</button>
        <button onClick={() => setTab('library')}>Save / Load</button>
        <button onClick={() => setHelp(true)}>Help <kbd>?</kbd></button>
        <button className="primary" onClick={png} disabled={busy || loading || loadError !== null}>Export PNG</button>
      </div>
    </header>
    <div className="workspace" inert={loading || loadError !== null}>
      <aside className="scene-panel" aria-label="Scene objects">
        <div className="panel-heading"><h2>Scene</h2><span className="badge">{doc.items.length} objects</span></div>
        <div className="scroll">
          <section><h3>Add a figure</h3><div className="two"><button onClick={() => add('male')}>+ Male</button><button onClick={() => add('female')}>+ Female</button></div></section>
          <section><h3>Objects & lighting</h3><label className="sr-only" htmlFor="add-prop">Add prop</label><select id="add-prop" value="" onChange={e => { if (e.target.value) add(e.target.value as Item['kind']); }}><option value="">+ Add a prop…</option>{PROP_KINDS.map(k => <option key={k} value={k}>{label(k)}</option>)}</select><button className="wide" onClick={() => add('light')}>+ Studio light</button></section>
          <div className="object-list" role="list" aria-label="Object list">{doc.items.map(i => <button role="listitem" key={i.id} className={`object-row ${i.id === selected ? 'selected' : ''}`} onClick={() => select(i.id, null)}><span className="object-icon">{isBody(i.kind) ? '○' : i.kind === 'light' ? '☼' : '◇'}</span><span>{i.name}<small>{isBody(i.kind) ? 'Rigged figure' : label(i.kind)}</small></span></button>)}</div>
          <section className="hint"><strong>Your private studio</strong><p>Nothing is uploaded. Save locally or download a scene file to keep your work.</p></section>
        </div>
      </aside>
      <main className="viewport-column">
        <div className="viewport-toolbar">
          <div className="segmented" aria-label="Transform mode">{(['translate', 'rotate', 'scale'] as const).map((m, n) => <button key={m} className={!joint && mode === m ? 'active' : ''} onClick={() => { setJoint(null); setMode(m); }} disabled={view}>{['Move', 'Rotate', 'Scale'][n]} <kbd>{['W', 'E', 'R'][n]}</kbd></button>)}</div>
          <div className="toolbar-right"><button onClick={() => engine.current?.focusSelected()} disabled={view}>Frame <kbd>F</kbd></button><button className={view ? 'active' : ''} onClick={() => setView(!view)}>{view ? 'Return to editor' : 'Camera view'} <kbd>C</kbd></button></div>
        </div>
        <div className={`viewport ${view ? 'camera-view' : ''}`}>
          <div ref={host} className="canvas-host" />
          <div className="viewport-caption"><span className="view-pill">{view ? `COMPOSITION / ${doc.camera.focalLength} mm / ${doc.camera.aspect}${doc.camera.dof ? ' / DOF ON' : ''}` : joint ? `LOCAL JOINT / ${label(joint)}` : 'PERSPECTIVE / EDITOR'}</span></div>
          {!view && <div className="viewport-bottom"><span>Drag: orbit · Right drag: pan · Scroll: zoom</span><button onClick={() => setHelp(true)}>Controls & workflow</button></div>}
        </div>
        <footer className="statusbar"><span>{item ? `${item.name}${joint ? ` / ${label(joint)}` : ' / Root transform'}` : 'Select an object to begin'}</span><span>{view ? 'Camera view · editor helpers hidden' : 'Meters · FK posing · WebGL'} · <a href={`${import.meta.env.BASE_URL}THIRD_PARTY_NOTICES.txt`} target="_blank" rel="noreferrer">Licenses</a></span></footer>
      </main>
      <aside className="inspector" aria-label="Inspector">
        <div className="tabs" role="tablist">{(['object', 'camera', 'library'] as const).map(t => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{label(t)}</button>)}</div>
        <div className="scroll inspector-content">
          {tab === 'object' && (item ? <>
            <section><div className="eyebrow">{isBody(item.kind) ? 'POSE / FIGURE' : item.kind === 'light' ? 'COMPOSE / LIGHT' : 'COMPOSE / PROP'}</div><h2>{item.name}</h2><label>Name<input aria-label="Object name" value={item.name} maxLength={80} onChange={e => editItem({ name: e.target.value })} /></label><label className="color-row">Surface color<input aria-label="Object color" type="color" value={item.color} onChange={e => editItem({ color: e.target.value })} /></label>{isBody(item.kind) && <><label className="color-row">Hair color<input aria-label="Hair color" type="color" value={item.hairColor ?? DEFAULT_HAIR_COLOR} onChange={e => editItem({ hairColor: e.target.value })} /></label><p className="muted">Scalp hair, eyebrows and eyelashes. Saved with the scene, not the pose.</p></>}</section>
            {isBody(item.kind) && item.pose && <section>
              <h3>Pose the figure</h3><p className="muted">Pick a gold joint in the viewport or choose one below. Rotate the colored rings.</p>
              <label>Editing<select aria-label="Editing joint" value={joint ?? ''} onChange={e => setJoint(e.target.value ? e.target.value as Joint : null)}><option value="">Root · whole figure</option>{JOINTS.map(j => <option value={j} key={j}>{label(j)}</option>)}</select></label>
              {joint && <><Vector label="Joint rotation (°)" value={item.pose[joint].map(degrees) as Vec3} min={-360} max={360} step={5} onChange={v => { const p = clone(item.pose!); p[joint] = v.map(radians) as Vec3; editItem({ pose: p }); }} /><button onClick={() => { const p = clone(item.pose!); p[joint] = [0, 0, 0]; editItem({ pose: p }); }}>Reset this joint</button></>}
              <label>Preset pose<select aria-label="Preset pose" value="" onChange={e => { if (e.target.value) { editItem({ pose: preset(e.target.value as typeof PRESETS[number]) }); setJoint(null); } }}><option value="">Choose a starting pose…</option>{PRESETS.map(p => <option key={p}>{p}</option>)}</select></label>
              <p className="muted">Presets change joints only. For Seated or Kneeling, lower the root to meet your furniture or floor.</p>
              <div className="two"><button onClick={() => { editItem({ pose: preset('Neutral') }); setJoint(null); }}>Neutral / reset</button><button onClick={() => setTab('library')}>Save pose…</button></div>
            </section>}
            <section><h3>Root transform</h3><Vector label="Position (m)" value={item.position} min={-100} max={100} onChange={position => editItem({ position })} /><Vector label="Rotation (°)" value={item.rotation.map(degrees) as Vec3} min={-360} max={360} step={5} onChange={v => editItem({ rotation: v.map(radians) as Vec3 })} /><Vector label="Scale" value={item.scale} min={0.05} max={10} onChange={scale => editItem({ scale })} /></section>
            {item.kind === 'light' && <section><h3>Real-time studio light</h3><p className="muted">Spot light points from its position toward this target. Rotation does not change aim.</p><Vector label="Light target (m)" value={item.target!} min={-100} max={100} onChange={target => editItem({ target })} /><NumberField label="Intensity" value={item.intensity!} min={0} max={200} step={1} onChange={intensity => editItem({ intensity })} /></section>}
            <section><div className="two"><button onClick={() => { const copy = clone(item); copy.id = crypto.randomUUID(); copy.name = `${item.name.slice(0, 70)} copy`; copy.position[0] += 0.6; update(d => d.items.push(copy)); select(copy.id, null); }} disabled={doc.items.length >= 64 || (item.kind === 'light' && doc.items.filter(i => i.kind === 'light').length >= 8)}>Duplicate</button><button className="danger" onClick={removeSelected}>Delete object</button></div></section>
          </> : <section><h2>Start a study</h2><p>Select a figure or prop in the scene, or add one using the left panel.</p></section>)}
          {tab === 'camera' && <>
            <section><div className="eyebrow">COMPOSE / CAMERA</div><h2>Find your frame</h2><p className="muted">Composition camera is independent of editor navigation.</p><div className="two"><button className={view ? 'active' : ''} onClick={() => setView(!view)}>{view ? 'Editor view' : 'Inspect camera'}</button><button onClick={() => { const c = engine.current?.useEditorCamera(); if (c) editCamera(c); }}>Use editor angle</button></div></section>
            <section><Vector label="Camera position (m)" value={doc.camera.position} min={-100} max={100} onChange={position => editCamera({ position })} /><Vector label="Aim target (m)" value={doc.camera.target} min={-100} max={100} onChange={target => editCamera({ target })} /><NumberField label="Lens (mm)" value={doc.camera.focalLength} min={15} max={150} step={1} onChange={focalLength => editCamera({ focalLength })} /><p className="muted">36 mm film gauge · horizontal fit in landscape · perspective lens.</p><label>Output aspect<select aria-label="Output aspect" value={doc.camera.aspect} onChange={e => editCamera({ aspect: e.target.value as SceneState['camera']['aspect'] })}>{['3:2', '16:9', '1:1', '4:5'].map(a => <option key={a}>{a}</option>)}</select></label><div className="two"><NumberField label="Near clip (m)" value={doc.camera.near} min={0.01} max={Math.min(10, doc.camera.far - 0.01)} onChange={near => editCamera({ near })} /><NumberField label="Far clip (m)" value={doc.camera.far} min={Math.max(1, doc.camera.near + 0.01)} max={500} step={1} onChange={far => editCamera({ far })} /></div></section>
            <section><h3>Depth of field</h3><label className="check"><input type="checkbox" checked={doc.camera.dof} onChange={e => editCamera({ dof: e.target.checked })} />Enable real lens blur</label><p className="muted">Rendered in camera view and PNG only. Off = direct rendering, no postprocessing passes.</p><NumberField label="Focus distance (m)" value={doc.camera.focus} min={0.1} max={100} onChange={focus => editCamera({ focus })} /><NumberField label="Aperture / blur strength" value={doc.camera.aperture} min={0.00001} max={0.005} step={0.00005} onChange={aperture => editCamera({ aperture })} /><NumberField label="Maximum blur" value={doc.camera.maxBlur} min={0.001} max={0.05} step={0.001} onChange={maxBlur => editCamera({ maxBlur })} /><button onClick={() => { const focus = engine.current?.selectedFocusDistance(); if (focus != null) editCamera({ focus }); }} disabled={!item}>Focus on selected object</button></section>
            <section><h3>Stage</h3><label className="color-row">Background<input aria-label="Background color" type="color" value={doc.background} onChange={e => update(d => { d.background = e.target.value; })} /></label><button className="primary wide" onClick={png} disabled={busy}>Export camera PNG</button></section>
          </>}
          {tab === 'library' && <>
            <section><div className="eyebrow">SAVE / LOCAL & PORTABLE</div><h2>Your studies</h2><p className="muted">Local saves stay in this browser. Clearing site data removes them. Same name replaces that local entry.</p><label>Save name<input aria-label="Save name" value={saveName} maxLength={80} onChange={e => setSaveName(e.target.value)} /></label><div className="two"><button className="primary" disabled={busy || !saveName.trim()} onClick={() => save('scene')}>Save scene</button><button disabled={busy || !saveName.trim() || !item || !isBody(item.kind)} onClick={() => save('pose')}>Save pose</button></div></section>
            <section><h3>Portable files</h3><div className="two"><button onClick={() => exportJson('scene')}>Scene JSON ↓</button><button disabled={!item || !isBody(item.kind)} onClick={() => exportJson('pose')}>Pose JSON ↓</button></div><button className="wide" onClick={() => file.current?.click()}>Import pose / scene JSON…</button><p className="muted">Versioned v1 files · max 1 MB / 64 objects / 8 lights. Scene imports replace the scene (undo available). Poses apply to the selected figure; both bodies share the semantic rig.</p>
              <input ref={file} className="sr-only" aria-label="Import JSON file" type="file" accept=".json,application/json" onChange={async e => { const f = e.target.files?.[0]; if (!f) return; try { if (f.size > MAX_FILE_BYTES) throw new Error('File exceeds the 1 MB import limit.'); loadPortable(parseFile(await f.text())); } catch (err) { report(err); } finally { e.target.value = ''; } }} />
            </section>
            <section><h3>Saved on this browser <span className="badge">{saved.length}</span></h3>{saved.length === 0 && <p className="muted">No saved studies yet.</p>}{saved.map(s => <div className="saved-row" key={s.id}><button onClick={() => { try { loadPortable(s.data); } catch (e) { report(e); } }}><strong>{s.name}</strong><small>{label(s.type)} · {new Date(s.savedAt).toLocaleDateString()}</small></button><button aria-label={`Delete saved ${s.name}`} title="Delete this local save" onClick={async () => { try { await deleteLocal(s.id); setSaved(await listSaved()); notify('Local save deleted.'); } catch (e) { report(e); } }}>×</button></div>)}</section>
          </>}
          <section className="view-options"><h3>Viewport helpers</h3><label className="check"><input type="checkbox" checked={showJoints} onChange={e => preference('joints', e.target.checked)} />Selected figure joints</label><label className="check"><input type="checkbox" checked={showHelpers} onChange={e => preference('helpers', e.target.checked)} />Ground grid</label></section>
        </div>
      </aside>
    </div>
    {(loading || loadError) && <div className="boot-overlay"><div className={`boot-card ${loadError ? 'error' : ''}`} role={loadError ? 'alert' : 'status'}><div className="eyebrow">QUATERNIUS / CC0 RIGGED FIGURES</div><h2>{loadError ? 'The figure assets could not be loaded' : 'Opening your figure studio'}</h2><p>{loadError ?? 'Loading the ready-made male and female rigs and their textures from this site. First load is about 30 MB; no scene data is uploaded.'}</p>{loadError && <button className="primary" onClick={() => setRetry(n => n + 1)}>Retry loading figures</button>}<small>Your existing local scenes and poses are not changed.</small></div></div>}
    {notice && <div className={`toast ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}><span>{notice.text}</span><button aria-label="Dismiss notification" onClick={() => setNotice(null)}>×</button></div>}
    {help && <div className="modal-backdrop" onClick={() => setHelp(false)}><div className="modal" role="dialog" aria-modal="true" aria-label="Studio help" onClick={e => e.stopPropagation()}><div className="panel-heading"><h2>A small studio. A clear workflow.</h2><button onClick={() => setHelp(false)} aria-label="Close help">×</button></div><div className="modal-content"><h3>01 / Pose</h3><p>Add or select a male/female figure. Choose a preset, then select a gold joint or use <strong>Editing</strong>. Drag a colored rotation ring or enter neutral-relative XYZ degrees. Reset a joint or the whole pose. Select Root to move the entire figure. No IK, joint limits, animation or finger posing; extreme FK rotations can intersect the body.</p><h3>02 / Compose</h3><p>Add furniture and lights. Move, rotate and scale roots. Light aim is its target, not its Euler rotation. Open Camera, set position/aim/lens/aspect or use the editor angle. Inspect Camera view. Enable lens blur and adjust focus distance. Export PNG always uses this camera, with no helpers. Surface color tints the body texture, not the eyes. Hair color independently colors scalp hair, eyebrows and eyelashes; it follows the head and is saved with the scene, not a pose.</p><h3>03 / Keep your work</h3><p>Save / Load stores named scenes and poses in IndexedDB. Download JSON for portable backups. Import validates the complete file before changing the scene. Both body types share compatible semantic joints, including v1 saves from the earlier procedural figures. Older scenes without hair color open with dark brown hair; existing saves are not rewritten. Reloading starts a fresh stage; load your named save from the library.</p><dl className="shortcuts"><dt>Left drag / right drag / wheel</dt><dd>Orbit / pan / zoom</dd><dt>W / E / R</dt><dd>Whole-object move / rotate / scale</dd><dt>F / C / Escape</dt><dd>Frame selected / camera / root editing</dd><dt>Ctrl Z / Ctrl Shift Z</dt><dd>Undo / redo (up to 100 edits)</dd><dt>Delete / ?</dt><dd>Delete selected / help</dd></dl><p className="muted">Figures: Quaternius Universal Base Characters, free Standard edition, Superhero male/female, CC0. Muscular reference bodies, not medical anatomy. Scalp hair and props are original procedural geometry. Real-time bokeh is a raster approximation, not calibrated f-stop optics. WebGL required. No uploads, telemetry, backend or accounts.</p><button className="primary" onClick={() => setHelp(false)}>Start creating</button></div></div></div>}
  </div>;
}
function label(value: string) { return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^\w/, c => c.toUpperCase()); }
function NumberField({ label: title, displayLabel, value, min, max, step = 0.05, onChange }: { label: string; displayLabel?: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void }) {
  const [draft, setDraft] = useState(String(Number(value.toFixed(5))));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { setDraft(String(Number(value.toFixed(5)))); setInvalid(false); }, [value]);
  const apply = () => {
    const n = Number(draft);
    if (!draft.trim() || !Number.isFinite(n) || n < min || n > max) { setInvalid(true); return; }
    setInvalid(false); if (n !== value) onChange(n);
  };
  return <label className="number-field">{displayLabel ?? title}<input aria-label={title} aria-invalid={invalid} type="number" value={draft} min={min} max={max} step={step} onChange={e => { setDraft(e.target.value); setInvalid(false); }} onBlur={apply} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />{invalid && <small className="error-text">Enter {min} to {max}.</small>}</label>;
}
function Vector({ label: title, value, onChange, min, max, step }: { label: string; value: Vec3; min: number; max: number; step?: number; onChange: (v: Vec3) => void }) {
  return <fieldset className="vector"><legend>{title}</legend><div className="three">{['X', 'Y', 'Z'].map((axis, i) => <NumberField key={axis} label={`${title} ${axis}`} displayLabel={axis} value={value[i]} min={min} max={max} step={step} onChange={n => { const next = [...value] as Vec3; next[i] = n; onChange(next); }} />)}</div></fieldset>;
}
