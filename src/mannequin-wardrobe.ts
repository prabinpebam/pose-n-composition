import * as T from 'three';
import type { Figure } from './rig';
import { clothPoseKey, type Garment, type Item, type TrenchGrip, type Vec3 } from './model';
import type { ClothInput } from './clothSettle';
import { getAuthoredSkinPositions } from './bodyProportions';
import { buildHeldFit, HELD_TRENCH, isHeldBeltCut } from './heldTrenchFit';
import { applyGarmentFit, buildFitTopology, clampFitOffset, fitFrames, fitNodeId, type FitTopology } from './garmentFit';

const colors: Record<Garment, string[]> = {
  tank: ['#83b8ad', '#457f78'],
  jacket: ['#425773', '#29394e'],
  trench: ['#bc9369', '#99724e', '#d6b38a', '#795a33'],
  trenchHeld: ['#bc9369', '#99724e', '#d6b38a', '#795a33'],
  skirt: ['#5c485a', '#433743'],
};
interface Panel {
  rows: number; cols: number; ids: Uint16Array; rest: Uint16Array;
  coords: Float32Array; arc: Float32Array;
}
interface Piece { mesh: T.Mesh<T.BufferGeometry, T.MeshStandardMaterial[]>; binds: Uint16Array; panel?: Panel;
  pattern: string; base: Float32Array; travel: Float32Array; applied?: string; tint?: string;
  heldFit?: ReturnType<typeof buildHeldFit>; grip:TrenchGrip; id:Garment;
  authored:Float32Array; authoredTravel:Float32Array; unheld:Float32Array; released:Float32Array;
  topology:FitTopology; fitKey:string; invalidFit?:string }
const outfits = new WeakMap<Figure, Map<Garment, Piece | null>>();
const appearance = new WeakMap<Figure, {slots: Item['wardrobe']; poseKey?: string; error:(e:Error)=>void}>();
const stalePattern = new WeakMap<Figure,string>();
const downloads = new Map<Garment, Promise<ArrayBuffer>>();

function fetchPattern(id: Garment) {
  if(id==='trenchHeld') id='trench';
  let result = downloads.get(id);
  if (!result) {
    const url = new URL(`./wardrobe-assets/${id}.bin`, import.meta.url);
    result = fetch(url).then(r => {
      if (!r.ok) throw new Error(`Cannot load ${id} wardrobe mesh (${r.status})`);
      return r.arrayBuffer();
    }).catch(error => { downloads.delete(id); throw error; });
    downloads.set(id, result);
  }
  return result;
}

