import {spectrumColor} from './live-storms-palette.js';
import {wrapLon} from './live-storms-primary.js';
import {resampleGrid} from './live-storms-resample.js';

export const SCIENTIFIC_SIZE=1800;
const interpolate=(value,table)=>{let i=0;while(i<table.length-2&&value>table[i+1][0])i++;const [a,c]=table[i],[b,d]=table[i+1],f=Math.max(0,Math.min(1,(value-a)/(b-a)));return c.map((v,j)=>Math.round(v+(d[j]-v)*f));};
const WV=[[-90,[78,78,78]],[-80,[80,76,93]],[-70,[105,162,132]],[-60,[151,209,192]],[-50,[120,144,178]],[-40,[233,233,233]],[-30,[179,197,219]],[-20,[184,83,37]],[-10,[221,159,130]],[0,[235,220,213]]];
const SST=[[0,[255,255,255]],[8,[190,166,241]],[14,[80,61,191]],[18,[87,139,161]],[22,[79,182,91]],[26,[56,221,42]],[27,[255,248,38]],[28,[240,173,37]],[29,[237,98,45]],[30,[219,4,48]],[31,[172,0,83]],[32,[150,0,192]]];
export const seaColor=t=>interpolate(Math.floor(t*2)/2,SST);
const colors={sst:seaColor,spectrum:spectrumColor,wv:t=>interpolate(t,WV),vis:t=>{const n=Math.round(255*Math.sqrt(Math.max(0,Math.min(1,t/100))));return [n,n,n];}};
const ranges={sst:[0,32,2],spectrum:[-100,50,10],wv:[-90,0,10],vis:[0,100,10]};
const tick=(n,lat)=>`${Math.abs(Math.round(n*10)/10)}°${lat?(n<0?'S':'N'):(wrapLon(n)<0?'W':'E')}`;
const date=value=>new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:'UTC'}).format(new Date(value)).replace(',','')+' UTC';
const rasters=new WeakMap(),lookups=new Map();
function lookup(kind){
  if(lookups.has(kind))return lookups.get(kind);const [min,max]=ranges[kind],table=new Uint8Array((Math.round((max-min)*20)+1)*3);
  for(let i=0;i<table.length/3;i++)table.set(colors[kind](min+i/20),i*3);lookups.set(kind,table);return table;
}
function raster(grid,kind){
  let cached=rasters.get(grid);if(cached?.kind===kind)return cached;
  // Shading interpolates temperatures before discrete color bands. Native
  // analysis values remain the source for all numerical readouts.
  const g=kind==='sst'?resampleGrid(grid,Math.max(2,Math.round(1400*grid.width/Math.max(grid.width,grid.height))),Math.max(2,Math.round(1400*grid.height/Math.max(grid.width,grid.height)))):grid;
  const canvas=typeof document==='undefined'?new OffscreenCanvas(g.width,g.height):document.createElement('canvas');canvas.width=g.width;canvas.height=g.height;const ctx=canvas.getContext('2d'),image=ctx.createImageData(g.width,g.height),table=lookup(kind),[min,max]=ranges[kind];let low=Infinity,high=-Infinity;
  for(let i=0;i<g.values.length;i++){
    const t=g.values[i];if(!Number.isFinite(t))continue;const j=Math.round((Math.max(min,Math.min(max,t))-min)*20)*3,k=i*4;
    image.data[k]=table[j];image.data[k+1]=table[j+1];image.data[k+2]=table[j+2];image.data[k+3]=255;low=Math.min(low,t);high=Math.max(high,t);
  }
  ctx.putImageData(image,0,0);cached={kind,canvas,min:low,max:high};rasters.set(grid,cached);return cached;
}
function centralMaximum(g,storm){
  const b=g.bounds,lon=b.west+((storm.longitude-b.west+720)%360),x0=Math.max(0,Math.floor((lon-1-b.west)/(b.east-b.west)*g.width)),x1=Math.min(g.width-1,Math.ceil((lon+1-b.west)/(b.east-b.west)*g.width)),y0=Math.max(0,Math.floor((b.north-storm.latitude-1)/(b.north-b.south)*g.height)),y1=Math.min(g.height-1,Math.ceil((b.north-storm.latitude+1)/(b.north-b.south)*g.height));let value=-Infinity;
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const t=g.values[y*g.width+x];if(Number.isFinite(t))value=Math.max(value,t);}return value;
}
export function drawScientific(canvas,grids,{kind='spectrum',storm,coastlines,source,satellite,band,validAt,method}={}){
  const size=SCIENTIFIC_SIZE,left=98,top=154,area=1500,right=left+area,b=grids.length===1?grids[0].bounds:{west:storm.longitude-10,east:storm.longitude+10,south:storm.latitude-10,north:storm.latitude+10},sst=kind==='sst',vis=kind==='vis',wv=kind==='wv',[min,max,delta]=ranges[kind];
  canvas.width=size;canvas.height=size;const ctx=canvas.getContext('2d'),x=lon=>left+(storm.longitude+wrapLon(lon-storm.longitude)-b.west)/(b.east-b.west)*area,y=lat=>top+(b.north-lat)/(b.north-b.south)*area;
  ctx.fillStyle='#fff';ctx.fillRect(0,0,size,size);ctx.fillStyle=sst?'#fff':'#0d0f21';ctx.fillRect(left,top,area,area);
  ctx.save();ctx.beginPath();ctx.rect(left,top,area,area);ctx.clip();let low=Infinity,high=-Infinity,center=-Infinity;
  for(const g of grids){const r=raster(g,kind);low=Math.min(low,r.min);high=Math.max(high,r.max);if(!sst&&!vis)center=Math.max(center,centralMaximum(g,storm));ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(r.canvas,x(g.bounds.west),y(g.bounds.north),(g.bounds.east-g.bounds.west)/(b.east-b.west)*area,(g.bounds.north-g.bounds.south)/(b.north-b.south)*area);}
  const step=sst?2:1;ctx.lineWidth=.85;ctx.strokeStyle=sst?'#62766765':'#e8edf17a';ctx.setLineDash([2.5,4]);ctx.beginPath();
  for(let lat=Math.ceil(b.south/step)*step;lat<b.north;lat+=step){ctx.moveTo(left,y(lat));ctx.lineTo(right,y(lat));}
  for(let lon=Math.ceil(b.west/step)*step;lon<b.east;lon+=step){ctx.moveTo(x(lon),top);ctx.lineTo(x(lon),top+area);}ctx.stroke();ctx.setLineDash([]);
  if(coastlines){ctx.strokeStyle=sst||wv?'#172024':'#d181d6';ctx.lineWidth=sst?1.6:1.15;ctx.lineJoin='round';ctx.beginPath();for(const line of coastlines.lines){let previous;for(const [lon,lat]of line){const px=x(lon),py=y(lat);if(previous&&Math.abs(px-previous)<area/2)ctx.lineTo(px,py);else ctx.moveTo(px,py);previous=px;}}ctx.stroke();}
  if(sst){const cx=x(storm.longitude),cy=y(storm.latitude);ctx.strokeStyle='#171a20';ctx.lineWidth=3;ctx.beginPath();ctx.arc(cx,cy,14,0,Math.PI*2);ctx.moveTo(cx,cy-14);ctx.bezierCurveTo(cx-25,cy-53,cx-34,cy-7,cx-13,cy+7);ctx.moveTo(cx,cy+14);ctx.bezierCurveTo(cx+25,cy+53,cx+34,cy+7,cx+13,cy-7);ctx.stroke();}
  ctx.restore();ctx.strokeStyle='#12151b';ctx.lineWidth=2;ctx.strokeRect(left,top,area,area);
  ctx.fillStyle='#12151b';ctx.textAlign='left';ctx.font='500 32px Arial';ctx.fillText(sst?'NOAA Coral Reef Watch · Sea-surface temperature [°C]':`${satellite} · Band ${band} · ${vis?'Visible reflectance [%]':'Brightness temperature [°C]'}`,left,43);
  ctx.textAlign='right';ctx.font='600 17px Arial';ctx.fillStyle='#4c5964';ctx.fillText('TORNADO DATABASE',right,43);ctx.fillStyle='#12151b';ctx.font='24px Arial';ctx.textAlign='left';ctx.fillText(date(validAt||grids[0].validAt),left,84);
  ctx.textAlign='right';ctx.font='600 25px Arial';ctx.fillText(`${storm.name} · ${storm.windKt??'—'} kt${storm.pressureMb?' · '+storm.pressureMb+' mb':''} (advisory)`,right,84);
  ctx.font='19px Arial';ctx.textAlign='left';ctx.fillStyle='#46535e';ctx.fillText('Advisory '+date(storm.validAt),left,121);ctx.textAlign='right';
  if(!sst&&!vis&&Number.isFinite(low))ctx.fillText(`Mapped min: ${low.toFixed(1)}°C · Max within 1° of advisory position: ${Number.isFinite(center)?center.toFixed(1):'—'}°C`,right,121);
  if(sst)ctx.fillText('Daily 5 km analysis · temperature shading in 0.5°C bands',right,121);
  if(vis)ctx.fillText('Reflectance · square-root contrast stretch',right,121);
  ctx.font='23px Arial';ctx.fillStyle='#12151b';for(let lat=Math.ceil(b.south/step)*step;lat<b.north;lat+=step){ctx.textAlign='right';ctx.fillText(tick(lat,true),left-13,y(lat)+7);}
  for(let lon=Math.ceil(b.west/step)*step;lon<b.east;lon+=step){ctx.textAlign='center';ctx.fillText(tick(wrapLon(lon),false),x(lon),top+area+37);}
  const barX=right+28,barY=top+20,barH=area-40,color=colors[kind];for(let i=0;i<barH;i++){const rgb=color(max-i/(barH-1)*(max-min));ctx.fillStyle=`rgb(${rgb.join(',')})`;ctx.fillRect(barX,barY+i,29,1);}
  ctx.strokeStyle='#111';ctx.lineWidth=1.5;ctx.strokeRect(barX,barY,29,barH);ctx.font='22px Arial';ctx.fillStyle='#111';ctx.textAlign='left';
  for(let t=min;t<=max;t+=delta){const py=barY+(max-t)/(max-min)*barH;ctx.beginPath();ctx.moveTo(barX+29,py);ctx.lineTo(barX+36,py);ctx.stroke();ctx.fillText(String(t),barX+43,py+7);}
  ctx.textAlign='left';ctx.font='22px Arial';ctx.fillStyle='#18212a';ctx.fillText(`Plot: Tornado Database · Data: ${source}`,left,1741);
  ctx.font='17px Arial';ctx.fillStyle='#52616a';ctx.fillText(sst?'Native analysis retained for values; bilinear shading preserves land and missing-data masks.':vis?'Native calibrated reflectance; bilinear geographic resampling. No solar-zenith correction.':method||'Calibrated observations; bilinear geographic resampling. No parallax correction.',left,1777);
  return {min:low,max:high,centerMaximum:center};
}
