// Small storm-balanced ridge regression. Fitting is offline; browser inference
// loads only the fitted means/scales/coefficients from the release artifact.
export function fitNativeRidge(rows,lambda=1){
  if(!rows.length||rows.length<rows[0].x.length+5||!Number.isFinite(lambda)||lambda<=0)throw Error('Not enough native training examples or invalid regularization.');
  const p=rows[0].x.length,counts=new Map();for(const r of rows)counts.set(r.storm,(counts.get(r.storm)||0)+1);
  const weights=rows.map(r=>1/counts.get(r.storm)),sw=weights.reduce((a,b)=>a+b,0),means=Array(p).fill(0),scales=Array(p).fill(0);
  rows.forEach((r,k)=>r.x.forEach((x,i)=>means[i]+=weights[k]*x/sw));
  rows.forEach((r,k)=>r.x.forEach((x,i)=>scales[i]+=weights[k]*(x-means[i])**2/sw));for(let i=0;i<p;i++)scales[i]=Math.sqrt(scales[i])||1;
  const intercept=rows.reduce((s,r,k)=>s+weights[k]*r.y,0)/sw,A=Array.from({length:p},(_,i)=>Array.from({length:p+1},(_,j)=>i===j?lambda:0));
  rows.forEach((r,k)=>{const z=r.x.map((x,i)=>(x-means[i])/scales[i]),w=weights[k];for(let i=0;i<p;i++){for(let j=0;j<p;j++)A[i][j]+=w*z[i]*z[j];A[i][p]+=w*z[i]*(r.y-intercept);}});
  for(let i=0;i<p;i++){
    let pivot=i;for(let j=i+1;j<p;j++)if(Math.abs(A[j][i])>Math.abs(A[pivot][i]))pivot=j;
    [A[i],A[pivot]]=[A[pivot],A[i]];const d=A[i][i];if(Math.abs(d)<1e-12)throw Error('The native regression system is singular.');
    for(let j=i;j<=p;j++)A[i][j]/=d;
    for(let k=0;k<p;k++)if(k!==i){const f=A[k][i];for(let j=i;j<=p;j++)A[k][j]-=f*A[i][j];}
  }
  return {means,scales,intercept,coefficients:A.map(r=>r[p]),lambda};
}
