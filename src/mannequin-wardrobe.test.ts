import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as T from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { afterEach, expect, it, vi } from 'vitest';
import { buildExternalFigure } from './external-rig';
import { initialScene, neutralPose, validatePortable } from './model';
import { setFigurePose } from './rig';
import { syncWardrobe } from './mannequin-wardrobe';
import { loadMannequinTestFixtures } from './testMannequinFixtures';
import { evaluateStandardLbsPositions } from './skinDeformer';

afterEach(() => vi.unstubAllGlobals());

function mockPatterns() {
  vi.stubGlobal('fetch', async (url: URL) => new Response(new Uint8Array(readFileSync(
    resolve(__dirname, 'wardrobe-assets', url.pathname.split('/').pop()!)))));
}

it('measures sleeve transfer error, opposite-arm drift, welded seams and skirt edge strain across stress poses', async () => {
  const f = buildExternalFigure('female', (await loadMannequinTestFixtures()).get('female')!, '#cca885');
  new T.Scene().add(f.root);
  mockPatterns();
  f.deformation = { bodyType: 'realistic', limitMode: 'anatomical' };
  const neutral = neutralPose();
  setFigurePose(f, neutral);
  let loaded = 0;
  syncWardrobe(f, { outer: 'jacket', skirt: true }, () => loaded++, e => { throw e; });
  await vi.waitFor(() => expect(loaded).toBe(2));
  const mesh = (id: string) => f.skin.getObjectByName(`Wardrobe: ${id}`) as T.Mesh<T.BufferGeometry>;
  const jacket = mesh('jacket').geometry, skirt = mesh('skirt').geometry;
  const j = jacket.getAttribute('position'), s = skirt.getAttribute('position');
  const point = (a: typeof j, i: number) => new T.Vector3().fromBufferAttribute(a, i);
  const rest = Array.from({ length: j.count }, (_, i) => point(j, i));
  const data = readFileSync(resolve(__dirname, 'wardrobe-assets/jacket.bin'));
  const bind = new Uint16Array(data.buffer, data.byteOffset + 24, j.count*9);
  const p = f.skin.geometry.getAttribute('position'), n = f.skin.geometry.getAttribute('normal');
  const pairs: [number,number][] = [], seen = new Map<string, number>();
  for (let i=0; i<rest.length; i++) {
    const key = rest[i].toArray().map(v => Math.round(v*1e6)).join(':');
    const other = seen.get(key);
    if (other !== undefined) pairs.push([other,i]);
    else seen.set(key,i);
  }
  expect(pairs.length).toBeGreaterThan(30);
  const edges = new Map<number, [number, number, number]>();
  const ix = skirt.index!;
  for (let k=0;k<ix.count;k+=3) for (let l=0;l<3;l++) {
    const a=ix.getX(k+l), b=ix.getX(k+(l+1)%3);
    const length=point(s,a).distanceTo(point(s,b));
    if (length>.003) edges.set(Math.min(a,b)*s.count+Math.max(a,b),[a,b,length]);
  }
  const cases: Record<string, Partial<typeof neutral>> = {
    raised:{leftShoulder:[0,0,1.9]}, bent:{leftShoulder:[0,0,.5],leftElbow:[-1.55,.42,0]},
    twist:{chest:[0,.48,0],leftElbow:[-.54,.96,0]},
    thigh:{leftHip:[-1.3,0,.1],leftKnee:[1.5,0,0]},
    seated:{leftHip:[-1.3,0,.1],leftKnee:[1.5,0,0],rightHip:[-1.3,0,-.1],rightKnee:[1.5,0,0]},
    reset:{},
  };
  const rows = [];
  for (const [name, change] of Object.entries(cases)) {
    setFigurePose(f, { ...neutral, ...change });
    const lbs = evaluateStandardLbsPositions(f);
    let sumLbs=0, sumSurface=0, samples=0, right=0;
    for (let i=0;i<rest.length;i++) {
      if (rest[i].x<-.17 && rest[i].y<1.2) right=Math.max(right,rest[i].distanceTo(point(j,i)));
      // Single-source sleeve vertices: transferred joint indices and normalized
      // weights are exactly those of this donor. Compare at zero ease to isolate rig error.
      if (bind[9*i+4]!==65535 || rest[i].x<.13 || rest[i].y<.91) continue;
      const id=bind[9*i], offset=point(n,id).multiplyScalar(bind[9*i+8]/10000);
      const body=f.skin.getVertexPosition(id,new T.Vector3());
      sumLbs+=body.distanceToSquared(new T.Vector3().fromArray(lbs,id*3));
      sumSurface+=body.distanceToSquared(point(j,i).sub(offset));
      samples++;
    }
    const stretch=[...edges.values()].map(([a,b,len])=>point(s,a).distanceTo(point(s,b))/len).sort((a,b)=>a-b);
    const seam=Math.max(...pairs.map(([a,b])=>point(j,a).distanceTo(point(j,b))));
    const rmsLbs=1000*Math.sqrt(sumLbs/samples), rmsSurface=1000*Math.sqrt(sumSurface/samples);
    expect(samples).toBeGreaterThan(500);
    expect(rmsSurface).toBeLessThan(.002);
    if (name==='bent') expect(rmsLbs).toBeGreaterThan(.5);
    if (name==='raised'||name==='bent') expect(right).toBeLessThan(.001);
    if (name==='thigh') expect(stretch[Math.floor(stretch.length*.99)]).toBeLessThan(2);
    if (name==='seated') expect(stretch[Math.floor(stretch.length*.99)]).toBeLessThan(1.6);
    expect(seam).toBeLessThan(.001);
    if (name==='reset') expect(Math.max(...rest.map((v,i)=>v.distanceTo(point(j,i))))).toBeLessThan(.00001);
    rows.push({name,rmsLbs,rmsSurface,oppositeMm:right*1000,seamMm:seam*1000,
      skirtP01:stretch[Math.floor(stretch.length*.01)], skirtP99:stretch[Math.floor(stretch.length*.99)],
      skirtMax:stretch.at(-1)});
  }
  // Compare to the actual rendered body in world space after rotating/translating the root.
  f.root.position.set(1.3,-.2,2); f.root.rotation.set(.1,.6,-.08);
  for (const bodyType of ['chubby','chibi','realistic'] as const) {
    f.deformation.bodyType=bodyType;
    setFigurePose(f,{...neutral,...cases.bent});
    for (let i=0;i<rest.length;i+=73) {
      if (bind[i*9+4]!==65535) continue;
      const k=bind[i*9], actual=point(j,i).applyMatrix4(mesh('jacket').matrixWorld);
      const anchor=f.skin.getVertexPosition(k,new T.Vector3()).applyMatrix4(f.skin.matrixWorld);
      // The sleeve fold is authored per vertex. Chibi LBS can foreshorten its normal.
      const ease = bind[i*9+8]/10000;
      expect(actual.distanceTo(anchor)).toBeLessThan(ease+.0001);
      expect(actual.distanceTo(anchor)).toBeGreaterThan(ease/3);
    }
  }
  console.table(rows);
});

