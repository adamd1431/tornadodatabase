export const LOOP_DEFAULTS=Object.freeze({frames:30,fps:10,skip:0});
export function loopSettings({frames=30,fps=10,skip=0}={}){
  const values={frames:Number(frames),fps:Number(fps),skip:Number(skip)};
  if(!Number.isInteger(values.frames)||values.frames<2||values.frames>60)throw Error('Choose 2–60 frames.');
  if(!Number.isFinite(values.fps)||values.fps<1||values.fps>30)throw Error('Choose a speed from 1 to 30 frames per second.');
  if(!Number.isInteger(values.skip)||values.skip<0||values.skip>5)throw Error('Skip every must be a whole number from 0 to 5.');
  return values;
}
export function selectLoopFrames(frames,count,skip=0){
  return [...frames].sort((a,b)=>Date.parse(b.validAt)-Date.parse(a.validAt)).filter((_,i)=>i%(skip+1)===0).slice(0,count).reverse();
}
export function satelliteLoopUrl(storm,product='spectrum'){
  return 'satellite-loop.html?'+new URLSearchParams({storm:storm.id,product:['spectrum','wv','vis'].includes(product)?product:'spectrum'});
}
export function gifDimensions(width,height,maxEdge=0){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>4096||height>4096)throw Error('Invalid frame dimensions.');
  if(![0,1200].includes(maxEdge))throw Error('Invalid GIF size.');
  const scale=maxEdge?Math.min(1,maxEdge/Math.max(width,height)):1;
  return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};
}
