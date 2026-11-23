import { Matrix3, Vector3 } from 'three';
import { JOINTS, clone, type Item, type Joint, type Pose, type PosePins, type Vec3 } from './model';
import { evaluatePoseBones, type Figure } from './rig';

export type PoseEdit =
  | { joint: Joint; target: Vector3 }
  | { joint: Joint; rotation: Vec3 };
type PoseState = Required<Pick<Item, 'pose' | 'position'>> & Pick<Item, 'posePins'>;

export const PIN_TOLERANCE_M = 0.0008;
const world = (f: Figure, j: Joint) => f.bones[j].getWorldPosition(new Vector3());
export const capturePin = (f: Figure, j: Joint): Vec3 => f.root.worldToLocal(world(f, j)).toArray();

function chain(f: Figure, joint: Joint, held?: Joint, pins?: PosePins) {
  const ancestors: Joint[] = [];
  // Stop limbs at their socket; reaching with a hand should not turn the pelvis.
  const socket = joint.endsWith('Wrist') || joint.endsWith('Elbow') ? 'Shoulder'
    : joint.endsWith('Ankle') || joint.endsWith('Knee') ? 'Hip' : '';
  for (let p = f.bones[joint].parent; p && p !== f.root; p = p.parent) {
    const j = JOINTS.find(name => f.bones[name] === p);
    if (!j) continue;
    if (j !== held) ancestors.push(j);
    if (pins?.[j] || (socket && j.endsWith(socket)) || ancestors.length >= 2) break;
  }
  return ancestors;
}

// One damped least-squares step. Differentiate the actual rig, including helper bones,
// bind bases and anatomical limits; no inverse bind matrices or vertex work are needed.
function reach(f: Figure, pose: Pose, joint: Joint, target: Vector3, held?: Joint, pins?: PosePins): Pose {
  const origin = world(f, joint), error = target.clone().sub(origin);
  if (error.lengthSq() < 1e-8) return pose;
  const joints = chain(f, joint, held, pins);
  if (!joints.length) return pose;
  const cols: Vector3[] = [], gram = new Matrix3().identity().multiplyScalar(0.0004);
  for (const j of joints) for (let axis = 0; axis < 3; axis++) {
    const trial = clone(pose), h = 0.002;
    trial[j][axis] += h;
    evaluatePoseBones(f, trial);
    let col = world(f, joint).sub(origin).divideScalar(h);
    if (col.lengthSq() < 1e-8) {
      trial[j][axis] -= 2 * h;
      evaluatePoseBones(f, trial);
      col = world(f, joint).sub(origin).divideScalar(-h);
    }
    cols.push(col);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++)
      gram.elements[3 * c + r] += col.getComponent(r) * col.getComponent(c);
  }
  const drive = error.clone().clampLength(0, 0.15).applyMatrix3(gram.invert());
  const steps = cols.map(col => col.dot(drive));
  const gain = Math.min(1, 0.28 / Math.max(0.001, ...steps.map(Math.abs)));
  let best = pose, bestError = error.lengthSq();
  const attempt = (trial: Pose) => {
    const effective = evaluatePoseBones(f, trial), residual = target.distanceToSquared(world(f, joint));
    if (residual < bestError - 1e-12) { best = effective; bestError = residual; }
  };
  for (const fraction of [1, 0.4]) {
    const trial = clone(pose);
    joints.forEach((j, n) => trial[j].forEach((_, a) => { trial[j][a] += fraction * gain * steps[n * 3 + a]; }));
    attempt(trial);
    if (best !== pose) break;
  }
  // A straight two-link limb has zero first-order axial reach. Seed its natural bend
  // with a counter-rotation at the socket, but only accept a measured improvement.
  if (bestError > error.lengthSq() * 0.99 && joints.length === 2 && /Knee|Elbow/.test(joints[0])) {
    const trial = clone(pose), flex = joints[0].endsWith('Knee') ? 0.18 : -0.18;
    trial[joints[0]][0] += flex; trial[joints[1]][0] -= flex * 0.5;
    attempt(trial);
  }
  evaluatePoseBones(f, best);
  return best;
}

/** Leaves bones at the accepted pose. Call setFigurePose once to update skin/wardrobe. */
export function solvePoseEdit(f: Figure, base: PoseState, edit: PoseEdit): PoseState {
  const { root } = f;
  root.position.fromArray(base.position);
  let pose = evaluatePoseBones(f, base.pose);
  const goals = JOINTS.flatMap(j => base.posePins?.[j]
    ? [{ joint: j, target: root.localToWorld(new Vector3(...base.posePins[j])) }] : []);
  const pinnedTarget = base.posePins?.[edit.joint];
  if ('target' in edit && pinnedTarget) return base;
  const isHipsMove = 'target' in edit && edit.joint === 'hips';
  if (isHipsMove && 'target' in edit) {
    const delta = edit.target.clone().sub(world(f, 'hips'));
    root.position.add(delta); // Scene item roots are direct children of the identity stage.
    root.updateMatrixWorld(true);
  } else if ('rotation' in edit) {
    pose = evaluatePoseBones(f, { ...pose, [edit.joint]: edit.rotation });
  }
  const maxDrift = () => goals.reduce((m, g) => Math.max(m, world(f, g.joint).distanceTo(g.target)), 0);
  const active = 'target' in edit && !isHipsMove ? edit.target : null;
  let best: PoseState = base;
  let bestError = active ? world(f, edit.joint).distanceTo(active) : Infinity;
  for (let iter = 0; iter < 12; iter++) {
    if (active) pose = reach(f, pose, edit.joint, active, undefined, base.posePins);
    for (const g of goals) {
      if (world(f, g.joint).distanceTo(g.target) > PIN_TOLERANCE_M * 0.15)
        pose = reach(f, pose, g.joint, g.target, 'rotation' in edit ? edit.joint : undefined, base.posePins);
    }
    const error = active ? world(f, edit.joint).distanceTo(active) : 0;
    if (maxDrift() <= PIN_TOLERANCE_M && error < bestError) {
      bestError = error;
      let pins: PosePins | undefined = base.posePins;
      if (isHipsMove && goals.length) pins = Object.fromEntries(goals.map(g =>
        [g.joint, root.worldToLocal(g.target.clone()).toArray()]));
      best = { pose, position: root.position.toArray(), posePins: pins };
    }
    if (bestError < 0.0004 || (!active && !goals.length)) break;
  }
  root.position.fromArray(best.position);
  evaluatePoseBones(f, best.pose);
  return best;
}
