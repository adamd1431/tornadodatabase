// Small deterministic squared-error gradient-boosted regression trees.
// Training is offline. Browser inference imports only the fitted JSON trees.
import {predictBoosted,evaluationMetrics} from './satellite-intensity-model.js';
const average=rows=>rows.reduce((s,r)=>s+r.y*r.w,0)/rows.reduce((s,r)=>s+r.w,0);
function fitTree(rows,depth,minLeaf){
  const value=average(rows);if(!depth||rows.length<2*minLeaf)return {value};
  let best=null;
  for(let feature=0;feature<rows[0].x.length;feature++){
    const sorted=[...rows].sort((a,b)=>a.x[feature]-b.x[feature]);
    const totalW=sorted.reduce((s,r)=>s+r.w,0),totalY=sorted.reduce((s,r)=>s+r.y*r.w,0);let lw=0,ly=0;
    for(let i=0;i<sorted.length-1;i++){
      lw+=sorted[i].w;ly+=sorted[i].w*sorted[i].y;
      if(i+1<minLeaf||sorted.length-i-1<minLeaf||sorted[i].x[feature]===sorted[i+1].x[feature])continue;
      const score=ly*ly/lw+(totalY-ly)**2/(totalW-lw);
      if(!best||score>best.score)best={score,feature,threshold:(sorted[i].x[feature]+sorted[i+1].x[feature])/2};
    }
  }
  if(!best)return {value};
  const left=rows.filter(r=>r.x[best.feature]<=best.threshold),right=rows.filter(r=>r.x[best.feature]>best.threshold);
  return {feature:best.feature,threshold:best.threshold,left:fitTree(left,depth-1,minLeaf),right:fitTree(right,depth-1,minLeaf)};
}
export function trainBoosted(rows,{trees=80,rate=.06,depth=2,minLeaf=24}={}){
  if(rows.length<2*minLeaf)throw Error('Not enough labeled examples for training.');
  const counts=new Map();for(const r of rows)counts.set(r.storm,(counts.get(r.storm)||0)+1);
  const data=rows.map(r=>({...r,w:1/counts.get(r.storm)})),model={base:average(data),rate,trees:[]},predicted=rows.map(()=>model.base);
  for(let k=0;k<trees;k++){const tree=fitTree(data.map((r,i)=>({...r,y:r.y-predicted[i]})),depth,minLeaf);model.trees.push(tree);for(let i=0;i<rows.length;i++)predicted[i]=predictBoosted(model,rows[i].x);}
  return model;
}
export function scoreTree(model,rows){return evaluationMetrics(rows.map(r=>({predicted:predictBoosted(model,r.x),observed:r.y})),'predicted','observed');}