export function createGarment(figure: Figure, id: Garment, bytes: ArrayBuffer): Piece {
  const trench = id === 'trench' || id === 'trenchHeld';
  const [bodyCount, count, ...groups] = new Uint32Array(bytes, 0, 6);
  if (bodyCount !== figure.skin.geometry.getAttribute('position').count) throw new Error(`Incompatible ${id} fit topology`);
  const binds = new Uint16Array(bytes, 24, count * 9);
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.BufferAttribute(new Float32Array(count * 3), 3).setUsage(T.DynamicDrawUsage));
  const faces = groups.reduce((a,b) => a+b, 0);
  const sourceIndex=new Uint16Array(bytes,24+binds.byteLength,faces*3);
  geometry.setIndex(new T.BufferAttribute(sourceIndex,1));
  const tail = 24 + binds.byteLength + faces*6;
  const [rows, cols] = new Uint16Array(bytes, tail, 2);
  const panel: Panel | undefined = rows ? { rows, cols, ids: new Uint16Array(bytes,tail+4,rows*cols),
    rest: new Uint16Array(bytes,tail+4+rows*cols*2,rows*cols*2),
    coords: new Float32Array(3*Math.max(rows,cols)), arc: new Float32Array(Math.max(rows,cols)) } : undefined;
  let start = 0;
  groups.forEach((faces, index) => {
    if (faces) geometry.addGroup(start, faces * 3, index);
    start += faces * 3;
  });
  if(id==='trenchHeld') {
    const indices:number[]=[];
    for(const g of geometry.groups) {
      const start=indices.length;
      for(let k=g.start;k<g.start+g.count;k+=3) {
        const a=sourceIndex[k],b=sourceIndex[k+1],c=sourceIndex[k+2];
        if(!isHeldBeltCut(a,b,c)) indices.push(a,b,c);
      }
      g.start=start;g.count=indices.length-start;
    }
    geometry.setIndex(new T.BufferAttribute(Uint16Array.from(indices),1));
  }
  const materials = colors[id].map(color => {
    const mat = new T.MeshStandardMaterial({ color, roughness: .87, side: T.DoubleSide });
    if (trench) {
      mat.onBeforeCompile = shader => {
        shader.uniforms.wardrobeLining = { value: new T.Color('#773f49') };
        shader.fragmentShader = 'uniform vec3 wardrobeLining;\n' + shader.fragmentShader.replace(
          '#include <color_fragment>', '#include <color_fragment>\nif (!gl_FrontFacing) diffuseColor.rgb = wardrobeLining;');
      };
    }
    return mat;
  });
  const mesh = new T.Mesh(geometry, materials);
  mesh.name = `Wardrobe: ${id}`;
  mesh.castShadow = mesh.receiveShadow = true;
  let hash=2166136261;
  for(const byte of new Uint8Array(bytes)) hash=Math.imul(hash^byte,16777619);
  const travel = new Float32Array(count), rest=getAuthoredSkinPositions(figure.root,figure.skin);
  if(!rest) throw new Error('Missing authored garment restraint frame');
  const joints=figure.skin.geometry.getAttribute('skinIndex'), weights=figure.skin.geometry.getAttribute('skinWeight');
  const sleeveBones=figure.skin.skeleton.bones.map(b=>/^(upperarm|lowerarm|hand)/i.test(b.name));
  const patternSpace=new Float32Array(count*3);
  const restGeometry=new T.BufferGeometry();
  restGeometry.setAttribute('position',new T.BufferAttribute(rest,3));
  restGeometry.setIndex(figure.skin.geometry.index);
  restGeometry.computeVertexNormals();
  const restNormals=restGeometry.getAttribute('normal');
  for(let i=0;i<count;i++) {
    let y=0, arm=0;
    for(let k=0;k<4;k++) {
      const donor=binds[i*9+k], w=binds[i*9+k+4]/65535;
      if(!w) continue;
      y+=rest[3*donor+1]*w;
      for(let d=0;d<3;d++) patternSpace[3*i+d]+=rest[3*donor+d]*w;
      if(trench) for(let j=0;j<4;j++) {
        if(sleeveBones[joints.getComponent(donor,j)]) arm+=w*weights.getComponent(donor,j);
      }
    }
    if(id!=='skirt' && (!trench || y>1.11 || arm>.5)) travel[i]=Math.min(id==='tank'?.021:.032, Math.max(0,(1.45-y)*.45));
    // Keep the shoulder yoke sewn and bent sleeves registered to the arms:
    // a chest collision must not push one side of a folded sleeve away.
    if(id==='trenchHeld') travel[i]*=(1-T.MathUtils.smoothstep(y,1.34,1.38))*(1-T.MathUtils.smoothstep(arm,.25,.75));
    // A crossed forearm lies in front of the tensioned placket. Its collision
    // surface must not project individual chest vertices through that arm.
    if(id==='trenchHeld' && i<HELD_TRENCH.loft) {
      const front=T.MathUtils.smoothstep(patternSpace[i*3+2],.005,.045);
      travel[i]*=1-front*(1-T.MathUtils.smoothstep(Math.abs(patternSpace[i*3]),.14,.19));
    }
  }
  // Binding, placket, lapel, welts and buttons remain registered to the fit.
  for(const g of geometry.groups) if(g.materialIndex) {
    for(let k=g.start;k<g.start+g.count;k++) travel[geometry.index!.getX(k)]=0;
  }
  // Rows run from hem up; the upper boundary is sewn in. No crossing the open front.
  if(panel) for(let r=0;r<panel.rows;r++) for(let c=0;c<panel.cols;c++) {
    travel[panel.ids[r*panel.cols+c]]=Math.min(1,(panel.rows-1-r)/6)*(id==='skirt'?.045:.065);
    if(id==='trenchHeld' && (c===0 || c===panel.cols-1)) travel[panel.ids[r*panel.cols+c]]*=.15;
  }
  const heldFit=id==='trenchHeld' ? buildHeldFit((hash>>>0).toString(16),patternSpace) : undefined;
  for(let i=0;i<count;i++) for(let k=0;k<4;k++) {
    const donor=binds[i*9+k],w=binds[i*9+k+4]/65535;
    for(let d=0;d<3;d++) patternSpace[3*i+d]+=binds[i*9+8]/10000*restNormals.getComponent(donor,d)*w;
  }
  restGeometry.dispose();
  if(heldFit) {
    travel[HELD_TRENCH.left]=travel[HELD_TRENCH.right]=0;
    hash=Math.imul(hash^HELD_TRENCH.revision,16777619);
  }
  const pattern=(hash>>>0).toString(16);
  const piece: Piece = { mesh, binds, panel, id, pattern,
    base:new Float32Array(count*3), authored:new Float32Array(count*3), travel, authoredTravel:travel.slice(),
    unheld:new Float32Array(count*3),released:new Float32Array(count*3),
    topology:buildFitTopology(patternSpace,geometry.index!.array,id==='trenchHeld'?[HELD_TRENCH.left,HELD_TRENCH.right]:[]),
    fitKey:'',heldFit,grip:appearance.get(figure)?.slots?.grip??'both' };
  updatePiece(figure, piece);
  return piece;
}

