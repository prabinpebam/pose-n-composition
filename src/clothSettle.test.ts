import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as T from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { expect, it, vi } from 'vitest';
import { buildExternalFigure } from './external-rig';
import { clothPoseKey, heldTrenchGesture, initialScene, neutralPose, validatePortable, TRENCH_GRIPS, type TrenchGrip } from './model';
import { HELD_TRENCH } from './heldTrenchFit';
import { setFigurePose } from './rig';
import { prepareCloth, syncWardrobe } from './mannequin-wardrobe';
import { loadMannequinTestFixtures } from './testMannequinFixtures';
import { solveCloth } from './clothSettle';

it.each(Object.keys(TRENCH_GRIPS) as TrenchGrip[])('opens the %s lapel fit, with live palm contact and pose-specific bakes',async(grip)=>{
  const fig=buildExternalFigure('female',(await loadMannequinTestFixtures()).get('female')!,'#cca885');
  new T.Scene().add(fig.root);
  fig.root.rotation.y=.65; fig.root.scale.set(1.1,.92,.9);
  fig.deformation={bodyType:'realistic',limitMode:'anatomical'};
  const scene=initialScene(), item=scene.items.find(i=>i.kind==='female')!;
  Object.assign(item,heldTrenchGesture(grip));
  item.wardrobe={outer:'trench'};
  vi.stubGlobal('fetch',async()=>new Response(new Uint8Array(readFileSync(resolve(__dirname,'wardrobe-assets/trench.bin')))));
  const refresh=()=>syncWardrobe(fig,item.wardrobe,()=>{},e=>{throw e;},clothPoseKey(item));
  const mesh=(id:string)=>fig.skin.getObjectByName(`Wardrobe: ${id}`) as T.Mesh;
  const v=(id:string,i:number)=>new T.Vector3().fromBufferAttribute(mesh(id).geometry.attributes.position,i);
  const gripError=()=>Math.max(...TRENCH_GRIPS[grip].bindings.map(([side,edge])=>{
    const h=fig.handRigs![side];
    const palm=h.wristBone.getWorldPosition(new T.Vector3()).lerp(h.fingers.middle!.phalanges[0].bone.getWorldPosition(new T.Vector3()),.72);
    return mesh('trenchHeld').localToWorld(v('trenchHeld',HELD_TRENCH[edge])).distanceTo(palm);
  }));
  const width=(id:string)=>v(id,HELD_TRENCH.left).x-v(id,HELD_TRENCH.right).x;
  try {
    setFigurePose(fig,item.pose!,item.handPose);refresh();
    await vi.waitFor(()=>expect(mesh('trench')).toBeDefined());
    const ordinary=width('trench');
    const panel=prepareCloth(fig,item).layers[0];
    const plain=panel.positions.slice();
    item.wardrobe.outer='trenchHeld';item.wardrobe.grip=grip;refresh();
    await vi.waitFor(()=>expect(mesh('trenchHeld')).toBeDefined());
    expect(width('trenchHeld')-ordinary).toBeGreaterThan(.04);
    expect(gripError()).toBeLessThan(.0001);
    item.wardrobe.drape=solveCloth(prepareCloth(fig,item));refresh();
    expect(gripError()).toBeLessThan(.0001);
    // A moved point surrounded by stationary cloth would create grip-length
    // spikes. Compare the whole front panel to its same-pose ordinary mesh.
    const shaped=mesh('trenchHeld').geometry.attributes.position.array;
    let worstGrowth=0, worstEdge='';
    const length=(a:ArrayLike<number>,i:number,j:number)=>Math.hypot(a[i]-a[j],a[i+1]-a[j+1],a[i+2]-a[j+2]);
    for(let k=0;k<panel.index.length;k+=3) for(let t=0;t<3;t++) {
      const i=panel.index[k+t]*3,j=panel.index[k+(t+1)%3]*3;
      if(plain[i+2]<0 || plain[i+1]<1.12 || plain[i+1]>1.45) continue;
      const growth=length(shaped,i,j)-length(plain,i,j);
      if(growth>worstGrowth) {worstGrowth=growth;worstEdge=`${i/3}-${j/3} (${length(plain,i,j)} m in ordinary coat)`;}
    }
    expect(worstGrowth,worstEdge).toBeLessThan(.035);
    const [side,edge]=TRENCH_GRIPS[grip].bindings[0], vertex=HELD_TRENCH[edge];
    const held=v('trenchHeld',vertex);
    item.pose![`${side}Elbow`][0]-=.085;setFigurePose(fig,item.pose!,item.handPose);
    expect(v('trenchHeld',vertex).distanceTo(held)).toBeGreaterThan(.01);
    expect(gripError()).toBeLessThan(.0001);
    item.wardrobe.drape=solveCloth(prepareCloth(fig,item));refresh();
    expect(gripError()).toBeLessThan(.0001);
    expect(width('trenchHeld')-ordinary).toBeGreaterThan(.02);
    delete item.wardrobe.drape;refresh();
    expect(gripError()).toBeLessThan(.0001);
  } finally {vi.unstubAllGlobals();}
});

