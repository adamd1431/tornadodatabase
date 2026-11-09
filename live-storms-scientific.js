import {spectrumColor} from './live-storms-palette.js';
import {wrapLon} from './live-storms-primary.js';
const stops=(value,table)=>{let i=0;while(i<table.length-2&&value>table[i+1][0])i++;const [a,c]=table[i],[b,d]=table[i+1],f=Math.max(0,Math.min(1,(value-a)/(b-a)));return c.map((v,j)=>Math.round(v+(d[j]-v)*f));};
const WV=[[-90,[78,78,78]],[-80,[80,76,93]],[-70,[105,162,132]],[-60,[151,209,192]],[-50,[120,144,178]],[-40,[233,233,233]],[-30,[179,197,219]],[-20,[184,83,37]],[-10,[221,159,130]],[0,[235,220,213]]];
const SST=[[0,[255,255,255]],[8,[190,166,241]],[14,[80,61,191]],[18,[87,139,161]],[22,[79,182,91]],[26,[56,221,42]],[27,[255,248,38]],[28,[240,173,37]],[29,[237,98,45]],[30,[219,4,48]],[31,[172,0,83]],[32,[150,0,192]]];
export const seaColor=t=>stops(Math.floor(t),SST);
const tick=(n,lat)=>`${Math.abs(Math.round(n*10)/10)}°${lat?(n<0?'S':'N'):(wrapLon(n)<0?'W':'E')}`;
function date(value){return new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:'UTC'}).format(new Date(value)).replace(',','')+' UTC';}
export function drawScientific(canvas,grids,{kind='spectrum',storm,coastlines,source,satellite,band,validAt,method}={}){
  const size=1200,left=72,top=94,area=1020,right=left+area,b=grids.length===1?grids[0].bounds:{west:storm.longitude-10,east:storm.longitude+10,south:storm.latitude-10,north:storm.latitude+10},sst=kind==='sst',vis=kind==='vis',wv=kind==='wv',min=sst?0:vis?0:wv?-90:-100,max=sst?32:vis?100:wv?0:50;
  canvas.width=size;canvas.height=size;const ctx=canvas.getContext('2d'),x=lon=>left+(storm.longitude+wrapLon(lon-storm.longitude)-b.west)/(b.east-b.west)*area,y=lat=>top+(b.north-lat)/(b.north-b.south)*area;
  ctx.fillStyle='white';ctx.fillRect(0,0,size,size);ctx.fillStyle=sst?'#fff':'#0d0f21';ctx.fillRect(left,top,area,area);
  const color=sst?seaColor:vis?t=>{const n=Math.round(255*Math.sqrt(Math.max(0,Math.min(1,t/100))));return [n,n,n];}:wv?t=>stops(t,WV):spectrumColor;
  ctx.save();ctx.beginPath();ctx.rect(left,top,area,area);ctx.clip();let low=Infinity,high=-Infinity,center=-Infinity;
  for(const g of grids){const raster=document.createElement('canvas');raster.width=g.width;raster.height=g.height;const rc=raster.getContext('2d'),pixels=rc.createImageData(g.width,g.height);
    for(let i=0;i<g.values.length;i++){const value=g.values[i];if(!Number.isFinite(value))continue;const rgb=color(value);pixels.data.set([...rgb,255],i*4);low=Math.min(low,value);high=Math.max(high,value);
      const lat=g.bounds.north-(Math.floor(i/g.width)+.5)/g.height*(g.bounds.north-g.bounds.south),lon=g.bounds.west+(i%g.width+.5)/g.width*(g.bounds.east-g.bounds.west);if(Math.abs(lat-storm.latitude)<=1&&Math.abs(wrapLon(lon-storm.longitude))<=1)center=Math.max(center,value);
    }rc.putImageData(pixels,0,0);ctx.imageSmoothingEnabled=false;const gx=x(g.bounds.west);ctx.drawImage(raster,gx,y(g.bounds.north),(g.bounds.east-g.bounds.west)/(b.east-b.west)*area,(g.bounds.north-g.bounds.south)/(b.north-b.south)*area);
  }
  const step=sst?2:1;ctx.lineWidth=.7;ctx.strokeStyle=sst?'#667a6f60':'#e8edf16b';ctx.setLineDash([2,3]);ctx.beginPath();for(let lat=Math.ceil(b.south/step)*step;lat<b.north;lat+=step){ctx.moveTo(left,y(lat));ctx.lineTo(right,y(lat));}for(let lon=Math.ceil(b.west/step)*step;lon<b.east;lon+=step){ctx.moveTo(x(lon),top);ctx.lineTo(x(lon),top+area);}ctx.stroke();ctx.setLineDash([]);
  if(coastlines){ctx.strokeStyle=sst||wv?'#172024':'#d181d6';ctx.lineWidth=sst?1.2:.9;ctx.beginPath();for(const line of coastlines.lines){let previous;for(const [lon,lat]of line){const px=x(lon),py=y(lat);if(previous&&Math.abs(px-previous)<area/2)ctx.lineTo(px,py);else ctx.moveTo(px,py);previous=px;}}ctx.stroke();}
  if(sst){const cx=x(storm.longitude),cy=y(storm.latitude);ctx.strokeStyle='#171a20';ctx.lineWidth=3;ctx.beginPath();ctx.arc(cx,cy,10,0,Math.PI*2);ctx.moveTo(cx,cy-10);ctx.bezierCurveTo(cx-18,cy-38,cx-24,cy-5,cx-9,cy+5);ctx.moveTo(cx,cy+10);ctx.bezierCurveTo(cx+18,cy+38,cx+24,cy+5,cx+9,cy-5);ctx.stroke();}
  ctx.restore();ctx.strokeStyle='#12151b';ctx.lineWidth=2;ctx.strokeRect(left,top,area,area);
  ctx.fillStyle='#12151b';ctx.textAlign='left';ctx.font='22px Arial';ctx.fillText(sst?'NOAA Coral Reef Watch sea-surface temperature [°C]':`${satellite} · Band ${band} · ${vis?'visible reflectance [%]':'brightness temperature [°C]'}`,left,30);
  ctx.font='18px Arial';ctx.fillText(date(validAt||grids[0].validAt),left,58);ctx.textAlign='right';ctx.fillText(`${storm.name} · ${storm.windKt??'—'} kt${storm.pressureMb?' · '+storm.pressureMb+' mb':''} (advisory)`,right,58);
  if(!sst){ctx.textAlign='left';ctx.font='14px Arial';ctx.fillText('Advisory '+date(storm.validAt),left,80);ctx.textAlign='right';}
  if(!sst&&!vis&&Number.isFinite(low)){ctx.font='15px Arial';ctx.fillText(`Min: ${low.toFixed(1)}°C · Max within 1° of advisory position: ${Number.isFinite(center)?center.toFixed(1):'—'}°C`,right,80);}
  ctx.font='16px Arial';for(let lat=Math.ceil(b.south/step)*step;lat<b.north;lat+=step){ctx.textAlign='right';ctx.fillText(tick(lat,true),left-9,y(lat)+5);}for(let lon=Math.ceil(b.west/step)*step;lon<b.east;lon+=step){ctx.textAlign='center';ctx.fillText(tick(Math.abs(wrapLon(lon))*(wrapLon(lon)<0?-1:1),false),x(lon),top+area+25);}
  const barX=right+20,barY=top+22,barH=area-44;for(let i=0;i<barH;i++){const t=max-i/(barH-1)*(max-min);ctx.fillStyle='rgb('+color(t).join(',')+')';ctx.fillRect(barX,barY+i,20,1);}ctx.strokeStyle='#111';ctx.strokeRect(barX,barY,20,barH);ctx.font='15px Arial';ctx.fillStyle='#111';ctx.textAlign='left';const delta=sst?2:vis?10:10;for(let t=min;t<=max;t+=delta)ctx.fillText(String(t),barX+28,barY+(max-t)/(max-min)*barH+5);
  ctx.textAlign='left';ctx.font='16px Arial';ctx.fillText(`Plot: Tornado Database · Data: ${source}`,left,1160);ctx.font='13px Arial';ctx.fillStyle='#52616a';ctx.fillText(sst?'Daily 5 km analysis. Marker: advisory position; land and missing cells remain blank.':vis?'Reflectance display uses a square-root contrast stretch; no solar-zenith correction.':method||'Calibrated native observations; nearest-pixel geographic reprojection.',left,1183);
  return {min:low,max:high,centerMaximum:center};
}