// Slide samples along the *posed cloth contour*, never across the coat opening.
// Keep hem, side rails and hips pinned. Small strains retain their precise surface fit.
function distributePanel(p: Panel, out: T.BufferAttribute) {
  function redistribute(base: number, step: number, count: number, axis: number, blend: number) {
    const {coords,arc,ids,rest} = p;
    let materialLength = 0;
    for (let k=0; k<count; k++) {
      const it = base+k*step, id = ids[it], off=k*3;
      coords[off]=out.getX(id); coords[off+1]=out.getY(id); coords[off+2]=out.getZ(id);
      if (k) {
        arc[k]=arc[k-1]+Math.hypot(coords[off]-coords[off-3],coords[off+1]-coords[off-2],coords[off+2]-coords[off-1]);
        materialLength+=rest[it*2+axis];
      }
    }
    if (!materialLength || arc[count-1]<1e-6) return;
    let j=1, length=0;
    for (let k=1; k<count-1; k++) {
      const it=base+k*step;
      length+=rest[it*2+axis];
      const target=arc[count-1]*length/materialLength;
      // Tolerance also prevents reparameterizing neutral cloth.
      if (Math.abs(target-arc[k]) < .003) continue;
      while (j<count-1 && arc[j]<target) j++;
      const t=(target-arc[j-1])/Math.max(1e-7,arc[j]-arc[j-1]);
      for (let d=0; d<3; d++) {
        const a=coords[(j-1)*3+d], b=coords[j*3+d], original=coords[k*3+d];
        out.setComponent(ids[it],d,original+blend*(a+(b-a)*t-original));
      }
    }
  }
  for (let c=0;c<p.cols;c++) redistribute(c,p.cols,p.rows,0,1);
  const quadrant=(p.cols-1)/4;
  for (let r=0;r<p.rows-1;r++) for (let k=0;k<4;k++) {
    redistribute(r*p.cols+k*quadrant,1,quadrant+1,1,Math.min(1,(p.rows-1-r)/3));
  }
}

