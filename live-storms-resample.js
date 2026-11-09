// Interpolate calibrated scalar observations before applying a color palette.
// A missing contributor stays missing: never interpolate across land or gaps.
export function bilinearSampler(width,height,read){
  return (x,y)=>{
    if(!Number.isFinite(x)||!Number.isFinite(y)||x<-.5||y<-.5||x>width-.5||y>height-.5)return NaN;
    x=Math.max(0,Math.min(width-1,x));y=Math.max(0,Math.min(height-1,y));
    const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(width-1,x0+1),y1=Math.min(height-1,y0+1),fx=x-x0,fy=y-y0;
    const a=read(x0,y0),b=fx?read(x1,y0):a,c=fy?read(x0,y1):a,d=fx&&fy?read(x1,y1):fy?c:b;
    if(!Number.isFinite(a)||!Number.isFinite(b)||!Number.isFinite(c)||!Number.isFinite(d))return NaN;
    return (a*(1-fx)+b*fx)*(1-fy)+(c*(1-fx)+d*fx)*fy;
  };
}
export function resampleGrid(grid,width,height=width){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<2||height<2||width*height>4194304)throw Error('Invalid display grid.');
  const sample=bilinearSampler(grid.width,grid.height,(x,y)=>grid.values[y*grid.width+x]),values=new Float32Array(width*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)values[y*width+x]=sample((x+.5)*grid.width/width-.5,(y+.5)*grid.height/height-.5);
  return {...grid,width,height,values};
}