it('discards obsolete attachments and their baked offsets, not the outfit or pose',()=>{
  const scene=initialScene(), i=scene.items.find(i=>i.kind==='female')!;
  const wardrobe={outer:'trench' as const, tank:true as const, colors:{trench:'#123456'}};
  i.wardrobe=wardrobe;
  Object.assign(i.wardrobe,{pins:[{garment:'trench',target:'rightPalm',vertex:19}],
    drape:{poseKey:clothPoseKey(i),layers:{}}});
  const restored=validatePortable(scene);
  expect(restored.type==='scene' && restored.items.find(j=>j.id===i.id)).toMatchObject({
    pose:i.pose,wardrobe:{outer:'trench',tank:true,colors:{trench:'#123456'}}});
  const slots=restored.type==='scene' && restored.items.find(j=>j.id===i.id)!.wardrobe;
  expect(slots).not.toHaveProperty('pins');expect(slots).not.toHaveProperty('drape');
});

it('settles and replays current fitted patterns against posed body and inner layers', async () => {
  const fig=buildExternalFigure('female',(await loadMannequinTestFixtures()).get('female')!,'#cca885');
  new T.Scene().add(fig.root);
  const scene=initialScene(), item=scene.items.find(i=>i.kind==='female')!;
  vi.stubGlobal('fetch',async (url:URL)=>new Response(new Uint8Array(readFileSync(
    resolve(__dirname,'wardrobe-assets',url.pathname.split('/').pop()!)))));
  const refresh=()=>syncWardrobe(fig,item.wardrobe,()=>{},e=>{throw e;},clothPoseKey(item));
  const geo=(id:string)=>(fig.skin.getObjectByName(`Wardrobe: ${id}`) as T.Mesh<T.BufferGeometry>).geometry;
  try {
    fig.deformation={bodyType:'realistic',limitMode:'anatomical'};
    for(const name of ['neutral','bent','seated'] as const) {
      item.pose=neutralPose();
      if(name==='bent') Object.assign(item.pose,{leftShoulder:[0,0,.5],leftElbow:[-1.55,.42,0]});
      if(name==='seated') Object.assign(item.pose,{
        leftHip:[-1.3,0,.1],leftKnee:[1.5,0,0],rightHip:[-1.3,0,-.1],rightKnee:[1.5,0,0]});
      item.wardrobe=name==='bent'?{outer:'jacket'}:{tank:true,skirt:true,outer:'trench',colors:{trench:'#186d86'}};
      setFigurePose(fig,item.pose); refresh();
      await vi.waitFor(()=>expect(fig.skin.getObjectByName(`Wardrobe: ${item.wardrobe!.outer}`)).toBeDefined());
      const input=prepareCloth(fig,item), start=performance.now(), drape=solveCloth(input);
      const ms=Math.round(performance.now()-start);
      item.wardrobe.drape=drape; refresh();
      const bodyBVH=new MeshBVH(fig.skin.geometry,{indirect:true});
      for(const layer of input.layers) {
        const attr=geo(layer.id).getAttribute('position'), result=attr.array as Float32Array;
        const pinned:number[]=[], sag:number[]=[], strain:number[]=[], contact:number[]=[], fixedContact:number[]=[];
        const q=new T.Vector3(), hit={point:new T.Vector3(),distance:0,faceIndex:0}, tri=new T.Triangle(), n=new T.Vector3();
        for(let i=0;i<layer.travel.length;i++) {
          const k=i*3, d=q.fromArray(layer.positions,k).distanceTo(n.fromArray(result,k));
          if(!layer.travel[i]) pinned.push(d);
          else sag.push(1000*(layer.positions[k+1]-result[k+1]));
          if(i%7===0 && bodyBVH.closestPointToPoint(q.fromArray(result,k),hit)) {
              for(const [a,pt] of [tri.a,tri.b,tri.c].entries()) pt.fromArray(input.body.positions,input.body.index[3*hit.faceIndex+a]*3);
              (layer.travel[i]?contact:fixedContact).push(q.sub(hit.point).dot(tri.getNormal(n))*1000);
          }
        }
        for(let k=0;k<layer.index.length;k+=3) for(let a=0;a<3;a++) {
          const u=layer.index[k+a]*3,v=layer.index[k+(a+1)%3]*3;
          const rest=q.fromArray(layer.positions,u).distanceTo(n.fromArray(layer.positions,v));
          if(rest>.003) strain.push(q.fromArray(result,u).distanceTo(n.fromArray(result,v))/rest);
        }
        const quantile=(values:number[],t:number)=>values.sort((a,b)=>a-b)[Math.floor((values.length-1)*t)];
        const row={pose:name,id:layer.id,ms,pinMaxMm:Math.max(...pinned)*1000,sag95mm:quantile(sag,.95),
          stretch99:quantile(strain,.99),minContactMm:Math.min(...contact),through2mm:contact.filter(v=>v< -2).length,
          tested:contact.length,pinnedThrough2mm:fixedContact.filter(v=>v< -2).length,pinnedTested:fixedContact.length};
        console.log(row);
        expect(row.pinMaxMm).toBe(0); expect(row.sag95mm).toBeGreaterThan(.5);
        expect(row.stretch99).toBeLessThan(1.5);
        expect(row.through2mm).toBeLessThan(Math.max(2,contact.length*.025));
        if(layer.id==='trench') {
          const file=readFileSync(resolve(__dirname,'wardrobe-assets/trench.bin'));
          const tail=24+layer.travel.length*18+layer.index.length*2, cols=file.readUInt16LE(tail+2);
          const ends=[0,cols-1].map(c=>file.readUInt16LE(tail+4+2*c)*3);
          expect(q.fromArray(result,ends[0]).distanceTo(n.fromArray(result,ends[1]))).toBeGreaterThan(.03);
          // Check front AND rear surfaces of the layered garment at the torso,
          // plus an unobstructed ray through the coat opening to the inner top.
          const hits=(id:string,x:number)=>new T.Raycaster(new T.Vector3(x,1.205,1),new T.Vector3(0,0,-1))
            .intersectObject(fig.skin.getObjectByName(`Wardrobe: ${id}`)!,false).map(h=>h.point.z);
          const top=hits('tank',.077), outer=hits('trench',.077);
          expect(Math.max(...outer)-Math.max(...top)).toBeGreaterThan(.001);
          expect(Math.min(...top)-Math.min(...outer)).toBeGreaterThan(.001);
          expect(Math.max(...hits('trench',.001))).toBeLessThan(0);
          for(const g of geo(layer.id).groups.filter(g=>g.materialIndex===2 || g.materialIndex===3))
            for(let k=g.start;k<g.start+g.count;k+=3) expect(layer.travel[layer.index[k]]).toBe(0);
        }
      }
      const saved=validatePortable(JSON.parse(JSON.stringify(scene)));
      if(saved.type!=='scene') throw new Error('Expected scene');
      const restored=saved.items.find(i=>i.id===item.id)!;
      expect(clothPoseKey(restored)).toBe(drape.poseKey);
      expect(restored.wardrobe).toEqual(item.wardrobe);
      if(name==='bent') expect(solveCloth(prepareCloth(fig,item))).toEqual(drape);
      if(name==='seated') {
        // A rebaked inner pattern must invalidate even the unchanged outer layer.
        const invalid=structuredClone(drape);
        invalid.layers.tank!.pattern='bad';
        const warn=vi.fn();
        syncWardrobe(fig,{...item.wardrobe,drape:invalid},()=>{},warn,drape.poseKey);
        expect(warn).toHaveBeenCalledOnce();
        for(const layer of input.layers) expect(geo(layer.id).getAttribute('position').array).toEqual(layer.positions);
      }
      delete item.wardrobe.drape; refresh();
      for(const layer of input.layers) expect(geo(layer.id).getAttribute('position').array).toEqual(layer.positions);
    }
    fig.root.rotation.z=Math.PI/2; fig.root.scale.set(2,.5,1);
    const gravity=prepareCloth(fig,item).gravity;
    expect(gravity[0]).toBeCloseTo(-9.81/2,5); expect(gravity[1]).toBeCloseTo(0,5);
    fig.deformation.bodyType='chibi'; item.bodyType='chibi'; item.wardrobe={skirt:true};
    setFigurePose(fig,item.pose!); refresh();
    const gpu=prepareCloth(fig,item), sample=new T.Vector3(), body=new T.Vector3();
    for(let i=0;i<gpu.body.positions.length/3;i+=233) {
      expect(sample.fromArray(gpu.body.positions,3*i).distanceTo(fig.skin.getVertexPosition(i,body))).toBeLessThan(1e-6);
    }
    item.wardrobe.drape=solveCloth(gpu); refresh();
    expect(geo('skirt').getAttribute('position').array).not.toEqual(gpu.layers[0].positions);
  } finally {vi.unstubAllGlobals();}
});