it('round-trips independent layers only for Mannequin Female without changing dress maps', () => {
  const scene = initialScene();
  for (const item of scene.items.filter(i => i.kind === 'female' || i.kind === 'male')) {
    item.wardrobe = { tank: true, skirt: true, outer: 'trench' };
    item.dressMapId = 'patterned-signature';
  }
  const parsed = validatePortable(JSON.parse(JSON.stringify(scene)));
  if (parsed.type !== 'scene') throw new Error('Expected scene');
  const female = parsed.items.find(i => i.kind === 'female')!;
  expect(female.wardrobe).toEqual({ tank: true, skirt: true, outer: 'trench' });
  expect(female.dressMapId).toBe('patterned-signature');
  expect(parsed.items.find(i => i.kind === 'male')!.wardrobe).toBeUndefined();
  expect(() => validatePortable({ ...scene, items: [{ ...female, wardrobe: { outer: 'unknown' } }] })).toThrow();
});

it('keeps a real opening and body clearance on both sides of a posed, layered figure', async () => {
  const templates = await loadMannequinTestFixtures();
  const f = buildExternalFigure('female', templates.get('female')!, '#cca885');
  new T.Scene().add(f.root);
  const pose = neutralPose();
  f.deformation = { bodyType: 'realistic', limitMode: 'anatomical' };
  setFigurePose(f, pose);
  mockPatterns();
  let loaded = 0;
  syncWardrobe(f, { tank: true, skirt: true, outer: 'trench' }, () => loaded++, e => { throw e; });
  await vi.waitFor(() => expect(loaded).toBe(3));
  const garment = (id: string) => f.skin.getObjectByName(`Wardrobe: ${id}`) as T.Mesh<T.BufferGeometry>;
  const coat = garment('trench'), tank = garment('tank'), skirt = garment('skirt');
  const hits = (mesh: T.Mesh, x: number, y: number) => new T.Raycaster(
    new T.Vector3(x, y, 1), new T.Vector3(0, 0, -1)).intersectObject(mesh, false).map(h => h.point.z);
  const opening = hits(coat, .001, 1.19);
  expect(opening.length).toBeGreaterThan(0); // The back exists.
  expect(Math.max(...opening)).toBeLessThan(0); // No hidden front face spanning the opening.
  expect(Math.max(...hits(tank, .001, 1.19))).toBeGreaterThan(0);
  // The front knit bridges the hollow below the bust rather than tracking
  // skin at a constant normal offset.
  const frontAt = (m: T.Mesh, x: number, y: number) => Math.max(...hits(m, x, y));
  const underbust = frontAt(tank, .077, 1.205) - frontAt(f.skin, .077, 1.205);
  expect(Number.isFinite(underbust)).toBe(true);
  expect(underbust).toBeGreaterThan(.015);
  expect(underbust).toBeLessThan(.04);
  const checkLayers = (inner: T.Mesh, x: number, y: number) => {
    const a = hits(inner, x, y), b = hits(coat, x, y);
    expect(a.length).toBeGreaterThan(1);
    expect(b.length).toBeGreaterThan(1);
    expect(Math.max(...b) - Math.max(...a)).toBeGreaterThan(.003);
    expect(Math.min(...a) - Math.min(...b)).toBeGreaterThan(.003);
  };
  checkLayers(tank, .077, 1.205);
  checkLayers(skirt, .08, .82);
  // Check the actual loft polygon, not a fitted bounding box. Its projected area
  // vector is independent of ring orientation (the seated hem is nearly vertical).
  function hem(id: 'skirt' | 'trench') {
    const bytes = readFileSync(resolve(__dirname,'wardrobe-assets',id+'.bin'));
    const offset = 24 + bytes.readUInt32LE(4)*18 +
      [8,12,16,20].reduce((sum,k)=>sum+bytes.readUInt32LE(k)*6,0);
    const points = garment(id).geometry.getAttribute('position');
    const count = bytes.readUInt16LE(offset+2);
    const loop = Array.from({length:count}, (_,k)=>new T.Vector3().fromBufferAttribute(points,bytes.readUInt16LE(offset+4+k*2)));
    const area = new T.Vector3();
    for (let k=0;k<count;k++) area.add(new T.Vector3().crossVectors(loop[k],loop[(k+1)%count]));
    return {area:area.length()*.5, gap:loop[0].distanceTo(loop[count-1])};
  }
  const restHems = [hem('skirt'),hem('trench')];
  function penetration(surface: T.BufferGeometry, cloth: T.BufferGeometry, range?: [number,number]) {
    const bvh = new MeshBVH(surface, { indirect:true }), pos=surface.getAttribute('position');
    const samples=cloth.getAttribute('position'), triangle=new T.Triangle(), n=new T.Vector3();
    const q=new T.Vector3(), delta=new T.Vector3(), target={point:new T.Vector3(),distance:0,faceIndex:0};
    let count=0, worst=0, tested=0;
    for(let i=0;i<samples.count;i+=7) {
      q.fromBufferAttribute(samples,i);
      if(range && (q.y<range[0] || q.y>range[1])) continue;
      const hit=bvh.closestPointToPoint(q,target);
      if(!hit) throw new Error('Missing body surface');
      const idx=hit.faceIndex*3, index=surface.index;
      for(const [k,pt] of [triangle.a,triangle.b,triangle.c].entries()) pt.fromBufferAttribute(pos,index?index.getX(idx+k):idx+k);
      const depth=-delta.subVectors(q,hit.point).dot(triangle.getNormal(n));
      tested++;
      if(depth>.002) {count++; worst=Math.max(worst,depth);}
    }
    return {tested,through2mm:count,worstMm:1000*worst};
  }
  console.log('neutral nearest-face diagnostics',penetration(f.skin.geometry,skirt.geometry),
    penetration(f.skin.geometry,coat.geometry));
  const points = coat.geometry.getAttribute('position');
  const nearest = (target: T.Vector3) => {
    let best = Infinity, id = -1;
    for (let i = 0; i < points.count; ++i) {
      const d = new T.Vector3().fromBufferAttribute(points, i).distanceToSquared(target);
      if (d < best) { best = d; id = i; }
    }
    return { id, before: new T.Vector3().fromBufferAttribute(points, id) };
  };
  const probes = [[.17,1.43,0], [.21,1.18,0], [.11,.71,0], [.10,1.31,-.10]]
    .map(v => nearest(new T.Vector3(...v)));
  pose.leftShoulder = [-.14,.05,.56]; pose.leftElbow = [-.83,.05,0];
  pose.leftHip = [-.26,0,.12]; pose.chest = [.02,.14,.03];
  setFigurePose(f, pose);
  for (const { id, before } of probes) {
    expect(new T.Vector3().fromBufferAttribute(points, id).distanceTo(before)).toBeGreaterThan(.005);
  }
  checkLayers(tank, .077, 1.205);
  checkLayers(skirt, .08, .82);
  for (const seated of [false,true]) {
    const stress = neutralPose();
    stress.leftHip = [-1.3,0,.1]; stress.leftKnee = [1.5,0,0];
    if (seated) { stress.rightHip = [-1.3,0,-.1]; stress.rightKnee = [1.5,0,0]; }
    setFigurePose(f, stress);
    const hems = [hem('skirt'),hem('trench')];
    hems.forEach((h,k) => expect(h.area/restHems[k].area).toBeGreaterThan(.4));
    expect(hems[1].gap).toBeGreaterThan(.03);
    expect(hems[0].gap).toBeLessThan(.0001);
    console.log('raised thigh, seated=',seated,'hem area ratios',hems.map((h,i)=>h.area/restHems[i].area),
      'coat gap mm',hems[1].gap*1000);
    console.log('skirt vs body',penetration(f.skin.geometry,skirt.geometry),
      'trench vs body',penetration(f.skin.geometry,coat.geometry));
  }
  f.deformation.bodyType = 'chibi';
  setFigurePose(f, pose);
  expect(coat.geometry.boundingSphere!.radius).toBeGreaterThan(.15);
  expect(coat.geometry.boundingSphere!.radius).toBeLessThan(1);
  syncWardrobe(f, undefined, () => {}, e => { throw e; });
  expect(f.skin.getObjectByName('Wardrobe: trench')).toBeUndefined();
});