function updatePiece(figure: Figure, piece: Piece) {
  const { mesh, binds, panel }=piece;
  const skin = figure.skin, geo = mesh.geometry;
  const p = skin.geometry.getAttribute('position'), n = skin.geometry.getAttribute('normal');
  const out = geo.getAttribute('position') as T.BufferAttribute;
  const gpu = figure.deformation?.bodyType === 'chibi';
  const v = new T.Vector3();
  for (let i = 0, b = 0; i < out.count; ++i, b += 9) {
    const ease = binds[b + 8] / 10000;
    let x = 0, y = 0, z = 0;
    for (let j = 0; j < 4; ++j) {
      const w = binds[b + 4 + j] / 65535;
      if (!w) continue;
      const k = binds[b + j];
      v.set(p.getX(k) + ease * n.getX(k), p.getY(k) + ease * n.getY(k), p.getZ(k) + ease * n.getZ(k));
      // Adult positions already contain the final CPU DQS/corrective solve. Chibi uses GPU LBS.
      if (gpu) skin.applyBoneTransform(k, v);
      x += w * v.x; y += w * v.y; z += w * v.z;
    }
    out.setXYZ(i, x, y, z);
  }
  if (panel) distributePanel(panel, out);
  piece.unheld.set(out.array);
  piece.authored.set(out.array);
  updateFit(figure,piece,appearance.get(figure)?.slots);
  (out.array as Float32Array).set(piece.base);
  piece.applied=undefined;
  out.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
}

function validFit(figure:Figure,piece:Piece,slots:Item['wardrobe']) {
  const fit=slots?.fit?.[piece.id], known=new Set(piece.topology.nodes.map(n=>n.id));
  const invalid=Object.keys(fit??{}).filter(node=>!known.has(node));
  const reason=invalid.join(',');
  if(reason && piece.invalidFit!==reason) {
    const error=new Error(`Ignored unsupported ${piece.id} fit nodes: ${reason}. The garment and supported edits are retained.`);
    const report=appearance.get(figure)?.error;
    if(!report) throw error;
    report(error);
  }
  piece.invalidFit=reason||undefined;
  return fit && Object.fromEntries(Object.entries(fit).filter(([node])=>known.has(node)));
}

function fitKey(slots:Item['wardrobe'],id:Garment) {
  const entries=Object.entries(slots?.fit?.[id]??{}).sort(([a],[b])=>Number(a)-Number(b));
  return entries.length?JSON.stringify(entries):'';
}

function updateFit(figure:Figure, piece:Piece, slots:Item['wardrobe']) {
  piece.travel.set(piece.authoredTravel);
  const fit=validFit(figure,piece,slots);
  if(piece.heldFit) {
    const edited=Object.keys(fit??{}).map(Number);
    piece.authored.set(piece.unheld); piece.released.set(piece.unheld);
    piece.heldFit(figure,new T.BufferAttribute(piece.authored,3),piece.grip,edited);
    piece.heldFit(figure,new T.BufferAttribute(piece.released,3),piece.grip,[HELD_TRENCH.left,HELD_TRENCH.right]);
  }
  applyGarmentFit(piece.id,piece.topology,piece.authored,
    Object.keys(fit??{}).length?fitFrames(figure,piece.binds,Object.keys(fit!).map(node=>fitNodeId(piece.topology,node))):[],
    fit,piece.base,piece.travel);
  piece.fitKey=fitKey(slots,piece.id);
}

/** Returned handles coincide with the displayed mesh, including transient fits and drape. */
export function getGarmentNodes(figure:Figure,id:Garment): {id:string;kind:'edge'|'surface';world:T.Vector3;normal:T.Vector3}[] {
  const piece=outfits.get(figure)?.get(id);
  if(!piece) return [];
  piece.mesh.updateWorldMatrix(true,false);
  const position=piece.mesh.geometry.getAttribute('position');
  const normal=piece.mesh.geometry.getAttribute('normal'),normalMatrix=new T.Matrix3().getNormalMatrix(piece.mesh.matrixWorld);
  return piece.topology.nodes.map(node=>({...node,world:new T.Vector3()
    .fromBufferAttribute(position,Number(node.id)).applyMatrix4(piece.mesh.matrixWorld),
    normal:new T.Vector3().fromBufferAttribute(normal,Number(node.id)).applyNormalMatrix(normalMatrix)}));
}

