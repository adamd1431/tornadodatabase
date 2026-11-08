import {decodeTemperatureGrid,centerMaximum} from './mcfetch-netcdf.js';
import {BD_COLORS} from './mcfetch-bd-colors.js';
const relativeLon=(value,center)=>center+((value-center+540)%360)-180;
const paletteIndex=t=>Math.max(0,Math.min(255,Math.floor((t+90)/120*255)));
let coastlinePromise;
export async function renderTemperaturePlot(bytes,settings,identity={}){
  const grid=decodeTemperatureGrid(bytes),maximum=centerMaximum(grid,settings.latitude,settings.longitude),extent=settings.plotExtent||6.5;
  if(grid.band!==settings.band)throw Error('McFETCH returned a different band from the one requested.');
  const coastlines=settings.map?await(coastlinePromise??=fetch('assets/mcfetch-coastlines.json').then(r=>{if(!r.ok)throw Error('The coastline overlay could not be loaded.');return r.json();}).catch(error=>{coastlinePromise=null;throw error;})):null;
  const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=920;const ctx=canvas.getContext('2d'),left=64,top=70,size=810,west=settings.longitude-extent,north=Math.min(90,settings.latitude+extent),south=Math.max(-90,settings.latitude-extent),east=settings.longitude+extent;
  const x=lon=>left+(relativeLon(lon,settings.longitude)-west)/(east-west)*size,y=lat=>top+(north-lat)/(north-south)*size;
  ctx.fillStyle='#000';ctx.fillRect(0,0,1000,920);ctx.imageSmoothingEnabled=false;
  const xs=new Float64Array(grid.width*grid.height),ys=new Float64Array(xs.length);
  for(let i=0;i<xs.length;i++){const la=grid.latitude[i],lo=grid.longitude[i];xs[i]=Number.isFinite(lo)&&Math.abs(lo)<=360?x(lo):NaN;ys[i]=Number.isFinite(la)&&Math.abs(la)<=90?y(la):NaN;}
  const rgb=t=>{if(settings.enhancement==='BD')return BD_COLORS[paletteIndex(t)];const v=Math.round((30-Math.max(-90,Math.min(30,t)))/120*255);return [v,v,v];},color=t=>`rgb(${rgb(t).join(',')})`;
  const raster=ctx.createImageData(size,size),pixels=raster.data;for(let i=3;i<pixels.length;i+=4)pixels[i]=255;
  ctx.save();ctx.beginPath();ctx.rect(left,top,size,size);ctx.clip();
  for(let row=0;row<grid.height;row++)for(let col=0;col<grid.width;col++){
    const i=row*grid.width+col,cx=xs[i],cy=ys[i],t=grid.temperature[i];if(!Number.isFinite(t)||!Number.isFinite(cx)||!Number.isFinite(cy)||cx<left-20||cx>left+size+20||cy<top-20||cy>top+size+20)continue;
    const r0=Math.max(0,row-1),r1=Math.min(grid.height-1,row+1),c0=Math.max(0,col-1),c1=Math.min(grid.width-1,col+1);
    const rx=(xs[r1*grid.width+col]-xs[r0*grid.width+col])/(r1-r0)*.51,ry=(ys[r1*grid.width+col]-ys[r0*grid.width+col])/(r1-r0)*.51,dx=(xs[row*grid.width+c1]-xs[row*grid.width+c0])/(c1-c0)*.51,dy=(ys[row*grid.width+c1]-ys[row*grid.width+c0])/(c1-c0)*.51;
    if(![rx,ry,dx,dy].every(Number.isFinite))continue;
    const points=[[cx-rx-dx-left,cy-ry-dy-top],[cx-rx+dx-left,cy-ry+dy-top],[cx+rx+dx-left,cy+ry+dy-top],[cx+rx-dx-left,cy+ry-dy-top]],r=rgb(t),minX=Math.max(0,Math.floor(Math.min(...points.map(p=>p[0])))),maxX=Math.min(size-1,Math.ceil(Math.max(...points.map(p=>p[0])))),minY=Math.max(0,Math.floor(Math.min(...points.map(p=>p[1])))),maxY=Math.min(size-1,Math.ceil(Math.max(...points.map(p=>p[1]))));
    // Paint exact, flat-colour geographic cells. Canvas path antialiasing would
    // introduce a visible checkerboard of seams into constant-temperature bands.
    for(let py=minY;py<=maxY;py++)for(let px=minX;px<=maxX;px++){let positive=true,negative=true;for(let k=0;k<4;k++){const a=points[k],b=points[(k+1)%4],cross=(b[0]-a[0])*(py+.5-a[1])-(b[1]-a[1])*(px+.5-a[0]);if(cross<0)positive=false;if(cross>0)negative=false;}if(positive||negative){const j=(py*size+px)*4;pixels[j]=r[0];pixels[j+1]=r[1];pixels[j+2]=r[2];}}
  }
  ctx.putImageData(raster,left,top);
  if(coastlines){ctx.strokeStyle='#20d5d9';ctx.lineWidth=1;ctx.beginPath();for(const line of coastlines.lines){let previous=null;for(const [lon,lat]of line){const px=x(lon),py=y(lat);if(previous&&Math.abs(px-previous[0])<size)ctx.lineTo(px,py);else ctx.moveTo(px,py);previous=[px,py];}}ctx.stroke();}
  ctx.restore();ctx.strokeStyle='#fff';ctx.lineWidth=1;ctx.strokeRect(left,top,size,size);ctx.fillStyle='#fff';ctx.font='14px Arial';
  for(let lat=Math.ceil(south/2)*2;lat<=north;lat+=2){const py=y(lat);ctx.textAlign='right';ctx.fillText(`${Math.abs(lat)}°${lat<0?'S':'N'}`,left-9,py+5);}
  for(let lon=Math.ceil(west/2)*2;lon<=east;lon+=2){const px=left+(lon-west)/(east-west)*size,canonical=((lon+540)%360)-180;ctx.textAlign='center';ctx.fillText(`${Math.abs(canonical)}°${canonical<0?'W':'E'}`,px,top+size+23);}
  const stamp=grid.timestamp,date=`${stamp.slice(8,10)}/${stamp.slice(5,7)}/${stamp.slice(0,4)}`,title1=`MCFETCH Band ${String(grid.band).padStart(2,'0')} Brightness Temperature | ${stamp.slice(11,16)} UTC ${date}`,title2=`${identity.atcf||''} ${String(identity.name||'TROPICAL CYCLONE').toUpperCase()} | Satellite: ${settings.satellite} | Max center temp: ${maximum===null?'unavailable':maximum.toFixed(2)+'°C'}`.trim();
  ctx.textAlign='left';for(const [text,py]of [[title1,27],[title2,53]]){let font=22;while(font>13){ctx.font=`${font}px Arial`;if(ctx.measureText(text).width<=920)break;font--;}ctx.fillText(text,left,py);}
  const bx=897,bw=42;for(let py=0;py<size;py++){ctx.fillStyle=color(30-py/(size-1)*120);ctx.fillRect(bx,top+py,bw,1);}ctx.strokeStyle='#fff';ctx.strokeRect(bx,top,bw,size);ctx.fillStyle='#fff';ctx.font='16px Arial';ctx.textAlign='left';for(let t=30;t>=-90;t-=10)ctx.fillText(String(t),bx+bw+8,top+(30-t)/120*size+5);
  ctx.save();ctx.translate(993,top+size/2);ctx.rotate(-Math.PI/2);ctx.textAlign='center';ctx.font='17px Arial';ctx.fillText(`Brightness Temperature (°C) | Colorscale: ${settings.enhancement==='BD'?'bd':'grayscale'}`,0,0);ctx.restore();
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('The temperature plot could not be created.');
  return {blob,grid,maximum,extent};
}
