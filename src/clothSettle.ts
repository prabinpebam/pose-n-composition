import { BufferAttribute, BufferGeometry, Triangle, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { Garment, SettledDrape, Vec3 } from './model';

interface Surface { positions: Float32Array; index: Uint16Array | Uint32Array }
export interface ClothLayer extends Surface {
  id: Garment; pattern: string; travel: Float32Array;
}
export interface ClothInput {
  body: Surface; layers: ClothLayer[]; gravity: Vec3; poseKey: string;
}

function collider(surface: Surface) {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(surface.positions, 3));
  geo.setIndex(new BufferAttribute(surface.index, 1));
  const bvh = new MeshBVH(geo, { indirect: true });
  const hit = { point: new Vector3(), distance: 0, faceIndex: 0 };
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), n = new Vector3(), diff = new Vector3();
  return (p: Vector3, planes: Float32Array, off: number, open: boolean) => {
    planes[off+3] = -Infinity;
    const radius=open ? .035 : .085;
    if (!bvh.closestPointToPoint(p, hit, 0, radius) || hit.distance>radius) return;
    const i = hit.faceIndex*3, ix = surface.index, points = surface.positions;
    Triangle.getNormal(a.fromArray(points,ix[i]*3), b.fromArray(points,ix[i+1]*3), c.fromArray(points,ix[i+2]*3), n);
    const height = diff.subVectors(p,hit.point).dot(n);
    // An open hem is not an infinite plane; reject closest edges approached tangentially.
    if (open && Math.abs(height) < .65*hit.distance) return;
    planes[off]=n.x; planes[off+1]=n.y; planes[off+2]=n.z;
    planes[off+3]=n.dot(hit.point)+(open ? .0028 : .002);
  };
}