/** Targets are world points in the posed donor frame. Edited held lapels use the released authored fit, not the palm. */
export function getGarmentOffset(figure:Figure,id:Garment,node:string,world:T.Vector3):Vec3 {
  const piece=outfits.get(figure)?.get(id);
  if(!piece) throw new Error(`The ${id} garment is not loaded`);
  const vertex=fitNodeId(piece.topology,node);
  piece.mesh.updateWorldMatrix(true,false);
  const reference=piece.heldFit && (vertex===HELD_TRENCH.left || vertex===HELD_TRENCH.right)?piece.released:piece.authored;
  const delta=piece.mesh.worldToLocal(world.clone()).sub(new T.Vector3().fromArray(reference,vertex*3));
  delta.applyQuaternion(fitFrames(figure,piece.binds,[vertex])[vertex].invert());
  return clampFitOffset(id,delta).toArray();
}

export function updateWardrobePose(figure: Figure) {
  outfits.get(figure)?.forEach(piece => { if(piece) updatePiece(figure,piece); });
}

function showAppearance(slots: Item['wardrobe'], replay:boolean, id: Garment, piece: Piece, force:boolean) {
  const tint=slots?.colors?.[id] ?? colors[id][0];
  if(piece.tint!==tint) {
    const primary=new T.Color(tint), original=new T.Color(colors[id][0]);
    piece.mesh.material.forEach((m,k)=>{
      m.color.set(colors[id][k]);
      if(tint!==colors[id][0] && !((id==='trench' || id==='trenchHeld') && k===3)) {
        // Preserve value hierarchy between fabric, darker binding and lighter lapels.
        m.color.copy(primary).multiplyScalar(new T.Color(colors[id][k]).getHSL({h:0,s:0,l:0}).l/original.getHSL({h:0,s:0,l:0}).l);
      }
    });
    piece.tint=tint;
  }
  const offsets=replay ? slots?.drape?.layers[id]?.offsets : undefined;
  if(!force && offsets===piece.applied) return false;
  const geo=piece.mesh.geometry, pos=geo.getAttribute('position') as T.BufferAttribute;
  const result=pos.array as Float32Array;
  result.set(piece.base);
  if(offsets) {
    const raw=atob(offsets);
    for(let i=0;i<result.length;i++) result[i]+=((raw.charCodeAt(2*i)|(raw.charCodeAt(2*i+1)<<8))<<16>>16)/10000;
  }
  pos.needsUpdate=true;
  geo.computeVertexNormals(); geo.computeBoundingSphere();
  piece.applied=offsets;
  return true;
}

function refreshOutfit(figure: Figure, changed:()=>void, error:(e:Error)=>void) {
  const outfit=outfits.get(figure), state=appearance.get(figure), slots=state?.slots;
  if(!outfit) return;
  const drape=slots?.drape;
  const updated=new Set<Piece>();
  for(const piece of outfit.values()) if(piece) {
    if(piece.heldFit && piece.grip!==(slots?.grip??'both')) {
      piece.grip=slots?.grip??'both'; updatePiece(figure,piece); updated.add(piece);
    } else if(fitKey(slots,piece.id)!==piece.fitKey) {
      updateFit(figure,piece,slots);
      updated.add(piece);
    }
  }
  let replay=!!drape && drape.poseKey===state?.poseKey && ![...outfit.values()].some(piece=>!piece || piece.invalidFit);
  // A different inner pattern invalidates the outer result too. Wait for every
  // requested layer on reload and reject the whole snapshot on a version mismatch.
  if(replay && drape) for(const [id,piece] of outfit) {
    const stored=drape.layers[id];
    if(!piece || stored?.pattern!==piece.pattern || stored.offsets.length!==piece.base.length/3*8) {
      replay=false;
      const reason=`${id}:${drape.poseKey}:${stored?.pattern}:${piece?.pattern}`;
      if(stalePattern.get(figure)!==reason) {
        stalePattern.set(figure,reason);
        error(new Error(`The ${id} pattern has changed. Using the fitted outfit; settle cloth again to replace the saved drape.`));
      }
      break;
    }
  }
  if(!drape || replay) stalePattern.delete(figure);
  let dirty=false;
  for(const [id,piece] of outfit) if(piece) {
    if(showAppearance(slots,replay,id,piece,updated.has(piece))) dirty=true;
  }
  if(dirty) changed();
}

