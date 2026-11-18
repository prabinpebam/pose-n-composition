export type Vec3 = [number, number, number];
export const JOINTS = ['hips', 'spine', 'chest', 'neck', 'head', 'leftShoulder', 'leftElbow', 'leftWrist', 'rightShoulder', 'rightElbow', 'rightWrist', 'leftHip', 'leftKnee', 'leftAnkle', 'rightHip', 'rightKnee', 'rightAnkle'] as const;
export type Joint = typeof JOINTS[number];
export type Pose = Record<Joint, Vec3>;
export type Body = 'male' | 'female';
export const PROP_KINDS = ['lamp', 'table', 'chair', 'desk', 'couch', 'bed', 'room'] as const;
export type PropKind = typeof PROP_KINDS[number];
export interface Item {
  id: string; name: string; kind: Body | PropKind | 'light'; color: string;
  position: Vec3; rotation: Vec3; scale: Vec3; pose?: Pose; intensity?: number; target?: Vec3;
}
export interface CameraState {
  position: Vec3; target: Vec3; focalLength: number; near: number; far: number;
  aspect: '3:2' | '16:9' | '1:1' | '4:5'; dof: boolean; focus: number; aperture: number; maxBlur: number;
}
export interface SceneState {
  schemaVersion: 1; rigVersion: 1; type: 'scene'; name: string; items: Item[];
  background: string; camera: CameraState;
}
export interface PoseFile { schemaVersion: 1; rigVersion: 1; type: 'pose'; name: string; body: Body; pose: Pose }
export type Portable = SceneState | PoseFile;
export const isBody = (kind: string): kind is Body => kind === 'male' || kind === 'female';
export const neutralPose = (): Pose => Object.fromEntries(JOINTS.map(j => [j, [0, 0, 0]])) as Pose;
export const clone = <T>(value: T): T => structuredClone(value);
export const radians = (degrees: number) => degrees * Math.PI / 180;
export const degrees = (r: number) => r * 180 / Math.PI;
export const PRESETS = ['Neutral', 'Contrapposto', 'Seated', 'Reach', 'Walking', 'Kneeling'] as const;
export function preset(name: typeof PRESETS[number]): Pose {
  const p = neutralPose();
  const set = (j: Joint, x = 0, y = 0, z = 0) => { p[j] = [x, y, z].map(radians) as Vec3; };
  if (name === 'Contrapposto') {
    set('hips', 0, 0, 8); set('chest', 0, -8, -10); set('leftHip', 0, 0, -12);
    set('leftKnee', 18); set('leftShoulder', 0, 0, -18); set('leftElbow', -65, 0, -25); set('head', 0, 16, 0);
  } else if (name === 'Seated') {
    set('leftHip', -85, 0, -4); set('rightHip', -85, 0, 4);
    set('leftKnee', 90); set('rightKnee', 90); set('leftElbow', -65); set('rightElbow', -65);
  } else if (name === 'Reach') {
    set('leftShoulder', -25, 0, -150); set('leftElbow', -25); set('chest', 0, 0, -12);
    set('rightShoulder', 0, 0, 15); set('head', -12, 0, -12);
  } else if (name === 'Walking') {
    set('leftHip', -32); set('rightHip', 25); set('rightKnee', 40);
    set('leftShoulder', 25); set('rightShoulder', -30); set('leftElbow', -25); set('rightElbow', -40);
    set('chest', 0, -9); set('hips', 0, 9);
  } else if (name === 'Kneeling') {
    set('leftHip', -75); set('leftKnee', 85); set('rightHip', 12); set('rightKnee', 125);
    set('leftShoulder', -25); set('rightShoulder', -25); set('leftElbow', -65); set('rightElbow', -65);
  }
  return p;
}
export function createItem(kind: Item['kind'], index = 0): Item {
  const body = isBody(kind);
  return {
    id: crypto.randomUUID(), name: `${kind[0].toUpperCase()}${kind.slice(1)} ${index + 1}`, kind,
    color: body ? (kind === 'male' ? '#b9c9d1' : '#d3b8a5') : kind === 'light' ? '#fff1db' : '#a59987',
    position: [index * 0.6, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
    ...(body ? { pose: neutralPose() } : {}),
    ...(kind === 'light' ? { position: [3, 5, 3] as Vec3, target: [0, 1, 0] as Vec3, intensity: 30 } : {}),
  };
}
export function initialScene(): SceneState {
  const male = createItem('male'); male.position = [-0.5, 0, 0]; male.pose = preset('Contrapposto');
  const female = createItem('female'); female.position = [0.55, 0, 0.05]; female.pose = preset('Neutral'); female.rotation[1] = -0.15;
  return {
    schemaVersion: 1, rigVersion: 1, type: 'scene', name: 'Untitled study',
    items: [male, female, createItem('light')], background: '#343231',
    camera: { position: [3.4, 2.3, 5.7], target: [0, 1, 0], focalLength: 50, near: 0.05, far: 100, aspect: '3:2', dof: false, focus: 6.7, aperture: 0.0015, maxBlur: 0.012 },
  };
}

const fail = (message: string): never => { throw new Error(`Invalid file: ${message}`); };
const obj = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return fail('expected an object');
  return v as Record<string, unknown>;
};
const text = (v: unknown, max = 80): string => typeof v === 'string' && v.length > 0 && v.length <= max ? v : fail('invalid or too-long text');
const num = (v: unknown, lo: number, hi: number): number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : fail(`number must be finite and between ${lo} and ${hi}`);
const vec = (v: unknown, lo = -100, hi = 100): Vec3 => {
  if (!Array.isArray(v) || v.length !== 3) return fail('expected three coordinates');
  return v.map(n => num(n, lo, hi)) as Vec3;
};
const color = (v: unknown): string => typeof v === 'string' && /^#[\da-f]{6}$/i.test(v) ? v : fail('expected #rrggbb color');
const enumValue = <T extends string>(v: unknown, values: readonly T[]): T => typeof v === 'string' && values.includes(v as T) ? v as T : fail('unknown kind or option');
export function validatePose(value: unknown): Pose {
  const p = obj(value);
  if (Object.keys(p).length !== JOINTS.length) fail('pose must contain every semantic joint exactly once');
  return Object.fromEntries(JOINTS.map(j => [j, vec(p[j], -Math.PI * 2, Math.PI * 2)])) as Pose;
}
export function validatePortable(value: unknown): Portable {
  const v = obj(value);
  if (v.schemaVersion !== 1 || v.rigVersion !== 1) fail('unsupported schemaVersion or rigVersion');
  const name = text(v.name);
  if (v.type === 'pose') return { schemaVersion: 1, rigVersion: 1, type: 'pose', name, body: enumValue(v.body, ['male', 'female']), pose: validatePose(v.pose) };
  if (v.type !== 'scene' || !Array.isArray(v.items) || v.items.length > 64) return fail('scene must have at most 64 items');
  const ids = new Set<string>();
  const items = v.items.map(raw => {
    const i = obj(raw);
    const id = text(i.id);
    if (ids.has(id)) fail('duplicate item ID');
    ids.add(id);
    const kind = enumValue(i.kind, ['male', 'female', ...PROP_KINDS, 'light']);
    const item: Item = { id, kind, name: text(i.name), color: color(i.color), position: vec(i.position), rotation: vec(i.rotation, -Math.PI * 2, Math.PI * 2), scale: vec(i.scale, 0.05, 10) };
    if (isBody(kind)) item.pose = validatePose(i.pose);
    if (kind === 'light') { item.intensity = num(i.intensity, 0, 200); item.target = vec(i.target); }
    return item;
  });
  if (items.filter(i => i.kind === 'light').length > 8) fail('at most 8 lights');
  const c = obj(v.camera);
  const near = num(c.near, 0.01, 10), far = num(c.far, 1, 500);
  if (far <= near) fail('far clipping must exceed near clipping');
  const dof = typeof c.dof === 'boolean' ? c.dof : fail('DOF must be boolean');
  return {
    schemaVersion: 1, rigVersion: 1, type: 'scene', name, items, background: color(v.background),
    camera: { position: vec(c.position), target: vec(c.target), focalLength: num(c.focalLength, 15, 150), near, far, aspect: enumValue(c.aspect, ['3:2', '16:9', '1:1', '4:5']), dof, focus: num(c.focus, 0.1, 100), aperture: num(c.aperture, 0.00001, 0.005), maxBlur: num(c.maxBlur, 0.001, 0.05) },
  };
}
export const MAX_FILE_BYTES = 1_000_000;
export function parseFile(source: string): Portable {
  if (new TextEncoder().encode(source).length > MAX_FILE_BYTES) fail('file exceeds 1 MB');
  let value: unknown;
  try { value = JSON.parse(source); } catch { return fail('not valid JSON'); }
  return validatePortable(value);
}
export function poseFile(item: Item, name: string): PoseFile {
  if (!isBody(item.kind) || !item.pose) throw new Error('Select a figure to save a pose.');
  return { schemaVersion: 1, rigVersion: 1, type: 'pose', name, body: item.kind, pose: clone(item.pose) };
}
export function applyPose(item: Item, file: PoseFile): Item {
  if (!isBody(item.kind)) throw new Error('Select a male or female figure before applying a pose.');
  return { ...item, pose: clone(file.pose) };
}