it('keeps fold allowance localized, positive and represented in panel rest lengths', () => {
  for (const id of ['tank', 'jacket', 'trench', 'skirt']) {
    const b = readFileSync(resolve(__dirname, 'wardrobe-assets', id+'.bin'));
    const count = b.readUInt32LE(4), groups = [8,12,16,20].map(k => b.readUInt32LE(k));
    const records = new Uint16Array(b.buffer, b.byteOffset+24, 9*count);
    const allowance = Array.from({length:count}, (_,i) => records[9*i+8]/10000);
    expect(Math.min(...allowance)).toBeGreaterThan(0);
    // Leave the jersey quiet; cuff compression on the jacket stores more cloth.
    if (id === 'tank') {
      expect(Math.max(...allowance)).toBeLessThan(.014);
      expect(Math.max(...allowance)-Math.min(...allowance)).toBeGreaterThan(.006);
    }
    if (id === 'jacket') expect(Math.max(...allowance)).toBeGreaterThan(.035);
    const tail = 24+18*count+6*groups.reduce((a,c) => a+c,0);
    const rows = b.readUInt16LE(tail), cols = b.readUInt16LE(tail+2);
    if (!rows) continue;
    const ids = new Uint16Array(b.buffer, b.byteOffset+tail+4, rows*cols);
    const spread = (row: number) => {
      const ring = Array.from(ids.subarray(row*cols,(row+1)*cols), k => allowance[k]);
      return Math.max(...ring)-Math.min(...ring);
    };
    if (id === 'trench') {
      expect(spread(0)).toBeGreaterThan(.025);
      // Open hem has extra contour length, not just bright and dark stripes.
      const rest = new Uint16Array(b.buffer, ids.byteOffset+ids.byteLength, ids.length*2);
      const length = Array.from({length:cols}, (_,c) => rest[2*c+1]/100000).reduce((a,c) => a+c);
      expect(length).toBeGreaterThan(1.25);
    } else {
      expect(spread(0)).toBeLessThan(.001);
      expect(Math.max(...Array.from({length:rows}, (_,r) => spread(r)))).toBeGreaterThan(.008);
    }
  }
});