export function prepareCloth(figure: Figure, item: Item): ClothInput {
  const skin=figure.skin, pos=skin.geometry.getAttribute('position'), v=new T.Vector3();
  const index=skin.geometry.index?.array;
  if(!(index instanceof Uint32Array || index instanceof Uint16Array)) throw new Error('Missing indexed body surface');
  const positions=new Float32Array(pos.count*3);
  if(figure.deformation?.bodyType==='chibi') for(let i=0;i<pos.count;i++) skin.getVertexPosition(i,v).toArray(positions,i*3);
  else positions.set(pos.array);
  skin.updateWorldMatrix(true,false);
  const inv=new T.Matrix3().setFromMatrix4(skin.matrixWorld).invert();
  const gravity=new T.Vector3(0,-9.81,0).applyMatrix3(inv).toArray();
  const layers: ClothInput['layers']=[];
  const w=item.wardrobe;
  for(const id of [w?.tank && 'tank', w?.skirt && 'skirt', w?.outer] as const) if(id) {
    const piece=outfits.get(figure)?.get(id);
    if(!piece) throw new Error('Garment pattern is still loading. Try settling again in a moment.');
    const fit=validFit(figure,piece,w),authored=piece.heldFit?piece.unheld.slice():piece.authored;
    if(piece.heldFit) piece.heldFit(figure,new T.BufferAttribute(authored,3),w?.grip??'both',Object.keys(fit??{}).map(Number));
    const positions=authored.slice(),travel=piece.authoredTravel.slice();
    applyGarmentFit(id,piece.topology,authored,
      Object.keys(fit??{}).length?fitFrames(figure,piece.binds,
        Object.keys(fit!).map(node=>fitNodeId(piece.topology,node))):[],fit,positions,travel);
    layers.push({id,pattern:piece.pattern,positions,travel,index:piece.mesh.geometry.index!.array as Uint16Array});
  }
  if(!layers.length) throw new Error('Equip a garment before settling.');
  return { body:{positions,index}, layers, gravity, poseKey:clothPoseKey(item) };
}

export function syncWardrobe(figure: Figure, slots: Item['wardrobe'], changed: () => void, error: (e: Error) => void, poseKey?:string) {
  if (figure.modelId !== 'mannequin-female') return;
  let outfit = outfits.get(figure);
  if (!slots && !outfit) return;
  appearance.set(figure,{slots,poseKey,error});
  const wanted = new Set<Garment>();
  if (slots?.tank) wanted.add('tank');
  if (slots?.skirt) wanted.add('skirt');
  if (slots?.outer) wanted.add(slots.outer);
  if (!outfit && !wanted.size) return;
  if (!outfit) outfits.set(figure, outfit = new Map());
  for (const [id, piece] of outfit) {
    if (wanted.has(id)) continue;
    if (piece) {
      piece.mesh.removeFromParent();
      piece.mesh.geometry.dispose();
      piece.mesh.material.forEach(m => m.dispose());
    }
    outfit.delete(id);
  }
  if (!wanted.size) outfits.delete(figure);
  for (const id of wanted) {
    if (outfit.has(id)) continue;
    outfit.set(id, null);
    void fetchPattern(id).then(bytes => {
      if (outfit.get(id) !== null || !figure.root.parent) return;
      const piece = createGarment(figure, id, bytes);
      figure.skin.add(piece.mesh);
      outfit.set(id, piece);
      refreshOutfit(figure,changed,error);
      changed();
    }).catch(e => { outfit.delete(id); error(e); });
  }
  refreshOutfit(figure,changed,error);
}
