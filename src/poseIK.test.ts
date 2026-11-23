import { beforeAll, expect, it } from 'vitest';
import { Vector3, type Group } from 'three';
import { buildExternalFigure } from './external-rig';
import { clone, initialScene, neutralPose, preset, validatePortable, type Body, type Joint } from './model';
import { capturePin, PIN_TOLERANCE_M, solvePoseEdit } from './poseIK';
import { makeFigure, setFigurePose, type Figure } from './rig';
import { loadMannequinTestFixtures } from './testMannequinFixtures';

const point = (f: Figure, j: Joint) => f.bones[j].getWorldPosition(new Vector3());
let templates: Map<Body, Group>;
beforeAll(async () => { templates = await loadMannequinTestFixtures(); });

it('tracks a known reachable 3D wrist goal on a reflected, scaled coupled mannequin while both ankles stay planted', () => {
  const f = buildExternalFigure('female', templates.get('female')!, '#aaaaaa');
  f.deformation = {bodyType: 'heroic', limitMode: 'anatomical'};
  f.root.position.set(1, 0.4, -2); f.root.rotation.y = 0.7; f.root.scale.set(-1.2, 0.95, 1.1);
  const pose = preset('Relaxed'), targetPose = clone(pose);
  targetPose.leftElbow[0] -= 0.3;
  setFigurePose(f, targetPose);
  const target = point(f, 'leftWrist');
  setFigurePose(f, pose);
  const feet = [point(f, 'leftAnkle'), point(f, 'rightAnkle')];
  const before = point(f, 'leftWrist').distanceTo(target);
  const state = {pose, position: f.root.position.toArray(), posePins: {
    leftAnkle: capturePin(f, 'leftAnkle'), rightAnkle: capturePin(f, 'rightAnkle'),
  }};
  const solved = solvePoseEdit(f, state, {joint: 'leftWrist', target});
  setFigurePose(f, solved.pose);
  expect(before).toBeGreaterThan(0.025);
  expect(point(f, 'leftWrist').distanceTo(target)).toBeLessThan(0.002);
  expect(point(f, 'leftAnkle').distanceTo(feet[0])).toBeLessThan(PIN_TOLERANCE_M);
  expect(point(f, 'rightAnkle').distanceTo(feet[1])).toBeLessThan(PIN_TOLERANCE_M);
});

it('keeps a wrist planted while changing a reachable ancestor rotation, and rejects an impossible one', () => {
  const f = makeFigure('male', '#aaaaaa'), pose = neutralPose();
  pose.leftElbow[0] = -0.85;
  setFigurePose(f, pose);
  const wrist = point(f, 'leftWrist'), position = f.root.position.toArray();
  const pins = {leftWrist: capturePin(f, 'leftWrist')};
  const changed = solvePoseEdit(f, {pose, position, posePins: pins}, {joint: 'chest', rotation: [0.06, 0.02, 0]});
  expect(changed.pose.chest[0]).toBeCloseTo(0.06, 8);
  expect(point(f, 'leftWrist').distanceTo(wrist)).toBeLessThan(PIN_TOLERANCE_M);
  const blocked = solvePoseEdit(f, changed, {joint: 'leftShoulder', rotation: [2, 0, 0]});
  expect(blocked.pose).toEqual(changed.pose);
  expect(point(f, 'leftWrist').distanceTo(wrist)).toBeLessThan(PIN_TOLERANCE_M);
  const free = solvePoseEdit(f, {pose: changed.pose, position}, {joint: 'leftShoulder', rotation: [2, 0, 0]});
  expect(free.pose.leftShoulder[0]).toBe(2);
  expect(point(f, 'leftWrist').distanceTo(wrist)).toBeGreaterThan(0.1);
});

it('bends a straight leg inward and handles unreachable targets without changing segment lengths', () => {
  const f = makeFigure('female', '#aaaaaa'), pose = neutralPose(), position = f.root.position.toArray();
  const ankle = point(f, 'leftAnkle'), target = ankle.clone().add(new Vector3(0, 0.12, 0));
  const len = point(f, 'leftKnee').distanceTo(ankle);
  const bent = solvePoseEdit(f, {pose, position}, {joint: 'leftAnkle', target});
  expect(point(f, 'leftAnkle').distanceTo(target)).toBeLessThan(0.003);
  solvePoseEdit(f, bent, {joint: 'leftAnkle', target: new Vector3(40, -50, 80)});
  expect(point(f, 'leftAnkle').distanceTo(point(f, 'leftKnee'))).toBeCloseTo(len, 8);
});

it('lowers the hips over two planted feet and preserves the captured world targets across drag steps', () => {
  const f = makeFigure('female', '#808080'), pose = neutralPose();
  f.root.rotation.y = 0.9; f.root.scale.set(1.2, 1.05, 0.8);
  setFigurePose(f, pose);
  const feet = [point(f, 'leftAnkle'), point(f, 'rightAnkle')], hips = point(f, 'hips');
  let state: Parameters<typeof solvePoseEdit>[1] = {pose, position: f.root.position.toArray(), posePins: {
    leftAnkle: capturePin(f, 'leftAnkle'), rightAnkle: capturePin(f, 'rightAnkle'),
  }};
  for (const y of [-0.035, -0.07]) {
    const target = hips.clone().add(new Vector3(0, y, 0));
    state = solvePoseEdit(f, state, {joint: 'hips', target});
    expect(point(f, 'hips').distanceTo(target)).toBeLessThan(0.0001);
    expect(point(f, 'leftAnkle').distanceTo(feet[0])).toBeLessThan(PIN_TOLERANCE_M);
    expect(point(f, 'rightAnkle').distanceTo(feet[1])).toBeLessThan(PIN_TOLERANCE_M);
  }
});

it('moves the wrist about its pinned elbow without disturbing the pin', () => {
  const f = makeFigure('female', '#808080'), pose = neutralPose(), position = f.root.position.toArray();
  const targetPose = clone(pose); targetPose.leftElbow[0] = -0.42;
  setFigurePose(f, targetPose);
  const target = point(f, 'leftWrist'), elbow = point(f, 'leftElbow');
  setFigurePose(f, pose);
  solvePoseEdit(f, {pose, position, posePins: {leftElbow: capturePin(f, 'leftElbow')}}, {joint: 'leftWrist', target});
  expect(point(f, 'leftElbow').distanceTo(elbow)).toBeLessThan(PIN_TOLERANCE_M);
  expect(point(f, 'leftWrist').distanceTo(target)).toBeLessThan(0.002);
});

it('validates optional scene pins without adding them to older scenes', () => {
  const scene = initialScene(), body = scene.items.find(i => i.pose)!;
  const roundTrip = () => {
    const parsed = validatePortable(JSON.parse(JSON.stringify(scene)));
    if (parsed.type !== 'scene') throw Error('Expected scene');
    return parsed.items.find(i => i.id === body.id)!;
  };
  expect(roundTrip().posePins).toBeUndefined();
  body.posePins = {leftWrist: [0.22, 0.88, 0.14]};
  expect(roundTrip().posePins).toEqual(body.posePins);
  Object.assign(body.posePins, {leftPaw: [0, 0, 0]});
  expect(roundTrip).toThrow(/unknown pinned joint/);
});
