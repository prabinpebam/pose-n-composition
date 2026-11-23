import { BufferAttribute, MathUtils, Vector3 } from 'three';
import { TRENCH_GRIPS, type HandSide, type TrenchGrip } from './model';
import type { Figure } from './rig';

// Vertices on the inner free boundaries of the two folded lapels. Reject a
// different source bake rather than accidentally binding another body part.
export const HELD_TRENCH = {source:'f450d193', revision:4, left:10811, right:10542, loft:10940} as const;
const loft=HELD_TRENCH.loft, cols=65, belt=loft+31*cols, beltRows=6;
// Cut a loop from each end of the source belt grid. Keep the source index
// buffer immutable: the ordinary trench still uses the continuous band.
export function isHeldBeltCut(a:number,b:number,c:number) {
  if(a<belt || a>=belt+beltRows*cols) return false;
  const col=Math.min((a-belt)%cols,(b-belt)%cols,(c-belt)%cols);
  return col===3 || col===60;
}

function drapeBelt(out:BufferAttribute) {
  for(const sign of [1,-1]) {
    const index=(r:number,c:number)=>belt+r*cols+(sign>0?c:64-c);
    const shell=(r:number,c:number)=>new Vector3().fromBufferAttribute(out,loft+r*cols+(sign>0?c:64-c));
    const up=new Vector3(0,1,0),side=shell(29,12);
    const tangent=shell(29,11).sub(shell(29,13)).setY(0).normalize();
    const normal=tangent.clone().cross(up).multiplyScalar(-sign).normalize();
    // Hang outside the *opened* hip panel. Sampling the shaped surface keeps
    // the belt tails visible rather than burying them in the released waist.
    for(let r=0;r<beltRows;r++) {
      const w=(r/(beltRows-1)-.5)*.034;
      for(let c=0;c<=32;c++) {
        if(sign<0 && c===32) continue;
        let p:Vector3;
        if(c<4) { // Short vertical, raised keeper wrapped over the belt.
          const t=c/3;
          p=side.clone().addScaledVector(normal,.002+.015*Math.sin(Math.PI*t))
            .addScaledVector(up,(t-.5)*.059).addScaledVector(tangent,w*.47);
        } else if(c<=15) {
          const t=(15-c)/11, bend=Math.min(1,t*3.0)*Math.PI/2;
          const row=29-9*t*t, low=Math.floor(row);
          p=shell(low,12).lerp(shell(Math.min(30,low+1),12),row-low)
            .addScaledVector(normal,.007+.012*t)
            .addScaledVector(tangent,.027*Math.sin(t*2)+w*Math.sin(bend))
            .addScaledVector(up,w*Math.cos(bend));
        } else {
          const t=(c-15)/17;
          const col=12+20*t, low=Math.floor(col);
          p=shell(29,low).lerp(shell(29,low+1),col-low);
          const outward=p.clone().sub(shell(29,32).lerp(shell(29,0),.5)).setY(0).normalize();
          p.addScaledVector(outward,.007).addScaledVector(up,w-.015*Math.sin(t*Math.PI/2));
        }
        out.setXYZ(index(r,c),p.x,p.y,p.z);
      }
    }
  }
}

export function buildHeldFit(pattern:string, rest:Float32Array) {
  if(pattern!==HELD_TRENCH.source) throw new Error('The held-open fit needs its matching trench pattern.');
  const panels: Record<HandSide,{i:number;pull:number;roll:number;below:number;rail:number}[]>={left:[],right:[]};
  const waist:{i:number;ease:number}[]=[];
  const smooth=MathUtils.smoothstep;
  // Rest-space front placket profile of the upper shell. The lower loft has
  // explicit left/right rails, down to the hem. Use those rather than distances
  // to the waist: the open fronts hang from their lapels, not a belt anchor.
  const upperRail=(y:number)=>.044-.015*(1-Math.min(1,Math.abs(y-1.25)/.16));
  for(let i=0;i<rest.length/3;i++) {
    const [x,y,z]=rest.subarray(3*i,3*i+3);
    if(i>=belt && i<belt+beltRows*cols) continue;
    const ease=.023*smooth(Math.abs(x),.07,.14)*smooth(y,.86,1.035)*(1-smooth(y,1.11,1.22));
    if(ease) waist.push({i,ease:Math.sign(x)*ease});
    const lower=i>=loft && i<belt;
    const height=1-smooth(y,1.37,1.45);
    const width=lower?1-smooth(Math.min((i-loft)%cols,64-(i-loft)%cols),0,19):1-smooth(Math.abs(x),.055,.192);
    const front=lower?1:smooth(z,-.012,.055);
    const pull=height*width*front;
    const row=lower?Math.floor((i-loft)/cols):MathUtils.clamp(Math.round((y-.433)/.655*29),0,30);
    const rail=loft+row*cols+(x>0?0:64);
    if(pull>0) panels[x>0?'left':'right'].push({i,pull,roll:height*Math.sin(Math.PI*width)*front,
      below:1-smooth(y,1.31,1.35),rail:y<1.10?-1-rail:upperRail(y)});
  }
  return (figure:Figure,out:BufferAttribute,grip:TrenchGrip,released:readonly number[] = []) => {
    for(const {i,ease} of waist) out.setX(i,out.getX(i)+ease);
    const rails=Float32Array.from({length:31*2},(_,k)=>out.getX(loft+Math.floor(k/2)*cols+(k%2)*64));
    for(const edge of ['left','right'] as const) {
      const sign=edge==='left'?1:-1, anchor=new Vector3().fromBufferAttribute(out,HELD_TRENCH[edge]);
      const side=TRENCH_GRIPS[grip].bindings.find(b=>b[1]===edge)?.[0];
      const delta=new Vector3(sign*.015,0,.007);
      const attached=side && !released.includes(HELD_TRENCH[edge]);
      if(attached) {
        const hand=figure.handRigs?.[side], mcp=hand?.fingers.middle?.phalanges[0]?.bone;
        if(!hand || !mcp) throw new Error(`Cannot resolve the ${side} palm on the held-open coat.`);
        delta.copy(figure.skin.worldToLocal(hand.wristBone.getWorldPosition(new Vector3())
          .lerp(mcp.getWorldPosition(new Vector3()),.72))).sub(anchor);
      }
      const bow=Math.min(.035,.28*delta.length());
      const forward=new Vector3().fromBufferAttribute(out,HELD_TRENCH[edge])
        .sub(figure.skin.worldToLocal(figure.bones.chest.getWorldPosition(new Vector3()))).normalize();
      for(const {i,pull,roll,below,rail} of panels[edge]) {
        const railX=rail<0?rails[Math.floor((-rail-1-loft)/cols)*2+(sign<0?1:0)]:rail*sign;
        const dx=delta.x+below*(anchor.x-railX);
        out.setXYZ(i,out.getX(i)+pull*dx+roll*bow*forward.x,
          out.getY(i)+pull*(1-below)*delta.y+roll*bow*forward.y,
          out.getZ(i)+pull*((1-below*.65)*delta.z+.014*below)+roll*bow*forward.z);
      }
      // The falloff shapes the surrounding fabric, not the palm constraint.
      if(attached) out.setXYZ(HELD_TRENCH[edge],anchor.x+delta.x,anchor.y+delta.y,anchor.z+delta.z);
    }
    drapeBelt(out);
  };
}
