import {spectrumColor} from './live-storms-palette.js';
const EXTENT=220;
export function plotIntensity(canvas,scan,estimate,{ring=true,small=false}={}){
  const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height,left=small?25:58,top=small?24:60,size=Math.min(w-left-24,h-top-(small?40:92));
  const center=estimate?.eye||scan.center,lat=center.latitude,lon=center.longitude,cos=Math.cos(lat*Math.PI/180),grid=scan.grid;
  const x=value=>left+(value+EXTENT)/(2*EXTENT)*size,y=value=>top+(EXTENT-value)/(2*EXTENT)*size;
  ctx.fillStyle='#07111d';ctx.fillRect(0,0,w,h);ctx.fillStyle='#b9cbd8';ctx.font=`${small?11:17}px Inter, sans-serif`;ctx.fillText(`${scan.satellite||grid.sensor||'Infrared'} · ${grid.timestamp.slice(11,16)} UTC`,left,small?16:30);
  ctx.save();ctx.beginPath();ctx.rect(left,top,size,size);ctx.clip();ctx.fillStyle='#050b14';ctx.fillRect(left,top,size,size);
  // Native calibrated samples are projected for display; no RGB image is used
  // to recover temperatures or train this model.
  const step=Math.max(1,Math.floor(grid.temperature.length/800000)),n=grid.temperature.length;
  const dy=n>grid.width?Math.abs(grid.latitude[grid.width]-grid.latitude[0])*111.195:4;
  const dx=grid.width>1?Math.abs(((grid.longitude[1]-grid.longitude[0]+540)%360)-180)*111.195*cos:4;
  const pw=Math.max(1.3,dx/(2*EXTENT)*size+1),ph=Math.max(1.3,dy/(2*EXTENT)*size+1);
  for(let i=0;i<n;i+=step){const t=grid.temperature[i];if(!Number.isFinite(t))continue;const px=(((grid.longitude[i]-lon+540)%360)-180)*111.195*cos,py=(grid.latitude[i]-lat)*111.195;if(Math.abs(px)>EXTENT+5||Math.abs(py)>EXTENT+5)continue;const c=spectrumColor(t);ctx.fillStyle=`rgb(${c[0]},${c[1]},${c[2]})`;ctx.fillRect(x(px)-pw/2,y(py)-ph/2,pw,ph);}
  ctx.strokeStyle='#ffffff26';ctx.lineWidth=.6;ctx.setLineDash([3,4]);for(const km of [-200,-100,0,100,200]){ctx.beginPath();ctx.moveTo(x(km),top);ctx.lineTo(x(km),top+size);ctx.moveTo(left,y(km));ctx.lineTo(left+size,y(km));ctx.stroke();}ctx.setLineDash([]);
  if(ring&&estimate){ctx.beginPath();ctx.arc(x(0),y(0),estimate.coldRingKm/(2*EXTENT)*size,0,2*Math.PI);ctx.strokeStyle='#8ffce0';ctx.lineWidth=small?1.5:2.5;ctx.stroke();}
  ctx.strokeStyle='#fff';ctx.lineWidth=small?1:2;ctx.beginPath();ctx.moveTo(x(0)-6,y(0));ctx.lineTo(x(0)+6,y(0));ctx.moveTo(x(0),y(0)-6);ctx.lineTo(x(0),y(0)+6);ctx.stroke();ctx.restore();
  ctx.font=`${small?10:14}px Inter, sans-serif`;ctx.fillStyle='#92a9bc';ctx.textAlign='center';for(const km of [-200,0,200])ctx.fillText(String(km),x(km),top+size+20);ctx.textAlign='right';for(const km of [-200,0,200])ctx.fillText(String(km),left-7,y(km)+4);ctx.textAlign='left';
  if(!small){ctx.fillText('Distance from analysis center · km',left,top+size+45);const by=top+size+62;for(let i=0;i<256;i++){const c=spectrumColor(-90+i/255*120);ctx.fillStyle=`rgb(${c[0]},${c[1]},${c[2]})`;ctx.fillRect(left+i/256*size,by,size/256+1,8);}ctx.fillStyle='#9eb4c7';ctx.font='12px Inter, sans-serif';ctx.fillText('−90 °C',left,by+24);ctx.textAlign='right';ctx.fillText('+30 °C',left+size,by+24);ctx.textAlign='left';}
  return {left,top,size,extent:EXTENT,latitude:lat,longitude:lon};
}