function settleLayer(layer: ClothLayer, gravity: Vec3, surfaces: ReturnType<typeof collider>[]) {
  const { positions: base, travel, index } = layer;
  // Fit-space UV splits are coincident but can carry different donor IDs. Weld solver
  // particles only (never edit render topology); fixed trim wins at a shared vertex.
  const ids = new Uint32Array(travel.length), unique = new Map<string, number>();
  const rest: number[] = [], limit: number[] = [];
  for (let i=0;i<ids.length;i++) {
    const j=i*3, key=`${Math.round(base[j]*1e6)},${Math.round(base[j+1]*1e6)},${Math.round(base[j+2]*1e6)}`;
    let id=unique.get(key);
    if (id===undefined) { id=limit.length; unique.set(key,id); rest.push(base[j],base[j+1],base[j+2]); limit.push(travel[i]); }
    else limit[id]=Math.min(limit[id],travel[i]);
    ids[i]=id;
  }
  const p=Float64Array.from(rest), old=p.slice(), count=limit.length;
  const edges=new Map<number,number>(), linksA:number[]=[], linksB:number[]=[], lengths:number[]=[], softness:number[]=[];
  const h=1/160, steps=48;
  function link(a:number,b:number,compliance:number) {
    if (a===b || (!limit[a]&&!limit[b])) return;
    const j=a*3,k=b*3,l=Math.hypot(p[j]-p[k],p[j+1]-p[k+1],p[j+2]-p[k+2]);
    if (l<1e-7) return;
    linksA.push(j); linksB.push(k); lengths.push(l); softness.push(compliance/(h*h));
  }
  for(let k=0;k<index.length;k+=3) for(let s=0;s<3;s++) {
    const a=ids[index[k+s]], b=ids[index[k+(s+1)%3]], c=ids[index[k+(s+2)%3]];
    if(a===b) continue;
    const key=Math.min(a,b)*count+Math.max(a,b), opposite=edges.get(key);
    if(opposite===undefined) { edges.set(key,c); link(a,b,1e-7); }
    else link(opposite,c,.00018); // Cross-hinge chord: inexpensive non-directional bend resistance.
  }
  // Fade freedom geodesically into sewn boundaries. Clipped pattern triangles can
  // be sub-millimetre wide; an abrupt full-travel/pinned transition tears those edges.
  for(let pass=0;pass<10;pass++) {
    for(let s=0;s<lengths.length;s++) {
      const k=pass%2?s:lengths.length-1-s,a=linksA[k]/3,b=linksB[k]/3, allowance=.14*lengths[k];
      limit[a]=Math.min(limit[a],limit[b]+allowance); limit[b]=Math.min(limit[b],limit[a]+allowance);
    }
  }
  const lambda=new Float64Array(lengths.length);
  const contacts=surfaces.map(()=>new Float32Array(count*4)), v=new Vector3();
  for(let step=0;step<steps;step++) {
    for(let i=0;i<count;i++) if(limit[i]) {
      for(let d=0;d<3;d++) {
        const j=i*3+d, x=p[j];
        p[j]+=.86*(x-old[j])+gravity[d]*h*h; old[j]=x;
      }
    }
    // Two Gauss-Seidel sweeps per substep; multipliers span the sweeps, not substeps.
    lambda.fill(0);
    for(let pass=0;pass<2;pass++) for(let s=0,n=lengths.length;s<n;s++) {
      const k=(pass+step)%2?s:n-1-s, a=linksA[k], b=linksB[k];
      const x=p[a]-p[b], y=p[a+1]-p[b+1], z=p[a+2]-p[b+2], l=Math.sqrt(x*x+y*y+z*z);
      if(l<1e-8) continue;
      const wa=limit[a/3]?1:0, wb=limit[b/3]?1:0;
      const dl=(-(l-lengths[k])-softness[k]*lambda[k])/(wa+wb+softness[k]);
      lambda[k]+=dl;
      const t=-dl/l;
      p[a]-=wa*t*x;p[a+1]-=wa*t*y;p[a+2]-=wa*t*z;
      p[b]+=wb*t*x;p[b+1]+=wb*t*y;p[b+2]+=wb*t*z;
    }
    for(let i=0;i<count;i++) if(limit[i]) {
      const j=i*3, o=i*4;
      v.fromArray(p,j);
      const x=v.x-rest[j],y=v.y-rest[j+1],z=v.z-rest[j+2], l=Math.hypot(x,y,z);
      if(l>limit[i]) v.set(rest[j]+x*limit[i]/l,rest[j+1]+y*limit[i]/l,rest[j+2]+z*limit[i]/l);
      for(let check=0;check<(step===steps-1?3:1);check++) for(let k=0;k<surfaces.length;k++) {
        const plane=contacts[k];
        if(step%8===0 || step===steps-1) surfaces[k](v,plane,o,k>0);
        const nx=plane[o],ny=plane[o+1],nz=plane[o+2], push=plane[o+3]-(nx*v.x+ny*v.y+nz*v.z);
        if(push>0) {v.x+=nx*push;v.y+=ny*push;v.z+=nz*push;}
      }
      v.toArray(p,j);
    }
  }
  const result=base.slice(), raw=new Uint8Array(base.length*2), view=new DataView(raw.buffer);
  for(let i=0;i<ids.length;i++) for(let d=0;d<3;d++) {
    const j=i*3+d, k=ids[i]*3+d, ticks=Math.round((p[k]-rest[k])*10000);
    if(!Number.isFinite(ticks)||Math.abs(ticks)>32767) throw new Error('Invalid cloth displacement');
    view.setInt16(j*2,ticks,true); result[j]+=ticks/10000;
  }
  let text='';
  for(let k=0;k<raw.length;k+=8192) text+=String.fromCharCode(...raw.subarray(k,k+8192));
  return { result, offsets:btoa(text) };
}

export function solveCloth(input: ClothInput): SettledDrape {
  const surfaces=[collider(input.body)];
  const layers: SettledDrape['layers']={};
  for(const layer of input.layers) {
    const { result, offsets }=settleLayer(layer,input.gravity,surfaces);
    layers[layer.id]={ pattern:layer.pattern, offsets };
    if(layer!==input.layers.at(-1)) surfaces.push(collider({ positions:result,index:layer.index }));
  }
  return { poseKey:input.poseKey, layers };
}
